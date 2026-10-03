// background.ts — connection + dispatch layer
//
// Design principles:
//   1. The service worker WILL be killed. Anything it must remember lives in
//      chrome.storage.session (survives SW death, cleared on browser restart),
//      and everything else is re-derived on wake.
//   2. chrome.alarms is the resurrection backstop: if the socket dies AND the
//      SW dies before its in-memory reconnect timer fires, the alarm wakes the
//      SW (~every 30s) and ensureConnected() reconnects. While connected, the
//      server's 10s pings keep the SW alive (WS traffic resets the idle timer,
//      Chrome 116+).
//   3. Tab targeting is explicit ADOPTION, not "whatever tab is active". The
//      agent owns a Sales Nav tab; it doesn't care what the user focuses.
//   4. Content scripts are assumed orphanable (every extension reload orphans
//      them). Every dispatch pings first and re-injects via chrome.scripting
//      if there's no answer.
//   5. The agent works inside a dedicated, never-focused window. Activating a
//      tab WITHIN an unfocused window does not steal focus from the user, but
//      the active tab of any visible window still paints and runs rAF — which
//      is what the DOM drivers need.

import { toToolError } from "./tools.ts";
import {
  type AgentCommand,
  type AuthMessage,
  type CommandName,
  type CommandReply,
  type CommandRequest,
  type CommandResultMap,
  ToolError,
  type ToolErrorCode,
} from "./types.ts";

const WS_URL = "ws://localhost:8000/ws/agent";
const AUTH_TOKEN = "REMOVED_LOCAL_TOKEN";
const CLIENT_ID = "default";

const WATCHDOG_ALARM = "ws-watchdog";
const SALES_NAV_HOME = "https://www.linkedin.com/sales/search/people";
const SALES_NAV_MATCH = "https://www.linkedin.com/sales/*";
const PROFILE_MATCH = "https://www.linkedin.com/company/*";

// If true, an adopted Sales Nav tab found in the user's own window is MOVED
// into the dedicated agent window. Keeps the user's window untouched while
// the agent runs, at the cost of "my tab just teleported" surprise. Flip to
// taste; during dev you may prefer false.
const MOVE_SALES_TAB_INTO_AGENT_WINDOW = false;

// ============================================================== session state
// chrome.storage.session: survives SW restarts, dies with the browser. Exactly
// the lifetime we want for "which window/tab is mine".

const K_AGENT_WINDOW = "agentWindowId";
const K_SALES_TAB = "salesTabId";

const Session = {
  async get<T>(key: string): Promise<T | undefined> {
    const o = await chrome.storage.session.get(key);
    return o[key] as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.session.set({ [key]: value });
  },
  async del(key: string): Promise<void> {
    await chrome.storage.session.remove(key);
  },
};

// ============================================================== reply cache
// Transport-level idempotency: a command is is an execution token.
// Cached in chrome.storage.session so it survives service-worker death.

type ReplyCache = {
  order: string[];
  byId: Record<string, CommandReply>;
};

const K_REPLY_CACHE = "replyCache";
const REPLY_CACHE_MAX = 100;

const inFlight = new Map<string, Promise<CommandReply>>();

async function loadReplyCache(): Promise<ReplyCache> {
  return (await Session.get<ReplyCache>(K_REPLY_CACHE)) ??
    { order: [], byId: {} };
}

async function cacheReply(reply: CommandReply): Promise<void> {
  const cache = await loadReplyCache();
  if (!(reply.id in cache.byId)) cache.order.push(reply.id);
  cache.byId[reply.id] = reply;
  while (cache.order.length > REPLY_CACHE_MAX) {
    const evicted = cache.order.shift()!;
    delete cache.byId[evicted];
  }
  await Session.set(K_REPLY_CACHE, cache);
}

async function executeCommand(req: CommandRequest): Promise<CommandReply> {
  let reply: CommandReply;
  try {
    const result = await dispatchCommand(req.command, req.args);
    reply = { id: req.id, ok: true, result };
  } catch (err) {
    const e = toToolError(err);
    reply = {
      id: req.id,
      ok: false,
      error: { code: e.code, message: e.message },
    };
  }
  inFlight.delete(req.id);

  // Cache BEFORE sending: if the SW dies between executing and replying,
  // the server's resend hits the cache instead of re-executing.
  await cacheReply(reply);
  return reply;
}

