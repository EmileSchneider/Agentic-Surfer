import {
  HEADCOUNT,
  clearFilter,
  listFilterOptions,
  readSelections,
  selectFilterOption,
} from "../linkedin/filters.ts";
import { ToolError, type FilterMode, type FilterOption } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface AccountHeadcountState {
  selections: { label: string; mode: FilterMode }[];
  page: number | null;
  totalPages: number | null;
}

const FIELDSET_KEY = "COMPANY_HEADCOUNT";

async function waitForHeadcountFieldset(): Promise<void> {
  await waitForAccountFilterFieldset(FIELDSET_KEY, "Company headcount");
}

export async function listHeadcountOptions(): Promise<FilterOption[]> {
  await waitForHeadcountFieldset();
  return await listFilterOptions(HEADCOUNT);
}

export function readHeadcountState(): AccountHeadcountState {
  return {
    selections: readSelections(HEADCOUNT).map(({ label, mode }) => ({
      label,
      mode,
    })),
    ...readPagination(),
  };
}

export async function selectHeadcountOption(args: {
  code?: string;
  label?: string;
}): Promise<AccountHeadcountState> {
  const code = String(args.code ?? args.label ?? "");
  if (!code) {
    throw new ToolError("BAD_ARGS", "Company headcount requires code or label");
  }

  await waitForHeadcountFieldset();
  await listFilterOptions(HEADCOUNT);
  await selectFilterOption(HEADCOUNT, code, "include");
  return readHeadcountState();
}

export async function clearHeadcount(): Promise<AccountHeadcountState> {
  await waitForHeadcountFieldset();
  await clearFilter(HEADCOUNT);
  return readHeadcountState();
}
