import { prepareLeadProfileRoot, readLeadCurrentRoles, readLeadExperience, readLeadIdentity } from "./lsn-profile/lead-profile.ts";


async function extract() {
  const root = await prepareLeadProfileRoot();
  const identity = readLeadIdentity(root);
  const currentRoles = readLeadExperience(root);

  console.log("CURRENT ROLES");
  console.log(currentRoles);
  
  const names = identity.name.split(' ');

  if (names.length === 0) {
    // wtf
  }
  
  return {
    firstName: names[0],
    lastName: names.slice(1).join(" "),
    title: currentRoles[0]?.roles[0]?.title			      ,
    company: currentRoles[0]?.company.name,
    linkedin: identity.linkedinUrl,
  }
}

const FLAG = "__asnLeadProfileContentLoaded";
const contentWindow = window as unknown as Record<string, boolean>;

if (!contentWindow[FLAG]) {
  contentWindow[FLAG] = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "PING_LEAD_PROFILE") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type !== "READ_LEAD_PROFILE") return;

    extract()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error)}));

    return true;
  });
}