// ============================================================== websocket

let socket: WebSocket | null = null;
let reconnectDelay = 1000;

function ensureConnected(): void {
  if (
    socket &&
    (socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN)
  ) {
    return;
  }
  connect();
}

function connect(): void {
  console.log("[ws] connecting...");
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    reconnectDelay = 1_000;
    const auth: AuthMessage = {
      token: AUTH_TOKEN,
      clientId: CLIENT_ID,
    };
    socket?.send(JSON.stringify(auth));
    console.log("[ws] open, auth sent");
  };

  socket.onmessage = (ev) => void handleMessage(ev);

  socket.onerror = () => {
    // onclose always follows an error; handled there, is this a good idea?
  };

  socket.onclose = () => {
    socket = null;
    console.log(
      `[ws] closed; retry in ${reconnectDelay}ms (alarm is backstop)`,
    );
    // In-memory retry while the SW is alive. If the SW is killed before this
    // timer fires, the timre dies with it and the watchdog alarm picks up
    // the reconnect on the next wake. Both paths converge on ensureConnected
    setTimeout(ensureConnected, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };
}

async function handleMessage(ev: MessageEvent): Promise<void> {
  let msg: any;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    console.warn("[ws] non-JSON frame ignored");
    return;
  }

  if (msg.type === "ready") {
    console.log("[ws] authenticated, ready");
    return;
  }
  if (msg.type === "ping") {
    socket?.send(JSON.stringify({ type: "ping" }));
    return;
  }
  if (!msg.command || !msg.id) {
    console.warn("[ws] unrecognized message", msg);
    return;
  }

  const req = msg as CommandRequest;

  // Replay of an already-completed command → answer from cache, never re-run.
  const cache = await loadReplyCache();
  const cached = cache.byId[req.id];
  if (cached) {
    console.log(`[ws] replay id=${req.id.slice(0, 8)} → cached reply`);
    socket?.send(JSON.stringify(cached));
    return;
  }

  // Server resent while we're still executing → join the in-flight promise
  // instead of starting a second execution.
  let pending = inFlight.get(req.id);
  if (!pending) {
    pending = executeCommand(req);
    inFlight.set(req.id, pending);
  }
  const reply = await pending;

  // `socket` may be a newer connection than the one this request arrived on
  // (reconnect happened while the tool ran) — ids make that safe
  socket?.send(JSON.stringify(reply));
}

// ============================================================== agent window

let agentWindowInFlight: Promise<number> | null = null;

async function ensureAgentWindow(): Promise<number> {
  const stored = await Session.get<number>(K_AGENT_WINDOW);
  if (stored != null) {
    try {
      await chrome.windows.get(stored);
      return stored;
    } catch {
      await Session.del(K_AGENT_WINDOW); // window was closed
    }
  }

  if (agentWindowInFlight) return agentWindowInFlight;

  agentWindowInFlight = (async () => {
    const again = await Session.get<number>(K_AGENT_WINDOW);

    if (again != null) {
      try {
        await chrome.windows.get(again);
        return again;
      } catch {
        await Session.del(K_AGENT_WINDOW); // window was closed
      }
    }

    const win = await chrome.windows.create({
      url: SALES_NAV_HOME,
      focused: false, // never steal focus on creation
      state: "normal", // do NOT minimize, minimized windows stop painting
      width: 1280,
      height: 900,
      left: 40,
      top: 40,
    });

    if (win.id == null) {
      throw new Error("Could not create agent window");
    }

    await Session.set(K_AGENT_WINDOW, win.id);

    const tab = win.tabs?.[0];
    if (tab?.id != null) await adoptSalesTab(tab.id);

    return win.id!;
  })();

  try {
    return await agentWindowInFlight;
  } finally {
    agentWindowInFlight = null;
  }
}

