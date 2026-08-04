// extension/tools.ts
//
// The tool layer. Generic where generic, specific where it must be.
//
// Responsibilities (everything the agent must NOT have to think about):
//   - Routing FilterName → FilterConfig (cfgFor).
//   - Archetype enforcement with prescriptive errors (fixed-list vs
//     typeahead vs include-only), as a backstop behind the tool docstrings.
//   - Staleness: searchFilterOptions records code → query in
//     chrome.storage.session; selectFilterOption transparently re-runs the
//     recorded query (typeahead) or re-expands the panel (fixed list) when a
//     code has fallen out of the DOM. The agent never learns DOM state exists.
//   - Company shaping: the CURRENT_COMPANY typeahead is filtered to
//     organizations (account lists dropped); code === org URN. This replaces
//     company.ts, which can be deleted.
//   - Every mutation returns the ENTIRE SearchState.
//   - Error classification into the closed ToolErrorCode set.
//
// NOTE: requires "storage" in manifest permissions, and the background script
// must run once:
//   chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
// (content scripts cannot see storage.session otherwise).

import type {
  AgentCommand,
  FilterMode,
  FilterName,
  FilterOption,
  ProfileInfo,
  ResultsPage,
  SearchState,
} from "./types.ts";
import { FILTER_NAMES, ToolError } from "./types.ts";
import {
  cfgFor,
  norm,
  listFilterOptions as driverList,
  searchFilter as driverSearch,
  selectFilterOption as driverSelect,
  removeFilterSelection as driverRemove,
  clearFilter as driverClear,
  readOptions,
  readSelections,
} from "./linkedin/filters.ts";
import {
  readKeywords,
  setKeywords as kwSet,
  clearKeywords as kwClear,
} from "./linkedin/keywords.ts";
import {
  readResults as resultsRead,
  readPagination,
  goToNextPage,
} from "./linkedin/results.ts";

// ---------------------------------------------------------------- label-code cache

const filterCacheKey = (filter: FilterName ) => `filterCache:${filter}`;

type FilterCache = {
  byLabel: Record<string, string>;
  byCode: Record<string, string>
}

async function getFilterCache(filter: FilterName): Promise<FilterCache> {
  const key = filterCacheKey(filter);
  const got = await chrome.storage.session.get(key);
  return got[key] ?? { byLabel: {}, byCode: {} };
}

async function rememberOptions(filter: FilterName, options: FilterOption[]) {
  const key = filterCacheKey(filter);
  const cache = await getFilterCache(filter);

  for (const { label, code } of options) {
    cache.byLabel[norm(label)] = code;
    cache.byCode[norm(code)] = label;    
  }

  await chrome.storage.session.set({ [key]: cache })
}

// ---------------------------------------------------------------- errors

// tools.ts
function describe(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  // Non-Error object (a thrown {code,message}, a DOMException-like, a plain
  // object): try to serialize it rather than collapsing to "[object Object]".
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(err, (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        return v;
      });
      if (json && json !== "{}") return json;
    } catch {
      /* fall through */
    }
  }
  return String(err); // last resort — at least it's honest about giving up
}

export function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  const msg = describe(err);
  if (/include-only|not supported/i.test(msg)) return new ToolError("UNSUPPORTED_MODE", msg);
  if (/timed?\s?out|waiting for/i.test(msg)) return new ToolError("TIMEOUT", msg);
  if (/not found|no .* option/i.test(msg)) return new ToolError("NOT_FOUND", msg);
  return new ToolError("INTERNAL", msg);
}


// ---------------------------------------------------------------- helpers

function assertFilterName(name: string): FilterName {
  if (!(FILTER_NAMES as readonly string[]).includes(name)) {
    throw new ToolError(
      "BAD_ARGS",
      `Unknown filter "${name}". Valid filters: ${FILTER_NAMES.join(", ")}`
    );
  }
  return name as FilterName;
}

const isTypeahead = (filter: FilterName): boolean => !!cfgFor(filter).placeholder;

/** urn:li:organization:93983723 -> "organization" */
const urnType = (urn: string): string => urn.split(":")[2] ?? "";

/** Company-specific shaping: organizations only. No-op for other filters. */
function shapeOptions(filter: FilterName, options: FilterOption[]): FilterOption[] {
  if (filter !== "company") return options;
  return options.filter((o) => urnType(o.code) === "organization");
}

// ---------------------------------------------------------------- state

/** Snapshot the whole search. Returned by getSearchState and every mutation. */
export function buildSearchState(): SearchState {
  const filters = {} as SearchState["filters"];
  for (const name of FILTER_NAMES) {
    filters[name] = readSelections(cfgFor(name)).map(({ label, mode }) => ({
      label,
      mode,
    }));
  }
  let keywords = "";
  try {
    keywords = readKeywords();
  } catch {
    // keyword input not present (not on a search page yet) — empty is honest
  }
  return { filters, keywords, ...readPagination() };
}

// ---------------------------------------------------------------- staleness cache
//
// chrome.storage.session: survives content-script reinjection and SPA
// navigation, dies with the browser session. Keyed per filter; value is a
// code → query map (NOT last-query-per-filter: the agent may search
// "fintech", then "banking", then come back for a fintech code).

const cacheKey = (filter: FilterName) => `codeQueries:${filter}`;
async function rememberQueries(
  filter: FilterName,
  query: string,
  options: FilterOption[]
): Promise<void> {
  const key = cacheKey(filter);
  const got = await chrome.storage.session.get(key);
  const map = (got[key] ?? {}) as Record<string, string>;
  for (const o of options) map[o.code] = query;
  await chrome.storage.session.set({ [key]: map });
}

