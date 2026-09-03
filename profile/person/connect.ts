import { isVisible, realClick } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

const CONNECT_SELECTOR =
  'a[href^="/preload/custom-invite/"][componentkey^="ConnectButtonstate:invitation:"]';

export function findConnectButton(): HTMLAnchorElement | null {
  return Array.from(
    document.querySelectorAll<HTMLAnchorElement>(CONNECT_SELECTOR),
  ).find(isVisible) ?? null;
}

export function clickConnectButton(memberId: string) {
  const button = findConnectButton();
  if (!button) throw new ToolError("NOT_FOUND", "Connect button not found");
  realClick(button);
  return { memberId, clicked: true as const };
}