async function adoptSalesTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  await Session.set(K_SALES_TAB, tabId);
}

let salesTabInFlight: Promise<number> | null = null;

async function ensureSalesTab(): Promise<number> {
  const winId = await ensureAgentWindow();

  const stored = await Session.get<number>(K_SALES_TAB);
  if (stored != null) {
    try {
      const tab = await chrome.tabs.get(stored);
      if (
        tab.windowId === winId &&
        tab.url?.startsWith("https://www.linkedin.com/sales/search")
      ) {
        return stored;
      }
    } catch {
      await Session.del(K_SALES_TAB);
    }
  }

  if (salesTabInFlight) return salesTabInFlight;

  salesTabInFlight = (async () => {
    const again = await Session.get<number>(K_SALES_TAB);
    if (again != null) {
      try {
        const tab = await chrome.tabs.get(again);
        if (
          tab.windowId === winId &&
          tab.url?.startsWith("https://www.linkedin.com/sales/search")
        ) {
          return again;
        }
      } catch {
        await Session.del(K_SALES_TAB);
      }
    }

    const inWin = await chrome.tabs.query({
      url: SALES_NAV_MATCH,
      windowId: winId,
    });
    const found = inWin.find((t) => t.id != null);
    if (found?.id != null) {
      await adoptSalesTab(found.id);
      return found.id;
    }

    const tab = await chrome.tabs.create({
      url: SALES_NAV_HOME,
      active: true,
      windowId: winId,
    });
    if (tab.id == null) throw new Error("Could not open a Sales Navigator tab");
    await adoptSalesTab(tab.id);
    return tab.id;
  })();

  try {
    return await salesTabInFlight;
  } finally {
    salesTabInFlight = null;
  }
}

// ============================================================== content script healing

async function pingContent(tabId: number, type = "PING"): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type });
    return res?.ok === true;
  } catch {
    return false; // "Receiving end does not exist" lands here
  }
}

async function ensureContentScript(
  tabId: number,
  scriptFile = "content.js",
  pingType = "PING",
  timeoutMs = 12_000,
): Promise<void> {
  if (await pingContent(tabId, pingType)) return;

  // No answer: fresh tab still loading, or the script was orphaned by an
  // extension reload (manifest injection does NOT re-run in open tabs).
  // Inject programmatically, then poll until it responds.
  const start = Date.now();
  let injected = false;
  while (Date.now() - start < timeoutMs) {
    if (!injected) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [scriptFile],
        });
        injected = true; // content.js guards itself against double-registration
      } catch {
        // Tab not read for injection yet (e.g. mid-navigation) - retry.
      }
    }
    if (await pingContent(tabId, pingType)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Content script unreachable (tab stuck loading or blocked)");
}

// ============================================================== dispatch
type ContentRoute = {
  kind: "content";
  tabKey: string;
  homeUrl: string;
  matchUrl: string;
  urlPrefix: string;
  scriptFile: string;
  pingType: string;
  invokeType: string;
};

type BackgroundJobRoute = {
  kind: "backgroundJob";
  job: "accountProfile" | "companyProfile" | "personProfile";
};

const leadSearchRoute = {
  kind: "content",
  tabKey: "leadSearchTabId",
  homeUrl: "https://www.linkedin.com/sales/search/people",
  matchUrl: "https://www.linkedin.com/sales/search/people*",
  urlPrefix: "https://www.linkedin.com/sales/search/people",
  scriptFile: "lead-search-content.js",
  pingType: "PING_LEAD_SEARCH",
  invokeType: "INVOKE_LEAD_SEARCH_TOOL",
} satisfies ContentRoute;

const accountSearchRoute = {
  kind: "content",
  tabKey: "accountSearchTabId",
  homeUrl: "https://www.linkedin.com/sales/search/company",
  matchUrl: "https://www.linkedin.com/sales/search/company*",
  urlPrefix: "https://www.linkedin.com/sales/search/company",
  scriptFile: "account-search-content.js",
  pingType: "PING_ACCOUNT_SEARCH",
  invokeType: "INVOKE_ACCOUNT_SEARCH_TOOL",
} satisfies ContentRoute;

