import { isVisible, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";
import { postCardRoots, readSearchPostCards, type LinkedInPost } from "./posts.ts";

export interface LinkedInSearchState {
  keywords: string;
  resultType: "posts";
  url: string;
}

export interface LinkedInSearchResults extends LinkedInSearchState {
  count: number;
  posts: LinkedInPost[];
}

function postsSelected(): boolean {
  return location.pathname === "/search/results/content/" ||
    document.querySelector<HTMLInputElement>('input[aria-label="Filter by Posts"]')?.checked === true;
}

function emptyResults(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main [role='status']"))
    .some((el) => isVisible(el) && /^(no results|no posts|we couldn.t find any results)/i.test(el.textContent?.trim() ?? ""));
}

export async function runLinkedInSearchTool(msg: { command: string; args?: { limit?: unknown; keywords?: unknown } }): Promise<LinkedInSearchState | LinkedInSearchResults> {
  if (msg.command !== "linkedinSearch.readPosts" && msg.command !== "linkedinSearch.searchPosts") {
    throw new ToolError("BAD_ARGS", `Unknown LinkedIn search command: ${msg.command}`);
  }
  const limit = msg.args?.limit ?? 20;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ToolError("BAD_ARGS", "limit must be an integer from 1 to 100");
  }
  if (!location.pathname.startsWith("/search/results/")) {
    throw new ToolError("BAD_ARGS", "Open LinkedIn post search results first");
  }
  await waitFor(() => postsSelected(), 10_000, "Posts filter selection");
  await waitFor(() => postCardRoots(document.querySelector("main") ?? document).length > 0 || emptyResults(),
    10_000, "LinkedIn post results or an empty results message");
  const keywords = new URL(location.href).searchParams.get("keywords") ?? "";
  if (msg.command === "linkedinSearch.searchPosts" && keywords !== msg.args?.keywords) {
    throw new ToolError("INTERNAL", "Search keywords do not match the requested keywords");
  }
  const state: LinkedInSearchState = { keywords, resultType: "posts", url: location.href };
  if (msg.command === "linkedinSearch.searchPosts") return state;
  const posts = await readSearchPostCards(document.querySelector("main") ?? document, limit);
  return { ...state, count: posts.length, posts };
}
