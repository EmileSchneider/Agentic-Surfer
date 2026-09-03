import { isVisible, realClick, waitFor } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

const CONNECT_SELECTOR =
  'a[href^="/preload/custom-invite/"][componentkey^="ConnectButtonstate:invitation:"]';
const INVITE_DIALOG_SELECTOR = '[data-test-modal][role="dialog"].send-invite';

export function findConnectButton(): HTMLAnchorElement | null {
  return Array.from(
    document.querySelectorAll<HTMLAnchorElement>(CONNECT_SELECTOR),
  ).find(isVisible) ?? null;
}

function controlText(element: HTMLElement): string {
  return (element.getAttribute("aria-label") ?? element.innerText)
    .replace(/\s+/g, " ")
    .trim();
}

function findMoreButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("main button"))
    .find((button) => isVisible(button) && controlText(button) === "More") ?? null;
}

function findModalButton(ariaLabel: string): HTMLButtonElement | null {
  const button = document.querySelector<HTMLButtonElement>(
    `${INVITE_DIALOG_SELECTOR} button[aria-label="${ariaLabel}"]`,
  );
  return button && isVisible(button) && !button.disabled ? button : null;
}

async function waitForModalButton(ariaLabel: string): Promise<HTMLButtonElement> {
  try {
    await waitFor(() => findModalButton(ariaLabel) !== null, 3000, ariaLabel);
  } catch {
    throw new ToolError("NOT_FOUND", `${ariaLabel} button not found`);
  }
  const button = findModalButton(ariaLabel);
  if (!button) throw new ToolError("NOT_FOUND", `${ariaLabel} button not found`);
  return button;
}

function setNote(textarea: HTMLTextAreaElement, note: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  textarea.focus();
  setter ? setter.call(textarea, note) : textarea.value = note;
  textarea.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: note,
    inputType: "insertText",
  }));
}

type MenuConnectionState =
  | { kind: "pending" }
  | { kind: "connected" }
  | { kind: "connect"; button: HTMLElement };

function readMenuConnectionState(): MenuConnectionState | null {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ).filter(isVisible);

  if (items.some((item) =>
    item.matches('[componentkey$="_pending"]') ||
    item.querySelector('[aria-label^="Pending, click to withdraw invitation"]')
  )) return { kind: "pending" };

  if (items.some((item) =>
    controlText(item) === "Remove connection" ||
    item.querySelector('[aria-label="Remove connection"]')
  )) return { kind: "connected" };

  const button = items.find((item) =>
    item.matches('[componentkey$="_connect"]') || controlText(item) === "Connect"
  );
  return button ? { kind: "connect", button } : null;
}

export async function clickConnectButton(memberId: string, note?: string) {
  const button = findConnectButton();
  if (button) {
    realClick(button);
  } else {
    const moreButton = findMoreButton();
    if (!moreButton) throw new ToolError("NOT_FOUND", "More button not found");
    realClick(moreButton);

    try {
      await waitFor(() => readMenuConnectionState() !== null, 3000, "connection state");
    } catch {
      throw new ToolError("NOT_FOUND", "Connection state not found");
    }

    const state = readMenuConnectionState();
    if (!state) throw new ToolError("NOT_FOUND", "Connection state not found");
    if (state.kind === "pending") {
      throw new ToolError("ALREADY_PENDING", "Connection request is pending");
    }
    if (state.kind === "connected") {
      throw new ToolError("ALREADY_CONNECTED", "Member is already connected");
    }
    realClick(state.button);
  }

  if (note === undefined) {
    realClick(await waitForModalButton("Send without a note"));
    return { memberId, sent: true as const };
  }

  realClick(await waitForModalButton("Add a note"));
  let textarea: HTMLTextAreaElement | null = null;
  try {
    await waitFor(() => {
      textarea = document.querySelector<HTMLTextAreaElement>(
        `${INVITE_DIALOG_SELECTOR} textarea#custom-message[name="message"]`,
      );
      return isVisible(textarea);
    }, 3000, "connection note field");
  } catch {
    throw new ToolError("NOT_FOUND", "Connection note field not found");
  }
  if (!textarea) throw new ToolError("NOT_FOUND", "Connection note field not found");
  setNote(textarea, note);
  realClick(await waitForModalButton("Send invitation"));
  return { memberId, sent: true as const };
}
