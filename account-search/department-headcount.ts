import { realClick, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readPagination } from "./results.ts";

export interface DepartmentHeadcountDepartment {
  label: string;
  value: string;
}

export interface DepartmentHeadcountSelection {
  label: string;
  department: string | null;
  min: number | null;
  max: number | null;
}

export interface DepartmentHeadcountState {
  selection: DepartmentHeadcountSelection | null;
  page: number | null;
  totalPages: number | null;
}

const FIELDSET_KEY = "DEPARTMENT_HEADCOUNT";
const DEPARTMENT_SELECT_LABEL = "Select department from dropdown";

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
  if (!el) throw new ToolError("NOT_FOUND", "Department headcount fieldset not found");
  return el;
}

function departmentSelect(root = fieldset()): HTMLSelectElement {
  const select = Array.from(root.querySelectorAll<HTMLSelectElement>("select"))
    .find((el) => el.getAttribute("aria-label") === DEPARTMENT_SELECT_LABEL);
  if (!select) {
    throw new ToolError("NOT_FOUND", "Department headcount department select not found");
  }
  return select;
}

function minInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => el.placeholder === "Min");
  if (!input) {
    throw new ToolError("NOT_FOUND", "Department headcount min input not found");
  }
  return input;
}

function maxInput(root = fieldset()): HTMLInputElement {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>("input"))
    .find((el) => el.placeholder === "Max");
  if (!input) {
    throw new ToolError("NOT_FOUND", "Department headcount max input not found");
  }
  return input;
}

function addButton(root = fieldset()): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => /Add filter for Department headcount/i.test(el.getAttribute("aria-label") ?? ""));
  if (!button) {
    throw new ToolError("NOT_FOUND", "Department headcount Add button not found");
  }
  return button;
}

function optionList(select: HTMLSelectElement): DepartmentHeadcountDepartment[] {
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
    throw new ToolError("BAD_ARGS", `Invalid Department headcount department: ${value}`);
  }
}

function parseNumber(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ToolError("BAD_ARGS", `Department headcount ${name} must be an integer`);
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
  selection: DepartmentHeadcountSelection;
  removeEl: HTMLElement;
} | null {
  const pill =
    root.querySelector<HTMLElement>(
      "[data-control-name='search_filter_pill_DEPARTMENT_HEADCOUNT_DISMISS']",
    ) ??
    Array.from(root.querySelectorAll<HTMLElement>(".artdeco-pill"))
      .find((el) => /Remove Department headcount filter/i.test(el.getAttribute("aria-label") ?? "")) ??
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
      /Edit Department headcount filter/i.test(button.textContent ?? "")
    ) ?? null;
}

function collapseEditorButton(root = fieldset()): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "true" &&
      /Collapse Department headcount filter/i.test(button.textContent ?? "")
    ) ?? null;
}

async function readStructuredSelection(): Promise<DepartmentHeadcountSelection | null> {
  const current = readSelection();
  if (!current) return null;

  const edit = editButton();
  if (!edit) {
    throw new ToolError("NOT_FOUND", "Department headcount edit button not found");
  }

  realClick(edit);
  await waitFor(
    () =>
      fieldset().querySelector(`select[aria-label="${DEPARTMENT_SELECT_LABEL}"]`) !== null &&
      fieldset().querySelector('input[placeholder="Min"]') !== null &&
      fieldset().querySelector('input[placeholder="Max"]') !== null,
    4000,
    "Department headcount edit controls",
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
        "Department headcount editor collapse",
      );
    }
  }
}

function hasSettledSelection(root = fieldset()): boolean {
  const selection = readSelection(root)?.selection;
  return selection != null && !/loading data/i.test(selection.label);
}

async function snapshotDepartmentHeadcountState(): Promise<DepartmentHeadcountState> {
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

export async function readDepartmentHeadcountState(): Promise<DepartmentHeadcountState> {
  await expandFilterPanel();
  try {
    await waitForAccountFilterFieldset(FIELDSET_KEY, "Department headcount");
    return await snapshotDepartmentHeadcountState();
  } finally {
    await collapseFilterPanel();
  }
}

export async function expandDepartmentHeadcount(): Promise<HTMLElement> {
  await expandFilterPanel();

  const root = await waitForAccountFilterFieldset(
    FIELDSET_KEY,
    "Department headcount",
  );
  if (root.querySelector(`select[aria-label="${DEPARTMENT_SELECT_LABEL}"]`)) {
    return root;
  }

  const toggle = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) =>
      button.getAttribute("aria-expanded") === "false" &&
      (
        button.getAttribute("data-x-search-filter") === "container-toggle" ||
        /expand department headcount filter/i.test(button.textContent ?? "")
      )
    );

  if (!toggle) {
    throw new ToolError("NOT_FOUND", "Department headcount expand toggle not found");
  }

  realClick(toggle);
  await waitFor(
    () => fieldset().querySelector(`select[aria-label="${DEPARTMENT_SELECT_LABEL}"]`) !== null,
    4000,
    "Department headcount controls",
  );

  return fieldset();
}

export async function listDepartmentHeadcountDepartments(): Promise<
  DepartmentHeadcountDepartment[]
> {
  await expandFilterPanel();
  try {
    const root = await expandDepartmentHeadcount();
    return optionList(departmentSelect(root));
  } finally {
    await collapseFilterPanel();
  }
}

export async function clearDepartmentHeadcount(): Promise<DepartmentHeadcountState> {
  await expandFilterPanel();
  try {
    const root = await waitForAccountFilterFieldset(
      FIELDSET_KEY,
      "Department headcount",
    );
    const current = readSelection(root);
    if (!current) return await snapshotDepartmentHeadcountState();

    realClick(current.removeEl);
    await waitFor(
      () => readSelection(fieldset()) === null,
      4000,
      "Department headcount pill removal",
    );

    return await snapshotDepartmentHeadcountState();
  } finally {
    await collapseFilterPanel();
  }
}

export async function setDepartmentHeadcount(args: {
  department?: string | number;
  min?: string | number;
  max?: string | number;
}): Promise<DepartmentHeadcountState> {
  const department = String(args.department ?? "");
  const min = parseNumber(args.min, "min");
  const max = parseNumber(args.max, "max");

  if (!department) {
    throw new ToolError("BAD_ARGS", "Department headcount requires department");
  }
  if (min == null && max == null) {
    throw new ToolError("BAD_ARGS", "Department headcount requires min, max, or both");
  }

  await expandFilterPanel();
  try {
    const existing = await waitForAccountFilterFieldset(
      FIELDSET_KEY,
      "Department headcount",
    );
    const current = readSelection(existing);
    if (current) {
      realClick(current.removeEl);
      await waitFor(
        () => readSelection(fieldset()) === null,
        4000,
        "Department headcount pill removal",
      );
    }

    const root = await expandDepartmentHeadcount();
    const select = departmentSelect(root);
    assertDepartment(select, department);

    setSelectValue(select, department);
    if (min != null) setInputValue(minInput(root), min);
    if (max != null) setInputValue(maxInput(root), max);

    await waitFor(
      () => !addButton(root).disabled,
      3000,
      "Department headcount Add button",
    );

    realClick(addButton(root));
    await waitFor(
      () => hasSettledSelection(fieldset()),
      10_000,
      "Department headcount selection",
    );

    return await snapshotDepartmentHeadcountState();
  } finally {
    await collapseFilterPanel();
  }
}
