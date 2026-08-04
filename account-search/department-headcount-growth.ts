import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface DepartmentHeadcountGrowthDepartment {
  label: string;
  value: string;
}

export interface DepartmentHeadcountGrowthSelection {
  label: string;
  department: string | null;
  min: number | null;
  max: number | null;
}

export interface DepartmentHeadcountGrowthState {
  selection: DepartmentHeadcountGrowthSelection | null;
  page: number | null;
  totalPages: number | null;
}

const FIELDSET_KEY = "DEPARTMENT_HEADCOUNT_GROWTH";

function isFilterPanelExpanded(): boolean {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-controls]"))
    .some((button) =>
      button.getAttribute("aria-expanded") === "true" &&
      /collapse filter panel/i.test(button.getAttribute("aria-label") ?? "")
    );
}

function filterPanelExpandToggle(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-controls]"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "false" &&
      (
        /expand filter panel/i.test(button.getAttribute("aria-label") ?? "") ||
        /expand panel to see all filters/i.test(button.getAttribute("aria-label") ?? "")
      )
    ) ?? null;
}

async function expandFilterPanel(): Promise<void> {
  await waitFor(
    () => isFilterPanelExpanded() || filterPanelExpandToggle() !== null,
    15_000,
    "account search filter panel toggle",
  );

  if (isFilterPanelExpanded()) return;

  const toggle = filterPanelExpandToggle();
  if (!toggle) {
    throw new ToolError("NOT_FOUND", "Account search filter panel expand toggle not found");
  }

  realClick(toggle);
  await waitFor(
    isFilterPanelExpanded,
    4000,
    "account search filter panel expansion",
  );
}

async function collapseFilterPanel(): Promise<void> {
  const toggle = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-controls]"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "true" &&
      /collapse filter panel/i.test(button.getAttribute("aria-label") ?? "")
    );

  if (!toggle) return;

  realClick(toggle);
  await waitFor(
    () => !isFilterPanelExpanded(),
    4000,
    "account search filter panel collapse",
  );
}

function fieldset(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${FIELDSET_KEY}"]`,
  );
  if (!el) {
    throw new ToolError("NOT_FOUND", "Department headcount growth fieldset not found");
  }
  return el;
}

function departmentSelect(root = fieldset()): HTMLSelectElement {
  const select = root.querySelector<HTMLSelectElement>("select");
  if (!select) {
    throw new ToolError(
      "NOT_FOUND",
      "Department headcount growth department select not found",
    );
  }
  return select;
}

function minInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => el.placeholder === "Min (%)");
  if (!input) {
    throw new ToolError("NOT_FOUND", "Department headcount growth min input not found");
  }
  return input;
}

function maxInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => el.placeholder === "Max (%)");
  if (!input) {
    throw new ToolError("NOT_FOUND", "Department headcount growth max input not found");
  }
  return input;
}

function addButton(root = fieldset()): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) =>
      /Add filter for Department headcount growth/i.test(
        el.getAttribute("aria-label") ?? "",
      )
    );
  if (!button) {
    throw new ToolError("NOT_FOUND", "Department headcount growth Add button not found");
  }
  return button;
}

function optionList(select: HTMLSelectElement): DepartmentHeadcountGrowthDepartment[] {
  return Array.from(select.options)
    .filter((option) => !option.disabled && option.value !== "")
    .map((option) => ({
      label: option.textContent?.replace(/\s+/g, " ").trim() ?? option.value,
      value: option.value,
    }));
}

function assertDepartment(select: HTMLSelectElement, value: string): void {
  const exists = Array.from(select.options).some(
    (option) => !option.disabled && option.value === value,
  );
  if (!exists) {
    throw new ToolError(
      "BAD_ARGS",
      `Invalid Department headcount growth department: ${value}`,
    );
  }
}

function parseNumber(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ToolError(
      "BAD_ARGS",
      `Department headcount growth ${name} must be an integer`,
    );
  }
  return number;
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

function pillLabel(pill: HTMLElement): string {
  return (
    pill.querySelector<HTMLElement>("._pill-text_16hazu")?.textContent?.trim() ??
    pill.textContent?.replace(/\s+/g, " ").trim() ??
    ""
  );
}

function readSelection(root = fieldset()): {
  selection: DepartmentHeadcountGrowthSelection;
  removeEl: HTMLElement;
} | null {
  const pill =
    root.querySelector<HTMLElement>(
      "[data-control-name='search_filter_pill_DEPARTMENT_HEADCOUNT_GROWTH_DISMISS']",
    ) ??
    Array.from(root.querySelectorAll<HTMLElement>(".artdeco-pill"))
      .find((el) =>
        /Remove Department headcount growth filter/i.test(
          el.getAttribute("aria-label") ?? "",
        )
      ) ??
    null;

  if (!pill) return null;

  const label = pillLabel(pill);
  if (!label) return null;

  return {
    selection: { label, department: null, min: null, max: null },
    removeEl: pill,
  };
}

function editButton(root = fieldset()): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "false" &&
      /Edit Department headcount growth filter/i.test(button.textContent ?? "")
    ) ?? null;
}

function collapseEditorButton(root = fieldset()): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "true" &&
      /Collapse Department headcount growth filter/i.test(button.textContent ?? "")
    ) ?? null;
}

