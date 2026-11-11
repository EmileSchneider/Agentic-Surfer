// Passed to chrome.scripting.executeScript in MAIN. Keep this function
// self-contained: imported helpers are not available in the page world.
export async function copyPostLink(cardKey: string): Promise<{ url?: string; error?: string }> {
  const resolve = async (): Promise<string> => {
    const card = Array.from(document.querySelectorAll<HTMLElement>('[componentkey^="update-card"]'))
      .find((el) => el.getAttribute("componentkey") === cardKey);
    if (!card) throw new Error("Post card disappeared before its link could be read");
    const menuButton = card.querySelector<HTMLButtonElement>('button[aria-label^="Open control menu for post by "]');
    if (!menuButton) throw new Error("Post control menu button not found");
    const visible = (el: HTMLElement) => el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden";
    const copyControls = () => Array.from(document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="button"], button, a',
    )).filter((el) => visible(el) && /^copy link(?: to (?:post|update))?$/i.test(
      (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim(),
    ));
    const oldControls = new Set(copyControls());
    let copied = "";
    const seen: string[] = [];
    const clipboard = navigator.clipboard;
    if (!clipboard) throw new Error("Clipboard API is unavailable for the post-link action");
    const writeTextDescriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
    const writeDescriptor = Object.getOwnPropertyDescriptor(clipboard, "write");
    let patchedText = false;
    let patchedWrite = false;
    const capture = (value: string) => {
      if (value) seen.push(value.slice(0, 120));
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") return;
        if (["www.linkedin.com", "linkedin.com"].includes(url.hostname) &&
          /^\/(feed\/update|posts)\//.test(url.pathname)) copied = url.href;
        // Search cards copy a short link; the background resolves it.
        else if (url.hostname === "lnkd.in" && /^\/p\/[\w-]+$/.test(url.pathname)) copied = url.href;
      } catch { /* A non-post clipboard value is not a post ID. */ }
  };
  // Legacy execCommand('copy') either copies a selection (often a hidden
  // textarea) or sets clipboardData in a page handler. clipboardData is only
  // readable during dispatch, so read everything synchronously.
  const onCopyCapture = () => {
    capture(document.getSelection()?.toString().trim() ?? "");
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      capture(field.value.trim());
    }
  };
  const onCopyBubble = (event: ClipboardEvent) => {
    capture(event.clipboardData?.getData("text/plain").trim() ?? "");
    event.preventDefault();
  };
  const restore = (name: "write" | "writeText", descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(clipboard, name, descriptor);
    else Reflect.deleteProperty(clipboard, name);
  };
  try {
    // Capture only the requested copy action, without reading or replacing
    // the user's system clipboard. Restore both methods in finally.
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      value: async (value: string) => { capture(value); },
    });
    patchedText = true;
    Object.defineProperty(clipboard, "write", {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        for (const item of items) {
          if (item.types.includes("text/plain")) capture(await (await item.getType("text/plain")).text());
        }
      },
    });
    patchedWrite = true;
    document.addEventListener("copy", onCopyCapture, true);
    window.addEventListener("copy", onCopyBubble);
    menuButton.click();
    const deadline = Date.now() + 5000;
    let control: HTMLElement | undefined;
    while (Date.now() < deadline) {
      control = copyControls().find((el) => !oldControls.has(el));
      if (control) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!control) throw new Error("Copy link to post action not found in the opened post menu");
    const href = control.closest<HTMLAnchorElement>("a[href]")?.href;
    if (href) capture(href);
    if (!copied) control.click();
    const copyDeadline = Date.now() + 3000;
    while (!copied && Date.now() < copyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!copied) {
      throw new Error("The post copy action did not supply a LinkedIn post URL" +
        (seen.length ? ` (saw: ${seen.join(" | ")})` : " (nothing was copied)"));
    }
    return copied;
  } finally {
    document.removeEventListener("copy", onCopyCapture, true);
    window.removeEventListener("copy", onCopyBubble);
    if (patchedWrite) restore("write", writeDescriptor);
    if (patchedText) restore("writeText", writeTextDescriptor);
    if (copyControls().some((el) => !oldControls.has(el))) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      if (copyControls().some((el) => !oldControls.has(el))) menuButton.click();
    }
  }
  };
  try { return { url: await resolve() }; }
  catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
