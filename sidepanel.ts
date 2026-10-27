// sidepanel.ts

import { createPerson, findDuplicatePeople, searchCompanies } from './twenty.ts';
import type { PersonInput } from './twenty.ts';
import type { PersonProfile } from './profile/person/tools.ts';

const out = document.getElementById("out")!;
const createButton = document.getElementById("create-person-btn") as HTMLButtonElement;
const companySelection = document.getElementById("company-selection") as HTMLSelectElement;
const duplicateOverride = document.getElementById("duplicate-override") as HTMLInputElement;
const duplicateOverrideLabel = document.getElementById("duplicate-override-label")!;
const profileExtractButtons = [
  document.getElementById("extract-profile-btn") as HTMLButtonElement,
  document.getElementById("extract-linkedin-profile-btn") as HTMLButtonElement,
];

let currentProfile: PersonInput | null = null;
let hasDuplicates = false;
let extracting = false;
let saving = false;
let personCreated = false;

function setProfileStatus(message: string): void {
  const status = document.getElementById("profile-status");
  if (status) status.textContent = message;
}

function updateCreateButton(): void {
  createButton.disabled = !currentProfile || !companySelection.value ||
    extracting || saving || personCreated ||
    (hasDuplicates && !duplicateOverride.checked);
}

companySelection.addEventListener("change", updateCreateButton);
duplicateOverride.addEventListener("change", updateCreateButton);

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

async function readLinkedInProfile(tabId: number, url: URL): Promise<PersonInput & { company: string }> {
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
  if (extracting || saving) return;
  for (const button of profileExtractButtons) button.disabled = true;
  extracting = true;
  currentProfile = null;
  hasDuplicates = false;
  personCreated = false;
  duplicateOverride.checked = false;
  duplicateOverrideLabel.hidden = true;
  companySelection.replaceChildren();
  document.getElementById("duplicate-warning")?.replaceChildren();
  for (const id of ["profile-name", "profile-role", "profile-company", "profile-linkedin-url"]) {
    document.getElementById(id)!.textContent = "";
  }
  updateCreateButton();

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
    let data: PersonInput & { company: string };
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

    setStatus("Checking CRM...");
    await listPossibleCompanies();

    const duplicates = await findDuplicatePeople(data.firstName, data.lastName);
    hasDuplicates = duplicates.totalCount > 0;
    duplicateOverrideLabel.hidden = !hasDuplicates;
    const warning = document.getElementById("duplicate-warning");

    if (warning) {
      warning.replaceChildren();

      if (duplicates.totalCount > 0) {
        const message = document.createElement("p");
        message.textContent = "Possible duplicate people found.";

        const list = document.createElement("ul");

        for (const person of duplicates.data.people) {
          const item = document.createElement("li");
          item.textContent =
            `${person.name.firstName} ${person.name.lastName} — ${person.company?.name || "No company"}`;
          list.appendChild(item);
        }

        warning.append(message, list);
      }
    }

    currentProfile = {
      firstName: data.firstName,
      lastName: data.lastName,
      linkedin: data.linkedin,
      title: data.title,
    };
    setStatus(!companySelection.value
      ? "Profile extracted. No matching company found."
      : hasDuplicates
      ? "Review the possible duplicates before creating a person."
      : "Profile extracted. Ready to create person.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    console.error("[sidepanel] Profile extraction failed", error);
  } finally {
    extracting = false;
    for (const button of profileExtractButtons) button.disabled = false;
    updateCreateButton();
  }
}

document.getElementById("extract-profile-btn")
  ?.addEventListener("click", () => extractProfile("sales"));
document.getElementById("extract-linkedin-profile-btn")
  ?.addEventListener("click", () => extractProfile("linkedin"));

async function listPossibleCompanies() {
  const companyName = document.getElementById("profile-company")?.innerText;

  if (!companyName) {
    throw new Error("Company name not defined");
  }

  const companies = await searchCompanies(companyName);

  const select = document.getElementById("company-selection");

  if (select) {
    select.replaceChildren();

    //@ts-ignore
    for (const company of companies.data.companies.slice(0, 5)) {
      const option = document.createElement("option");
      option.value = company.id;
      option.textContent =
      `${company.name} - ${company.domainName.primaryLinkUrl}`;

      select.appendChild(option);
    }
  }
}

document.getElementById("search-companies")?.addEventListener("click", listPossibleCompanies);

async function savePerson(): Promise<void> {
  if (createButton.disabled || saving) return;
  const profile = currentProfile;
  const companyId = companySelection.value;
  const companyName = companySelection.selectedOptions[0]?.textContent ?? companyId;

  if (!profile || !companyId || (hasDuplicates && !duplicateOverride.checked)) return;
  if (![profile.firstName, profile.lastName, profile.linkedin, profile.title]
    .every((value) => typeof value === "string" && value.trim().length > 0)) {
    setProfileStatus("First name, last name, LinkedIn URL, and job title are required.");
    return;
  }

  saving = true;
  for (const button of profileExtractButtons) button.disabled = true;
  companySelection.disabled = true;
  duplicateOverride.disabled = true;
  updateCreateButton();
  setProfileStatus("Creating person...");

  try {
    const result = await createPerson(profile, companyId);
    personCreated = true;
    setProfileStatus(
      `${profile.firstName} ${profile.lastName} created and linked to ${companyName}. ID: ${result.data.createPerson.id}`,
    );
  } catch (error) {
    setProfileStatus(error instanceof Error ? error.message : String(error));
    console.error("[sidepanel] Person creation failed", error);
  } finally {
    saving = false;
    for (const button of profileExtractButtons) button.disabled = false;
    companySelection.disabled = false;
    duplicateOverride.disabled = false;
    updateCreateButton();
  }
}

createButton.addEventListener("click", savePerson);
