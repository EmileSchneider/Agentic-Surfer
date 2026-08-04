import { realClick, sleep, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { absoluteUrl, cleanText, elementText } from "./dom.ts";

const LEAD_PROFILE_ROOT_SELECTOR = "main#content-main";
const LEAD_TOP_CARD_SELECTOR =
  '#profile-card-section[data-sn-view-name="feature-lead-top-card"]';
const LEAD_ABOUT_SELECTOR =
  '#about-section[data-sn-view-name="feature-about-lead"]';
const LEAD_EXPERIENCE_SELECTOR =
  '[data-sn-view-name="feature-lead-experience"]';
const LEAD_EDUCATION_SELECTOR = '[data-sn-view-name="feature-lead-education"]';
const LEAD_SKILLS_SELECTOR =
  '#skills-section[data-sn-view-name="feature-lead-skills"]';

export interface LeadProfileSnapshot {
  lead: LeadIdentity;
  observedAt: string;

  currentRoles: LeadCurrentRole[];
  contactInfo: LeadContactInfo;
  about: string | null;
  experience: LeadExperience[];
  education: LeadEducation[];
  skills: LeadSkill[];
}

export interface LeadIdentity {
  memberId: string | null;
  name: string;
  headline: string | null;
  location: string | null;

  connectionDegree: 1 | 2 | 3 | null;
  connectionCount: {
    count: number;
    atLeast: boolean;
  } | null;

  profileImageUrl: string | null;
  salesNavigatorUrl: string;
  linkedinUrl: string | null;
}

export interface LeadCompanyRef {
  accountId: string | null;
  name: string;
  salesNavigatorUrl: string | null;
  logoUrl: string | null;
}

export interface LeadCurrentRole {
  title: string;
  company: LeadCompanyRef;
  period: string | null;
  duration: string | null;
}

export interface LeadContactInfo {
  emails: string[];
  phoneNumbers: string[];
  addresses: string[];
  websites: Array<{
    label: string | null;
    url: string;
  }>;
}

export interface LeadExperience {
  company: LeadCompanyRef;
  totalDuration: string | null;
  roles: LeadExperienceRole[];
}

export interface LeadExperienceRole {
  title: string;
  period: string | null;
  duration: string | null;
  location: string | null;
  description: string | null;
}

export interface LeadEducation {
  institution: string;
  institutionUrl: string | null;
  logoUrl: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  period: string | null;
}

export interface LeadSkill {
  name: string;
  endorsementCount: number | null;
}

function malformed(message: string): never {
  throw new ToolError(
    "INTERNAL",
    `Malformed Sales Navigator lead profile: ${message}`,
  );
}

function requiredText(
  element: Element | null,
  description: string,
): string {
  const value = elementText(element);
  if (!value) malformed(`${description} not found`);
  return value;
}

function cleanMultilineText(
  value: string | null | undefined,
): string | null {
  const cleaned = value
    ?.replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() ?? "";

  return cleaned || null;
}

function textWithoutControls(element: Element): string | null {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(
    "button, svg, li-icon, .a11y-text, [aria-hidden='true']",
  ).forEach((candidate) => candidate.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return cleanMultilineText(clone.textContent);
}

function fullDescription(element: Element | null): string | null {
  if (!element) return null;

  const completeText = cleanMultilineText(element.getAttribute("title"));
  const renderedText = textWithoutControls(element);
  if (!completeText) return renderedText;
  if (!renderedText) return completeText;

  return completeText.length >= renderedText.length
    ? completeText
    : renderedText;
}

function currentPageUrl(): URL {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  return url;
}

function memberIdFromUrl(url: URL): string | null {
  const encodedLeadId = url.pathname.match(/\/sales\/lead\/([^/]+)/)?.[1];
  if (!encodedLeadId) return null;

  try {
    return decodeURIComponent(encodedLeadId).split(",")[0] || null;
  } catch {
    return encodedLeadId.split(",")[0] || null;
  }
}

function connectionDegree(value: string | null): 1 | 2 | 3 | null {
  const match = value?.match(/\b([123])(?:st|nd|rd)\b/i);
  if (!match) return null;

  const degree = Number(match[1]);
  return degree === 1 || degree === 2 || degree === 3 ? degree : null;
}

function connectionCount(
  value: string | null,
): LeadIdentity["connectionCount"] {
  const match = value?.match(/([\d,]+)(\+)?\s+connections?\b/i);
  if (!match?.[1]) return null;

  const count = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(count)) return null;
  return { count, atLeast: match[2] === "+" };
}

function uniqueStrings(
  values: Array<string | null>,
  normalize: (value: string) => string = (value) => value,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value) continue;
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function durationWithoutPeriod(
  element: Element | null,
  period: string | null,
): string | null {
  const fullText = elementText(element);
  if (!fullText) return null;
  if (!period) return fullText;

  return cleanText(fullText.replace(period, ""));
}

function companyReference(
  root: HTMLElement,
  companyElement?: Element | null,
): LeadCompanyRef {
  const nameElement = companyElement ??
    root.querySelector('[data-anonymize="company-name"]');
  const name = requiredText(nameElement, "company name");
  const anchor = nameElement?.closest<HTMLAnchorElement>(
    'a[href*="/sales/company/"]',
  ) ??
    root.querySelector<HTMLAnchorElement>('a[href*="/sales/company/"]');
  const href = anchor?.getAttribute("href") ?? null;

  return {
    accountId: href?.match(/\/sales\/company\/(\d+)/)?.[1] ?? null,
    name,
    salesNavigatorUrl: absoluteUrl(href),
    logoUrl: absoluteUrl(
      root
        .querySelector<HTMLImageElement>(
          'img[data-anonymize="company-logo"]',
        )
        ?.getAttribute("src"),
    ),
  };
}

async function expandSkills(root: HTMLElement): Promise<void> {
  const section = root.querySelector<HTMLElement>(LEAD_SKILLS_SELECTOR);
  const button = section?.querySelector<HTMLButtonElement>(
    "button.show-all-button",
  );
  if (!section || !button || button.getAttribute("aria-expanded") === "true") {
    return;
  }

  const skillCountBefore = section.querySelectorAll(":scope ul > li").length;
  button.scrollIntoView({ block: "center" });
  realClick(button);

  await waitFor(
    () => {
      const currentButton = section.querySelector<HTMLButtonElement>(
        "button.show-all-button",
      );
      return currentButton?.getAttribute("aria-expanded") === "true" ||
        section.querySelectorAll(":scope ul > li").length > skillCountBefore ||
        currentButton == null;
    },
    8_000,
    "all lead skills",
  );
}

export async function prepareLeadProfileRoot(
  timeoutMs = 15_000,
): Promise<HTMLElement> {
  await waitFor(
    () =>
      document.querySelector(
        `${LEAD_PROFILE_ROOT_SELECTOR} ${LEAD_TOP_CARD_SELECTOR} [data-x--lead--name]`,
      ) !== null,
    timeoutMs,
    "Sales Navigator lead profile",
  );

  const root = document.querySelector<HTMLElement>(
    LEAD_PROFILE_ROOT_SELECTOR,
  );
  if (!root) {
    throw new ToolError("NOT_FOUND", "Sales Navigator lead profile not found");
  }

  const sectionSelectors = [
    LEAD_ABOUT_SELECTOR,
    LEAD_EXPERIENCE_SELECTOR,
    LEAD_EDUCATION_SELECTOR,
    LEAD_SKILLS_SELECTOR,
  ];
  for (const selector of sectionSelectors) {
    const section = root.querySelector<HTMLElement>(selector);
    if (!section) continue;
    section.scrollIntoView({ block: "center" });
    await sleep(80);
  }

  await expandSkills(root);
  root.querySelector<HTMLElement>(LEAD_TOP_CARD_SELECTOR)?.scrollIntoView({
    block: "start",
  });
  return root;
}

export function readLeadIdentity(root: HTMLElement): LeadIdentity {
  const card = root.querySelector<HTMLElement>(LEAD_TOP_CARD_SELECTOR);
  if (!card) malformed("top card not found");

  const nameElement = card.querySelector(
    '[data-x--lead--name][data-anonymize="person-name"]',
  );
  const name = requiredText(nameElement, "lead name");
  const headlineElement = card.querySelector('[data-anonymize="headline"]');
  const connectionsAnchor = card.querySelector<HTMLAnchorElement>(
    'a[href*="/linkedin-connections/"]',
  );
  const metadataContainer = headlineElement?.parentElement?.nextElementSibling;
  const locationElement = connectionsAnchor?.previousElementSibling ??
    metadataContainer?.firstElementChild ??
    null;
  const degreeElement = nameElement?.parentElement?.querySelector(
    ":scope > span",
  ) ?? null;
  const pageUrl = currentPageUrl();
  const memberId = memberIdFromUrl(pageUrl);

  return {
    memberId,
    name,
    headline: elementText(headlineElement),
    location: elementText(locationElement),
    connectionDegree: connectionDegree(elementText(degreeElement)),
    connectionCount: connectionCount(elementText(connectionsAnchor)),
    profileImageUrl: absoluteUrl(
      card
        .querySelector<HTMLImageElement>(
          'img[data-anonymize="headshot-photo"]',
        )
        ?.getAttribute("src"),
    ),
    salesNavigatorUrl: pageUrl.href,
    linkedinUrl: memberId ? `https://www.linkedin.com/in/${memberId}` : null,
  };
}

export function readLeadCurrentRoles(
  root: HTMLElement,
): LeadCurrentRole[] {
  const section = root.querySelector<HTMLElement>(
    `${LEAD_TOP_CARD_SELECTOR} [data-sn-view-name="lead-current-role"]`,
  );
  if (!section) return [];

  const list = section.querySelector<HTMLElement>(":scope > ul");
  if (!list) return [];

  return Array.from(
    list.querySelectorAll<HTMLElement>(":scope > li"),
  ).map((item, index) => {
    const titleElement = item.querySelector('[data-anonymize="job-title"]');
    const title = requiredText(
      titleElement,
      `current role ${index + 1} title`,
    );
    const companyElement = item.querySelector(
      '[data-anonymize="company-name"]',
    );
    if (!companyElement) {
      malformed(`current role ${index + 1} company not found`);
    }

    const titleRow = titleElement?.closest("p");
    const periodRow = titleRow?.nextElementSibling?.matches("p")
      ? titleRow.nextElementSibling
      : null;
    const period = elementText(
      periodRow?.querySelector(":scope > span") ?? null,
    );

    return {
      title,
      company: companyReference(item, companyElement),
      period,
      duration: durationWithoutPeriod(periodRow, period),
    };
  });
}

export function readLeadContactInfo(
  root: HTMLElement,
): LeadContactInfo {
  const section = root.querySelector<HTMLElement>(
    `${LEAD_TOP_CARD_SELECTOR} [data-sn-view-name="lead-contact-info"]`,
  );
  if (!section) {
    return {
      emails: [],
      phoneNumbers: [],
      addresses: [],
      websites: [],
    };
  }

  const mailLinks = Array.from(
    section.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'),
  );
  const emailNodes = Array.from(
    section.querySelectorAll<HTMLElement>('[data-anonymize="email"]'),
  );
  const emails = uniqueStrings(
    [
      ...emailNodes.map((node) => elementText(node)),
      ...mailLinks.map((anchor) => {
        const href = anchor.getAttribute("href");
        return href ? decodeURIComponent(href.slice("mailto:".length)) : null;
      }),
    ],
    (value) => value.toLocaleLowerCase(),
  );

  const phoneNumbers = uniqueStrings(
    Array.from(
      section.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]'),
    ).map((anchor) => {
      const href = anchor.getAttribute("href");
      return href ? decodeURIComponent(href.slice("tel:".length)) : null;
    }),
  );

  const mapLinks = Array.from(
    section.querySelectorAll<HTMLAnchorElement>(
      'a[href*="maps.google."], a[href*="google.com/maps"]',
    ),
  );
  const addresses = uniqueStrings(
    mapLinks.map((anchor) => textWithoutControls(anchor)),
    (value) => value.toLocaleLowerCase(),
  );

  const websites = Array.from(
    section.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).flatMap((anchor) => {
    const url = absoluteUrl(anchor.getAttribute("href"));
    if (!url || !/^https?:/i.test(url)) return [];

    const parsedUrl = new URL(url);
    if (
      /(^|\.)bing\.com$/i.test(parsedUrl.hostname) ||
      /(^|\.)google\./i.test(parsedUrl.hostname) &&
        /\/maps|maps\./i.test(url)
    ) {
      return [];
    }

    return [{
      label: textWithoutControls(anchor),
      url,
    }];
  });

  const seenWebsiteUrls = new Set<string>();
  return {
    emails,
    phoneNumbers,
    addresses,
    websites: websites.filter((website) => {
      if (seenWebsiteUrls.has(website.url)) return false;
      seenWebsiteUrls.add(website.url);
      return true;
    }),
  };
}

