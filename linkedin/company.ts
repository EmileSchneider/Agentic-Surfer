// extension/linkedin/company.ts
//
// Company filter — a thin wrapper over the generic typeahead driver
// (filters.ts). The DOM mechanics (expand, type, read options, select,
// remove, clear, mode detection, count-span stripping) all live in the
// driver now; this module keeps ONLY what is genuinely company-specific:
//
//   1. Org-type filtering — the CURRENT_COMPANY typeahead returns account
//      lists (urn:li:salesList:…) alongside organizations; the agent only
//      wants organizations.
//   2. The {name, urn, orgId} DTO the agent layer consumes (CompanyResult),
//      vs the driver's generic {label, code}. For company, code === the URN.
//   3. ensureCompanyOption — re-search by urn if the option has fallen out of
//      the DOM since the last search, so apply is robust to a stale typeahead.
//
// Everything DOM-facing routes through the driver, so company inherits the
// toggle-label mode detection and span-stripping fixes for free.

import type { CompanyResult } from "../types.ts";
import {
  COMPANY,
  searchFilter,
  readOptions,
  selectFilterOption,
  removeFilterSelection,
  clearFilter,
} from "./filters.ts";

/** urn:li:organization:93983723 -> "organization" */
function urnType(urn: string): string {
  return urn.split(":")[2] ?? "";
}

/** urn:li:organization:93983723 -> "93983723" */
function urnOrgId(urn: string): string {
  return urn.split(":").pop() ?? "";
}

/** Driver option (code === urn) -> agent DTO, organizations only. */
function toResults(
  options: { label: string; code: string }[]
): CompanyResult[] {
  return options
    .filter((o) => urnType(o.code) === "organization")
    .map(({ label, code }) => ({
      name: label,
      urn: code,
      orgId: urnOrgId(code),
    }));
}

/** Type a query, return organization results as CompanyResult DTOs. */
export async function searchForCompany(query: string): Promise<CompanyResult[]> {
  const options = await searchFilter(COMPANY, query);
  return toResults(options);
}

/** Alias kept for the current tool layer; identical to searchForCompany. */
export const proposeCompany = searchForCompany;

/**
 * Ensure the option for `urn` is present in the DOM, re-searching by `query`
 * if it has gone stale, then include/exclude it. The driver matches options
 * by code, and for company the code IS the urn, so we pass urn straight
 * through as the code.
 */
export async function applyCompany(
  query: string,
  urn: string,
  mode: "include" | "exclude" = "include"
): Promise<{ ok: true; urn: string }> {
  const present = readOptions(COMPANY).some((o) => o.code === urn);
  if (!present) {
    const results = await searchForCompany(query);
    if (!results.some((r) => r.urn === urn)) {
      throw new Error(
        `Company option ${urn} not found after re-searching "${query}"`
      );
    }
  }
  await selectFilterOption(COMPANY, urn, mode);
  return { ok: true, urn };
}

/** setForUrn — select an already-listed option by urn, no re-search. */
export async function setForUrn(
  urn: string,
  mode: "include" | "exclude" = "include"
): Promise<{ ok: true; urn: string }> {
  await selectFilterOption(COMPANY, urn, mode);
  return { ok: true, urn };
}

export async function removeCompany(
  name: string
): Promise<{ ok: true; name: string }> {
  await removeFilterSelection(COMPANY, name);
  return { ok: true, name };
}

export async function clearCompany(): Promise<{ ok: true }> {
  return clearFilter(COMPANY);
}
