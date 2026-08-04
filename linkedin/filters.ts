// extension/linkedin/filters.ts
//
// Generic Sales Nav filter driver — extracted from the repetition between
// function.ts and geography.ts, then corrected against observed DOM for the
// four new filters. THREE archetypes (the third was discovered during
// verification — headcount is not shaped like the other two):
//
//   FIXED       (Seniority):
//               expand → options are just there → include/exclude click.
//               Rows carry the standard include-/Exclude markup and a real
//               per-option code (`include-<N>` suffix).
//
//   TYPEAHEAD   (Job title, Industry; also Geography):
//               expand → type a query → options render → include/exclude click.
//               Rows carry the standard markup and a real per-option code.
//
//   SINGLE-CLICK (Company headcount):
//               expand → options are just there → ONE click selects (include
//               only). Rows are a single clickable <div tabindex="0">, with
//               NO include/exclude buttons and NO per-option code — the only
//               identifier is the visible label. Exclude is not possible.
//
// Per filter the varying strings are (GEOGRAPHY taught us fieldset key and
// dismiss key can differ):
//
//   fieldsetKey    → fieldset[data-x-search-filter="<KEY>"]
//   dismissKey     → [data-control-name='search_filter_pill_<KEY>_DISMISS']
//   placeholder    → input[role=combobox][placeholder]  (typeahead only)
//   singleClickRows→ headcount-style rows (no codes, include-only)
//
// All four CONFIG blocks below are VERIFIED against real DOM (2026-06).

import { waitFor, realClick, typeQuery, waitForInput, sleep } from "./dom.ts";

export type FilterMode = "include" | "exclude";

export interface FilterOption {
  label: string;
  code: string;
  includeEl: HTMLElement;
  excludeEl: HTMLElement;
}

interface FilterSelection {
  label: string;
  mode: FilterMode;
  removeEl: HTMLElement;
}

interface FilterConfig {
  fieldsetKey: string;
  dismissKey: string;
  /** present → typeahead filter; absent → fixed-list filter */
  placeholder?: string;
  /**
   * headcount-style rows: a single clickable <div tabindex="0"> per option,
   * include-only, with no per-option code (code === label). When set,
   * readOptions reads these rows instead of the include-/Exclude markup, and
   * selectFilterOption rejects mode "exclude".
   */
  singleClickRows?: boolean;
}

/**
 * Normalize a label for comparison. Headcount option rows render with commas
 * (`501-1,000`) but the resulting pill reads back without them (`501-1000`),
 * and LinkedIn is internally inconsistent across renders (`10,001+` vs
 * `10000+`). Collapsing commas and whitespace lets option labels and pill
 * labels reconcile. No-op for the other three filters (their labels contain
 * no differing commas/spaces), so it is applied universally.
 */
export const norm = (s: string): string => s.replace(/[,\s]/g, "");

// ---------------------------------------------------------------- configs
// Verified references:
//   function.ts  → fieldset FUNCTION,  dismiss FUNCTION
//   geography.ts → fieldset GEOGRAPHY, dismiss REGION   (they differ!)

export const SENIORITY: FilterConfig = {
  fieldsetKey: "SENIORITY_LEVEL", // ✓ verified
  dismissKey: "SENIORITY_LEVEL", // ✓ verified
};

export const HEADCOUNT: FilterConfig = {
  fieldsetKey: "COMPANY_HEADCOUNT", // ✓ verified
  dismissKey: "COMPANY_HEADCOUNT", // ✓ verified (pill: ..._COMPANY_HEADCOUNT_DISMISS)
  singleClickRows: true, // ✓ verified — include-only, no per-option codes
};

export const JOB_TITLE: FilterConfig = {
  fieldsetKey: "CURRENT_TITLE", // ✓ verified (NOT "JOB_TITLE")
  dismissKey: "CURRENT_TITLE", // ✓ verified
  placeholder: "Add current titles", // ✓ verified exact text
};

export const INDUSTRY: FilterConfig = {
  fieldsetKey: "INDUSTRY", // ✓ verified
  dismissKey: "INDUSTRY", // ✓ verified
  placeholder: "Add industries", // ✓ verified exact text
};

export const FUNCTION: FilterConfig = { fieldsetKey: "FUNCTION",  dismissKey: "FUNCTION" };

export const GEOGRAPHY: FilterConfig = { fieldsetKey: "GEOGRAPHY", dismissKey: "REGION", placeholder: "Add locations" };

export const COMPANY: FilterConfig = {
  fieldsetKey: "CURRENT_COMPANY",
  dismissKey: "CURRENT_COMPANY",
  placeholder: "Add current companies and account lists",
};

// ---------------------------------------------------------------- core ops

function fieldsetOf(cfg: FilterConfig): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${cfg.fieldsetKey}"]`
  );
  if (!el) throw new Error(`${cfg.fieldsetKey} fieldset not found`);
  return el;
}