async function recallQuery(
  filter: FilterName,
  code: string
): Promise<string | null> {
  const key = cacheKey(filter);
  const got = await chrome.storage.session.get(key);
  const map = (got[key] ?? {}) as Record<string, string>;
  const hit = Object.keys(map).find((k) => norm(k) === norm(code));
  return hit ? (map[hit] ?? null) : null;
}

// ---------------------------------------------------------------- reads

async function toolListOptions(filterRaw: string): Promise<FilterOption[]> {
  const filter = assertFilterName(filterRaw);
  if (isTypeahead(filter)) {
    throw new ToolError(
      "BAD_ARGS",
      `"${filter}" is a typeahead filter; use searchFilterOptions with a query`
    );
  }
  const options = await driverList(cfgFor(filter));

  await rememberOptions(filter, options);

  return options;
}

async function toolSearchOptions(
  filterRaw: string,
  query: string
): Promise<FilterOption[]> {
  const filter = assertFilterName(filterRaw);
  if (!isTypeahead(filter)) {
    throw new ToolError(
      "BAD_ARGS",
      `"${filter}" is a fixed-list filter; use listFilterOptions (no query needed)`
    );
  }
  const options = shapeOptions(
    filter,
    await driverSearch(cfgFor(filter), query)
  );
  await rememberQueries(filter, query, options);
  await rememberOptions(filter, options);
  return options.map(({ label, code }) => ({ label, code }));
}

// ---------------------------------------------------------------- mutations

async function toolSelect(
  filterRaw: string,
  code: string,
  mode: FilterMode = "include"
): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  const cfg = cfgFor(filter);

  const present = () =>
    readOptions(cfg).some((o) => norm(o.code) === norm(code));

  const selected = () => readSelections(cfgFor(filter));

  const cache = await getFilterCache(filter);
  const cachedLabel = cache.byCode[norm(code)];
  if (
    cachedLabel &&
      selected().some(
	(s) => norm(s.label) === norm(cachedLabel) && s.mode === mode
      )
  ) {
    return buildSearchState();
  }

  // Staleness recovery — entirely the layer's problem, never the agent's.
  if (!present()) {
    if (isTypeahead(filter)) {
      const query = await recallQuery(filter, code);
      if (!query) {
        throw new ToolError(
          "NOT_FOUND",
          `Code "${code}" was never returned by a ${filter} search in this session — ` +
            `call searchFilterOptions("${filter}", …) and pick a code from its results`
        );
      }
      await driverSearch(cfg, query); // silent re-run of the recorded query
    } else {
      await driverList(cfg); // fixed list: panel collapsed — re-expand
    }
    if (!present()) {
      throw new ToolError(
        "NOT_FOUND",
        `Code "${code}" no longer resolves for ${filter} — ` +
          `re-run searchFilterOptions("${filter}", …) and pick a fresh code`
      );
    }
  }

  await driverSelect(cfg, code, mode);
  return buildSearchState();
}

async function toolRemove(
  filterRaw: string,
  label: string
): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  await driverRemove(cfgFor(filter), label);
  return buildSearchState();
}

async function toolClear(filterRaw: string): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  await driverClear(cfgFor(filter));
  return buildSearchState();
}

async function toolSetKeywords(text: string): Promise<SearchState> {
  await kwSet(text);
  return buildSearchState();
}

async function toolClearKeywords(): Promise<SearchState> {
  await kwClear();
  return buildSearchState();
}

async function toolNextPage(): Promise<SearchState> {
  await goToNextPage();
  return buildSearchState();
}

async function toolReadResults(limit?: number): Promise<ResultsPage> {
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
    throw new ToolError("BAD_ARGS", `limit must be a positive integer, got ${limit}`);
  }
  return await resultsRead(limit);
}

// ---------------------------------------------------------------- specific

export function checkLinkedinProfile(urn: string): Promise<ProfileInfo> {
  const orgId = urn.split(":").pop() ?? "";
  if (!/^\d+$/.test(orgId)) {
    return Promise.reject(
      new ToolError("BAD_ARGS", `Bad org id from urn: ${urn}`)
    );
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CHECK_PROFILE", orgId }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new ToolError("INTERNAL", chrome.runtime.lastError.message ?? "runtime error"));
      }
      if (!response?.ok) {
        return reject(new ToolError("INTERNAL", response?.error ?? "Unknown error"));
      }
      resolve(response.data as ProfileInfo);
    });
  });
}

// ---------------------------------------------------------------- dispatch

export async function runTool(msg: {
  command: AgentCommand["command"];
  args: any;
}): Promise<unknown> {
  switch (msg.command) {
    // reads
    case "getSearchState":      return buildSearchState();
    case "listFilterOptions":   return await toolListOptions(msg.args.filter);
    case "searchFilterOptions": return await toolSearchOptions(msg.args.filter, msg.args.query);
    case "readResults":         return await toolReadResults(msg.args?.limit);
    // mutations
    case "selectFilterOption":  return await toolSelect(msg.args.filter, msg.args.code, msg.args.mode ?? "include");
    case "removeFilterSelection": return await toolRemove(msg.args.filter, msg.args.label);
    case "clearFilter":         return await toolClear(msg.args.filter);
    case "setKeywords":         return await toolSetKeywords(msg.args.text);
    case "clearKeywords":       return await toolClearKeywords();
    case "nextPage":            return await toolNextPage();
    // specific
    case "checkLinkedinProfile": return await checkLinkedinProfile(msg.args.urn);
    default: {
      const _exhaustive: never = msg.command;
      throw new ToolError("BAD_ARGS", `Unknown tool: ${String(_exhaustive)}`);
    }
  }
}


