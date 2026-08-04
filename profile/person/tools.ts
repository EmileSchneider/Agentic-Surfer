import { isVisible, realClick, sleep, waitFor } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

const SECTION_LABELS = [
  "About",
  "Activity",
  "Experience",
  "Education",
  "Services",
  "Featured",
  "Licenses & certifications",
  "Skills",
  "Recommendations",
  "Interests",
] as const;

type SectionLabel = typeof SECTION_LABELS[number];

export interface PersonExperience {
  title: string | null;
  company: string | null;
  dateRange: string | null;
  duration: string | null;
  location: string | null;
  description: string | null;
}

export interface PersonProfile {
  memberId: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: PersonExperience[];
  url: string;
  finalUrl: string;
  hydration: {
    attempted: true;
    scrolls: number;
    scrollY: number;
    documentHeight: number;
    sections: Record<SectionLabel, boolean>;
  };
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text || null;
}

function text(selector: string, root: ParentNode = document): string | null {
  return cleanText(root.querySelector(selector)?.textContent);
}

function attr(el: Element | null, name: string): string | null {
  return el?.getAttribute(name) ?? null;
}

function componentKey(el: Element | null): string | null {
  return attr(el, "componentkey") ?? attr(el, "componentKey");
}

function elementText(el: Element | null): string | null {
  return cleanText(el instanceof HTMLElement ? el.innerText : el?.textContent);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function withoutLeadingLabel(
  value: string | null,
  label: string,
): string | null {
  if (!value) return null;
  const trimmed = cleanText(value);
  if (!trimmed) return null;
  const prefix = `${label} `;
  return trimmed.toLowerCase().startsWith(prefix.toLowerCase())
    ? cleanText(trimmed.slice(prefix.length))
    : trimmed;
}

async function waitForPersonProfile(timeoutMs = 10000): Promise<void> {
  await waitFor(
    () => topCardRoot() !== null || findSection("About") !== null,
    timeoutMs,
    "person profile render",
  );
}

function topCardRoot(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'main [componentkey*="com.linkedin.sdui.profile.card"][componentkey*="Topcard"]',
    ),
  )
    .map((el) => el.closest<HTMLElement>("section") ?? el)
    .filter((el) => isVisible(el));

  return candidates[0] ?? null;
}

function readTopCard() {
  const root = topCardRoot();
  const heading = root?.querySelector<HTMLElement>("h1, h2, [role='heading']");
  const name = elementText(heading ?? null) ?? text("main h1") ??
    text("main h2");
  const headline =
    (root ? text(".text-body-medium.break-words", root) : null) ??
      (root ? text("[data-generated-suggestion-target]", root) : null) ??
      text(".text-body-medium.break-words") ??
      text("[data-generated-suggestion-target]") ??
      null;
  const location =
    (root
      ? text(".text-body-small.inline.t-black--light.break-words", root)
      : null) ??
      text(".text-body-small.inline.t-black--light.break-words") ??
      null;

  return { name, headline, location };
}

function headingMatches(el: Element, label: string): boolean {
  const value = elementText(el);
  if (!value) return false;
  return value.toLowerCase() === label.toLowerCase() ||
    value.toLowerCase().startsWith(`${label.toLowerCase()} (`);
}

function sectionByHeading(label: string): HTMLElement | null {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>(
      "main h1, main h2, main h3, main [role='heading']",
    ),
  );
  const visibleHeading = headings.find((el) =>
    isVisible(el) && headingMatches(el, label) &&
    !el.closest('[componentkey*="feed"], [componentkey*="Feed"]')
  );
  const heading = visibleHeading ??
    headings.find((el) => headingMatches(el, label));
  return heading?.closest("section") ?? null;
}

function sectionByComponentKey(fragment: string): HTMLElement | null {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>("main [componentkey]"),
  )
    .find((el) => {
      const key = componentKey(el) ?? "";
      return key.includes(fragment) &&
        /profile\.card|ProfileNullStateCardAnchor|profileCards/i.test(key);
    });
  return found?.closest("section") ?? found ?? null;
}

