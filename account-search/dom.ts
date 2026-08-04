import { waitFor } from "../linkedin/dom.ts";
import { ToolError } from "../types.ts";

export async function waitForAccountFilterFieldset(
  fieldsetKey: string,
  label: string,
  timeoutMs = 4000,
): Promise<HTMLElement> {
  await waitFor(
    () =>
      document.querySelector(
        `fieldset[data-x-search-filter="${fieldsetKey}"]`,
      ) !== null,
    timeoutMs,
    `${label} fieldset`,
  );

  const el = document.querySelector<HTMLElement>(
    `fieldset[data-x-search-filter="${fieldsetKey}"]`,
  );
  if (!el) throw new ToolError("NOT_FOUND", `${label} fieldset not found`);
  return el;
}
