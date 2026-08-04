import { isVisible, realClick, sleep, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";

export interface AccountResult {
  name: string | null;
  accountId: string | null;
  salesNavUrl: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  location: string | null;
  employeeCount: string | null;
  revenue: string | null;
  description: string | null;
}

export interface AccountResultsPage {
  count: number;
  page: number | null;
  totalPages: number | null;
  accounts: AccountResult[];
}

export interface AccountPaginationState {
  page: number;
  totalPages: number;
}

function text(el: Element | null): string | null {
  const value = el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return value || null;
}

function hasEmptyResultsState(): boolean {
  return isVisible(
    document.querySelector(".illustration-spots-large.empty-room"),
  );
}

function resultRows(): HTMLElement[] {
  const scrollRows = Array.from(
    document.querySelectorAll<HTMLElement>("ol.artdeco-list > li.artdeco-list__item"),
  ).filter((li) => li.querySelector("[data-scroll-into-view]") !== null);

  if (scrollRows.length > 0) return scrollRows;

  const linkedRows = Array.from(
    document.querySelectorAll<HTMLElement>("ol.artdeco-list > li.artdeco-list__item"),
  ).filter((li) => li.querySelector('a[href*="/sales/company/"]') !== null);

  if (linkedRows.length > 0) return linkedRows;

  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-x-search-result="ACCOUNT"]'),
  );
}

function firstResultIdentity(): string | null {
  const row = resultRows()[0];
  if (!row) return null;

  return (
    row.querySelector("[data-scroll-into-view]")?.getAttribute("data-scroll-into-view") ??
    row.querySelector<HTMLAnchorElement>('a[href*="/sales/company/"]')
      ?.getAttribute("href")
      ?.split("?")[0] ??
    null
  );
}

function isHydrated(row: HTMLElement): boolean {
  return (
    row.querySelector('[data-x-search-result="ACCOUNT"]') !== null ||
    row.querySelector('a[href*="/sales/company/"]') !== null
  );
}

function parseAccountId(url: string | null): string | null {
  return url?.match(/\/sales\/company\/(\d+)/)?.[1] ?? null;
}

function normalizeSalesNavUrl(url: string | null): string | null {
  if (!url) return null;
  const path = url.split("?")[0] ?? url;
  return path.startsWith("http") ? path : `https://www.linkedin.com${path}`;
}

function bestMetadata(row: HTMLElement): string[] {
  const candidates = Array.from(
    row.querySelectorAll<HTMLElement>(
      [
        "[data-anonymize]",
        ".artdeco-entity-lockup__subtitle",
        ".artdeco-entity-lockup__caption",
        ".artdeco-entity-lockup__metadata",
      ].join(","),
    ),
  )
    .map(text)
    .filter((value): value is string => value !== null);

  return Array.from(new Set(candidates));
}

function firstMatching(parts: string[], pattern: RegExp): string | null {
  return parts.find((part) => pattern.test(part)) ?? null;
}

function matchText(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[0]?.trim() ?? null;
}

function parseEmployeeCount(parts: string[]): string | null {
  for (const part of parts) {
    const match = matchText(
      part,
      /(?:Self-employed|[\d,.]+(?:K|M)?\+?(?:\s*-\s*[\d,.]+(?:K|M)?\+?)?)\s+employees?\s+on\s+LinkedIn/i,
    );
    if (match) return match;
  }
  return null;
}

function parseRevenue(parts: string[]): string | null {
  for (const part of parts) {
    const match = matchText(
      part,
      /\$[\d,.]+(?:K|M|B)?\s*(?:-\s*\$[\d,.]+(?:K|M|B)?)?\s+in\s+revenue/i,
    );
    if (match) return match;
  }
  return null;
}