const invitationsRoute = {
  kind: "content",
  tabKey: "invitationManagerTabId",
  homeUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
  matchUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent*",
  urlPrefix: "https://www.linkedin.com/mynetwork/invitation-manager/sent",
  scriptFile: "invitations-content.js",
  pingType: "PING_INVITATIONS",
  invokeType: "INVOKE_INVITATIONS_TOOL",
} satisfies ContentRoute;

const profileRoute = {
  kind: "backgroundJob",
  job: "companyProfile",
} satisfies BackgroundJobRoute;

const personProfileRoute = {
  kind: "backgroundJob",
  job: "personProfile",
} satisfies BackgroundJobRoute;

const accountProfileRoute = {
  kind: "backgroundJob",
  job: "accountProfile",
} satisfies BackgroundJobRoute;

const COMMAND_ROUTES = {
  // old names:
  "getSearchState": leadSearchRoute,
  "listFilterOptions": leadSearchRoute,
  "searchFilterOptions": leadSearchRoute,
  "selectFilterOption": leadSearchRoute,
  "removeFilterSelection": leadSearchRoute,
  "clearFilter": leadSearchRoute,
  "setKeywords": leadSearchRoute,
  "clearKeywords": leadSearchRoute,
  "readResults": leadSearchRoute,
  "nextPage": leadSearchRoute,

  // new routing
  "leadSearch.getState": leadSearchRoute,
  "leadSearch.listFilterOptions": leadSearchRoute,
  "leadSearch.searchFilterOptions": leadSearchRoute,
  "leadSearch.selectFilterOption": leadSearchRoute,
  "leadSearch.removeFilterSelection": leadSearchRoute,
  "leadSearch.clearFilter": leadSearchRoute,
  "leadSearch.setKeywords": leadSearchRoute,
  "leadSearch.clearKeywords": leadSearchRoute,
  "leadSearch.readResults": leadSearchRoute,
  "leadSearch.nextPage": leadSearchRoute,

  "accountSearch.readResults": accountSearchRoute,
  "accountSearch.getPagination": accountSearchRoute,
  "accountSearch.nextPage": accountSearchRoute,
  "accountSearch.previousPage": accountSearchRoute,
  "accountSearch.goToPage": accountSearchRoute,
  "accountSearch.listAnnualRevenueOptions": accountSearchRoute,
  "accountSearch.setAnnualRevenue": accountSearchRoute,
  "accountSearch.clearAnnualRevenue": accountSearchRoute,
  "accountSearch.listHeadcountOptions": accountSearchRoute,
  "accountSearch.selectHeadcountOption": accountSearchRoute,
  "accountSearch.clearHeadcount": accountSearchRoute,
  "accountSearch.setHeadcountGrowth": accountSearchRoute,
  "accountSearch.clearHeadcountGrowth": accountSearchRoute,
  "accountSearch.listDepartmentHeadcountDepartments": accountSearchRoute,
  "accountSearch.setDepartmentHeadcount": accountSearchRoute,
  "accountSearch.clearDepartmentHeadcount": accountSearchRoute,
  "accountSearch.readDepartmentHeadcountState": accountSearchRoute,
  "accountSearch.listDepartmentHeadcountGrowthDepartments": accountSearchRoute,
  "accountSearch.setDepartmentHeadcountGrowth": accountSearchRoute,
  "accountSearch.clearDepartmentHeadcountGrowth": accountSearchRoute,
  "accountSearch.readDepartmentHeadcountGrowthState": accountSearchRoute,
  "accountSearch.searchHeadquartersLocationOptions": accountSearchRoute,
  "accountSearch.selectHeadquartersLocationOption": accountSearchRoute,
  "accountSearch.clearHeadquartersLocation": accountSearchRoute,
  "accountSearch.searchIndustryOptions": accountSearchRoute,
  "accountSearch.selectIndustryOption": accountSearchRoute,
  "accountSearch.clearIndustry": accountSearchRoute,
  "accountSearch.setKeywords": accountSearchRoute,
  "accountSearch.clearKeywords": accountSearchRoute,
  "accountSearch.getState": accountSearchRoute,

  "invitations.withdrawOld": invitationsRoute,

  "profile.readCompany": profileRoute,
  "profile.person.open": personProfileRoute,
  "profile.person.read": personProfileRoute,
  "profile.person.connect": personProfileRoute,
  "checkLinkedinProfile": profileRoute,
  "accountAbout.read": accountProfileRoute,
  "accountProfile.read": accountProfileRoute,
  "accountProfile.website": accountProfileRoute,
  "accountIq.read": accountProfileRoute,
} as const;

