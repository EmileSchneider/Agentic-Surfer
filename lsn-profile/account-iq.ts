import { ToolError } from "../types.ts";
import {
  absoluteUrl,
  type AccountIqSectionKey,
  cleanText,
  elementText,
  findAccountIqSection,
  prepareAccountIqRoot,
  readSectionSources,
} from "./dom.ts";

/**
 * A source LinkedIn associates with an Account IQ section.
 *
 * Sources apply to their complete section. They are not evidence for a
 * particular bullet unless LinkedIn explicitly makes that association.
 */
export type AccountIqSource =
  | {
    kind: "external";
    name: string;
    url: string;
  }
  | {
    kind: "linkedin";
    name: "LinkedIn";
  };

export interface SourcedSection {
  sources: AccountIqSource[];
}

export interface TitledInsight {
  title: string;
  description: string;
}

export interface HowTheyMakeMoneySection extends SourcedSection {
  summary: string;
}

export interface StrategicPrioritiesSection extends SourcedSection {
  priorities: TitledInsight[];
}

export interface BusinessChallengesSection extends SourcedSection {
  challenges: TitledInsight[];
}

export interface Competitor {
  name: string;
  industry: string | null;
  accountId: string | null;
  salesNavigatorUrl: string;
  logoUrl: string | null;
}

export interface CompetitiveLandscapeSection extends SourcedSection {
  summary: string;
  competitors: Competitor[];
}

export type HeadcountPeriod = "3m" | "1y";

export interface HeadcountChange {
  period: HeadcountPeriod;

  /**
   * A signed percentage: 17 represents +17%, and -4 represents -4%.
   */
  percentChange: number;
}

export interface DepartmentHeadcountGrowth {
  department: string;
  changes: HeadcountChange[];
}

export interface HeadcountInsightsSection extends SourcedSection {
  /**
   * LinkedIn's AI-written observations, kept separate from the numeric table.
   */
  insights: TitledInsight[];
  departmentGrowth: DepartmentHeadcountGrowth[];
  detailsUrl: string | null;
}

export interface RelatedNewsItem {
  headline: string;
  publisher: string | null;
  url: string;
  thumbnailUrl: string | null;
}

export interface RelatedNewsSection extends SourcedSection {
  articles: RelatedNewsItem[];
}

export interface KeyPerson {
  name: string;
  role: string | null;
  connectionDegree: 1 | 2 | 3 | null;
  salesNavigatorUrl: string;
  imageUrl: string | null;
}

export interface KeyPeopleSection extends SourcedSection {
  people: KeyPerson[];
  allExecutivesUrl: string | null;
}

export interface ExecutiveVoiceAuthor {
  name: string;
  role: string | null;
  salesNavigatorUrl: string | null;
  imageUrl: string | null;
}

export interface ExecutiveVoiceItem {
  author: ExecutiveVoiceAuthor;
  excerpt: string;
  postUrl: string;
}

export interface ExecutiveVoicesSection extends SourcedSection {
  posts: ExecutiveVoiceItem[];
  allPostsUrl: string | null;
}

export interface AccountIqSections {
  howTheyMakeMoney: HowTheyMakeMoneySection | null;
  strategicPriorities: StrategicPrioritiesSection | null;
  businessChallenges: BusinessChallengesSection | null;
  competitiveLandscape: CompetitiveLandscapeSection | null;
  headcountInsights: HeadcountInsightsSection | null;
  keyPeople: KeyPeopleSection | null;
  executiveVoices: ExecutiveVoicesSection | null;
  relatedNews: RelatedNewsSection | null;
}

export interface AccountIqAccount {
  accountId: string | null;
  name: string | null;
  salesNavigatorUrl: string;
}

/**
 * A point-in-time observation of LinkedIn Sales Navigator's Account IQ data.
 */
export interface AccountIqSnapshot {
  account: AccountIqAccount;
  observedAt: string;
  sections: AccountIqSections;
}

function malformed(section: string, message: string): never {
  throw new ToolError(
    "INTERNAL",
    `Malformed Account IQ ${section} section: ${message}`,
  );
}

function section(
  root: HTMLElement,
  key: AccountIqSectionKey,
): HTMLElement | null {
  return findAccountIqSection(root, key);
}

function headingFor(
  root: HTMLElement,
  sectionName: string,
): HTMLHeadingElement | null {
  return root
    .querySelector(`[data-section-name="${sectionName}"]`)
    ?.closest<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6") ?? null;
}

