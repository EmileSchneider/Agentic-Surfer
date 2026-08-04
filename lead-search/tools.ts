import type { AgentCommand } from "../types.ts";
import { ToolError } from "../types.ts";
import {
  clearFilter,
  listFilterOptions,
  removeFilterSelection,
  searchFilterOptions,
  selectFilterOption,
} from "./filters.ts";
import { clearKeywords, setKeywords } from "./keywords.ts";
import { getSearchState } from "./search_state.ts";
import { goToNextPage, readResults } from "./results.ts";

async function setKeywordSearch(text: string) {
  await setKeywords(text);
  return await getSearchState();
}

async function clearKeywordSearch() {
  await clearKeywords();
  return await getSearchState();
}

async function nextPage() {
  await goToNextPage();
  return await getSearchState();
}

export async function runLeadSearchTool(msg: {
  command: AgentCommand["command"];
  args: any;
}): Promise<unknown> {
  switch (msg.command) {
    case "getSearchState":
      return await getSearchState();
    case "listFilterOptions":
      return await listFilterOptions(msg.args.filter);
    case "searchFilterOptions":
      return await searchFilterOptions(msg.args.filter, msg.args.query);
    case "readResults":
      return await readResults(msg.args?.limit);
    case "selectFilterOption":
      return await selectFilterOption(
        msg.args.filter,
        msg.args.code,
        msg.args.mode ?? "include",
      );
    case "removeFilterSelection":
      return await removeFilterSelection(msg.args.filter, msg.args.label);
    case "clearFilter":
      return await clearFilter(msg.args.filter);
    case "setKeywords":
      return await setKeywordSearch(msg.args.text);
    case "clearKeywords":
      return await clearKeywordSearch();
    case "nextPage":
      return await nextPage();
    case "checkLinkedinProfile":
      throw new ToolError(
        "BAD_ARGS",
        "checkLinkedinProfile is handled by the background profile route",
      );
    default: {
      const _exhaustive: never = msg.command;
      throw new ToolError("BAD_ARGS", `Unknown lead search tool: ${String(_exhaustive)}`);
    }
  }
}
