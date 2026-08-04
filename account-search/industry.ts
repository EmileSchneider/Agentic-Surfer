import {
  INDUSTRY,
  norm,
  readOptions,
  searchFilter,
  type FilterMode,
} from "../linkedin/filters.ts";
import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError, type FilterOption, type FilterSelection } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface IndustryState {
  selections: FilterSelection[];
  page: number | null;
  totalPages: number | null;
}

async function waitForIndustryFieldset(): Promise<void> {
  await waitForAccountFilterFieldset(INDUSTRY.fieldsetKey, "Industry");
}

function fieldset(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${INDUSTRY.fieldsetKey}"]`,
  );
  if (!el) throw new ToolError("NOT_FOUND", "Industry fieldset not found");
  return el;
}

function pillLabel(pill: HTMLElement): string {
  return (
    pill.querySelector<HTMLElement>("._pill-text_16hazu")?.textContent?.trim() ??
    pill.textContent?.replace(/\s+/g, " ").trim() ??
    ""
  );
}

function readIndustrySelections(): {
  label: string;
  mode: FilterMode;
  removeEl: HTMLElement | null;
}[] {
  const root = fieldset();
  return Array.from(root.querySelectorAll<HTMLElement>(".artdeco-pill"))
    .flatMap((pill) => {
      const label = pillLabel(pill);
      if (!label) return [];

      const toggle = pill.querySelector<HTMLElement>(
        "[data-control-name$='_exclusion_toggle']",
      );
      const toggleLabel = toggle?.getAttribute("aria-label")?.trim() ?? "";
      const mode: FilterMode = toggleLabel.startsWith("Exclude")
        ? "include"
        : toggleLabel.startsWith("Include")
        ? "exclude"
        : "include";

      const removeEl =
        pill.querySelector<HTMLElement>(
          `[data-control-name='search_filter_pill_${INDUSTRY.dismissKey}_DISMISS']`,
        ) ??
        (pill.matches("[data-control-name$='_DISMISS']") ? pill : null);

      return [{ label, mode, removeEl }];
    });
}

export function readIndustryState(): IndustryState {
  return {
    selections: readIndustrySelections().map(({ label, mode }) => ({
      label,
      mode,
    })),
    ...readPagination(),
  };
}

export async function searchIndustryOptions(
  query: string,
): Promise<FilterOption[]> {
  await waitForIndustryFieldset();
  return await searchFilter(INDUSTRY, query);
}

export async function selectIndustryOption(args: {
  code?: string;
  query?: string;
  mode?: FilterMode;
}): Promise<IndustryState> {
  let code = String(args.code ?? "");
  const query = args.query == null ? null : String(args.query);
  const mode = args.mode ?? "include";

  await waitForIndustryFieldset();
  if (
    query !== null &&
    readIndustrySelections().some(
      (selection) =>
        norm(selection.label) === norm(query) && selection.mode === mode,
    )
  ) {
    return readIndustryState();
  }

  if (!code && query === null) {
    throw new ToolError("BAD_ARGS", "Industry requires code or query");
  }

  if (query !== null) {
    const options = await searchFilter(INDUSTRY, query);
    if (!code) {
      const matches = options.filter(
        (candidate) => norm(candidate.label) === norm(query),
      );
      if (matches.length !== 1) {
        throw new ToolError(
          "NOT_FOUND",
          `Expected one industry named ${query}, found ${matches.length}`,
        );
      }
      code = matches[0]!.code;
    }
  }

  const option = readOptions(INDUSTRY)
    .find((candidate) => norm(candidate.code) === norm(code));
  if (!option) {
    throw new ToolError(
      "NOT_FOUND",
      `No industry option for code ${code}`,
    );
  }

  if (
    readIndustrySelections().some(
      (selection) =>
        norm(selection.label) === norm(option.label) && selection.mode === mode,
    )
  ) {
    return readIndustryState();
  }

  realClick(mode === "include" ? option.includeEl : option.excludeEl);

  await waitFor(
    () =>
      readIndustrySelections().some(
        (selection) =>
          norm(selection.label) === norm(option.label) &&
          selection.mode === mode,
      ),
    4000,
    `Industry selection "${option.label}"`,
  );

  return readIndustryState();
}

export async function clearIndustry(): Promise<IndustryState> {
  await waitForIndustryFieldset();
  let guard = 0;
  while (true) {
    const selections = readIndustrySelections();
    if (selections.length === 0) return readIndustryState();

    const first = selections[0]!;
    if (!first.removeEl) {
      throw new ToolError(
        "NOT_FOUND",
        `Remove control not found for industry "${first.label}"`,
      );
    }

    const before = selections.length;
    realClick(first.removeEl);
    await waitFor(
      () => readIndustrySelections().length < before,
      3000,
      `Industry removal "${first.label}"`,
    );

    if (++guard > 50) {
      throw new ToolError("INTERNAL", "clearIndustry runaway");
    }
  }
}
