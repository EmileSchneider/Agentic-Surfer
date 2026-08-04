// extension/linkedin/keywords.ts
//
// Global keyword search bar — the free-text box at the top of the Sales Nav
// results page (#global-typeahead-search-input). NOT a FilterConfig filter:
// no fieldset, no pills, no include/exclude, no option codes. It is a setter
// over a single input, committed with Enter.
//
// The input shows an autocomplete dropdown of "Matching Leads & Accounts"
// while typing; that is IGNORED. Keyword search means: type text, press Enter,
// the results re-run against the keyword. We do not pick suggestions.
//
// Active keyword state lives in the input's value (and the URL's keywords
// param), not in any chip/pill — so readKeywords is just the input value.

import { sleep } from "./dom.ts";

const INPUT_ID = "global-typeahead-search-input";

function inputEl(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`#${INPUT_ID}`);
  if (!el) throw new Error("global keyword input not found");
  return el;
}

/**
 * Set a controlled <input>'s value in a way React/Ember will register.
 * Assigning .value directly is swallowed by the framework's synthetic event
 * system; we must call the native setter and then dispatch a bubbling input
 * event so the framework's onChange fires.
 */
function setControlledValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(el: HTMLInputElement): void {
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
}

/** Current active keyword text (empty string if none). */
export function readKeywords(): string {
  return inputEl().value.trim();
}

/** Type `text` into the keyword box and commit it with Enter. */
export async function setKeywords(
  text: string
): Promise<{ ok: true; keywords: string }> {
  const el = inputEl();
  el.focus();
  setControlledValue(el, text);
  // Let the dropdown settle so Enter commits the raw keyword rather than a
  // highlighted suggestion. (No suggestion is arrow-key-selected, so Enter
  // applies the typed text.)
  await sleep(150);
  pressEnter(el);
  await sleep(600); // results re-run settle, matches the filter drivers
  return { ok: true, keywords: text };
}

/** Clear the keyword box and commit the empty search. */
export async function clearKeywords(): Promise<{ ok: true }> {
  const el = inputEl();
  el.focus();
  setControlledValue(el, "");
  await sleep(150);
  pressEnter(el);
  await sleep(600);
  return { ok: true };
}
