import type { FilterName, SearchState } from "../types.ts";
import { FILTER_NAMES } from "../types.ts";
import { cfgFor, readSelections } from "../linkedin/filters.ts";
import { readKeywords } from "./keywords.ts";
import { readPagination } from "./results.ts";
import { waitForLeadSearchFilterFieldset } from "./dom.ts";

const LEAD_FILTER_FIELDSETS: Record<
  FilterName,
  { fieldsetKey: string; label: string }
> = {
  seniority: { fieldsetKey: "SENIORITY_LEVEL", label: "Seniority" },
  headcount: { fieldsetKey: "COMPANY_HEADCOUNT", label: "Company headcount" },
  jobTitle: { fieldsetKey: "CURRENT_TITLE", label: "Current job title" },
  industry: { fieldsetKey: "INDUSTRY", label: "Industry" },
  function: { fieldsetKey: "FUNCTION", label: "Function" },
  geography: { fieldsetKey: "GEOGRAPHY", label: "Geography" },
  company: { fieldsetKey: "CURRENT_COMPANY", label: "Current company" },
};

export async function waitForLeadSearchFilter(
  filter: FilterName,
): Promise<void> {
  const config = LEAD_FILTER_FIELDSETS[filter];
  await waitForLeadSearchFilterFieldset(config.fieldsetKey, config.label);
}

export async function waitForLeadSearchFilters(): Promise<void> {
  await Promise.all(
    FILTER_NAMES.map((filter) => waitForLeadSearchFilter(filter)),
  );
}

export async function getSearchState(): Promise<SearchState> {
  await waitForLeadSearchFilters();

  const filters = {} as SearchState["filters"];
  for (const name of FILTER_NAMES) {
    filters[name] = readSelections(cfgFor(name)).map(({ label, mode }) => ({
      label,
      mode,
    }));
  }

  let keywords = "";
  try {
    keywords = readKeywords();
  } catch {
    // Keyword input can be absent during a partial render; empty is honest.
  }

  return { filters, keywords, ...readPagination() };
}