const contextTabInFlight = new Map<string, Promise<number>>();

async function adoptContextTab(
  route: ContentRoute,
  tabId: number,
): Promise<void> {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  await Session.set(route.tabKey, tabId);
}

async function ensureContextTab(route: ContentRoute): Promise<number> {
  const winId = await ensureAgentWindow();

  const stored = await Session.get<number>(route.tabKey);

  if (stored != null) {
    try {
      const tab = await chrome.tabs.get(stored);
      if (
        tab.windowId === winId &&
        tab.url?.startsWith(route.urlPrefix)
      ) {
        return stored;
      }
    } catch {
      await Session.del(route.tabKey);
    }
  }

  const existing = contextTabInFlight.get(route.tabKey);
  if (existing) return existing;

  const pending = (async () => {
    const again = await Session.get<number>(route.tabKey);
    if (again != null) {
      try {
        const tab = await chrome.tabs.get(again);
        if (
          tab.windowId === winId &&
          tab.url?.startsWith(route.urlPrefix)
        ) {
          return again;
        }
      } catch {
        await Session.del(route.tabKey);
      }
    }
    const inWin = await chrome.tabs.query({
      url: route.matchUrl,
      windowId: winId,
    });

    const found = inWin.find((t) => t.id != null);
    if (found?.id != null) {
      await adoptContextTab(route, found.id);
      return found.id;
    }

    const tab = await chrome.tabs.create({
      url: route.homeUrl,
      active: true,
      windowId: winId,
    });

    if (tab.id == null) {
      throw new Error(`Could not open context tab for ${route.tabKey}`);
    }
    await adoptContextTab(route, tab.id);
    return tab.id;
  })();

  contextTabInFlight.set(route.tabKey, pending);

  try {
    return await pending;
  } finally {
    contextTabInFlight.delete(route.tabKey);
  }
}

async function sendContentCommand(
  tabId: number,
  command: string,
  args: unknown,
  type = "INVOKE_TOOL",
): Promise<unknown> {
  if (command === "profile.person.connect") {
    console.log("[profile.person.background] send to content", {
      tabId,
      type,
      args,
    });
  }
  const response = await chrome.tabs.sendMessage(tabId, {
    type,
    command,
    args,
  });
  if (command === "profile.person.connect") {
    console.log("[profile.person.background] content reply", response);
  }

  if (!response?.ok) {
    const e = response?.error;
    if (e && typeof e === "object" && "code" in e) {
      throw new ToolError(
        (e as { code: ToolErrorCode }).code,
        (e as { message: string }).message,
      );
    }
    throw new Error(typeof e === "string" ? e : `Tool ${command} failed`);
  }

  return response.result;
}

async function waitForTabSettled(
  tabId: number,
  timeoutMs = 15_000,
  stableMs = 900,
): Promise<void> {
  const start = Date.now();
  let lastUrl: string | undefined;
  let stableSince = 0;

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;

    if (tab.status === "complete" && url && url === lastUrl) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      stableSince = 0;
      lastUrl = url;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for profile tab to settle");
}

function isClosedMessageChannelError(err: unknown): boolean {
  return err instanceof Error &&
    /message channel closed before a response was received/i.test(err.message);
}

