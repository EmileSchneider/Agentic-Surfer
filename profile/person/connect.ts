import { isVisible, realClick, waitFor } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

const CONNECT_SELECTOR =
  'a[href^="/preload/custom-invite/"][componentkey^="ConnectButtonstate:invitation:"]';

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

export async function clickConnectButton(memberId: string) {
  const button = findConnectButton();
  if (button) {
    realClick(button);
    return { memberId, clicked: true as const };
  }

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
  return { memberId, clicked: true as const };
}
