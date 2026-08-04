import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface AnnualRevenueOptions {
  currencies: { label: string; value: string }[];
  minValues: { label: string; value: string }[];
  maxValues: { label: string; value: string }[];
}

export interface AnnualRevenueState {
  currency: string | null;
  min: string | null;
  max: string | null;
  page: number | null;
  totalPages: number | null;
}

const FIELDSET_KEY = "ANNUAL_REVENUE";
const OPEN_ENDED_MAX_VALUE = "1001";

function fieldset(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${FIELDSET_KEY}"]`,
  );
  if (!el) throw new ToolError("NOT_FOUND", "Annual revenue fieldset not found");
  return el;
}

function selectByLabel(root: HTMLElement, label: string): HTMLSelectElement {
  const select = Array.from(root.querySelectorAll<HTMLSelectElement>("select"))
    .find((el) => el.getAttribute("aria-label")?.includes(label));
  if (!select) throw new ToolError("NOT_FOUND", `Annual revenue ${label} select not found`);
  return select;
}

function currencySelect(root = fieldset()): HTMLSelectElement {
  return selectByLabel(root, "Select currency");
}

function minSelect(root = fieldset()): HTMLSelectElement {
  return selectByLabel(root, "Minimum value");
}

function maxSelect(root = fieldset()): HTMLSelectElement {
  return selectByLabel(root, "Maximum value");
}

function addButton(root = fieldset()): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => /Add filter for Annual revenue/i.test(el.getAttribute("aria-label") ?? ""));
  if (!button) throw new ToolError("NOT_FOUND", "Annual revenue Add button not found");
  return button;
}

function resetButton(root = fieldset()): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => /Reset Annual revenue/i.test(el.getAttribute("aria-label") ?? "")) ?? null;
}

function optionList(select: HTMLSelectElement): { label: string; value: string }[] {
  return Array.from(select.options)
    .filter((option) => !option.disabled && option.value !== "")
    .map((option) => ({
      label: option.textContent?.replace(/\s+/g, " ").trim() ?? option.value,
      value: option.value,
    }));
}

function selectedValue(select: HTMLSelectElement): string | null {
  const option = select.selectedOptions[0];
  return option && !option.disabled ? option.value || null : null;
}

function semanticMaxValue(select: HTMLSelectElement): string | null {
  const value = selectedValue(select);
  return value === OPEN_ENDED_MAX_VALUE ? null : value;
}

function assertOption(select: HTMLSelectElement, value: string, name: string): void {
  const exists = Array.from(select.options).some(
    (option) => !option.disabled && option.value === value,
  );
  if (!exists) {
    throw new ToolError("BAD_ARGS", `Invalid Annual revenue ${name}: ${value}`);
  }
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;

  setter?.call(select, value);
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function isAnnualRevenueOpen(): boolean {
  return fieldset().querySelectorAll("select").length >= 3;
}

export async function expandAnnualRevenue(): Promise<HTMLElement> {
  const root = await waitForAccountFilterFieldset(FIELDSET_KEY, "Annual revenue");
  if (isAnnualRevenueOpen()) return root;

  const toggles = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  );

  if (toggles.length !== 1) {
    throw new ToolError(
      "NOT_FOUND",
      `Expected one Annual revenue toggle, found ${toggles.length}`,
    );
  }

  const toggle = toggles[0]!;
  if (toggle.getAttribute("aria-expanded") === "false") {
    realClick(toggle);
  }

  await waitFor(
    isAnnualRevenueOpen,
    4000,
    "Annual revenue controls",
  );

  return fieldset();
}

export async function listAnnualRevenueOptions(): Promise<AnnualRevenueOptions> {
  const root = await expandAnnualRevenue();
  return {
    currencies: optionList(currencySelect(root)),
    minValues: optionList(minSelect(root)),
    maxValues: optionList(maxSelect(root)),
  };
}

export async function setAnnualRevenue(args: {
  currency?: string;
  min?: string | number;
  max?: string | number;
}): Promise<AnnualRevenueState> {
  const root = await expandAnnualRevenue();

  const currency = String(args.currency ?? "USD");
  const min = String(args.min ?? "");
  const rawMax = args.max == null ? null : String(args.max);
  const max = rawMax === OPEN_ENDED_MAX_VALUE ? null : rawMax;

  if (!min && max === null) {
    throw new ToolError("BAD_ARGS", "Annual revenue requires min, max, or both");
  }

  const currencyEl = currencySelect(root);
  const minEl = minSelect(root);
  const maxEl = maxSelect(root);

  if (
    selectedValue(currencyEl) === currency &&
    selectedValue(minEl) === (min || null) &&
    semanticMaxValue(maxEl) === max
  ) {
    return await readAnnualRevenueState();
  }

  const formMax = max ?? OPEN_ENDED_MAX_VALUE;

  assertOption(currencyEl, currency, "currency");
  if (min) assertOption(minEl, min, "min");
  assertOption(maxEl, formMax, "max");

  setSelectValue(currencyEl, currency);
  if (min) setSelectValue(minEl, min);
  setSelectValue(maxEl, formMax);

  await waitFor(
    () => !addButton(root).disabled,
    3000,
    "Annual revenue Add button",
  );

  realClick(addButton(root));
  await waitFor(
    () => addButton(root).disabled,
    5000,
    "Annual revenue filter apply",
  ).catch(() => {});

  return await readAnnualRevenueState();
}

export async function clearAnnualRevenue(): Promise<AnnualRevenueState> {
  const root = await expandAnnualRevenue();
  const reset = resetButton(root);
  if (reset && !reset.disabled) {
    realClick(reset);
    await waitFor(
      () => resetButton(root)?.disabled === true,
      3000,
      "Annual revenue reset",
    ).catch(() => {});
  }
  return await readAnnualRevenueState();
}

export async function readAnnualRevenueState(): Promise<AnnualRevenueState> {
  const root = await expandAnnualRevenue();
  const pagination = readPagination();

  const min = selectedValue(minSelect(root));
  const max = semanticMaxValue(maxSelect(root));
  const currency = min === null && max === null
    ? null
    : selectedValue(currencySelect(root));
  return { currency, min, max, ...pagination };
}
