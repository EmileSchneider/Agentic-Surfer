import type { LeadResult } from "./linkedin/results.ts";
import type { AccountIqSnapshot } from "./lsn-profile/account-iq.ts";

export type Brand<T, B extends string> = T & { readonly __brand: B };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
};

export type Err<E = Error> = {
  readonly ok: false;
  readonly error: E;
};

export const Ok = <T>(value: T): Ok<T> => ({
  ok: true,
  value,
});

export const Err = <E = Error>(error: E): Err<E> => ({
  ok: false,
  error,
});


export type FilterMode = "include" | "exclude";

export const FILTER_NAMES = [
  "seniority",
  "headcount",
  "jobTitle",
  "industry",
  "function",
  "geography",
  "company"
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];

export interface FilterOption {
  label: string;
  code: string;
}

export interface FilterSelection {
  label: string;
  mode: FilterMode;
}

// ---------------------------------------------------------------- state

/**
 * The full current search state. EVERY mutation returns this, so the agent
 * always knows "THIS is what's currently filtering" without a follow-up read.
 */


export interface SearchState {
  filters: Record<FilterName, FilterSelection[]>;
  keywords: string;
  page: number | null;
  totalPages: number | null;
}

export interface ResultsPage {
  count: number;
  page: number | null;
  totalPages: number | null;
  leads: LeadResult[]
}

export interface ProfileInfo {
  name: string | null;
  industry: string | null;
  location: string | null;
  followers: string | null;
  employeeCount: string | null;
  tagline: string | null;
  url: string;
  finalUrl: string;
}

// ---------------------------------------------------------------- errors
/**
 * Closed set of error codes. Python routes on these:
 * NOT_FOUND / TIMEOUT / UNSUPPORTED_MODE / BAD_ARGS -> ModelRetry (agent can
   correct: re-search, pick another candidate, drop the exclude)
 * INTERNAL -> crash louadly (agent cannot fix the dom / the extension)
 */

export type ToolErrorCode =
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNSUPPORTED_MODE"
  | "BAD_ARGS"
  | "INTERNAL";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ToolError"
  }
}
export interface CompanyResult {
  name: string;
  urn: string;        // full urn, e.g. "urn:li:organization:277579"
  orgId: string;      // just the numeric id, "277579" — useful for URLs
}

 
// ---------------------------------------------------------------- commands
 
export type AgentCommand =
  // reads
  | { command: "getSearchState"; args: Record<never, never> }
  | { command: "listFilterOptions"; args: { filter: FilterName } }
  | { command: "searchFilterOptions"; args: { filter: FilterName; query: string } }
  | { command: "readResults"; args: { limit?: number } }
  // mutations (all return SearchState)
  | { command: "selectFilterOption"; args: { filter: FilterName; code: string; mode?: FilterMode } }
  | { command: "removeFilterSelection"; args: { filter: FilterName; label: string } }
  | { command: "clearFilter"; args: { filter: FilterName } }
  | { command: "setKeywords"; args: { text: string } }
  | { command: "clearKeywords"; args: Record<never, never> }
  | { command: "nextPage"; args: Record<never, never> }
  // specific
  | { command: "checkLinkedinProfile"; args: { urn: string } };

export type AccountIqCommand = {
  command: "accountIq.read";
  args: { accountId: string };
};

export type AccountAboutCommand = {
  command: "accountAbout.read";
  args: { accountId: string };
};

export type ExtensionCommand =
  | AgentCommand
  | AccountAboutCommand
  | AccountIqCommand;
export type CommandName = ExtensionCommand["command"];
 
// Map each command name to its result type, so the dispatcher is typed
// end-to-end (args in, correct result out).
export interface CommandResultMap {
  getSearchState: SearchState;
  listFilterOptions: FilterOption[];
  searchFilterOptions: FilterOption[];
  readResults: ResultsPage;
  selectFilterOption: SearchState;
  removeFilterSelection: SearchState;
  clearFilter: SearchState;
  setKeywords: SearchState;
  clearKeywords: SearchState;
  nextPage: SearchState;
  checkLinkedinProfile: ProfileInfo;
  "accountAbout.read": string | null;
  "accountIq.read": AccountIqSnapshot;
}
 
// ---------------------------------------------------------------- wire
 
export interface CommandRequest {
  id: string;
  command: CommandName;
  args: Record<string, unknown>;
}
 
export type CommandReply =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: ToolErrorCode; message: string } };
 


// ---------------------------------------------------------------- auth

export type AuthMessage = {
  token: string;
  clientId: string;
}
