# Extension commands

This file lists all 61 command names in `COMMAND_ROUTES` in [background.ts](background.ts). Arguments are the contents of `args`. Return types describe the successful `result`, after the command completes. `?` marks an optional field. Send `{}` when no arguments are needed.

The router and handlers are the source for this list. `ExtensionCommand` and `CommandResultMap` in `types.ts` are incomplete.

## Request and reply

```ts
{ id: string; command: string; args: object; cacheReply?: boolean }
// Success
{ id: string; ok: true; result: /* type below */ }
// Failure
{ id: string; ok: false; error: { code: ToolErrorCode; message: string } }
```

## Lead search

Both names in each row accept the same arguments and return the same result. The short name is the old name.

| Command | Old name | Arguments | Return type |
| --- | --- | --- | --- |
| `leadSearch.getState` | `getSearchState` | `{}` | `SearchState` |
| `leadSearch.listFilterOptions` | `listFilterOptions` | `{ filter: FilterName }` | `FilterOption[]` |
| `leadSearch.searchFilterOptions` | `searchFilterOptions` | `{ filter: FilterName; query: string }` | `FilterOption[]` |
| `leadSearch.selectFilterOption` | `selectFilterOption` | `{ filter: FilterName; code: string; mode?: FilterMode }` | `SearchState` |
| `leadSearch.removeFilterSelection` | `removeFilterSelection` | `{ filter: FilterName; label: string }` | `SearchState` |
| `leadSearch.clearFilter` | `clearFilter` | `{ filter: FilterName }` | `SearchState` |
| `leadSearch.setKeywords` | `setKeywords` | `{ text: string }` | `SearchState` |
| `leadSearch.clearKeywords` | `clearKeywords` | `{}` | `SearchState` |
| `leadSearch.readResults` | `readResults` | `{ limit?: number }` | `ResultsPage` |
| `leadSearch.nextPage` | `nextPage` | `{}` | `SearchState` |

`mode` defaults to `"include"`. Use `listFilterOptions` for fixed lists. Use `searchFilterOptions` for filters that need a text search.

## Account search

Sources: [tools.ts](account-search/tools.ts) and the functions imported by that file.

| Command | Arguments | Return type |
| --- | --- | --- |
| `accountSearch.readResults` | `{ limit?: number }` | `AccountResultsPage` |
| `accountSearch.getPagination` | `{}` | `AccountPaginationState` |
| `accountSearch.nextPage` | `{}` | `AccountSearchState` |
| `accountSearch.previousPage` | `{}` | `AccountPaginationState` |
| `accountSearch.goToPage` | `{ page: number }` | `AccountPaginationState` |
| `accountSearch.listAnnualRevenueOptions` | `{}` | `AnnualRevenueOptions` |
| `accountSearch.setAnnualRevenue` | `{ currency?: string; min?: string \| number; max?: string \| number; }` | `AnnualRevenueState` |
| `accountSearch.clearAnnualRevenue` | `{}` | `AnnualRevenueState` |
| `accountSearch.listHeadcountOptions` | `{}` | `FilterOption[]` |
| `accountSearch.selectHeadcountOption` | `{ code?: string; label?: string; }` | `AccountHeadcountState` |
| `accountSearch.clearHeadcount` | `{}` | `AccountHeadcountState` |
| `accountSearch.setHeadcountGrowth` | `{ min?: number \| string; max?: number \| string; }` | `HeadcountGrowthState` |
| `accountSearch.clearHeadcountGrowth` | `{}` | `HeadcountGrowthState` |
| `accountSearch.listDepartmentHeadcountDepartments` | `{}` | `DepartmentHeadcountDepartment[]` |
| `accountSearch.setDepartmentHeadcount` | `{ department?: string \| number; min?: string \| number; max?: string \| number; }` | `DepartmentHeadcountState` |
| `accountSearch.clearDepartmentHeadcount` | `{}` | `DepartmentHeadcountState` |
| `accountSearch.readDepartmentHeadcountState` | `{}` | `DepartmentHeadcountState` |
| `accountSearch.listDepartmentHeadcountGrowthDepartments` | `{}` | `DepartmentHeadcountGrowthDepartment[]` |
| `accountSearch.setDepartmentHeadcountGrowth` | `{ department?: string \| number; min?: string \| number; max?: string \| number; }` | `DepartmentHeadcountGrowthState` |
| `accountSearch.clearDepartmentHeadcountGrowth` | `{}` | `DepartmentHeadcountGrowthState` |
| `accountSearch.readDepartmentHeadcountGrowthState` | `{}` | `DepartmentHeadcountGrowthState` |
| `accountSearch.searchHeadquartersLocationOptions` | `{ query: string }` | `FilterOption[]` |
| `accountSearch.selectHeadquartersLocationOption` | `{ code?: string; query?: string; mode?: FilterMode; }` | `HeadquartersLocationState` |
| `accountSearch.clearHeadquartersLocation` | `{}` | `HeadquartersLocationState` |
| `accountSearch.searchIndustryOptions` | `{ query: string }` | `FilterOption[]` |
| `accountSearch.selectIndustryOption` | `{ code?: string; query?: string; mode?: FilterMode; }` | `IndustryState` |
| `accountSearch.clearIndustry` | `{}` | `IndustryState` |
| `accountSearch.setKeywords` | `{ text: string }` | `AccountSearchState` |
| `accountSearch.clearKeywords` | `{}` | `AccountSearchState` |
| `accountSearch.getState` | `{}` | `AccountSearchState` |