export function readLeadAbout(root: HTMLElement): string | null {
  const section = root.querySelector<HTMLElement>(LEAD_ABOUT_SELECTOR);
  return fullDescription(
    section?.querySelector('[data-anonymize="person-blurb"]') ?? null,
  );
}

function experienceRole(
  root: HTMLElement,
  titleElement: Element | null,
  description: string,
): LeadExperienceRole {
  const title = requiredText(titleElement, `${description} title`);
  const periodSpan = Array.from(
    root.querySelectorAll<HTMLElement>("p > span"),
  ).find((candidate) =>
    !candidate.closest('[data-sn-view-name="feature-account-iq-insight"]') &&
    elementText(candidate) !== null
  ) ?? null;
  const periodRow = periodSpan?.parentElement ?? null;
  const period = elementText(periodSpan);
  const locationElement = periodRow?.nextElementSibling?.matches("p")
    ? periodRow.nextElementSibling
    : null;
  const blurb = Array.from(
    root.querySelectorAll<HTMLElement>('[data-anonymize="person-blurb"]'),
  ).find((candidate) =>
    !candidate.closest('[data-sn-view-name="feature-account-iq-insight"]')
  ) ?? null;

  return {
    title,
    period,
    duration: durationWithoutPeriod(periodRow, period),
    location: elementText(locationElement),
    description: fullDescription(blurb),
  };
}

