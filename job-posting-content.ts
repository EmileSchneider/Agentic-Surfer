import { createJobPostingExtractor } from "./job-posting/extractor.ts";
import { toToolError } from "./tools.ts";

const flags = window as unknown as Record<string, boolean>;
if (!flags.__asnJobPostingContentLoaded) {
  flags.__asnJobPostingContentLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_JOB_POSTING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_JOB_POSTING_TOOL") return;
    Promise.resolve().then(async () => ({
      sourceUrl: location.href,
      descriptionMarkdown: await createJobPostingExtractor(location.href).extract(),
    })).then(result => sendResponse({ ok: true, result })).catch(error => {
      const e = toToolError(error);
      sendResponse({ ok: false, error: { code: e.code, message: e.message } });
    });
    return true;
  });
}