Argument rules:

- `page` and `limit` must be positive integers.
- `selectHeadcountOption` requires `code` or `label`.
- Location and industry selection accept `code` or a search `query`. `mode` defaults to `"include"`.
- Growth setters require `min`, `max`, or both. Department setters also require `department`; get its value from the department list command.
- Annual revenue uses the option values from `listAnnualRevenueOptions`. `currency` defaults to `"USD"`.
- `accountSearch.nextPage` returns the full search state. `previousPage` and `goToPage` return pagination only.

## Profiles, invitations, and job postings

| Command | Arguments | Return type |
| --- | --- | --- |
| `invitations.withdrawOld` | `{}` | `WithdrawOldInvitationsResult` |
| `profile.readCompany` | `{ orgId: string } OR { urn: string }` | `ProfileInfo` |
| `profile.company.read.urn` | `{ url: string }` | `{ urn: string }` |
| `checkLinkedinProfile` | `{ orgId: string } OR { urn: string }` | `ProfileInfo` |
| `profile.person.open` | `{ memberId: string }` | `PersonProfileOpenResult` |
| `profile.person.read` | `{ memberId: string }` | `PersonProfile` |
| `profile.person.connect` | `{ memberId: string; note?: string }` | `ProfilePersonConnectResult` |
| `jobPosting.read` | `{ url: string }` | `{ sourceUrl: string; descriptionMarkdown: string }` |
| `accountAbout.read` | `{ accountId: string }` | `string \| null` |
| `accountProfile.read` | `{ accountId: string }` | `AccountProfileSnapshot` |
| `accountProfile.website` | `{ accountId: string }` | `string \| null` |
| `accountIq.read` | `{ accountId: string }` | `AccountIqSnapshot` |

Argument and result notes:

- Company IDs and Sales Navigator account IDs must contain digits only. For a company URN, the final part must be the numeric ID. `orgId` takes priority over `urn`.
- `memberId` identifies a LinkedIn person. For `open` and `read`, it must be nonempty and must not contain `/`, `?`, or `#`. For `connect`, only letters, combining marks, numbers, `_`, and `-` are accepted.
- A connection note must be nonempty when supplied and must have no more than 300 characters.
- `profile.person.open` leaves the tab open. `read` and `connect` close their temporary tab after completion. The returned connection `tabId` thus identifies a tab that has been closed.
- `jobPosting.read` validates and normalizes its URL with `jobPostingUrl` in [job-posting/extractor.ts](job-posting/extractor.ts).
- `invitations.withdrawOld` has no age argument. See [invitations/tools.ts](invitations/tools.ts) for its fixed age rule.

## Return type definitions

These definitions come from the source files linked below. Comments are omitted.

### [types.ts](types.ts)

```ts
type FilterMode = "include" | "exclude";

type FilterName = "seniority" | "headcount" | "jobTitle" | "industry" | "function" | "geography" | "company";

interface FilterOption {
  label: string;
  code: string;
}

interface FilterSelection {
  label: string;
  mode: FilterMode;
}

interface SearchState {
  filters: Record<FilterName, FilterSelection[]>;
  keywords: string;
  page: number | null;
  totalPages: number | null;
}

interface ResultsPage {
  count: number;
  page: number | null;
  totalPages: number | null;
  leads: LeadResult[]
}

interface ProfileInfo {
  name: string | null;
  industry: string | null;
  location: string | null;
  followers: string | null;
  employeeCount: string | null;
  tagline: string | null;
  url: string;
  finalUrl: string;
}

type ToolErrorCode =
  | "NOT_FOUND"
  | "ALREADY_PENDING"
  | "ALREADY_CONNECTED"
  | "TIMEOUT"
  | "UNSUPPORTED_MODE"
  | "BAD_ARGS"
  | "INTERNAL";

interface ProfilePersonConnectResult {
  memberId: string;
  sent: true;
  tabId: number;
  finalUrl: string;
}

interface WithdrawOldInvitationsResult {
  scanned: number;
  eligible: number;
  withdrawn: number;
}
```