const LEAD_COMMAND_ALIASES = {
  "leadSearch.getState": "getSearchState",
  "leadSearch.listFilterOptions": "listFilterOptions",
  "leadSearch.searchFilterOptions": "searchFilterOptions",
  "leadSearch.selectFilterOption": "selectFilterOption",
  "leadSearch.removeFilterSelection": "removeFilterSelection",
  "leadSearch.clearFilter": "clearFilter",
  "leadSearch.setKeywords": "setKeywords",
  "leadSearch.clearKeywords": "clearKeywords",
  "leadSearch.readResults": "readResults",
  "leadSearch.nextPage": "nextPage",
} as const;

async function runBackgroundJob(
  command: string,
  args: unknown,
): Promise<unknown> {
  switch (command) {
    case "accountAbout.read":
    case "accountProfile.read":
    case "accountProfile.website":
    case "accountIq.read": {
      const accountId = String((args as any)?.accountId ?? "");
      if (!/^\d+$/.test(accountId)) {
        throw new ToolError(
          "BAD_ARGS",
          `Bad Sales Navigator accountId: ${JSON.stringify(args)}`,
        );
      }

      return enqueueProfile(() =>
        handleReadSalesNavigatorAccount(accountId, command)
      );
    }
    case "profile.person.open": {
      const memberId = String((args as any)?.memberId ?? "");
      if (!memberId || /[/?#]/.test(memberId)) {
        throw new ToolError(
          "BAD_ARGS",
          `Bad memberId: ${JSON.stringify(args)}`,
        );
      }

      return enqueueProfile(() => handleOpenPersonProfile(memberId));
    }
    case "profile.person.read": {
      const memberId = String((args as any)?.memberId ?? "");
      if (!memberId || /[/?#]/.test(memberId)) {
        throw new ToolError(
          "BAD_ARGS",
          `Bad memberId: ${JSON.stringify(args)}`,
        );
      }

      return enqueueProfile(() =>
        handlePersonProfileCommand(memberId, command, args)
      );
    }
    case "profile.person.connect": {
      const memberId = (args as any)?.memberId;
      const note = (args as any)?.note;
      if (typeof memberId !== "string" || !/^[A-Za-z0-9_-]+$/.test(memberId)) {
        throw new ToolError("BAD_ARGS", `Bad memberId: ${JSON.stringify(args)}`);
      }
      if (note != null && typeof note !== "string") {
        throw new ToolError("BAD_ARGS", "note must be a string");
      }
      if (typeof note === "string" && note.length > 300) {
        throw new ToolError("BAD_ARGS", "note must be 300 characters or less");
      }
      return enqueueProfile(() =>
        handlePersonProfileCommand(memberId, command, args)
      );
    }
    case "checkLinkedinProfile":
    case "profile.readCompany": {
      const urn = String((args as any)?.urn ?? "");
      const orgId = String((args as any)?.orgId ?? "") ||
        urn.split(":").pop() ||
        "";

      if (!/^\d+$/.test(orgId)) {
        throw new ToolError(
          "BAD_ARGS",
          `Bad company ref: ${JSON.stringify(args)}`,
        );
      }

      return enqueueProfile(() => handleCheckProfile(orgId));
    }
    default:
      throw new ToolError("BAD_ARGS", `Unknown background job: ${command}`);
  }
}

async function dispatchCommand(
  command: string,
  args: unknown,
): Promise<unknown> {
  const route = COMMAND_ROUTES[command as keyof typeof COMMAND_ROUTES];

  if (!route) {
    throw new ToolError("BAD_ARGS", `Unknown command: ${command}`);
  }

  if (route.kind === "content") {
    const tabId = await ensureContextTab(route);
    await ensureContentScript(tabId, route.scriptFile, route.pingType);

    const contentCommand = command in LEAD_COMMAND_ALIASES
      ? LEAD_COMMAND_ALIASES[command as keyof typeof LEAD_COMMAND_ALIASES]
      : command;

    return sendContentCommand(tabId, contentCommand, args, route.invokeType);
  }

  if (route.kind === "backgroundJob") {
    return runBackgroundJob(command, args);
  }

  throw new ToolError("BAD_ARGS", `Unsupported route for command :${command}`);
}

async function dispatchCommand_old(
  command: string,
  args: unknown,
): Promise<unknown> {
  if (command == "checkLinkedinProfile") {
    const urn = String((args as any)?.urn ?? "");
    const orgId = urn.split(":").pop() ?? "";
    if (!/^\d+$/.test(orgId)) throw new Error(`Bad org id from urn: ${urn}`);
    return enqueueProfile(() => handleCheckProfile(orgId));
  }

  const tabId = await ensureSalesTab();
  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "INVOKE_TOOL",
    command,
    args,
  });

  // if (!response?.ok) throw new Error(response?.error ?? `Tool ${command} failed`);
  if (!response?.ok) {
    const e = response?.error;
    if (e && typeof e === "object" && "code" in e) {
      throw new ToolError(
        (e as { code: ToolErrorCode }).code,
        (e as { message: string }).message,
      );
    }
    throw new Error(typeof e === "string" ? e : `Tool ${command} failed`);
  }
  return response.result;
}

