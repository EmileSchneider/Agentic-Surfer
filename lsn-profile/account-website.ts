import { waitFor } from "../linkedin/dom.ts";
import { absoluteUrl } from "./dom.ts";

const ACCOUNT_WEBSITE_SELECTOR =
  'a[data-control-name="visit_company_website"][href]';

export async function readAccountWebsite(): Promise<string | null> {
  await waitFor(
    () => document.querySelector(ACCOUNT_WEBSITE_SELECTOR) !== null,
    15_000,
    "account website",
  );

  const anchor = document.querySelector<HTMLAnchorElement>(
    ACCOUNT_WEBSITE_SELECTOR,
  );

  return absoluteUrl(anchor?.getAttribute("href"));
}