function explicitCompanyDuration(entry: HTMLElement): string | null {
  const header = entry.querySelector<HTMLElement>(":scope > div");
  if (!header) return null;

  const durationPattern =
    /\b\d+\s+(?:yr|yrs|year|years|mo|mos|month|months)\b/i;
  const durationParagraph = Array.from(
    header.querySelectorAll<HTMLElement>("p"),
  ).find((paragraph) =>
    paragraph.querySelector(":scope > span") === null &&
    durationPattern.test(elementText(paragraph) ?? "")
  );

  return elementText(durationParagraph ?? null);
}

export function readLeadExperience(root: HTMLElement): LeadExperience[] {
  const section = root.querySelector<HTMLElement>(LEAD_EXPERIENCE_SELECTOR);
  const list = section?.querySelector<HTMLElement>(":scope > div > ul");
  if (!list) return [];

  return Array.from(
    list.querySelectorAll<HTMLElement>(":scope > li"),
  ).map((entry, entryIndex) => {
    const companyElement = entry.querySelector(
      '[data-anonymize="company-name"]',
    );
    if (!companyElement) {
      malformed(`experience ${entryIndex + 1} company not found`);
    }

    const nestedRoleList = entry.querySelector<HTMLElement>(":scope > ul");
    const nestedRoleItems = nestedRoleList
      ? Array.from(
        nestedRoleList.querySelectorAll<HTMLElement>(":scope > li"),
      )
      : [];
    const roles = nestedRoleItems.length > 0
      ? nestedRoleItems.map((role, roleIndex) =>
        experienceRole(
          role,
          role.querySelector('[data-anonymize="job-title"]'),
          `experience ${entryIndex + 1} role ${roleIndex + 1}`,
        )
      )
      : [
        experienceRole(
          entry,
          entry.querySelector('[data-anonymize="job-title"]'),
          `experience ${entryIndex + 1} role 1`,
        ),
      ];

    return {
      company: companyReference(entry, companyElement),
      totalDuration: explicitCompanyDuration(entry) ??
        (roles.length === 1 ? roles[0]?.duration ?? null : null),
      roles,
    };
  });
}

