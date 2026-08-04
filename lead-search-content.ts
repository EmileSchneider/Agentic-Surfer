import type { AgentCommand } from "./types.ts";
import { runLeadSearchTool } from "./lead-search/tools.ts";
import { getSearchState } from "./lead-search/search_state.ts";
import { toToolError } from "./tools.ts";

const FLAG = "__asnLeadSearchContentLoaded";

if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => {}, () => {});
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING_LEAD_SEARCH") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "INVOKE_LEAD_SEARCH_TOOL") return;

    enqueue(() =>
      runLeadSearchTool(
        msg as { command: AgentCommand["command"]; args: any },
      )
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        const e = toToolError(err);
        sendResponse({ ok: false, error: { code: e.code, message: e.message } });
      });

    return true;
  });

  void (async () => {
    const filters = await import("./lead-search/filters.ts");
    const dom = await import("./lead-search/dom.ts");
    const keywords = await import("./lead-search/keywords.ts");
    const results = await import("./lead-search/results.ts");

    (window as any).leadSearchTools = {
      runLeadSearchTool,
      getSearchState,
      ...filters,
      ...dom,
      ...keywords,
      ...results,
    };
    console.log(
      "[lead-search-content] leadSearchTools attached:",
      Object.keys((window as any).leadSearchTools),
    );
  })();
}
