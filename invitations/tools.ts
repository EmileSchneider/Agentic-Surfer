import { isVisible, realClick, sleep, waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";

const SCREEN_SELECTOR =
  '[data-sdui-screen="com.linkedin.sdui.flagshipnav.mynetwork.invitations.InvitationSentWithType"]';
const LIST_SELECTOR = `${SCREEN_SELECTOR} [data-testid="lazy-column"]`;
const ROW_SELECTOR = `${LIST_SELECTOR} [role="listitem"]`;
const WITHDRAW_SELECTOR = 'a[aria-label^="Withdraw invitation sent to "]';
const CONFIRM_SELECTOR =
  '[data-testid="dialog-content"] button[aria-label^="Withdraw invitation sent to "]';

function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function invitationRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

function isOldInvitation(row: HTMLElement): boolean {
  return Array.from(row.querySelectorAll("p, span")).some((element) =>
    /^Sent (?:a|one|[1-9]\d*) (?:month|months|year|years) ago$/.test(
      text(element),
    )
  );
}

function withdrawControl(row: HTMLElement): HTMLElement | null {
  const control = row.querySelector<HTMLElement>(WITHDRAW_SELECTOR);
  return isVisible(control) && control?.getAttribute("aria-disabled") !== "true"
    ? control
    : null;
}

function listSignature(): string {
  const rows = invitationRows();
  const last = rows.at(-1)?.querySelector(WITHDRAW_SELECTOR);
  return `${rows.length}:${last?.getAttribute("aria-label") ?? ""}`;
}

async function loadAllInvitations(): Promise<void> {
  await waitFor(
    () => document.querySelector(LIST_SELECTOR) !== null,
    10_000,
    "sent invitations list",
  );

  for (let round = 0; round < 100; round += 1) {
    const before = listSignature();
    invitationRows().at(-1)?.scrollIntoView({ block: "end" });
    window.scrollTo(0, document.documentElement.scrollHeight);
    try {
      await waitFor(() => listSignature() !== before, 2000, "more invitations");
    } catch {
      return;
    }
  }
  throw new ToolError("TIMEOUT", "Sent invitations did not finish loading");
}

function confirmationButton(label: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(CONFIRM_SELECTOR))
    .find((button) =>
      isVisible(button) && !button.disabled &&
      button.getAttribute("aria-label") === label
    ) ?? null;
}

async function withdraw(row: HTMLElement, control: HTMLElement): Promise<void> {
  const label = control.getAttribute("aria-label");
  if (!label) throw new ToolError("NOT_FOUND", "Withdraw label not found");
  realClick(control);
  await waitFor(() => confirmationButton(label) !== null, 3000, "withdraw dialog");
  await sleep(500);
  realClick(confirmationButton(label)!);
  await waitFor(
    () => !row.isConnected || row.querySelector(WITHDRAW_SELECTOR) === null,
    5000,
    "withdrawn invitation removal",
  );
  await sleep(500);
}

export async function withdrawOldInvitations() {
  await loadAllInvitations();
  const scanned = invitationRows().length;
  const eligible = invitationRows().filter((row) =>
    isOldInvitation(row) && withdrawControl(row) !== null
  ).length;
  let withdrawn = 0;

  while (true) {
    const row = invitationRows().find((item) =>
      isOldInvitation(item) && withdrawControl(item) !== null
    );
    if (!row) break;
    await withdraw(row, withdrawControl(row)!);
    withdrawn += 1;
  }
  return { scanned, eligible, withdrawn };
}

export async function runInvitationsTool(command: string) {
  if (command === "invitations.withdrawOld") return await withdrawOldInvitations();
  throw new ToolError("BAD_ARGS", `Unknown invitations tool: ${command}`);
}