function paragraphAfterHeading(
  heading: HTMLHeadingElement | null,
): string | null {
  let candidate = heading?.nextElementSibling ?? null;
  while (candidate) {
    if (candidate.matches("p")) return elementText(candidate);
    candidate = candidate.nextElementSibling;
  }
  return null;
}

function descriptionWithoutTitle(
  item: HTMLElement,
  title: string,
): string | null {
  const value = elementText(item);
  if (!value) return null;
  if (!value.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())) {
    return value;
  }
  return cleanText(value.slice(title.length).replace(/^[:\s–—-]+/, ""));
}

function parseTitledItems(
  root: HTMLElement,
  sectionName: string,
): TitledInsight[] {
  const list = root.querySelector<HTMLUListElement>("ul");
  if (!list) malformed(sectionName, "content list not found");

  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li")).map(
    (item, index) => {
      const title = elementText(item.querySelector("strong"));
      if (!title) malformed(sectionName, `item ${index + 1} has no title`);

      const description = elementText(item.querySelector("p")) ??
        descriptionWithoutTitle(item, title);
      if (!description) {
        malformed(sectionName, `item ${index + 1} has no description`);
      }

      return { title, description };
    },
  );
}

function parseHowTheyMakeMoney(
  root: HTMLElement,
): HowTheyMakeMoneySection | null {
  const sectionRoot = section(root, "howTheyMakeMoney");
  if (!sectionRoot) return null;

  const summary = paragraphAfterHeading(
    headingFor(sectionRoot, "revenue_sources"),
  );
  if (!summary) malformed("How they make money", "summary not found");

  return {
    summary,
    sources: readSectionSources(sectionRoot, "revenue_sources"),
  };
}

function parseStrategicPriorities(
  root: HTMLElement,
): StrategicPrioritiesSection | null {
  const sectionRoot = section(root, "strategicPriorities");
  if (!sectionRoot) return null;

  return {
    priorities: parseTitledItems(sectionRoot, "Strategic priorities"),
    sources: readSectionSources(sectionRoot, "strategic_priorities"),
  };
}