function findSection(label: SectionLabel): HTMLElement | null {
  const byHeading = sectionByHeading(label);
  if (byHeading) return byHeading;

  const fragments: Record<SectionLabel, string[]> = {
    "About": ["About"],
    "Activity": ["Activity", "activity_posts_pillContent"],
    "Experience": ["ExperienceTopLevelSection"],
    "Education": ["EducationTopLevelSection"],
    "Services": ["Services"],
    "Featured": ["Featured"],
    "Licenses & certifications": ["CertificationTopLevel", "Certifications"],
    "Skills": ["Skills"],
    "Recommendations": ["RecommendationsTopLevel"],
    "Interests": ["Interests"],
  };

  for (const fragment of fragments[label]) {
    const section = sectionByComponentKey(fragment);
    if (section) return section;
  }
  return null;
}

function expandableButtons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(
    '[data-testid="expandable-text-button"], button',
  )).filter((button) => {
    if (!isVisible(button) || button.disabled) return false;
    const label = `${elementText(button) ?? ""} ${
      attr(button, "aria-label") ?? ""
    }`;
    return /(?:…|\.\.\.)\s*more|see more|show more/i.test(label);
  });
}

async function expandSection(section: HTMLElement): Promise<void> {
  for (const button of expandableButtons(section).slice(0, 8)) {
    realClick(button);
    await sleep(120);
  }
}

async function readAbout(): Promise<string | null> {
  const section = findSection("About");
  if (!section) return null;

  await expandSection(section);

  const box = section.querySelector<HTMLElement>(
    '[data-testid="expandable-text-box"]',
  );
  const hidden = section.querySelector<HTMLElement>(".visually-hidden");
  const visible = box ??
    section.querySelector<HTMLElement>(".inline-show-more-text") ??
    section.querySelector<HTMLElement>("[dir='ltr']") ??
    section;

  return withoutLeadingLabel(
    cleanText(visible.textContent) ?? cleanText(hidden?.textContent),
    "About",
  );
}

function hasSection(label: SectionLabel): boolean {
  return findSection(label) !== null;
}

function semanticExperienceMarker(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    [
      'main [componentkey*="ExperienceTopLevelSection"]',
      'main [componentkey="ProfileNullStateCardAnchor_Experience"]',
      'main [componentkey^="profile_experience_top_anchor_"]',
    ].join(","),
  );
}

function scrollRoot(): HTMLElement | null {
  const main = document.querySelector<HTMLElement>("main");
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("body *"),
  )
    .filter((el) => {
      if (!isVisible(el)) return false;
      if (main && !el.contains(main) && !main.contains(el)) return false;
      const style = getComputedStyle(el);
      if (
        !/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)
      ) {
        return false;
      }
      return el.scrollHeight > el.clientHeight + 120;
    })
    .sort((a, b) => b.scrollHeight - a.scrollHeight);

  return candidates[0] ?? document.scrollingElement as HTMLElement | null;
}

function scrollPosition(root: HTMLElement | null): {
  top: number;
  height: number;
  viewport: number;
} {
  if (!root || root === document.documentElement || root === document.body) {
    return {
      top: window.scrollY,
      height: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      ),
      viewport: window.innerHeight,
    };
  }

  return {
    top: root.scrollTop,
    height: root.scrollHeight,
    viewport: root.clientHeight,
  };
}

function naturalScroll(root: HTMLElement | null, amount: number): void {
  if (!root || root === document.documentElement || root === document.body) {
    window.scrollBy({ top: amount, left: 0, behavior: "smooth" });
    return;
  }

  root.scrollBy({ top: amount, left: 0, behavior: "smooth" });
}

async function hydratePersonProfile(): Promise<PersonProfile["hydration"]> {
  let scrolls = 0;
  let lastY = -1;
  let lastHeight = -1;
  let stableTurns = 0;
  const maxScrolls = 24;
  const root = scrollRoot();

  while (scrolls < maxScrolls) {
    await sleep(250);

    if (hasSection("Experience") || semanticExperienceMarker()) {
      break;
    }

    const pos = scrollPosition(root);
    const maxY = Math.max(0, pos.height - pos.viewport);
    if (pos.top >= maxY - 20) {
      if (lastY === pos.top && lastHeight === pos.height) {
        stableTurns += 1;
      }
      if (stableTurns >= 2) break;
    } else {
      stableTurns = 0;
    }

    lastY = pos.top;
    lastHeight = pos.height;
    naturalScroll(root, Math.max(360, Math.round(pos.viewport * 0.72)));
    scrolls += 1;
    await sleep(650);
  }

  const sections = Object.fromEntries(
    SECTION_LABELS.map((label) => [label, hasSection(label)]),
  ) as Record<SectionLabel, boolean>;

  return {
    attempted: true,
    scrolls,
    scrollY: scrollPosition(root).top,
    documentHeight: scrollPosition(root).height,
    sections,
  };
}

