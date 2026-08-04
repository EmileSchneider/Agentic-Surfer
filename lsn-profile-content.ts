import { runAccountIqTool } from "./lsn-profile/tools.ts";
import { toToolError } from "./tools.ts";

const FLAG = "__asnLsnProfileContentLoaded";
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
}

if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_LSN_PROFILE") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_LSN_PROFILE_TOOL") return;

    enqueue(() => runAccountIqTool(msg as { command: string; args: unknown }))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        const error = toToolError(err);
        sendResponse({
          ok: false,
          error: { code: error.code, message: error.message },
        });
      });

    return true;
  });
}
