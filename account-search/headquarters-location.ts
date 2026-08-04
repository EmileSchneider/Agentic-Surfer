import {
  norm,
  readOptions,
  searchFilter,
  type FilterMode,
} from "../linkedin/filters.ts";
import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError, type FilterOption, type FilterSelection } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface HeadquartersLocationState {
  selections: FilterSelection[];
  page: number | null;
  totalPages: number | null;
}

const HEADQUARTERS_LOCATION = {
  fieldsetKey: "HEADQUARTERS_LOCATION",
  dismissKey: "HEADQUARTERS_LOCATION",
  placeholder: "Add locations",
};

async function waitForHeadquartersLocationFieldset(): Promise<void> {
  await waitForAccountFilterFieldset(
    HEADQUARTERS_LOCATION.fieldsetKey,
    "Headquarters location",
  );
}

function fieldset(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    'fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]',
  );
  if (!el) throw new ToolError("NOT_FOUND", "Headquarters location fieldset not found");
  return el;
}

function pillLabel(pill: HTMLElement): string {
  return (
    pill.querySelector<HTMLElement>("._pill-text_16hazu")?.textContent?.trim() ??
    pill.textContent?.replace(/\s+/g, " ").trim() ??
    ""
  );
}

function readLocationSelections(): {
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
          [
            "[data-control-name='search_filter_pill_HEADQUARTERS_LOCATION_DISMISS']",
            "[data-control-name='search_filter_pill_REGION_DISMISS']",
            "[data-control-name^='search_filter_pill_'][data-control-name$='_DISMISS']",
          ].join(","),
        ) ??
        (pill.matches("[data-control-name$='_DISMISS']") ? pill : null);

      return [{ label, mode, removeEl }];
    });
}

export function readHeadquartersLocationState(): HeadquartersLocationState {
  return {
    selections: readLocationSelections().map(({ label, mode }) => ({
      label,
      mode,
    })),
    ...readPagination(),
  };
}

export async function searchHeadquartersLocationOptions(
  query: string,
): Promise<FilterOption[]> {
  await waitForHeadquartersLocationFieldset();
  return await searchFilter(HEADQUARTERS_LOCATION, query);
}

export async function selectHeadquartersLocationOption(args: {
  code?: string;
  query?: string;
  mode?: FilterMode;
}): Promise<HeadquartersLocationState> {
  let code = String(args.code ?? "");
  const query = args.query == null ? null : String(args.query);
  const mode = args.mode ?? "include";

  await waitForHeadquartersLocationFieldset();
  if (
    query !== null &&
    readLocationSelections().some(
      (selection) =>
        norm(selection.label) === norm(query) && selection.mode === mode,
    )
  ) {
    return readHeadquartersLocationState();
  }

  if (!code && query === null) {
    throw new ToolError(
      "BAD_ARGS",
      "Headquarters location requires code or query",
    );
  }

  if (query !== null) {
    const options = await searchFilter(HEADQUARTERS_LOCATION, query);
    if (!code) {
      const matches = options.filter(
        (candidate) => norm(candidate.label) === norm(query),
      );
      if (matches.length !== 1) {
        throw new ToolError(
          "NOT_FOUND",
          `Expected one headquarters location named ${query}, found ${matches.length}`,
        );
      }
      code = matches[0]!.code;
    }
  }

  const option = readOptions(HEADQUARTERS_LOCATION).find(
    (candidate) => norm(candidate.code) === norm(code),
  );
  if (!option) {
    throw new ToolError(
      "NOT_FOUND",
      `No headquarters location option for code ${code}`,
    );
  }

  if (
    readLocationSelections().some(
      (selection) => norm(selection.label) === norm(option.label) && selection.mode === mode,
    )
  ) {
    return readHeadquartersLocationState();
  }

  realClick(mode === "include" ? option.includeEl : option.excludeEl);

  await waitFor(
    () =>
      readLocationSelections().some(
        (selection) => norm(selection.label) === norm(option.label) && selection.mode === mode,
      ),
    4000,
    `Headquarters location selection "${option.label}"`,
  );

  return readHeadquartersLocationState();
}

export async function clearHeadquartersLocation(): Promise<HeadquartersLocationState> {
  await waitForHeadquartersLocationFieldset();
  let guard = 0;
  while (true) {
    const selections = readLocationSelections();
    if (selections.length === 0) return readHeadquartersLocationState();

    const first = selections[0]!;
    if (!first.removeEl) {
      throw new ToolError(
        "NOT_FOUND",
        `Remove control not found for headquarters location "${first.label}"`,
      );
    }

    const before = selections.length;
    realClick(first.removeEl);
    await waitFor(
      () => readLocationSelections().length < before,
      3000,
      `Headquarters location removal "${first.label}"`,
    );

    if (++guard > 50) {
      throw new ToolError("INTERNAL", "clearHeadquartersLocation runaway");
    }
  }
}
