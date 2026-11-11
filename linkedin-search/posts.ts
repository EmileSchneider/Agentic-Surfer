import { ToolError } from "../types.ts";
import { sleep, waitFor } from "../linkedin/dom.ts";

export interface LinkedInPost {
  post_urn: string;
  url: string;
  text: string | null;
  authorName: string | null;
  authorProfileUrl: string | null;
  authorHeadline: string | null;
  ageText: string | null;
  isRepost: boolean;
  reactionCount: number | null;
  commentCount: number | null;
}

function clean(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function count(value: string | null | undefined): number | null {
  const match = clean(value)?.match(/^(\d[\d,]*(?:\.\d+)?)\s*([KM])?(?:\s|$)/i);
  if (!match) return null;
  const scale = match[2]?.toLowerCase() === "k" ? 1000
    : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(Number(match[1]!.replace(/,/g, "")) * scale);
}

type PostReference = { post_urn: string; url: string };
const resolvedLinks = new WeakMap<HTMLElement, { key: string | null; ref: PostReference }>();

export function postCardRoots(root: ParentNode): HTMLElement[] {
  const cards = Array.from(root.querySelectorAll<HTMLElement>(
    '[componentkey^="update-card"], .feed-shared-update-v2, [data-testid="carousel-child-container"]',
  ));
  // A carousel wrapper can contain an update card. Read each post once.
  return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
}

function postReference(value: string | null | undefined): PostReference | null {
  if (!value) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  let urn = decoded.match(/^urn:li:(?:activity|ugcPost|share):\d+$/)?.[0];
  if (!urn) {
    let url: URL;
    try { url = new URL(decoded); } catch { return null; }
    if (url.protocol !== "https:" || !["www.linkedin.com", "linkedin.com"].includes(url.hostname)) return null;
    urn = url.pathname.match(/^\/feed\/update\/(urn:li:(?:activity|ugcPost|share):\d+)\/?$/)?.[1];
    const slug = url.pathname.startsWith("/posts/")
      ? url.pathname.match(/(?:_|-)(activity|ugcPost|share)-(\d+)(?:-|\/|$)/) : undefined;
    if (!urn && slug) urn = `urn:li:${slug[1]}:${slug[2]}`;
  }
  return urn ? { post_urn: urn, url: `https://www.linkedin.com/feed/update/${urn}/` } : null;
}

function cardReference(card: HTMLElement): PostReference | null {
  for (const link of card.querySelectorAll<HTMLAnchorElement>('a[href*="/feed/update/"], a[href*="/posts/"]')) {
    const ref = postReference(link.href);
    if (ref) return ref;
  }
  const cached = resolvedLinks.get(card);
  return postReference(card.getAttribute("data-urn")) ??
    (cached?.key === card.getAttribute("componentkey") ? cached.ref : null);
}

export async function readSearchPostCards(root: ParentNode, limit: number): Promise<LinkedInPost[]> {
  const posts = new Map<string, LinkedInPost>();
  const processed = new Set<string | HTMLElement>();
  const identity = (card: HTMLElement) => card.getAttribute("componentkey") ??
    card.getAttribute("data-urn") ?? card;
  const nextCard = () => postCardRoots(root).find((card) => !processed.has(identity(card)));
  let scrolls = 0;
  let idleScrolls = 0;
  let lastSkip: unknown;
  // Rescan after every read: LinkedIn can remove or recycle cards on scroll.
  // Keep extracted posts in the map even after their DOM nodes disappear.
  for (let attempts = 0; attempts < 300 && posts.size < limit; attempts++) {
    const card = nextCard();
    if (!card) {
      if (idleScrolls >= 3 || scrolls >= 50) break;
      const last = postCardRoots(root).at(-1);
      if (!last) break;
      last.scrollIntoView({ block: "end" });
      let scroller = last.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight &&
        /auto|scroll|overlay/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement;
      }
      if (scroller) scroller.scrollBy({ top: Math.max(360, scroller.clientHeight * 0.8), behavior: "instant" });
      else window.scrollBy({ top: Math.max(360, window.innerHeight * 0.8), behavior: "instant" });
      scrolls++;
      // Same scroll-and-wait mechanism as the lead/account readers.
      await waitFor(() => nextCard() !== undefined, 2500, "more LinkedIn post cards").catch(() => {});
      idleScrolls = nextCard() ? 0 : idleScrolls + 1;
      continue;
    }
    const key = identity(card);
    card.scrollIntoView({ block: "center" });
    await sleep(120);
    if (!card.isConnected || identity(card) !== key) continue;
    // One unreadable card (ad, suggestion block, broken link) is skipped, not
    // fatal: the batch keeps going and only fails if nothing is readable.
    try {
      await waitFor(() => cardReference(card) !== null ||
        card.querySelector('button[aria-label^="Open control menu for post by "]') !== null,
        5000, "post card hydration");
      if (!cardReference(card)) {
        const cardKey = card.getAttribute("componentkey");
        if (!cardKey?.startsWith("update-card")) {
          throw new ToolError("NOT_FOUND", "Post has no permalink or supported post menu");
        }
        const reply = await chrome.runtime.sendMessage({ type: "READ_LINKEDIN_POST_LINK", cardKey });
        if (!card.isConnected || identity(card) !== key) continue;
        const ref = reply?.ok ? postReference(reply.url) : null;
        if (!ref) {
          const author = card.querySelector('button[aria-label^="Open control menu for post by "]')?.getAttribute("aria-label");
          throw new ToolError("NOT_FOUND", `${author ?? "Post"}: ${reply?.error ?? "Copied link contains no recognized post URN"}`);
        }
        resolvedLinks.set(card, { key: cardKey, ref });
      }
    } catch (error) {
      lastSkip = error;
      processed.add(key);
      continue;
    }
    const post = extractPost(card);
    if (post) posts.set(post.post_urn, post);
    processed.add(key);
    idleScrolls = 0;
  }
  if (posts.size === 0 && lastSkip) throw lastSkip;
  return Array.from(posts.values());
}

