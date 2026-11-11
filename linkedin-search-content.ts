import { runLinkedInSearchTool } from "./linkedin-search/tools.ts";
import { ToolError } from "./types.ts";

const FLAG = "__linkedinSearchContentLoaded";
const flags = window as unknown as Record<string, boolean>;
if (!flags[FLAG]) {
  flags[FLAG] = true;
  let queue: Promise<unknown> = Promise.resolve();
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_LINKEDIN_SEARCH") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_LINKEDIN_SEARCH_TOOL") return;
    const result = queue.then(() => runLinkedInSearchTool(msg));
    queue = result.catch(() => {});
    result.then((value) => sendResponse({ ok: true, result: value })).catch((error) => {
      sendResponse({ ok: false, error: {
        code: error instanceof ToolError ? error.code
          : error instanceof Error && error.message.startsWith("Timed out") ? "TIMEOUT" : "INTERNAL",
        message: error instanceof Error ? error.message : String(error),
      } });
    });
    return true;
  });
}