export function expandFilter(cfg: FilterConfig): void {
  const fieldset = fieldsetOf(cfg);
  // Already open? (typeahead → input present; fixed/single-click → options
  // present). Headcount renders li[role="option"] just like a fixed list, so
  // the non-typeahead marker is correct for it too.
  const openMarker = cfg.placeholder
    ? 'input[role="combobox"]'
    : 'li[role="option"]';
  if (fieldset.querySelector(openMarker)) return;

  const toggle = Array.from(
    fieldset.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (btn) =>
      btn.getAttribute("aria-expanded") === "false" &&
      (btn.getAttribute("data-x-search-filter") === "container-toggle" ||
        /expand .* filter/i.test(btn.textContent ?? ""))
  );
  if (!toggle) throw new Error(`${cfg.fieldsetKey} expand toggle not found`);
  toggle.click();
}

export function readOptions(cfg: FilterConfig): FilterOption[] {
  const fieldset = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${cfg.fieldsetKey}"]`
  );
  if (!fieldset) return [];

  const items = fieldset.querySelectorAll<HTMLLIElement>('li[role="option"]');

  // ---- single-click archetype (headcount): one clickable div, include-only.
  if (cfg.singleClickRows) {
    return Array.from(items).flatMap((li) => {
      const clickEl = li.querySelector<HTMLElement>("[tabindex='0']");
      if (!clickEl) return [];
      // The clickable contains the label as a text node plus, sometimes, a
      // count span (<span class="t-black--light">81M+</span>). The label text
      // is NOT necessarily the firstChild — Glimmer emits a leading whitespace
      // text node — so reading firstChild yields "". Clone the node, strip the
      // count span(s), and take what's left. Robust to leading whitespace /
      // comment nodes and to the count span being present or absent.
      const clone = clickEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("span").forEach((s) => s.remove());
      const label = clone.textContent?.trim() ?? "";
      if (!label) return [];
      // No per-option code exists in the markup; the label IS the code.
      // includeEl/excludeEl both point at the same element to keep the type
      // uniform — selectFilterOption guards against ever using excludeEl here.
      return [{ label, code: label, includeEl: clickEl, excludeEl: clickEl }];
    });
  }

  // ---- standard archetype (seniority / job title / industry).
  return Array.from(items).flatMap((li) => {
    const includeEl = li.querySelector<HTMLElement>(
      "[data-x-search-filter-typeahead-suggestion^='include-']"
    );
    const excludeEl = li.querySelector<HTMLElement>("[aria-label^='Exclude']");
    if (!includeEl || !excludeEl) return [];

    const suggestion =
      includeEl.getAttribute("data-x-search-filter-typeahead-suggestion") ?? "";
    const code = suggestion.replace(/^include-/, "");
    // The label lives in span.nowrap-ellipsis, but that span can contain a
    // nested count span (e.g. "249M+") whose text bleeds into textContent and
    // breaks the post-click match against the clean pill label. Clone and
    // strip nested spans before reading.
    const labelEl = li.querySelector<HTMLElement>("span.nowrap-ellipsis");
    let label = "";
    if (labelEl) {
      const clone = labelEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("span").forEach((s) => s.remove());
      label = clone.textContent?.trim() ?? "";
    }
    return [{ label, code, includeEl, excludeEl }];
  });
}

export function readSelections(cfg: FilterConfig): FilterSelection[] {
  const fieldset = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${cfg.fieldsetKey}"]`
  );
  if (!fieldset) return [];

  const pills = fieldset.querySelectorAll<HTMLElement>(".artdeco-pill");
  return Array.from(pills).flatMap((pill) => {
    const label =
      pill
        .querySelector<HTMLElement>("._pill-text_16hazu")
        ?.textContent?.trim() ?? "";
    if (!label) return [];

    // Mode detection keys off the exclusion-toggle button's semantic
    // aria-label, NOT the pill colour. The colour classes are backwards
    // (_pill--green_ = active include, _pill--red_ = active exclude) and
    // hashed/fragile. The toggle's label states the action it WILL perform,
    // so it is the inverse of the pill's current state:
    //   button "Exclude …" ⇒ pill is currently an include
    //   button "Include …" ⇒ pill is currently an exclude
    // Headcount pills have no toggle (include-only) → default to "include".
    const toggle = pill.querySelector<HTMLElement>(
      "[data-control-name$='_exclusion_toggle']"
    );
    const toggleLabel = toggle?.getAttribute("aria-label")?.trim() ?? "";
    const mode: FilterMode = toggleLabel.startsWith("Exclude")
      ? "include"
      : toggleLabel.startsWith("Include")
      ? "exclude"
      : "include";

    // The dismiss control is a descendant on include/exclude pills (the pill
    // is a <div> wrapper), but on headcount the pill IS the dismiss <button>
    // and carries data-control-name itself. querySelector only searches
    // descendants, so check self-or-descendant via closest() as a fallback.
    const sel = `[data-control-name='search_filter_pill_${cfg.dismissKey}_DISMISS']`;
    const removeEl =
      pill.querySelector<HTMLElement>(sel) ??
      (pill.matches(sel) ? pill : null);
    if (!removeEl) return [];
    
    return [{ label, mode, removeEl }];
  });
}

