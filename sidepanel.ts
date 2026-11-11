import type { PersonProfile } from "./profile/person/tools.ts";

interface ExtractedProfile {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  linkedin: string;
}

const out = document.getElementById("out")!;
const profileExtractButtons = [
  document.getElementById("extract-profile-btn") as HTMLButtonElement,
  document.getElementById("extract-linkedin-profile-btn") as HTMLButtonElement,
];

let extracting = false;

function setProfileStatus(message: string): void {
  const status = document.getElementById("profile-status");
  if (status) status.textContent = message;
}

async function pollOnce() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "GET_WS_STATE" });
    out.textContent = reply?.state ?? "unknown";
  } catch (e) {
    // No receiving end = SW mid-restart; the message itself wakes it.
    // Treat as transient, let the next tick resolve it.
    out.textContent = "connecting";
  }
}

pollOnce();
const timer = setInterval(pollOnce, 2000);

// Stop polling when the panel is closed/hidden so we don't keep
// waking the SW for a panel nobody's looking at.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearInterval(timer);
});


async function pingContent(tabId: number, type: string): Promise<boolean> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type,
    });
    return reply?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContent(
  tabId: number,
  file: string,
  pingType: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let injected = false;

  while (Date.now() < deadline) {
    if (await pingContent(tabId, pingType)) return;

    if (!injected) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
      injected = true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Could not connect to the tab within 10 seconds.");
}

const copyResultsButton = document.getElementById("copy-results-btn") as HTMLButtonElement;
const resultsStatus = document.getElementById("results-status")!;

async function copyResults(): Promise<void> {
  if (copyResultsButton.disabled) return;
  copyResultsButton.disabled = true;

  try {
    resultsStatus.textContent = "Connecting to results...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error("No active tab found.");

    const url = new URL(tab.url ?? "about:blank");
    const isLead = /^\/sales\/search\/people\/?$/.test(url.pathname);
    const isAccount = /^\/sales\/search\/company\/?$/.test(url.pathname);
    if (url.origin !== "https://www.linkedin.com" || (!isLead && !isAccount)) {
      throw new Error("Open a Sales Navigator lead or account results page in the active tab.");
    }

    await ensureContent(
      tab.id,
      isLead ? "lead-search-content.js" : "account-search-content.js",
      isLead ? "PING_LEAD_SEARCH" : "PING_ACCOUNT_SEARCH",
    );
    resultsStatus.textContent = "Extracting results. Keep the results tab active...";
    const reply = await chrome.tabs.sendMessage(tab.id, {
      type: isLead ? "INVOKE_LEAD_SEARCH_TOOL" : "INVOKE_ACCOUNT_SEARCH_TOOL",
      command: isLead ? "readResults" : "accountSearch.readResults",
      args: {},
    });
    if (!reply?.ok) {
      throw new Error(reply?.error?.message ?? "No results returned.");
    }
    const records = isLead ? reply.result?.leads : reply.result?.accounts;
    if (!Array.isArray(records)) throw new Error("Invalid results returned.");

    resultsStatus.textContent = "Reading applied filters...";
    const stateReply = await chrome.tabs.sendMessage(tab.id, {
      type: isLead ? "INVOKE_LEAD_SEARCH_TOOL" : "INVOKE_ACCOUNT_SEARCH_TOOL",
      command: isLead ? "getSearchState" : "accountSearch.getState",
      args: {},
    });
    if (!stateReply?.ok || !stateReply.result) {
      throw new Error(stateReply?.error?.message ?? "No search state returned.");
    }

    resultsStatus.textContent = "Copying JSON...";
    await navigator.clipboard.writeText(JSON.stringify({
      ...reply.result,
      searchState: stateReply.result,
    }, null, 2));
    resultsStatus.textContent = `Copied ${records.length} ${isLead ? "leads" : "accounts"}.`;
  } catch (error) {
    resultsStatus.textContent = error instanceof Error ? error.message : String(error);
    console.error("[sidepanel] Copy results failed", error);
  } finally {
    copyResultsButton.disabled = false;
  }
}

copyResultsButton.addEventListener("click", copyResults);

async function readLinkedInProfile(tabId: number, url: URL): Promise<ExtractedProfile> {
  const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
  if (url.origin !== "https://www.linkedin.com" || !match?.[1]) {
    throw new Error("Open a regular LinkedIn person profile in the active tab.");
  }

  await ensureContent(tabId, "profile-person-content.js", "PING_PROFILE_PERSON");
  setProfileStatus("Extracting profile. Keep the profile tab active...");
  const reply = await chrome.tabs.sendMessage(tabId, {
    type: "INVOKE_PROFILE_PERSON_TOOL",
    command: "profile.person.read",
    args: { memberId: decodeURIComponent(match[1]) },
  });
  if (!reply?.ok || !reply.result) {
    throw new Error(reply?.error?.message ?? "No profile data returned.");
  }

  const profile = reply.result as PersonProfile;
  const names = profile.name?.trim().split(/\s+/) ?? [];
  if (!names[0]) throw new Error("Profile name not found.");
  const role = profile.experience.find((item) => /\bPresent\b/i.test(item.dateRange ?? ""));
  if (!role?.title || !role.company) {
    throw new Error("Current job title or company not found in Experience.");
  }

  return {
    firstName: names[0],
    lastName: names.slice(1).join(" "),
    title: role.title,
    company: role.company,
    linkedin: `${url.origin}/in/${match[1]}`,
  };
}

async function extractProfile(source: "sales" | "linkedin") {
  if (extracting) return;
  for (const button of profileExtractButtons) button.disabled = true;
  extracting = true;
  for (const id of ["profile-name", "profile-role", "profile-company", "profile-linkedin-url"]) {
    document.getElementById(id)!.textContent = "";
  }

  const setStatus = setProfileStatus;

  try {
    setStatus("Connecting to profile...");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab?.id === undefined) {
      throw new Error("No active tab found");
    }
    let data: ExtractedProfile;
    if (source === "linkedin") {
      data = await readLinkedInProfile(tab.id, new URL(tab.url ?? "about:blank"));
    } else {
      if (!tab.url?.startsWith("https://www.linkedin.com/sales/lead/")) {
        throw new Error("Open a Sales Navigator person profile in the active tab.");
      }

      await ensureContent(tab.id, "lsn-lead-profile-content.js", "PING_LEAD_PROFILE");
      setStatus("Extracting profile...");
      const reply = await chrome.tabs.sendMessage(tab.id, {
        type: "READ_LEAD_PROFILE",
      });

      if (!reply?.ok) {
        throw new Error(reply?.error ?? "No profile data returned.");
      }
      data = reply.data;
    }

    const setElement = (elementId: string, value: string) => {
      const el = document.getElementById(elementId);
      if (el) el.innerText = value;
    };

    setElement("profile-name", `${data.firstName} ${data.lastName}`);
    setElement("profile-role", data.title);
    setElement("profile-company", data.company);
    setElement("profile-linkedin-url", data.linkedin);

    setStatus("Profile extracted.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    console.error("[sidepanel] Profile extraction failed", error);
  } finally {
    extracting = false;
    for (const button of profileExtractButtons) button.disabled = false;
  }
}

document.getElementById("extract-profile-btn")
  ?.addEventListener("click", () => extractProfile("sales"));
document.getElementById("extract-linkedin-profile-btn")
  ?.addEventListener("click", () => extractProfile("linkedin"));
