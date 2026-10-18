// sidepanel.ts

import { createPerson, findDuplicatePeople, searchCompanies } from './twenty.ts';
import type { PersonInput } from './twenty.ts';

const out = document.getElementById("out")!;
const createButton = document.getElementById("create-person-btn") as HTMLButtonElement;
const companySelection = document.getElementById("company-selection") as HTMLSelectElement;
const duplicateOverride = document.getElementById("duplicate-override") as HTMLInputElement;
const duplicateOverrideLabel = document.getElementById("duplicate-override-label")!;

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


async function pingLeadProfile(tabId: number): Promise<boolean> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: "PING_LEAD_PROFILE",
    });
    return reply?.ok === true;
  } catch {
    return false;
  }
}

async function ensureLeadProfileContent(tabId: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let injected = false;

  while (Date.now() < deadline) {
    if (await pingLeadProfile(tabId)) return;

    if (!injected) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["lsn-lead-profile-content.js"],
      });
      injected = true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Could not connect to the profile tab within 10 seconds.");
}

async function extractProfile() {
  const button = document.getElementById("extract-profile-btn") as
    HTMLButtonElement | null;
  if (button?.disabled || saving) return;
  if (button) button.disabled = true;
  extracting = true;
  currentProfile = null;
  hasDuplicates = false;
  personCreated = false;
  duplicateOverride.checked = false;
  duplicateOverrideLabel.hidden = true;
  companySelection.replaceChildren();
  document.getElementById("duplicate-warning")?.replaceChildren();
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
    if (!tab.url?.startsWith("https://www.linkedin.com/sales/lead/")) {
      throw new Error("Open a Sales Navigator person profile in the active tab.");
    }

    await ensureLeadProfileContent(tab.id);
    setStatus("Extracting profile...");
    const reply = await chrome.tabs.sendMessage(tab.id, {
      type: "READ_LEAD_PROFILE",
    });

    if (!reply?.ok) {
      throw new Error(reply?.error ?? "No profile data returned.");
    }
    const data = reply.data;

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
    if (button) button.disabled = false;
    updateCreateButton();
  }
}

document.getElementById("extract-profile-btn")
  ?.addEventListener("click", extractProfile);

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

  const extractButton = document.getElementById("extract-profile-btn") as HTMLButtonElement;
  saving = true;
  extractButton.disabled = true;
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
    extractButton.disabled = false;
    companySelection.disabled = false;
    duplicateOverride.disabled = false;
    updateCreateButton();
  }
}

createButton.addEventListener("click", savePerson);