// ---- fixed-list: list everything (Seniority, Headcount)

export async function listFilterOptions(
  cfg: FilterConfig
): Promise<{ label: string; code: string }[]> {
  expandFilter(cfg);
  await waitFor(
    () => readOptions(cfg).length > 0,
    4000,
    `${cfg.fieldsetKey} options to render`
  );
  return readOptions(cfg).map(({ label, code }) => ({ label, code }));
}

// ---- typeahead: search (Job title, Industry)

export async function searchFilter(
  cfg: FilterConfig,
  query: string
): Promise<{ label: string; code: string }[]> {
  if (!cfg.placeholder) {
    throw new Error(
      `${cfg.fieldsetKey} is a fixed-list filter; use listFilterOptions`
    );
  }
  expandFilter(cfg);
  await waitForInput(cfg.placeholder);
  typeQuery(cfg.placeholder, query);
  await sleep(3000); // same settle the geography driver uses
  return readOptions(cfg).map(({ label, code }) => ({ label, code }));
}

// ---- mutations (all archetypes)

export async function selectFilterOption(
  cfg: FilterConfig,
  code: string,
  mode: FilterMode = "include"
): Promise<{ ok: true; code: string }> {
  if (cfg.singleClickRows && mode === "exclude") {
    throw new Error(
      `${cfg.fieldsetKey} is include-only; "exclude" is not supported`
    );
  }

  // A selected single-click option is removed from LinkedIn's available
  // option rows and represented only by its pill. For this archetype the
  // option code is the label, so check the pill before requiring an option
  // row to exist.
  if (
    cfg.singleClickRows &&
    readSelections(cfg).some(
      (s) => norm(s.label) === norm(code) && s.mode === mode
    )
  ) {
    return { ok: true, code };
  }

  // Match on normalized code so headcount's comma/no-comma variants reconcile
  // (code === label there). Exact match for the coded archetypes is a subset
  // of normalized match, so this is safe for all filters.
  const option = readOptions(cfg).find((o) => norm(o.code) === norm(code));
  if (!option) {
    throw new Error(
      `No ${cfg.fieldsetKey} option for code ${code} — ` +
        (cfg.placeholder ? "search first" : "list first")
    );
  }

  // Already selected? Don't click again (toggle risk); report success.
  if (
    readSelections(cfg).some(
      (s) => norm(s.label) === norm(option.label) && s.mode === mode
    )
  ) {
    return { ok: true, code };
  }

  realClick(mode === "include" ? option.includeEl : option.excludeEl);

  await waitFor(
    () =>
      readSelections(cfg).some(
        (s) => norm(s.label) === norm(option.label) && s.mode === mode
      ),
    3000,
    `${cfg.fieldsetKey} selection "${option.label}" (${mode})`
  );
  return { ok: true, code };
}

export async function removeFilterSelection(
  cfg: FilterConfig,
  label: string
): Promise<{ ok: true; label: string }> {
  const sels = readSelections(cfg);
  const match = sels.find((s) => norm(s.label) === norm(label));
  if (!match) return { ok: true, label }; // already gone — success, not error

  const before = sels.length;
  realClick(match.removeEl);
  await waitFor(
    () => readSelections(cfg).length < before,
    3000,
    `${cfg.fieldsetKey} removal "${label}"`
  );
  return { ok: true, label };
}

export async function clearFilter(cfg: FilterConfig): Promise<{ ok: true }> {
  let guard = 0;
  while (true) {
    const sels = readSelections(cfg);
    if (sels.length === 0) return { ok: true };
    const before = sels.length;
    realClick(sels[0]!.removeEl);
    await waitFor(
      () => readSelections(cfg).length < before,
      3000,
      `${cfg.fieldsetKey} pill removal`
    );
    if (++guard > 50) throw new Error(`clearFilter(${cfg.fieldsetKey}) runaway`);
  }
}

// ---------------------------------------------------------------- registry
// Lets the tool layer route by name without a large switch.

export const FILTERS: Record<string, FilterConfig> = {
  seniority: SENIORITY,
  headcount: HEADCOUNT,
  jobTitle: JOB_TITLE,
  industry: INDUSTRY,
  function:  FUNCTION,
  geography: GEOGRAPHY,
  company: COMPANY,
};

/** Resolve a registry name to its config, for the tool layer. */
export function cfgFor(name: string): FilterConfig {
  const cfg = FILTERS[name];
  if (!cfg) throw new Error(`Unknown filter: ${name}`);
  return cfg;
}
