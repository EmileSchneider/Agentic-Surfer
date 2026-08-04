import { runProfileCompanyTool } from "./profile/company/tools.ts";
import { toToolError } from "./tools.ts";

const FLAG = "__asnProfileCompanyContentLoaded";

if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => {}, () => {});
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_PROFILE_COMPANY") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_PROFILE_COMPANY_TOOL") return;

    enqueue(() =>
      runProfileCompanyTool(msg as { command: string; args: any })
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        const e = toToolError(err);
        sendResponse({ ok: false, error: { code: e.code, message: e.message } });
      });

    return true;
  });
}