### [linkedin/results.ts](linkedin/results.ts)

```ts
interface LeadResult {
  memberId: string | null;
  name: string | null;
  title: string | null;
  company: string | null;
  companyOrgId: string | null;
  location: string | null;
  tenure: string[];
  about: string | null;
  connectionDegree: string | null;
  salesNavUrl: string | null;
  linkedinUrl: string | null;
  inNetwork: boolean;
}
```

### [account-search/results.ts](account-search/results.ts)

```ts
interface AccountResult {
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

interface AccountResultsPage {
  count: number;
  page: number | null;
  totalPages: number | null;
  accounts: AccountResult[];
}

interface AccountPaginationState {
  page: number;
  totalPages: number;
}
```

### [account-search/annual-revenue.ts](account-search/annual-revenue.ts)

```ts
interface AnnualRevenueOptions {
  currencies: { label: string; value: string }[];
  minValues: { label: string; value: string }[];
  maxValues: { label: string; value: string }[];
}

interface AnnualRevenueState {
  currency: string | null;
  min: string | null;
  max: string | null;
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/headcount.ts](account-search/headcount.ts)

```ts
interface AccountHeadcountState {
  selections: { label: string; mode: FilterMode }[];
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/headcount-growth.ts](account-search/headcount-growth.ts)

```ts
interface HeadcountGrowthState {
  min: number | null;
  max: number | null;
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/department-headcount.ts](account-search/department-headcount.ts)

```ts
interface DepartmentHeadcountDepartment {
  label: string;
  value: string;
}

interface DepartmentHeadcountSelection {
  label: string;
  department: string | null;
  min: number | null;
  max: number | null;
}

interface DepartmentHeadcountState {
  selection: DepartmentHeadcountSelection | null;
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/department-headcount-growth.ts](account-search/department-headcount-growth.ts)

```ts
interface DepartmentHeadcountGrowthDepartment {
  label: string;
  value: string;
}

interface DepartmentHeadcountGrowthSelection {
  label: string;
  department: string | null;
  min: number | null;
  max: number | null;
}

interface DepartmentHeadcountGrowthState {
  selection: DepartmentHeadcountGrowthSelection | null;
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/headquarters-location.ts](account-search/headquarters-location.ts)

```ts
interface HeadquartersLocationState {
  selections: FilterSelection[];
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/industry.ts](account-search/industry.ts)

```ts
interface IndustryState {
  selections: FilterSelection[];
  page: number | null;
  totalPages: number | null;
}
```

### [account-search/search_state.ts](account-search/search_state.ts)

```ts
interface AccountSearchState {
  headcount: AccountHeadcountState,
  annualRevenue: AnnualRevenueState,
  headcountGrowth: HeadcountGrowthState,
  departmentHeadcount: DepartmentHeadcountState,
  departmentHeadcountGrowth: DepartmentHeadcountGrowthState,
  headquartersLocation: HeadquartersLocationState,
  industry: IndustryState,
  keywords: string,
  page: number | null,
  totalPages: number | null,
}
```

### [profile/person/tools.ts](profile/person/tools.ts)

```ts
interface PersonExperience {
  title: string | null;
  company: string | null;
  dateRange: string | null;
  duration: string | null;
  location: string | null;
  description: string | null;
}

interface PersonProfile {
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
```

### [lsn-profile/account-profile.ts](lsn-profile/account-profile.ts)

```ts
interface AccountProfileSnapshot {
  website: string | null;
  location: string | null;
  revenue: string | null;
  employeeCount: string | null;
  accountIq: AccountIqSnapshot;
}
```

### [lsn-profile/account-iq.ts](lsn-profile/account-iq.ts)