function parseBusinessChallenges(
  root: HTMLElement,
): BusinessChallengesSection | null {
  const sectionRoot = section(root, "businessChallenges");
  if (!sectionRoot) return null;

  return {
    challenges: parseTitledItems(sectionRoot, "Business challenges"),
    sources: readSectionSources(sectionRoot, "challenges_and_pain_points"),
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function parseCompetitor(
  anchor: HTMLAnchorElement,
  index: number,
): Competitor {
  const salesNavigatorUrl = absoluteUrl(anchor.getAttribute("href"));
  if (!salesNavigatorUrl) {
    malformed("Competitive landscape", `competitor ${index + 1} has no URL`);
  }

  const name = elementText(
    anchor.querySelector('[data-anonymize="company-name"], h5'),
  );
  if (!name) {
    malformed("Competitive landscape", `competitor ${index + 1} has no name`);
  }

  return {
    name,
    industry: elementText(anchor.querySelector("p")),
    accountId: salesNavigatorUrl.match(/\/sales\/company\/(\d+)/)?.[1] ?? null,
    salesNavigatorUrl,
    logoUrl: absoluteUrl(
      anchor.querySelector<HTMLImageElement>("img")?.getAttribute("src"),
    ),
  };
}

function parseCompetitiveLandscape(
  root: HTMLElement,
): CompetitiveLandscapeSection | null {
  const sectionRoot = section(root, "competitiveLandscape");
  if (!sectionRoot) return null;

  const summary = paragraphAfterHeading(
    headingFor(sectionRoot, "competitive_landscape"),
  );
  if (!summary) malformed("Competitive landscape", "summary not found");

  const competitors = Array.from(
    sectionRoot.querySelectorAll<HTMLAnchorElement>(
      'a[data-control-name="account_iq_competitors"][href*="/sales/company/"]',
    ),
  ).map(parseCompetitor);

  return {
    summary,
    competitors: uniqueBy(
      competitors,
      (competitor) => competitor.salesNavigatorUrl,
    ),
    sources: readSectionSources(sectionRoot, "competitive_landscape"),
  };
}

function parsePercentChange(cell: HTMLTableCellElement): number | null {
  const value = elementText(cell);
  const match = value?.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  if (!match?.[1]) return null;

  const parsed = Number(match[1].replace(",", "."));
  if (!Number.isFinite(parsed)) return null;

  const direction = elementText(
    cell.querySelector(".a11y-text"),
  )?.toLocaleLowerCase();
  if (direction?.includes("decreas")) return -Math.abs(parsed);
  if (direction?.includes("increas")) return Math.abs(parsed);
  return parsed;
}

function parseHeadcountTable(
  sectionRoot: HTMLElement,
): DepartmentHeadcountGrowth[] {
  const table = sectionRoot.querySelector<HTMLTableElement>("table");
  if (!table) return [];

  const headings = Array.from(
    table.querySelectorAll<HTMLTableCellElement>("thead th"),
  ).map(elementText);

  const periodColumns = headings.flatMap((heading, index) => {
    const period = heading?.toLocaleLowerCase();
    return period === "3m" || period === "1y"
      ? [{ index, period: period as HeadcountPeriod }]
      : [];
  });

  return Array.from(
    table.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ).map((row, rowIndex) => {
    const cells = Array.from(
      row.querySelectorAll<HTMLTableCellElement>(":scope > td"),
    );
    const department = elementText(cells[0] ?? null);
    if (!department) {
      malformed(
        "Headcount insights",
        `table row ${rowIndex + 1} has no department`,
      );
    }

    const changes = periodColumns.flatMap(({ index, period }) => {
      const cell = cells[index];
      if (!cell) return [];
      const percentChange = parsePercentChange(cell);
      return percentChange == null ? [] : [{ period, percentChange }];
    });

    return { department, changes };
  });
}

function parseHeadcountNarrative(
  sectionRoot: HTMLElement,
): TitledInsight[] {
  const heading = headingFor(sectionRoot, "headcount_growth");
  const narrativeRoot = heading?.parentElement ?? null;
  const list = narrativeRoot?.querySelector<HTMLUListElement>("ul") ?? null;
  if (!list) return [];

  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li")).map(
    (item, index) => {
      const title = elementText(item.querySelector("strong"));
      if (!title) {
        malformed(
          "Headcount insights",
          `narrative item ${index + 1} has no title`,
        );
      }
      const description = descriptionWithoutTitle(item, title);
      if (!description) {
        malformed(
          "Headcount insights",
          `narrative item ${index + 1} has no description`,
        );
      }
      return { title, description };
    },
  );
}

function parseHeadcountInsights(
  root: HTMLElement,
): HeadcountInsightsSection | null {
  const sectionRoot = section(root, "headcountInsights");
  if (!sectionRoot) return null;

  return {
    insights: parseHeadcountNarrative(sectionRoot),
    departmentGrowth: parseHeadcountTable(sectionRoot),
    detailsUrl: absoluteUrl(
      sectionRoot.querySelector<HTMLAnchorElement>(
        'a[href*="anchor=growth-insights"]',
      )?.getAttribute("href"),
    ),
    sources: readSectionSources(sectionRoot, "headcount_growth"),
  };
}

function connectionDegree(element: Element | null): 1 | 2 | 3 | null {
  const value = `${element?.getAttribute("aria-label") ?? ""} ${
    elementText(element) ?? ""
  }`.toLocaleLowerCase();
  if (/\b(?:first|1st)\b/.test(value)) return 1;
  if (/\b(?:second|2nd)\b/.test(value)) return 2;
  if (/\b(?:third|3rd)\b/.test(value)) return 3;
  return null;
}

function keyPersonContainer(
  nameAnchor: HTMLAnchorElement,
  sectionRoot: HTMLElement,
): HTMLElement | null {
  let candidate = nameAnchor.parentElement;
  while (candidate && candidate !== sectionRoot) {
    const names = candidate.querySelectorAll(
      '[data-anonymize="person_name"]',
    );
    if (
      names.length === 1 &&
      candidate.querySelector('[data-anonymize="headshot-photo"]')
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function roleFollowingName(nameAnchor: HTMLAnchorElement): string | null {
  const nameWrapper = nameAnchor.closest("span");
  return elementText(nameWrapper?.parentElement?.nextElementSibling ?? null);
}

function parseKeyPerson(
  nameAnchor: HTMLAnchorElement,
  sectionRoot: HTMLElement,
  index: number,
): KeyPerson {
  const container = keyPersonContainer(nameAnchor, sectionRoot);
  if (!container) {
    malformed("Key people", `person ${index + 1} has no entity container`);
  }

  const name = elementText(nameAnchor);
  if (!name) malformed("Key people", `person ${index + 1} has no name`);

  const salesNavigatorUrl = absoluteUrl(nameAnchor.getAttribute("href"));
  if (!salesNavigatorUrl) {
    malformed("Key people", `person ${index + 1} has no profile URL`);
  }

  return {
    name,
    role: roleFollowingName(nameAnchor),
    connectionDegree: connectionDegree(
      container.querySelector('[aria-label*="-degree connection"]'),
    ),
    salesNavigatorUrl,
    imageUrl: absoluteUrl(
      container.querySelector<HTMLImageElement>(
        'img[data-anonymize="headshot-photo"]',
      )?.getAttribute("src"),
    ),
  };
}

function parseKeyPeople(root: HTMLElement): KeyPeopleSection | null {
  const sectionRoot = section(root, "keyPeople");
  if (!sectionRoot) return null;

  const people = Array.from(
    sectionRoot.querySelectorAll<HTMLAnchorElement>(
      'a[data-anonymize="person_name"][href*="/sales/lead/"]',
    ),
  ).map((anchor, index) => parseKeyPerson(anchor, sectionRoot, index));

  return {
    people: uniqueBy(people, (person) => person.salesNavigatorUrl),
    allExecutivesUrl: absoluteUrl(
      sectionRoot.querySelector<HTMLAnchorElement>(
        'a[href*="/sales/search/people"]',
      )?.getAttribute("href"),
    ),
    sources: readSectionSources(sectionRoot, "exec_team"),
  };
}

function executiveVoiceContainer(
  postAnchor: HTMLAnchorElement,
  sectionRoot: HTMLElement,
): HTMLElement | null {
  let candidate = postAnchor.parentElement;
  while (candidate && candidate !== sectionRoot) {
    if (
      candidate.querySelectorAll(
          '[data-control-name="account_dossier_exec_team_posts"]',
        ).length === 1 &&
      candidate.querySelector('a[href*="/sales/lead/"]')
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function nameFromProfileAnchor(anchor: HTMLAnchorElement): string | null {
  const label = cleanText(anchor.getAttribute("aria-label"));
  return cleanText(label?.replace(/^View profile of\s+/i, "")) ??
    elementText(anchor);
}

function executiveRole(
  container: HTMLElement,
  authorName: string,
): string | null {
  const nameElement = Array.from(
    container.querySelectorAll<HTMLElement>("span"),
  ).find((element) => elementText(element) === authorName);
  return elementText(nameElement?.parentElement?.nextElementSibling ?? null);
}

function parseExecutiveVoice(
  postAnchor: HTMLAnchorElement,
  sectionRoot: HTMLElement,
  index: number,
): ExecutiveVoiceItem {
  const container = executiveVoiceContainer(postAnchor, sectionRoot);
  if (!container) {
    malformed(
      "Executive voices",
      `post ${index + 1} has no entity container`,
    );
  }

  const profileAnchor = container.querySelector<HTMLAnchorElement>(
    'a[href*="/sales/lead/"]',
  );
  const authorName = profileAnchor
    ? nameFromProfileAnchor(profileAnchor)
    : null;
  if (!authorName) {
    malformed("Executive voices", `post ${index + 1} has no author`);
  }

  const excerpt = elementText(postAnchor) ?? "";
  // if (!excerpt) {
  //   malformed("Executive voices", `post ${index + 1} has no excerpt`);
  // }

  const postUrl = absoluteUrl(postAnchor.getAttribute("href"));
  if (!postUrl) {
    malformed("Executive voices", `post ${index + 1} has no URL`);
  }

  return {
    author: {
      name: authorName,
      role: executiveRole(container, authorName),
      salesNavigatorUrl: absoluteUrl(profileAnchor?.getAttribute("href")),
      imageUrl: absoluteUrl(
        container.querySelector<HTMLImageElement>(
          'img[data-anonymize="headshot-photo"]',
        )?.getAttribute("src"),
      ),
    },
    excerpt,
    postUrl,
  };
}

function parseExecutiveVoices(
  root: HTMLElement,
): ExecutiveVoicesSection | null {
  const sectionRoot = section(root, "executiveVoices");
  if (!sectionRoot) return null;

  const posts = Array.from(
    sectionRoot.querySelectorAll<HTMLAnchorElement>(
      'a[data-control-name="account_dossier_exec_team_posts"][href]',
    ),
  ).map((anchor, index) => parseExecutiveVoice(anchor, sectionRoot, index));

  return {
    posts: uniqueBy(posts, (post) => post.postUrl),
    allPostsUrl: absoluteUrl(
      sectionRoot.querySelector<HTMLAnchorElement>(
        'a[data-control-name="account_iq_exec_team_posts_view_all"]',
      )?.getAttribute("href"),
    ),
    sources: readSectionSources(sectionRoot, "exec_voices"),
  };
}

function parseNewsItem(
  article: HTMLElement,
  index: number,
): RelatedNewsItem {
  const anchor = Array.from(
    article.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).find((candidate) => candidate.querySelector("h4"));
  if (!anchor) malformed("Related news", `article ${index + 1} has no link`);

  const headline = elementText(anchor.querySelector("h4"));
  if (!headline) {
    malformed("Related news", `article ${index + 1} has no headline`);
  }

  const url = absoluteUrl(anchor.getAttribute("href"));
  if (!url) malformed("Related news", `article ${index + 1} has no URL`);

  return {
    headline,
    publisher: elementText(article.querySelector("p")),
    url,
    thumbnailUrl: absoluteUrl(
      article.querySelector<HTMLImageElement>("img")?.getAttribute("src"),
    ),
  };
}

function parseRelatedNews(root: HTMLElement): RelatedNewsSection | null {
  const sectionRoot = section(root, "relatedNews");
  if (!sectionRoot) return null;

  const articles = Array.from(
    sectionRoot.querySelectorAll<HTMLElement>("article"),
  ).map(parseNewsItem);

  return {
    articles: uniqueBy(articles, (article) => article.url),
    sources: readSectionSources(sectionRoot, "account_news"),
  };
}

function accountName(root: HTMLElement): string | null {
  const companyName = Array.from(
    document.querySelectorAll<HTMLElement>('[data-anonymize="company-name"]'),
  ).find((candidate) => !root.contains(candidate));
  if (companyName) return elementText(companyName);

  const pageHeading = Array.from(
    document.querySelectorAll<HTMLElement>("main h1"),
  ).find((candidate) =>
    !root.contains(candidate) && elementText(candidate) !== "Account IQ"
  );
  if (pageHeading) return elementText(pageHeading);

  const revenueHeading = elementText(
    headingFor(root, "revenue_sources"),
  );
  return revenueHeading?.match(/^How (.+) makes money$/i)?.[1] ?? null;
}

function accountReference(root: HTMLElement): AccountIqAccount {
  const pageUrl = new URL(location.href);
  pageUrl.search = "";
  pageUrl.hash = "";

  return {
    accountId: pageUrl.pathname.match(/\/sales\/company\/(\d+)/)?.[1] ?? null,
    name: accountName(root),
    salesNavigatorUrl: pageUrl.href,
  };
}

export async function readAccountIq(): Promise<AccountIqSnapshot> {
  const root = await prepareAccountIqRoot();
  return {
    account: accountReference(root),
    observedAt: new Date().toISOString(),
    sections: {
      howTheyMakeMoney: parseHowTheyMakeMoney(root),
      strategicPriorities: parseStrategicPriorities(root),
      businessChallenges: parseBusinessChallenges(root),
      competitiveLandscape: parseCompetitiveLandscape(root),
      headcountInsights: parseHeadcountInsights(root),
      keyPeople: parseKeyPeople(root),
      executiveVoices: parseExecutiveVoices(root),
      relatedNews: parseRelatedNews(root),
    },
  };
}

export async function readHowTheyMakeMoney(): Promise<
  HowTheyMakeMoneySection | null
> {
  return parseHowTheyMakeMoney(await prepareAccountIqRoot());
}

export async function readStrategicPriorities(): Promise<
  StrategicPrioritiesSection | null
> {
  return parseStrategicPriorities(await prepareAccountIqRoot());
}

export async function readBusinessChallenges(): Promise<
  BusinessChallengesSection | null
> {
  return parseBusinessChallenges(await prepareAccountIqRoot());
}

export async function readCompetitiveLandscape(): Promise<
  CompetitiveLandscapeSection | null
> {
  return parseCompetitiveLandscape(await prepareAccountIqRoot());
}

export async function readHeadcountInsights(): Promise<
  HeadcountInsightsSection | null
> {
  return parseHeadcountInsights(await prepareAccountIqRoot());
}

export async function readKeyPeople(): Promise<KeyPeopleSection | null> {
  return parseKeyPeople(await prepareAccountIqRoot());
}

export async function readExecutiveVoices(): Promise<
  ExecutiveVoicesSection | null
> {
  return parseExecutiveVoices(await prepareAccountIqRoot());
}

export async function readRelatedNews(): Promise<RelatedNewsSection | null> {
  return parseRelatedNews(await prepareAccountIqRoot());
}