// ============================================================== profile checks

let profileQueue: Promise<unknown> = Promise.resolve();

function enqueueProfile<T>(work: () => Promise<T>): Promise<T> {
  const result = profileQueue.then(work, work);
  profileQueue = result.then(() => {}, () => {});
  return result;
}

async function handleCheckProfile(orgId: string) {
  const url = `https://www.linkedin.com/company/${orgId}`;
  const winId = await ensureAgentWindow();
  const salesTabId = await Session.get<number>(K_SALES_TAB);

  // Open INSIDE the agent window, active within it. The window is not
  // focused, so the user feels nothing - but the tab paints and runs rAF,
  // which the profile scraper's waiting logic needs (does it?)
  const tab = await chrome.tabs.create({ url, active: true, windowId: winId });
  const tabId = tab.id!;
  try {
    const data = await scrapeWithRetry(tabId);
    const finalUrl = (await chrome.tabs.get(tabId)).url ?? url;
    return { ...data, url, finalUrl };
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
    // Hand the agent window back to the Sales Nave tab so its content script
    // resumes painting but only if that tab actually lives in our window
    // (otherwise we'd switch the user's visible tab in THEIR window).
    if (salesTabId != null) {
      try {
        const salesTab = await chrome.tabs.get(salesTabId);
        if (salesTab.windowId === winId) {
          await chrome.tabs.update(salesTabId, { active: true });
        }
      } catch {
        // tab gone; ensureSalesTab will recover next dispatch
      }
    }
  }
}