function removeKnownMetadata(
  value: string,
  employeeCount: string | null,
  revenue: string | null,
): string {
  let cleaned = value;
  if (employeeCount) cleaned = cleaned.replace(employeeCount, "");
  if (revenue) cleaned = cleaned.replace(revenue, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function extractRow(row: HTMLElement): AccountResult {
  const link = row.querySelector<HTMLAnchorElement>('a[href*="/sales/company/"]');
  const rawUrl = link?.getAttribute("href") ?? null;
  const salesNavUrl = normalizeSalesNavUrl(rawUrl);
  const accountId = parseAccountId(rawUrl);

  const name =
    text(row.querySelector('[data-anonymize="company-name"]')) ??
    text(link) ??
    text(row.querySelector("h3, .artdeco-entity-lockup__title"));

  const metadata = bestMetadata(row).filter((part) => part !== name);
  const employeeCount = parseEmployeeCount(metadata);
  const revenue = parseRevenue(metadata);
  const location = firstMatching(metadata, /,\s*[A-Z]{2}\b| area\b| region\b/i);
  const industry =
    metadata
      .map((part) => removeKnownMetadata(part, employeeCount, revenue))
      .find((part) => part && part !== location) ?? null;

  const description =
    text(row.querySelector('[data-anonymize="company-blurb"]')) ??
    row.querySelector("[title]")?.getAttribute("title")?.trim() ??
    null;

  return {
    name,
    accountId,
    salesNavUrl,
    linkedinUrl: accountId ? `https://www.linkedin.com/company/${accountId}` : null,
    industry,
    location,
    employeeCount,
    revenue,
    description,
  };
}

export function readPagination(): { page: number | null; totalPages: number | null } {
  const root = document.querySelector<HTMLElement>(".artdeco-pagination");
  const activePage = root?.querySelector<HTMLElement>(
    "li[data-test-pagination-page-btn].active",
  );
  const page = Number(activePage?.getAttribute("data-test-pagination-page-btn"));
  const numberedPages = Array.from(
    root?.querySelectorAll<HTMLElement>("li[data-test-pagination-page-btn]") ?? [],
  )
    .map((item) => Number(item.getAttribute("data-test-pagination-page-btn")))
    .filter((value) => Number.isInteger(value) && value > 0);
  const totalPages = numberedPages.length > 0 ? Math.max(...numberedPages) : null;

  return {
    page: Number.isInteger(page) && page > 0 ? page : null,
    totalPages,
  };
}

function requirePagination(): AccountPaginationState {
  const pagination = readPagination();
  if (pagination.page == null || pagination.totalPages == null) {
    throw new ToolError("NOT_FOUND", "Account search pagination state not found");
  }
  return {
    page: pagination.page,
    totalPages: pagination.totalPages,
  };
}

function paginationButton(direction: "next" | "previous"): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button.artdeco-pagination__button--${direction}`,
  );
  if (!button) {
    throw new ToolError("NOT_FOUND", `Account search ${direction} page button not found`);
  }
  return button;
}

async function clickPageButton(
  button: HTMLButtonElement,
  expectedPage: number,
): Promise<AccountPaginationState> {
  const firstResultBefore = firstResultIdentity();

  button.scrollIntoView({ block: "center" });
  realClick(button);

  await waitFor(
    () => {
      if (readPagination().page !== expectedPage) return false;
      if (hasEmptyResultsState()) return true;

      const firstResultAfter = firstResultIdentity();
      return firstResultAfter !== null && firstResultAfter !== firstResultBefore;
    },
    10_000,
    `account search results for page ${expectedPage}`,
  );

  return requirePagination();
}

function renderedPageNumbers(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".artdeco-pagination li[data-test-pagination-page-btn]",
    ),
  )
    .map((item) => Number(item.getAttribute("data-test-pagination-page-btn")))
    .filter((page) => Number.isInteger(page) && page > 0);
}

async function goToRenderedPage(page: number): Promise<AccountPaginationState> {
  const button = document.querySelector<HTMLButtonElement>(
    `.artdeco-pagination li[data-test-pagination-page-btn="${page}"] button`,
  );
  if (!button) {
    throw new ToolError("NOT_FOUND", `Rendered account search page ${page} not found`);
  }
  return await clickPageButton(button, page);
}

async function moveOnePage(
  direction: "next" | "previous",
): Promise<AccountPaginationState> {
  const before = requirePagination();
  const expectedPage = direction === "next" ? before.page + 1 : before.page - 1;

  if (expectedPage < 1 || expectedPage > before.totalPages) {
    throw new ToolError(
      "BAD_ARGS",
      direction === "next"
        ? "Already on the last account search page"
        : "Already on the first account search page",
    );
  }

  const button = paginationButton(direction);
  if (button.disabled) {
    throw new ToolError(
      "BAD_ARGS",
      `Account search ${direction} page button is disabled`,
    );
  }

  return await clickPageButton(button, expectedPage);
}

export function readAccountPagination(): AccountPaginationState {
  return requirePagination();
}

export async function goToNextAccountPage(): Promise<AccountPaginationState> {
  return await moveOnePage("next");
}

export async function goToPreviousAccountPage(): Promise<AccountPaginationState> {
  return await moveOnePage("previous");
}

export async function goToAccountPage(page: number): Promise<AccountPaginationState> {
  if (!Number.isInteger(page) || page < 1) {
    throw new ToolError("BAD_ARGS", `Account search page must be a positive integer: ${page}`);
  }

  let current = requirePagination();
  if (page > current.totalPages) {
    throw new ToolError(
      "BAD_ARGS",
      `Account search page ${page} exceeds the last page ${current.totalPages}`,
    );
  }

  while (current.page < page) {
    const rendered = renderedPageNumbers()
      .filter((candidate) => candidate > current.page && candidate <= page);
    current = rendered.length > 0
      ? await goToRenderedPage(Math.max(...rendered))
      : await moveOnePage("next");
  }
  while (current.page > page) {
    const rendered = renderedPageNumbers()
      .filter((candidate) => candidate < current.page && candidate >= page);
    current = rendered.length > 0
      ? await goToRenderedPage(Math.min(...rendered))
      : await moveOnePage("previous");
  }
  return current;
}

export async function readAccountResults(
  limit?: number,
): Promise<AccountResultsPage> {
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
    throw new ToolError("BAD_ARGS", `limit must be a positive integer, got ${limit}`);
  }

  await waitFor(
    () => resultRows().length > 0 || hasEmptyResultsState(),
    8000,
    "account results list",
  );

  if (resultRows().length === 0 && hasEmptyResultsState()) {
    return { count: 0, ...readPagination(), accounts: [] };
  }

  const rows = limit != null ? resultRows().slice(0, limit) : resultRows();
  for (const row of rows) {
    if (isHydrated(row)) continue;
    row.scrollIntoView({ block: "center" });
    await waitFor(() => isHydrated(row), 5000, "account row hydration").catch(() => {});
    await sleep(120);
  }
  rows[0]?.scrollIntoView({ block: "center" });

  const all = resultRows();
  const slice = limit != null ? all.slice(0, limit) : all;

  return {
    count: all.length,
    ...readPagination(),
    accounts: slice.map(extractRow),
  };
}
