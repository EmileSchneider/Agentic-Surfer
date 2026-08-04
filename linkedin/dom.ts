export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  label = "condition"
): Promise<void> {

  if (predicate()) return;

  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };

    const check = () => {
      try {
	if (predicate()) finish();	
      } catch (e) {
	finish(e as Error);
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    const poll = setInterval(check, 300);
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${label}`)),
      timeoutMs
    );
    
  });  
}


export function realClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}


export function typeQuery(placeholder: string, query: string): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[role="combobox"][placeholder="${placeholder}"]`
  );
  if (!input) throw new Error(`Input not found: "${placeholder}"`);

  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  input.focus();

  // Clear any existing value first (keyboard-event style, same as below)
  nativeSetter?.call(input, "");
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));

  // Set the full query, wrapped in keyboard events so Ember's search fires
  const lastChar = query.slice(-1) || "a";
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: lastChar }));
  nativeSetter?.call(input, query);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: query }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: lastChar }));
}

export async function waitForInput(
  placeholder: string,
  timeoutMs = 4000
): Promise<HTMLInputElement> {
  let input: HTMLInputElement | null = null;
  await waitFor(
    () => {
      input = document.querySelector<HTMLInputElement>(
	`input[role="combobox"][placeholder="${placeholder}"]`
      );
      return input !== null;
    },
    timeoutMs,
    `input "${placeholder}"`
  );
  return input!;
}

function firstOptionUrn(): string | null {
  const el = document.querySelector<HTMLElement>(
    'fieldset[data-x-search-filter="CURRENT_COMPANY"] ul[role="listbox"] li[role="option"] [data-x-search-filter-typeahead-suggestion^="include-"]'
  );
  return el?.getAttribute("data-x-search-filter-typeahead-suggestion") ?? null;
}

export function waitForResultsChanged(prevFirst: string | null, timeoutMs = 4000): Promise<void> {
  return waitFor(
    () => {
      const current = firstOptionUrn();
      return current !== null && current !== prevFirst;
    },
    timeoutMs,
    "results to change"
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


export function isVisible(el: Element | null): boolean {
  return !!el && el.getClientRects().length > 0;
}
