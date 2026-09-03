import { runInvitationsTool } from "./invitations/tools.ts";
import { toToolError } from "./tools.ts";

const FLAG = "__asnInvitationsContentLoaded";

if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => {}, () => {});
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_INVITATIONS") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_INVITATIONS_TOOL") return;

    enqueue(() => runInvitationsTool(String(msg.command)))
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
