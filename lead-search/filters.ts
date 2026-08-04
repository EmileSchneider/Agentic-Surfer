import type { FilterMode, FilterName, FilterOption, SearchState } from "../types.ts";
import { FILTER_NAMES, ToolError } from "../types.ts";
import {
  cfgFor,
  clearFilter as driverClear,
  listFilterOptions as driverList,
  norm,
  readOptions,
  readSelections,
  removeFilterSelection as driverRemove,
  searchFilter as driverSearch,
  selectFilterOption as driverSelect,
} from "../linkedin/filters.ts";
import { getSearchState, waitForLeadSearchFilter } from "./search_state.ts";

const filterCacheKey = (filter: FilterName) => `filterCache:${filter}`;

type FilterCache = {
  byLabel: Record<string, string>;
  byCode: Record<string, string>;
};

async function getFilterCache(filter: FilterName): Promise<FilterCache> {
  const key = filterCacheKey(filter);
  const got = await chrome.storage.session.get(key);
  return got[key] ?? { byLabel: {}, byCode: {} };
}

async function rememberOptions(filter: FilterName, options: FilterOption[]) {
  const key = filterCacheKey(filter);
  const cache = await getFilterCache(filter);

  for (const { label, code } of options) {
    cache.byLabel[norm(label)] = code;
    cache.byCode[norm(code)] = label;
  }

  await chrome.storage.session.set({ [key]: cache });
}

function assertFilterName(name: string): FilterName {
  if (!(FILTER_NAMES as readonly string[]).includes(name)) {
    throw new ToolError(
      "BAD_ARGS",
      `Unknown filter "${name}". Valid filters: ${FILTER_NAMES.join(", ")}`,
    );
  }
  return name as FilterName;
}

const isTypeahead = (filter: FilterName): boolean => !!cfgFor(filter).placeholder;

function urnType(urn: string): string {
  return urn.split(":")[2] ?? "";
}

function shapeOptions(filter: FilterName, options: FilterOption[]): FilterOption[] {
  if (filter !== "company") return options;
  return options.filter((option) => urnType(option.code) === "organization");
}

const cacheKey = (filter: FilterName) => `codeQueries:${filter}`;

async function rememberQueries(
  filter: FilterName,
  query: string,
  options: FilterOption[],
): Promise<void> {
  const key = cacheKey(filter);
  const got = await chrome.storage.session.get(key);
  const map = (got[key] ?? {}) as Record<string, string>;
  for (const option of options) map[option.code] = query;
  await chrome.storage.session.set({ [key]: map });
}

async function recallQuery(
  filter: FilterName,
  code: string,
): Promise<string | null> {
  const key = cacheKey(filter);
  const got = await chrome.storage.session.get(key);
  const map = (got[key] ?? {}) as Record<string, string>;
  const hit = Object.keys(map).find((key) => norm(key) === norm(code));
  return hit ? (map[hit] ?? null) : null;
}

export async function listFilterOptions(
  filterRaw: string,
): Promise<FilterOption[]> {
  const filter = assertFilterName(filterRaw);
  if (isTypeahead(filter)) {
    throw new ToolError(
      "BAD_ARGS",
      `"${filter}" is a typeahead filter; use searchFilterOptions with a query`,
    );
  }

  await waitForLeadSearchFilter(filter);
  const options = await driverList(cfgFor(filter));
  await rememberOptions(filter, options);
  return options;
}

export async function searchFilterOptions(
  filterRaw: string,
  query: string,
): Promise<FilterOption[]> {
  const filter = assertFilterName(filterRaw);
  if (!isTypeahead(filter)) {
    throw new ToolError(
      "BAD_ARGS",
      `"${filter}" is a fixed-list filter; use listFilterOptions (no query needed)`,
    );
  }

  await waitForLeadSearchFilter(filter);
  const options = shapeOptions(
    filter,
    await driverSearch(cfgFor(filter), query),
  );
  await rememberQueries(filter, query, options);
  await rememberOptions(filter, options);
  return options.map(({ label, code }) => ({ label, code }));
}

export async function selectFilterOption(
  filterRaw: string,
  code: string,
  mode: FilterMode = "include",
): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  const config = cfgFor(filter);

  await waitForLeadSearchFilter(filter);

  const present = () =>
    readOptions(config).some((option) => norm(option.code) === norm(code));

  const selected = () => readSelections(config);

  const cache = await getFilterCache(filter);
  const cachedLabel = cache.byCode[norm(code)];
  if (
    cachedLabel &&
    selected().some(
      (selection) =>
        norm(selection.label) === norm(cachedLabel) && selection.mode === mode,
    )
  ) {
    return await getSearchState();
  }

  if (!present()) {
    if (isTypeahead(filter)) {
      const query = await recallQuery(filter, code);
      if (!query) {
        throw new ToolError(
          "NOT_FOUND",
          `Code "${code}" was never returned by a ${filter} search in this session - ` +
            `call searchFilterOptions("${filter}", ...) and pick a code from its results`,
        );
      }
      await driverSearch(config, query);
    } else {
      await driverList(config);
    }
    if (!present()) {
      throw new ToolError(
        "NOT_FOUND",
        `Code "${code}" no longer resolves for ${filter} - ` +
          `re-run searchFilterOptions("${filter}", ...) and pick a fresh code`,
      );
    }
  }

  await driverSelect(config, code, mode);
  return await getSearchState();
}

export async function removeFilterSelection(
  filterRaw: string,
  label: string,
): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  await waitForLeadSearchFilter(filter);
  await driverRemove(cfgFor(filter), label);
  return await getSearchState();
}

export async function clearFilter(filterRaw: string): Promise<SearchState> {
  const filter = assertFilterName(filterRaw);
  await waitForLeadSearchFilter(filter);
  await driverClear(cfgFor(filter));
  return await getSearchState();
}
