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

function findMenuConnectButton(): HTMLElement | null {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ).find((item) => isVisible(item) && controlText(item) === "Connect") ?? null;
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
    await waitFor(() => findMenuConnectButton() !== null, 3000, "Connect menu item");
  } catch {
    throw new ToolError("NOT_FOUND", "Connect menu item not found");
  }

  const menuConnectButton = findMenuConnectButton();
  if (!menuConnectButton) {
    throw new ToolError("NOT_FOUND", "Connect menu item not found");
  }
  realClick(menuConnectButton);
  return { memberId, clicked: true as const };
}
