import { type AccountIqSnapshot, readAccountIq } from "./account-iq.ts";
import { absoluteUrl, elementText, prepareAccountProfileRoot } from "./dom.ts";

export interface AccountProfileSnapshot {
  website: string | null;
  location: string | null;
  revenue: string | null;
  employeeCount: string | null;
  accountIq: AccountIqSnapshot;
}

export async function readAccountProfile(): Promise<AccountProfileSnapshot> {
  const header = await prepareAccountProfileRoot();

  const websiteAnchor = header.querySelector<HTMLAnchorElement>(
    'a[data-control-name="visit_company_website"][href]',
  );
  const website = absoluteUrl(websiteAnchor?.getAttribute("href"));
  const location = elementText(
    header.querySelector('[data-anonymize="location"]'),
  );
  const revenue = elementText(
    header.querySelector('[data-anonymize="revenue"]'),
  );
  const employeeCount = elementText(
    header.querySelector('[data-anonymize="company-size"]'),
  );

  const accountIq = await readAccountIq();
  return { website, location, revenue, employeeCount, accountIq };
}
