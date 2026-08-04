import { scrapeProfile, waitForProfile } from "./linkedin/profile.ts";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SCRAPE_PROFILE") return;

  waitForProfile()
    .then(() => sendResponse({ ok: true, data: scrapeProfile() }))
    .catch((err) =>
      sendResponse({ ok: false, error: String(err?.message ?? err) })
    );

  return true;
});




