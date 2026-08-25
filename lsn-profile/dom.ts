import { realClick, sleep, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import type { AccountIqSource } from "./account-iq.ts";

export const ACCOUNT_IQ_ROOT_SELECTOR =
  'section#aiq[data-sn-view-name="feature-account-iq"]';

export const ACCOUNT_ABOUT_ROOT_SELECTOR =
  'section#about [data-sn-view-name="feature-account-top-card"]';

export const ACCOUNT_IQ_SECTION_IDS = {
  howTheyMakeMoney: "aiq-section-revenue_sources",
  strategicPriorities: "aiq-section-strategic_priorities",
  businessChallenges: "aiq-section-challenges_and_pain_points",
  competitiveLandscape: "aiq-section-competitive_landscape",
  headcountInsights: "aiq-section-headcount_growth",
  keyPeople: "aiq-section-exec_team",
  executiveVoices: "aiq-section-exec_voices",
  relatedNews: "aiq-section-account_news",
} as const;

export type AccountIqSectionKey = keyof typeof ACCOUNT_IQ_SECTION_IDS;

const ACCOUNT_IQ_SECTION_SELECTOR = Object.values(ACCOUNT_IQ_SECTION_IDS)
  .map((id) => `#${id}`)
  .join(",");

export function cleanText(
  value: string | null | undefined,
): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned || null;
}

export function elementText(element: Element | null): string | null {
  return cleanText(
    element instanceof HTMLElement ? element.innerText : element?.textContent,
  );
}

export function absoluteUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return null;
  }
}

export function findAccountIqSection(
  root: HTMLElement,
  key: AccountIqSectionKey,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `#${ACCOUNT_IQ_SECTION_IDS[key]}`,
  );
}

function accountIqRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ACCOUNT_IQ_ROOT_SELECTOR);
}

function accountProfileRoot(): HTMLElement | null {
  return document
    .querySelector('[data-anonymize="company-name"]')
    ?.closest<HTMLElement>("header") ?? null;
}

export async function prepareAccountProfileRoot(
  timeoutMs = 15_000,
): Promise<HTMLElement> {
  await waitFor(
    () => accountProfileRoot() !== null,
    timeoutMs,
    "account profile header",
  );

  const root = accountProfileRoot();
  if (!root) {
    throw new ToolError("NOT_FOUND", "Account profile header not found");
  }
  return root;
}

export async function prepareAccountAboutRoot(
  timeoutMs = 15_000,
): Promise<HTMLElement> {
  await waitFor(
    () => document.querySelector(ACCOUNT_ABOUT_ROOT_SELECTOR) !== null,
    timeoutMs,
    "account About section",
  );

  const root = document.querySelector<HTMLElement>(
    ACCOUNT_ABOUT_ROOT_SELECTOR,
  );
  if (!root) {
    throw new ToolError("NOT_FOUND", "Account About section not found");
  }

  root.scrollIntoView({ block: "center" });
  await waitFor(
    () => root.querySelector('[data-anonymize="company-blurb"]') !== null,
    timeoutMs,
    "account About text",
  );
  return root;
}

function renderedSections(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(ACCOUNT_IQ_SECTION_SELECTOR),
  );
}

function accountIqUnsupported(root: HTMLElement): boolean {
  return root.querySelector("[data-x-unsupported-reasons]") !== null;
}

function accountIqUnavailable(root: HTMLElement): boolean {
  if (accountIqUnsupported(root)) return true;

  const value = elementText(root) ?? "";
  return /account iq (?:is )?(?:not|un)available|could(?: not|n't) generate|try again later/i
    .test(value);
}

function isExpanded(button: HTMLButtonElement): boolean {
  const ariaExpanded = button.getAttribute("aria-expanded");
  if (ariaExpanded != null) return ariaExpanded === "true";

  const dataExpanded = button.getAttribute("data-expanded");
  if (dataExpanded != null) return dataExpanded !== "false";

  return /^view less$/i.test(elementText(button) ?? "");
}

async function expandAccountIq(root: HTMLElement): Promise<void> {
  const buttonSelector = "[data-x--account-dossier--view-more]";
  const button = root.querySelector<HTMLButtonElement>(buttonSelector);
  if (!button || isExpanded(button)) return;

  const sectionCountBefore = renderedSections(root).length;
  button.scrollIntoView({ block: "center" });
  realClick(button);

  await waitFor(
    () => {
      const currentButton = root.querySelector<HTMLButtonElement>(
        buttonSelector,
      );
      return (
        (currentButton != null && isExpanded(currentButton)) ||
        renderedSections(root).length > sectionCountBefore
      );
    },
    8_000,
    "Account IQ expansion",
  );
}

async function hydrateAccountIqSections(root: HTMLElement): Promise<void> {
  for (const section of renderedSections(root)) {
    section.scrollIntoView({ block: "center" });
    await sleep(80);
  }
  root.scrollIntoView({ block: "start" });
}

export async function prepareAccountIqRoot(
  timeoutMs = 30_000,
): Promise<HTMLElement> {
  await waitFor(
    () => accountIqRoot() !== null,
    timeoutMs,
    "Account IQ section",
  );

  const root = accountIqRoot();
  if (!root) {
    throw new ToolError("NOT_FOUND", "Account IQ section not found");
  }

  root.scrollIntoView({ block: "start" });

  await waitFor(
    () => renderedSections(root).length > 0 || accountIqUnavailable(root),
    timeoutMs,
    "Account IQ generated content",
  );

  if (accountIqUnsupported(root)) {
    throw new ToolError(
      "NOT_FOUND",
      "Account IQ is not supported for this company size",
    );
  }

  if (accountIqUnavailable(root)) {
    throw new ToolError(
      "NOT_FOUND",
      "Account IQ is unavailable for this account",
    );
  }

  await expandAccountIq(root);
  await hydrateAccountIqSections(root);
  return root;
}

function footerForSourceKey(
  section: HTMLElement,
  sourceKey: string,
): HTMLElement | null {
  const feedback = section.querySelector<HTMLElement>(
    `[data-x--account-dossier--feedback="${sourceKey}"]`,
  );
  return feedback?.parentElement ?? null;
}

export function readSectionSources(
  section: HTMLElement,
  sourceKey: string,
): AccountIqSource[] {
  const footer = footerForSourceKey(section, sourceKey);
  if (!footer) return [];

  const sources: AccountIqSource[] = [];
  if (
    footer.querySelector(
      '[data-test-icon="linkedin-logo-blue-xxsmall"]',
    )
  ) {
    sources.push({ kind: "linkedin", name: "LinkedIn" });
  }

  for (const anchor of footer.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = absoluteUrl(anchor.getAttribute("href"));
    if (!url || !/^https?:/i.test(url)) continue;

    const name = elementText(anchor) ?? new URL(url).hostname;
    sources.push({ kind: "external", name, url });
  }

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.kind === "external"
      ? `${source.kind}:${source.url}`
      : source.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
