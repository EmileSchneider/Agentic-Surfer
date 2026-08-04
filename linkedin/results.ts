// extension/linkedin/results.ts
//
// Read the lead results list on /sales/search/people.
//
// The list is virtualized: rows exist as skeleton placeholders until they
// intersect the viewport, then hydrate with real content. Strategy: walk the
// rows, scrollIntoView() each unhydrated one, wait for hydration (the
// skeleton <article aria-hidden> is replaced by div[data-x-search-result]),
// extract. Requires the tab to be the ACTIVE tab of its window (it is, in
// the agent window) — IntersectionObserver doesn't fire in non-painting tabs.
//
// Selector strategy: lean on data-anonymize attributes (person-name, title,
// company-name, location, person-blurb). They exist for LinkedIn's own
// anonymization tooling and are far more stable than hashed CSS classes.

import { waitFor, realClick, sleep, isVisible } from "./dom.ts";

export interface LeadResult {
  /** Member id (ACwAA…) — durable. linkedin.com/in/<id> resolves to the real profile. */
  memberId: string | null;
  name: string | null;
  title: string | null;
  company: string | null;
  /** Numeric org id parsed from the company link — feeds checkLinkedinProfile. */
  companyOrgId: string | null;
  location: string | null;
  /** Raw tenure strings, e.g. ["6 years 3 months in role", "6 years 3 months in company"] */
  tenure: string[];
  /** Full untruncated About text (from the clamp tooltip), if present. */
  about: string | null;
  /** e.g. "2nd degree connection" */
  connectionDegree: string | null;
  /** Sales Navigator lead page path for this person. */
  salesNavUrl: string | null;
  /** Public profile URL derived from memberId. */
  linkedinUrl: string | null;
  /** false for OUT_OF_NETWORK rows (anonymized "LinkedIn Member" cards). */
  inNetwork: boolean;
}

// ---- row discovery -----------------------------------------------------------

function resultRows(): HTMLLIElement[] {
  // Only rows that carry a salesProfile urn are lead rows (excludes ads,
  // upsells, and other list furniture).
  return Array.from(
    document.querySelectorAll<HTMLLIElement>("ol.artdeco-list > li.artdeco-list__item")
  ).filter((li) => li.querySelector("[data-scroll-into-view]") !== null);
}

function rowUrn(li: HTMLLIElement): string {
  return (
    li.querySelector("[data-scroll-into-view]")?.getAttribute("data-scroll-into-view") ?? ""
  );
}

function isHydrated(li: HTMLLIElement): boolean {
  return li.querySelector('[data-x-search-result="LEAD"]') !== null;
}

// urn:li:fs_salesProfile:(ACwAAAAjt5QB…,NAME_SEARCH,0Kxe) → { memberId, context }
function parseUrn(urn: string): { memberId: string | null; context: string | null } {
  const m = urn.match(/\(([^,)]+),([^,)]+)/);
  return { memberId: m?.[1] ?? null, context: m?.[2] ?? null };
}

// ---- extraction ----------------------------------------------------------------

function extractRow(li: HTMLLIElement): LeadResult {
  const urn = rowUrn(li);
  const { memberId, context } = parseUrn(urn);
  const inNetwork = context !== "OUT_OF_NETWORK";

  const text = (sel: string) => li.querySelector(sel)?.textContent?.trim() ?? null;

  const companyLink = li.querySelector<HTMLAnchorElement>('a[data-anonymize="company-name"]');
  const companyOrgId = companyLink?.getAttribute("href")?.match(/\/sales\/company\/(\d+)/)?.[1] ?? null;

  const nameLink = li.querySelector<HTMLAnchorElement>(
    'a[data-control-name="view_lead_panel_via_search_lead_name"]'
  );
  const salesNavUrl = nameLink?.getAttribute("href")?.split("?")[0] ?? null;

  // Tenure lives in the lockup metadata: "X in role <pipe> Y in company".
  const tenure = (li.querySelector(".artdeco-entity-lockup__metadata")?.textContent ?? "")
    .split("|")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // The clamped About div carries the FULL text in its title attribute.
  const about =
    li.querySelector('[data-anonymize="person-blurb"]')?.getAttribute("title")?.trim() ?? null;

  return {
    memberId,
    name: text('span[data-anonymize="person-name"]'),
    title: text('span[data-anonymize="title"]'),
    company: companyLink?.textContent?.trim() ?? null,
    companyOrgId,
    location: text('span[data-anonymize="location"]'),
    tenure,
    about,
    connectionDegree: text(".artdeco-entity-lockup__badge .a11y-text"),
    salesNavUrl,
    linkedinUrl: memberId ? `https://www.linkedin.com/in/${memberId}` : null,
    inNetwork,
  };
}

// ---- the driver -----------------------------------------------------------------

function hasEmptyResultsState(): boolean {
  return isVisible(
    document.querySelector('.illustration-spots-large.empty-room')
  );
}

export async function readResults(
  limit?: number
): Promise<{ count: number; page: number | null; totalPages: number | null; leads: LeadResult[] }> {

  await waitFor(
    () => resultRows().length > 0 || hasEmptyResultsState(),
    8000,
    "results list"
  );

  if (resultRows().length === 0 && hasEmptyResultsState()) {
    return { count: 0, ...readPagination(), leads: []}
  }
  
  const rows = limit != null ? resultRows().slice(0, limit) : resultRows();
  
  for (const li of rows) {
    if (isHydrated(li)) continue;
    const urn = rowUrn(li);
    const budget = urn.includes("OUT_OF_NETWORK") ? 1500 : 5000;
    li.scrollIntoView({ block: "center" });
    await waitFor(() => isHydrated(li), budget, "row hydration").catch(() => {});
    await sleep(120);
  }
  rows[0]?.scrollIntoView({ block: "center" });

  const all = resultRows();
  const slice = limit != null ? all.slice(0, limit) : all;
  const leads = slice.map(extractRow);
  return { count: all.length, ...readPagination(), leads };
}


// ---- pagination -----------------------------------------------------------------

// "Page 1 of 100" → { page: 1, totalPages: 100 }
export function readPagination(): { page: number | null; totalPages: number | null } {
  const state = document
    .querySelector(".artdeco-pagination__page-state")
    ?.textContent?.trim();
  const m = state?.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  return {
    page: m ? Number(m[1]) : null,
    totalPages: m ? Number(m[2]) : null,
  };
}

export async function goToNextPage(): Promise<{ ok: true; page: number | null; totalPages: number | null }> {
  const next = document.querySelector<HTMLButtonElement>(
    "button.artdeco-pagination__button--next"
  );
  if (!next) throw new Error("Pagination next button not found");
  if (next.disabled) throw new Error("Already on the last page");

  const firstUrnBefore = resultRows()[0] ? rowUrn(resultRows()[0]!) : null;

  next.scrollIntoView({ block: "center" });
  realClick(next);

  await waitFor(
    () => {
      const first = resultRows()[0];
      return first != null && rowUrn(first) !== firstUrnBefore;
    },
    10_000,
    "next page results"
  );

  return { ok: true, ...readPagination() };
}
