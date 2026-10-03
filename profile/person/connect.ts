import { isVisible, realClick, sleep, waitFor } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

const CONNECT_SELECTOR =
  'a[href^="/preload/custom-invite/"][componentkey^="ConnectButtonstate:invitation:"]';
const INTEROP_HOST_SELECTOR = '#interop-outlet[data-testid="interop-shadowdom"]';
const INVITE_DIALOG_SELECTOR =
  '[data-test-modal][role="dialog"][aria-labelledby="send-invite-modal"]';
const LOG = "[profile.person.connect]";
let lastModalEvidence = "";

function elementState(element: HTMLElement | null) {
  return element ? {
    tag: element.tagName,
    ariaLabel: element.getAttribute("aria-label"),
    text: element.innerText.trim(),
    visible: isVisible(element),
    disabled: element instanceof HTMLButtonElement && element.disabled,
    connected: element.isConnected,
  } : null;
}

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
  const modalRoot = document.querySelector<HTMLElement>(INTEROP_HOST_SELECTOR)
    ?.shadowRoot ?? null;
  const button = modalRoot?.querySelector<HTMLButtonElement>(
    `button[aria-label="${ariaLabel}"]`,
  ) ?? null;
  const dialog = button?.closest<HTMLElement>('[role="dialog"]') ??
    modalRoot?.querySelector<HTMLElement>(INVITE_DIALOG_SELECTOR) ?? null;
  const candidates = Array.from(
    modalRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  )
    .filter(isVisible)
    .map((item) => elementState(item))
    .filter((item) => /send|note|invite/i.test(
      `${item?.ariaLabel ?? ""} ${item?.text ?? ""}`,
    ));
  const evidence = {
    ariaLabel,
    dialog: elementState(dialog),
    button: elementState(button),
    candidates,
  };
  const serialized = JSON.stringify(evidence);
  if (serialized !== lastModalEvidence) {
    console.log(LOG, "modal evidence", serialized);
    lastModalEvidence = serialized;
  }
  return button && !button.disabled ? button : null;
}

async function waitForModalButton(ariaLabel: string): Promise<HTMLButtonElement> {
  console.log(LOG, "wait for modal button", { ariaLabel });
  try {
    await waitFor(() => findModalButton(ariaLabel) !== null, 3000, ariaLabel);
  } catch (error) {
    console.error(LOG, "modal button wait failed", error);
    throw new ToolError("NOT_FOUND", `${ariaLabel} button not found`);
  }
  const button = findModalButton(ariaLabel);
  if (!button) throw new ToolError("NOT_FOUND", `${ariaLabel} button not found`);
  console.log(LOG, "modal button ready", elementState(button));
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
  console.log(LOG, "start", { memberId, hasNote: note !== undefined });
  const button = findConnectButton();
  console.log(LOG, "direct connect lookup", elementState(button));
  if (button) {
    console.log(LOG, "click direct connect", elementState(button));
    realClick(button);
    console.log(LOG, "clicked direct connect");
  } else {
    const moreButton = findMoreButton();
    console.log(LOG, "more lookup", elementState(moreButton));
    if (!moreButton) throw new ToolError("NOT_FOUND", "More button not found");
    console.log(LOG, "click more");
    realClick(moreButton);

    try {
      await waitFor(() => readMenuConnectionState() !== null, 3000, "connection state");
    } catch {
      throw new ToolError("NOT_FOUND", "Connection state not found");
    }

    const state = readMenuConnectionState();
    console.log(LOG, "menu state", state?.kind ?? null);
    if (!state) throw new ToolError("NOT_FOUND", "Connection state not found");
    if (state.kind === "pending") {
      throw new ToolError("ALREADY_PENDING", "Connection request is pending");
    }
    if (state.kind === "connected") {
      throw new ToolError("ALREADY_CONNECTED", "Member is already connected");
    }
    console.log(LOG, "click menu connect", elementState(state.button));
    realClick(state.button);
  }

  if (note === undefined) {
    await waitForModalButton("Send without a note");
    await sleep(500);
    const sendButton = findModalButton("Send without a note");
    if (!sendButton) {
      throw new ToolError("NOT_FOUND", "Send without a note button disappeared");
    }
    console.log(LOG, "click send without note", elementState(sendButton));
    sendButton.click();
    console.log(LOG, "clicked send without note", {
      button: elementState(sendButton),
      dialog: elementState(document.querySelector(INVITE_DIALOG_SELECTOR)),
    });
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