function educationDetails(value: string | null): {
  degree: string | null;
  fieldOfStudy: string | null;
} {
  if (!value) return { degree: null, fieldOfStudy: null };

  const separatorIndex = value.indexOf(",");
  if (separatorIndex === -1) {
    return { degree: value, fieldOfStudy: null };
  }

  return {
    degree: cleanText(value.slice(0, separatorIndex)),
    fieldOfStudy: cleanText(value.slice(separatorIndex + 1)),
  };
}

export function readLeadEducation(root: HTMLElement): LeadEducation[] {
  const section = root.querySelector<HTMLElement>(LEAD_EDUCATION_SELECTOR);
  const list = section?.querySelector<HTMLElement>(":scope > div > ul");
  if (!list) return [];

  return Array.from(
    list.querySelectorAll<HTMLElement>(":scope > li"),
  ).map((item, index) => {
    const institutionElement = item.querySelector<HTMLElement>(
      '[data-anonymize="education-name"]',
    );
    const institution = requiredText(
      institutionElement,
      `education ${index + 1} institution`,
    );
    const content = institutionElement?.parentElement;
    const paragraphs = content
      ? Array.from(
        content.querySelectorAll<HTMLElement>(":scope > p"),
      )
      : [];
    const details = educationDetails(elementText(paragraphs[0] ?? null));
    const period = elementText(
      paragraphs[1]?.querySelector("span") ?? paragraphs[1] ?? null,
    );
    const institutionAnchor =
      institutionElement?.querySelector<HTMLAnchorElement>("a[href]") ??
        institutionElement?.closest<HTMLAnchorElement>("a[href]") ??
        null;

    return {
      institution,
      institutionUrl: absoluteUrl(
        institutionAnchor?.getAttribute("href"),
      ),
      logoUrl: absoluteUrl(
        item.querySelector<HTMLImageElement>("img[src]")?.getAttribute("src"),
      ),
      degree: details.degree,
      fieldOfStudy: details.fieldOfStudy,
      period,
    };
  });
}

