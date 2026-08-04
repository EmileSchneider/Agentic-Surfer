import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface HeadcountGrowthState {
  min: number | null;
  max: number | null;
  page: number | null;
  totalPages: number | null;
}

const FIELDSET_KEY = "COMPANY_HEADCOUNT_GROWTH";

function fieldset(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${FIELDSET_KEY}"]`,
  );
  if (!el) throw new ToolError("NOT_FOUND", "Company headcount growth fieldset not found");
  return el;
}

function minInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => /Minimum value/i.test(el.labels?.[0]?.textContent ?? "") || el.placeholder === "Min (%)");
  if (!input) throw new ToolError("NOT_FOUND", "Company headcount growth min input not found");
  return input;
}

function maxInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => /Maximum value/i.test(el.labels?.[0]?.getAttribute("aria-label") ?? "") || el.placeholder === "Max (%)");
  if (!input) throw new ToolError("NOT_FOUND", "Company headcount growth max input not found");
  return input;
}

function addButton(root = fieldset()): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => /Add filter for Company headcount growth/i.test(el.getAttribute("aria-label") ?? ""));
  if (!button) throw new ToolError("NOT_FOUND", "Company headcount growth Add button not found");
  return button;
}

function resetButton(root = fieldset()): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => /Reset Company headcount growth/i.test(el.getAttribute("aria-label") ?? "")) ?? null;
}

function parseNumber(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ToolError("BAD_ARGS", `Company headcount growth ${name} must be an integer`);
  }
  return number;
}

function setInputValue(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;

  input.focus();
  setter?.call(input, String(value));
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(value) }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function expandHeadcountGrowth(): Promise<HTMLElement> {
  const root = await waitForAccountFilterFieldset(
    FIELDSET_KEY,
    "Company headcount growth",
  );
  if (root.querySelector("input")) return root;

  const toggle = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find(
      (button) =>
        button.getAttribute("aria-expanded") === "false" &&
        (
          button.getAttribute("data-x-search-filter") === "container-toggle" ||
          /expand company headcount growth filter/i.test(button.textContent ?? "")
        ),
    );

  if (!toggle) {
    throw new ToolError("NOT_FOUND", "Company headcount growth expand toggle not found");
  }
  realClick(toggle);

  await waitFor(
    () => fieldset().querySelector("input") !== null,
    4000,
    "Company headcount growth controls",
  );

  return fieldset();
}

export function readHeadcountGrowthState(): HeadcountGrowthState {
  const root = fieldset();
  const pagination = readPagination();

  if (!root.querySelector("input")) {
    return { min: null, max: null, ...pagination };
  }

  return {
    min: parseNumber(minInput(root).value, "min"),
    max: parseNumber(maxInput(root).value, "max"),
    ...pagination,
  };
}

export async function setHeadcountGrowth(args: {
  min?: number | string;
  max?: number | string;
}): Promise<HeadcountGrowthState> {
  const root = await expandHeadcountGrowth();
  const min = parseNumber(args.min, "min");
  const max = parseNumber(args.max, "max");

  if (min == null && max == null) {
    throw new ToolError("BAD_ARGS", "Company headcount growth requires min, max, or both");
  }

  if (min != null) setInputValue(minInput(root), min);
  if (max != null) setInputValue(maxInput(root), max);

  await waitFor(
    () => !addButton(root).disabled,
    3000,
    "Company headcount growth Add button",
  );

  realClick(addButton(root));
  await waitFor(
    () => addButton(root).disabled,
    5000,
    "Company headcount growth filter apply",
  ).catch(() => {});

  return readHeadcountGrowthState();
}

export async function clearHeadcountGrowth(): Promise<HeadcountGrowthState> {
  const root = await expandHeadcountGrowth();
  const reset = resetButton(root);
  if (reset && !reset.disabled) {
    realClick(reset);
    await waitFor(
      () => resetButton(root)?.disabled === true,
      3000,
      "Company headcount growth reset",
    ).catch(() => {});
  }
  return readHeadcountGrowthState();
}