function likelyExperienceItem(el: HTMLElement): boolean {
  const key = componentKey(el) ?? "";
  const value = elementText(el) ?? "";
  if (value.length < 12) return false;
  if (/^Experience\b/i.test(value)) return false;
  if (/^Show all\b/i.test(value)) return false;
  return key.startsWith("entity-collection-item") ||
    el.matches("li.artdeco-list__item") ||
    el.querySelector('a[href*="/company/"]') !== null;
}

function experienceItemRoots(section: HTMLElement): HTMLElement[] {
  const semantic = Array.from(
    section.querySelectorAll<HTMLElement>(
      '[componentkey^="entity-collection-item"], li.artdeco-list__item',
    ),
  ).filter((el) => likelyExperienceItem(el));

  if (semantic.length > 0) return semantic;

  return unique(
    Array.from(
      section.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]'),
    )
      .map((link) =>
        link.closest<HTMLElement>(
          '[componentkey^="entity-collection-item"], li, [role="listitem"]',
        ) ?? link
      )
      .filter((el) => likelyExperienceItem(el)),
  );
}

function splitDotParts(value: string | null | undefined): string[] {
  return (value ?? "")
    .split("·")
    .map((part) => cleanText(part))
    .filter((part): part is string => part != null);
}

function readExperienceFromItem(item: HTMLElement): PersonExperience | null {
  const companyAnchor = item.querySelector<HTMLAnchorElement>(
    'a[href*="/company/"]',
  );
  const anchorParagraphs = companyAnchor
    ? Array.from(companyAnchor.querySelectorAll<HTMLParagraphElement>("p"))
    : [];
  const [titleEl, companyEl, dateEl, locationEl] = anchorParagraphs;

  const title = elementText(titleEl ?? null);
  const companyLine = elementText(companyEl ?? null);
  const dateLine = elementText(dateEl ?? null);
  const locationLine = elementText(locationEl ?? null);
  const description = elementText(
    item.querySelector<HTMLElement>('[data-testid="expandable-text-box"]'),
  );

  const company = companyLine;
  const [dateRange, duration] = splitDotParts(dateLine);

  if (!title && !company && !dateRange && !description) return null;

  return {
    title,
    company,
    dateRange: dateRange ?? null,
    duration: duration ?? null,
    location: locationLine,
    description,
  };
}

async function readExperience(): Promise<PersonExperience[]> {
  const section = findSection("Experience");
  if (!section) return [];

  await expandSection(section);

  return experienceItemRoots(section)
    .map(readExperienceFromItem)
    .filter((item): item is PersonExperience => item !== null);
}

async function readPersonProfile(memberId: string): Promise<PersonProfile> {
  const hydration = await hydratePersonProfile();
  const about = await readAbout();
  const experience = await readExperience();

  return {
    memberId,
    ...readTopCard(),
    about,
    experience,
    url: `https://www.linkedin.com/in/${encodeURIComponent(memberId)}`,
    finalUrl: location.href,
    hydration,
  };
}

export async function runProfilePersonTool(msg: {
  command: string;
  args: any;
}): Promise<unknown> {
  switch (msg.command) {
    case "profile.person.read": {
      const memberId = String(msg.args?.memberId ?? "");
      if (!memberId) {
        throw new ToolError(
          "BAD_ARGS",
          "profile.person.read requires memberId",
        );
      }
      await waitForPersonProfile();
      return readPersonProfile(memberId);
    }
    default:
      throw new ToolError(
        "BAD_ARGS",
        `Unknown person profile tool: ${msg.command}`,
      );
  }
}
