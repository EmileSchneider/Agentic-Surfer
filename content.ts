// extension/content.ts
//
// Single message listener, registered exactly once (the previous version
// registered INVOKE_TOOL twice — once inside the flag guard, once
// unconditionally — so every command ran twice on re-injection). Queue
// serializes tool execution: one DOM operation at a time, in order.
//
// Errors leave here as { ok: false, error: { code, message } } — the
// structured envelope Python routes on (retry-to-model vs crash).

import type { AgentCommand } from "./types.ts";
import { runTool, toToolError, buildSearchState } from "./tools.ts";

const FLAG = "__asnContentLoaded";


if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => {}, () => {});
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return; // synchronous reply
    }
    if (msg.type !== "INVOKE_TOOL") return;

    enqueue(() =>
      runTool(msg as { command: AgentCommand["command"]; args: any })
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        const e = toToolError(err);
        sendResponse({ ok: false, error: { code: e.code, message: e.message } });
      });

    return true; // async sendResponse
  });

  // ---- dev-only console harness ------------------------------------------
  // Switch the console context dropdown to the content script, then call
  // agentTools.<fn>(...) on a Sales Nav page. Mirrors the agent vocabulary
  // (runTool) plus raw driver access for poking at the DOM.
  void (async () => {
    const filters = await import("./linkedin/filters.ts");
    const dom = await import("./linkedin/dom.ts");
    const keywords = await import("./linkedin/keywords.ts");
    const results = await import("./linkedin/results.ts");

    (window as any).agentTools = {
      // the actual tool surface, exactly as the agent sees it
      runTool,
      buildSearchState,
      // raw driver + dom, for manual debugging
      ...filters,
      ...dom,
      ...keywords,
      ...results,
    };
    console.log(
      "[content] agentTools attached:",
      Object.keys((window as any).agentTools)
    );
  })();
}