```ts
type AccountIqSource =
  | {
    kind: "external";
    name: string;
    url: string;
  }
  | {
    kind: "linkedin";
    name: "LinkedIn";
  };

interface SourcedSection {
  sources: AccountIqSource[];
}

interface TitledInsight {
  title: string;
  description: string;
}

interface HowTheyMakeMoneySection extends SourcedSection {
  summary: string;
}

interface StrategicPrioritiesSection extends SourcedSection {
  priorities: TitledInsight[];
}

interface BusinessChallengesSection extends SourcedSection {
  challenges: TitledInsight[];
}

interface Competitor {
  name: string;
  industry: string | null;
  accountId: string | null;
  salesNavigatorUrl: string;
  logoUrl: string | null;
}

interface CompetitiveLandscapeSection extends SourcedSection {
  summary: string;
  competitors: Competitor[];
}

type HeadcountPeriod = "3m" | "1y";

interface HeadcountChange {
  period: HeadcountPeriod;
  percentChange: number;
}

interface DepartmentHeadcountGrowth {
  department: string;
  changes: HeadcountChange[];
}

interface HeadcountInsightsSection extends SourcedSection {
  insights: TitledInsight[];
  departmentGrowth: DepartmentHeadcountGrowth[];
  detailsUrl: string | null;
}

interface RelatedNewsItem {
  headline: string;
  publisher: string | null;
  url: string;
  thumbnailUrl: string | null;
}

interface RelatedNewsSection extends SourcedSection {
  articles: RelatedNewsItem[];
}

interface KeyPerson {
  name: string;
  role: string | null;
  connectionDegree: 1 | 2 | 3 | null;
  salesNavigatorUrl: string;
  imageUrl: string | null;
}

interface KeyPeopleSection extends SourcedSection {
  people: KeyPerson[];
  allExecutivesUrl: string | null;
}

interface ExecutiveVoiceAuthor {
  name: string;
  role: string | null;
  salesNavigatorUrl: string | null;
  imageUrl: string | null;
}

interface ExecutiveVoiceItem {
  author: ExecutiveVoiceAuthor;
  excerpt: string;
  postUrl: string;
}

interface ExecutiveVoicesSection extends SourcedSection {
  posts: ExecutiveVoiceItem[];
  allPostsUrl: string | null;
}

interface AccountIqSections {
  howTheyMakeMoney: HowTheyMakeMoneySection | null;
  strategicPriorities: StrategicPrioritiesSection | null;
  businessChallenges: BusinessChallengesSection | null;
  competitiveLandscape: CompetitiveLandscapeSection | null;
  headcountInsights: HeadcountInsightsSection | null;
  keyPeople: KeyPeopleSection | null;
  executiveVoices: ExecutiveVoicesSection | null;
  relatedNews: RelatedNewsSection | null;
}

interface AccountIqAccount {
  accountId: string | null;
  name: string | null;
  salesNavigatorUrl: string;
}

interface AccountIqSnapshot {
  account: AccountIqAccount;
  observedAt: string;
  sections: AccountIqSections;
}
```

### Additional types

```ts
type SectionLabel = "About" | "Activity" | "Experience" | "Education" | "Services" | "Featured" | "Licenses & certifications" | "Skills" | "Recommendations" | "Interests";
interface PersonProfileOpenResult {
  memberId: string;
  tabId: number;
  url: string;
  finalUrl: string;
}
```

`PersonProfileOpenResult` is a documentation name for the object returned by `handleOpenPersonProfile`; the source has no named interface for it.

## Internal messages

These are not command names in `COMMAND_ROUTES`:

- `profile.company.read`: content handler in [profile/company/tools.ts](profile/company/tools.ts); no arguments; returns `CompanyProfileInfo`, with the same fields as `ProfileInfo`. Sending it through the command router fails. Use `profile.readCompany`.
- `READ_LEAD_PROFILE`: Chrome message in [lsn-lead-profile-content.ts](lsn-lead-profile-content.ts); no arguments. Returns `{ ok: true; data: { firstName: string; lastName: string; title: string | undefined; company: string | undefined; linkedin: string | null } }`, or `{ ok: false; error: string }`.
- `SCRAPE_PROFILE`: Chrome message in [profile-content.ts](profile-content.ts); no arguments; returns `{ ok: true; data: Omit<ProfileInfo, "url" | "finalUrl"> }` or `{ ok: false; error: string }`.
- `CHECK_PROFILE`: legacy Chrome message in [background.ts](background.ts); takes `orgId` at the message root; returns `{ ok: true; data: ProfileInfo }` or `{ ok: false; error: string }`.
- Ping and invoke message names are transport messages, not additional commands.