export function readLeadSkills(root: HTMLElement): LeadSkill[] {
  const section = root.querySelector<HTMLElement>(LEAD_SKILLS_SELECTOR);
  const list = section?.querySelector<HTMLElement>(":scope div > ul");
  if (!list) return [];

  return Array.from(
    list.querySelectorAll<HTMLElement>(":scope > li"),
  ).map((item, index) => {
    const nameElement = item.querySelector<HTMLElement>("p[title]") ??
      item.querySelector<HTMLElement>("p");
    const name = cleanText(nameElement?.getAttribute("title")) ??
      requiredText(nameElement, `skill ${index + 1} name`);
    const endorsementMatch = elementText(item)?.match(
      /\b([\d,]+)\s+endorsements?\b/i,
    );

    return {
      name,
      endorsementCount: endorsementMatch?.[1]
        ? Number(endorsementMatch[1].replaceAll(",", ""))
        : null,
    };
  });
}

export async function readLeadProfile(): Promise<LeadProfileSnapshot> {
  const root = await prepareLeadProfileRoot();
  return {
    lead: readLeadIdentity(root),
    observedAt: new Date().toISOString(),
    currentRoles: readLeadCurrentRoles(root),
    contactInfo: readLeadContactInfo(root),
    about: readLeadAbout(root),
    experience: readLeadExperience(root),
    education: readLeadEducation(root),
    skills: readLeadSkills(root),
  };
}
