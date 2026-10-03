import { runProfilePersonTool } from "./profile/person/tools.ts";
import { toToolError } from "./tools.ts";

const FLAG = "__asnProfilePersonContentLoaded";

if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => {}, () => {});
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_PROFILE_PERSON") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_PROFILE_PERSON_TOOL") return;

    console.log("[profile.person.content] command received", {
      command: msg.command,
      args: msg.args,
    });

    enqueue(() =>
      runProfilePersonTool(msg as { command: string; args: any })
    )
      .then((result) => {
        console.log("[profile.person.content] command succeeded", result);
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        const e = toToolError(err);
        console.error("[profile.person.content] command failed", {
          originalError: err,
          code: e.code,
          message: e.message,
        });
        sendResponse({ ok: false, error: { code: e.code, message: e.message } });
      });

    return true;
  });
}