function readAuthorHeadline(card: HTMLElement, authorLink: HTMLAnchorElement | null | undefined, age: HTMLParagraphElement | undefined): string | null {
  const legacy = clean(card.querySelector('.update-components-actor__description [aria-hidden="true"]')?.textContent);
  if (legacy) return legacy;
  if (!authorLink || !age) return null;
  // SDUI places the headline between the name link and age in their nearest
  // common author block. Exclude linked names, badges and website CTAs.
  let header = age.parentElement;
  while (header && header !== card) {
    if (header.contains(authorLink)) {
      const headline = Array.from(header.querySelectorAll("p")).find((p) =>
        p !== age && !p.closest("a") && !p.querySelector("a") &&
        Boolean(p.compareDocumentPosition(age) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(authorLink.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        clean(p.textContent) !== null);
      return clean(headline?.textContent);
    }
    header = header.parentElement;
  }
  return null;
}

export function readPostCards(root: ParentNode): LinkedInPost[] {
  const posts = new Map<string, LinkedInPost>();
  for (const card of postCardRoots(root)) {
    const post = extractPost(card);
    if (post) posts.set(post.post_urn, post);
  }
  return Array.from(posts.values());
}

function extractPost(card: HTMLElement): LinkedInPost | null {
  const ref = cardReference(card);
  if (!ref) return null;

  const box = card.querySelector(
    '[data-testid="expandable-text-box"], .update-components-text',
  )?.cloneNode(true) as HTMLElement | undefined;
  box?.querySelectorAll('[data-testid="expandable-text-button"], .inline-show-more-text__button')
    .forEach((button) => button.remove());
  box?.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const authorLabel = card.querySelector(
    'button[aria-label^="Open control menu for post by "]',
  )?.getAttribute("aria-label");
  const authorName = clean(authorLabel?.slice("Open control menu for post by ".length))
    ?? clean(card.querySelector('.update-components-actor__name [aria-hidden="true"]')?.textContent);
  const authorLink = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"], a[href*="/company/"]'))
    .find((a) => clean(a.querySelector("p")?.textContent) === authorName)
    ?? card.querySelector<HTMLAnchorElement>('a.update-components-actor__meta[href*="/in/"]');
  const paragraphs = Array.from(card.querySelectorAll("p"));
  const age = paragraphs.find((p) => p.querySelector('[aria-label^="Visibility:"]'));
  const reactionText = Array.from(card.querySelectorAll("[aria-label], div"))
    .map((el) => el.getAttribute("aria-label") ?? clean(el.textContent))
    .find((value) => /^\d[\d,.]*\s*[KM]?\s+reactions?$/i.test(value ?? ""));
  const comments = card.querySelector('[aria-label="Comment"]')?.textContent
    ?? Array.from(card.querySelectorAll("button, a"))
      .map((el) => clean(el.textContent))
      .find((value) => /^\d[\d,.]*\s*[KM]?\s+comments?$/i.test(value ?? ""));
  return {
    ...ref,
    text: box?.textContent?.replace(/[^\S\n]+/g, " ").trim() || null,
    authorName,
    authorProfileUrl: authorLink ? authorLink.href.split("?")[0]! : null,
    authorHeadline: readAuthorHeadline(card, authorLink, age),
    ageText: clean((age?.textContent
      ?? card.querySelector('.update-components-actor__sub-description [aria-hidden="true"]')?.textContent)?.split("•")[0]),
    isRepost: paragraphs.some((p) => !p.querySelector('[data-testid="expandable-text-box"]') &&
      /\breposted this\s*$/.test(p.textContent ?? "")) ||
      /\breposted\b/i.test(card.querySelector('.update-components-header')?.textContent ?? ""),
    reactionCount: count(reactionText),
    commentCount: count(comments),
  };
}