async function handleOpenPersonProfile(memberId: string) {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(memberId)}`;
  const winId = await ensureAgentWindow();
  const tab = await chrome.tabs.create({ url, active: true, windowId: winId });
  if (tab.id == null) {
    throw new Error("Could not open person profile tab");
  }

  const opened = await chrome.tabs.get(tab.id);
  return {
    memberId,
    tabId: tab.id,
    url,
    finalUrl: opened.url ?? url,
  };
}

async function handlePersonProfileCommand(
  memberId: string,
  command: "profile.person.read" | "profile.person.connect",
  args: unknown,
) {
  const opened = await handleOpenPersonProfile(memberId);
  const tabId = opened.tabId;

  try {
    await waitForTabSettled(tabId);
    await ensureContentScript(
      tabId,
      "profile-person-content.js",
      "PING_PROFILE_PERSON",
    );

    let result: unknown;
    try {
      result = await sendContentCommand(
        tabId,
        command,
        args,
        "INVOKE_PROFILE_PERSON_TOOL",
      );
    } catch (err) {
      if (!isClosedMessageChannelError(err)) throw err;
      await waitForTabSettled(tabId);
      await ensureContentScript(
        tabId,
        "profile-person-content.js",
        "PING_PROFILE_PERSON",
      );
      result = await sendContentCommand(
        tabId,
        command,
        args,
        "INVOKE_PROFILE_PERSON_TOOL",
      );
    }
    const finalUrl = (await chrome.tabs.get(tabId)).url ?? opened.finalUrl;
    if (command === "profile.person.connect") {
      return { ...(result as Record<string, unknown>), tabId, finalUrl };
    }
    return { ...(result as Record<string, unknown>), finalUrl };
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function handleReadSalesNavigatorAccount(
  accountId: string,
  command:
    | "accountAbout.read"
    | "accountProfile.read"
    | "accountProfile.website"
    | "accountIq.read",
) {
  const url = `https://www.linkedin.com/sales/company/${accountId}`;
  const winId = await ensureAgentWindow();
  const tab = await chrome.tabs.create({ url, active: true, windowId: winId });
  if (tab.id == null) {
    throw new Error("Could not open Sales Navigator account profile tab");
  }
  const tabId = tab.id;

  try {
    await waitForTabSettled(tabId);
    await ensureContentScript(
      tabId,
      "lsn-profile-content.js",
      "PING_LSN_PROFILE",
    );

    let result: unknown;
    try {
      result = await sendContentCommand(
        tabId,
        command,
        { accountId },
        "INVOKE_LSN_PROFILE_TOOL",
      );
    } catch (err) {
      if (!isClosedMessageChannelError(err)) throw err;

      await waitForTabSettled(tabId);
      await ensureContentScript(
        tabId,
        "lsn-profile-content.js",
        "PING_LSN_PROFILE",
      );
      result = await sendContentCommand(
        tabId,
        command,
        { accountId },
        "INVOKE_LSN_PROFILE_TOOL",
      );
    }

    return result;
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function scrapeWithRetry(
  tabId: number,
  timeoutMs = 15_000,
): Promise<any> {
  const start = Date.now();
  let injectedFallback = false;
  while (true) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "SCRAPE_PROFILE",
      });
      if (result?.ok) return result.data;
    } catch {
      // Content script not there yet. Manifest injects at document_idle; if
      // we're past 4s and still nothing, inject programmatically once
      // (covers the orphaned-after-reload case for profile tabs too).
      if (!injectedFallback && Date.now() - start > 4_000) {
        injectedFallback = true;
        await chrome.scripting
          .executeScript({ target: { tabId }, files: ["profile-content.js"] })
          .catch(() => {});
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Profile scrape timed out");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ============================================================== legacy bridge
// Kept the dev-console harness (content-side checkLinkedinProfile) still works.
// The agent path no longer goes through here

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "CHECK_PROFILE") return; // not ours; ignore

  enqueueProfile(() =>
    handleCheckProfile(msg.orgId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err?.message ?? err) })
      )
  );

  return true; // CRITICAL: keep the message channel open for the async sendResponse
});

// ============================================================== bootstrap

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  // Heal already-open tabs: manifest content scripts are NOT injected into
  // tabs that were open before this (re)install - inject explicitly
  void reinjectExistingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) ensureConnected();
});

async function reinjectExistingTabs(): Promise<void> {
  const inject = async (match: string, file: string) => {
    const tabs = await chrome.tabs.query({ url: match });
    for (const t of tabs) {
      const tabId = t.id;
      if (tabId == null) continue;
      await chrome.scripting
        .executeScript({ target: { tabId: tabId }, files: [file] })
        .catch(() => {});
    }
  };

  await inject(leadSearchRoute.matchUrl, leadSearchRoute.scriptFile);
  await inject(accountSearchRoute.matchUrl, accountSearchRoute.scriptFile);
  await inject(
    "https://www.linkedin.com/sales/company/*",
    "lsn-profile-content.js",
  );
  await inject(PROFILE_MATCH, "profile-content.js");
}

// Top-level call runs on EVERY service worker start: install, browser launcher,
// AND every wake-from-death. This is the primary reconnect path;
// the alarm and onclose-timer are the backstops
// background.ts — near the bottom, with the other top-level bootstrap
chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
});
ensureConnected();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("[sidepanel] setPanelBhavior", e));

// ---------------------------------------------------------------- sidepanel

function wsState(): "connected" | "connecting" | "disconnected" {
  if (!socket) return "disconnected";
  switch (socket.readyState) {
    case WebSocket.OPEN:
      return "connected";
    case WebSocket.CONNECTING:
      return "connecting";
    default:
      return "disconnected"; // CLOSING | CLOSED
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "GET_WS_STATE") return; // not ours
  sendResponse({ state: wsState() });
  return; // synchronous
});