async function readStructuredSelection(): Promise<
  DepartmentHeadcountGrowthSelection | null
> {
  const current = readSelection();
  if (!current) return null;

  const edit = editButton();
  if (!edit) {
    throw new ToolError("NOT_FOUND", "Department headcount growth edit button not found");
  }

  realClick(edit);
  await waitFor(
    () =>
      fieldset().querySelector("select") !== null &&
      fieldset().querySelector('input[placeholder="Min (%)"]') !== null &&
      fieldset().querySelector('input[placeholder="Max (%)"]') !== null,
    4000,
    "Department headcount growth edit controls",
  );

  try {
    const root = fieldset();
    return {
      label: current.selection.label,
      department: departmentSelect(root).value || null,
      min: parseNumber(minInput(root).value, "min"),
      max: parseNumber(maxInput(root).value, "max"),
    };
  } finally {
    const collapse = collapseEditorButton();
    if (collapse) {
      realClick(collapse);
      await waitFor(
        () => readSelection(fieldset()) !== null,
        4000,
        "Department headcount growth editor collapse",
      );
    }
  }
}

function hasSettledSelection(root = fieldset()): boolean {
  const selection = readSelection(root)?.selection;
  return selection != null && !/loading data/i.test(selection.label);
}

async function snapshotDepartmentHeadcountGrowthState(): Promise<
  DepartmentHeadcountGrowthState
> {
  const pagination = readPagination();
  const root = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${FIELDSET_KEY}"]`,
  );
  if (!root) return { selection: null, ...pagination };

  return {
    selection: await readStructuredSelection(),
    ...pagination,
  };
}

export async function readDepartmentHeadcountGrowthState(): Promise<
  DepartmentHeadcountGrowthState
> {
  await expandFilterPanel();
  try {
    await waitForAccountFilterFieldset(FIELDSET_KEY, "Department headcount growth");
    return await snapshotDepartmentHeadcountGrowthState();
  } finally {
    await collapseFilterPanel();
  }
}

export async function expandDepartmentHeadcountGrowth(): Promise<HTMLElement> {
  await expandFilterPanel();

  const root = await waitForAccountFilterFieldset(
    FIELDSET_KEY,
    "Department headcount growth",
  );
  if (root.querySelector("select")) return root;

  const toggle = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "false" &&
      (
        button.getAttribute("data-x-search-filter") === "container-toggle" ||
        /expand department headcount growth filter/i.test(button.textContent ?? "")
      )
    );

  if (!toggle) {
    throw new ToolError("NOT_FOUND", "Department headcount growth expand toggle not found");
  }

  realClick(toggle);
  await waitFor(
    () => fieldset().querySelector("select") !== null,
    4000,
    "Department headcount growth controls",
  );

  return fieldset();
}

export async function listDepartmentHeadcountGrowthDepartments(): Promise<
  DepartmentHeadcountGrowthDepartment[]
> {
  await expandFilterPanel();
  try {
    const root = await expandDepartmentHeadcountGrowth();
    return optionList(departmentSelect(root));
  } finally {
    await collapseFilterPanel();
  }
}

export async function clearDepartmentHeadcountGrowth(): Promise<
  DepartmentHeadcountGrowthState
> {
  await expandFilterPanel();
  try {
    const root = await waitForAccountFilterFieldset(
      FIELDSET_KEY,
      "Department headcount growth",
    );
    const current = readSelection(root);
    if (!current) return await snapshotDepartmentHeadcountGrowthState();

    realClick(current.removeEl);
    await waitFor(
      () => readSelection(fieldset()) === null,
      4000,
      "Department headcount growth pill removal",
    );

    return await snapshotDepartmentHeadcountGrowthState();
  } finally {
    await collapseFilterPanel();
  }
}

export async function setDepartmentHeadcountGrowth(args: {
  department?: string | number;
  min?: string | number;
  max?: string | number;
}): Promise<DepartmentHeadcountGrowthState> {
  const department = String(args.department ?? "");
  const min = parseNumber(args.min, "min");
  const max = parseNumber(args.max, "max");

  if (!department) {
    throw new ToolError("BAD_ARGS", "Department headcount growth requires department");
  }
  if (min == null && max == null) {
    throw new ToolError(
      "BAD_ARGS",
      "Department headcount growth requires min, max, or both",
    );
  }

  await expandFilterPanel();
  try {
    const existing = await waitForAccountFilterFieldset(
      FIELDSET_KEY,
      "Department headcount growth",
    );
    const current = readSelection(existing);
    if (current) {
      realClick(current.removeEl);
      await waitFor(
        () => readSelection(fieldset()) === null,
        4000,
        "Department headcount growth pill removal",
      );
    }

    const root = await expandDepartmentHeadcountGrowth();
    const select = departmentSelect(root);
    assertDepartment(select, department);

    setSelectValue(select, department);
    if (min != null) setInputValue(minInput(root), min);
    if (max != null) setInputValue(maxInput(root), max);

    await waitFor(
      () => !addButton(root).disabled,
      3000,
      "Department headcount growth Add button",
    );

    realClick(addButton(root));
    await waitFor(
      () => hasSettledSelection(fieldset()),
      10_000,
      "Department headcount growth selection",
    );

    return await snapshotDepartmentHeadcountGrowthState();
  } finally {
    await collapseFilterPanel();
  }
}
