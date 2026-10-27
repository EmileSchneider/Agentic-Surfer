import { waitFor } from "../../linkedin/dom.ts";
import { ToolError } from "../../types.ts";

export interface CompanyProfileInfo {
  name: string | null;
  industry: string | null;
  location: string | null;
  followers: string | null;
  employeeCount: string | null;
  tagline: string | null;
  url: string;
  finalUrl: string;
}

function text(selector: string): string | null {
  return document.querySelector(selector)?.textContent?.trim() ?? null;
}

async function waitForCompanyProfile(timeoutMs = 8000): Promise<void> {
  await waitFor(
    () => !!document.querySelector("h1.org-top-card-summary__title")?.textContent?.trim(),
    timeoutMs,
    "company profile render",
  );
}

function readCompanyProfile(): CompanyProfileInfo {
  const infoItems = Array.from(
    document.querySelectorAll(".org-top-card-summary-info-list__info-item"),
  ).map((el) => el.textContent?.trim() ?? "");

  const followers = infoItems.find((item) => /follower/i.test(item)) ?? null;
  const employeeCount = infoItems.find((item) => /employee/i.test(item)) ?? null;
  const industry =
    infoItems.find(
      (item) =>
        !/follower|employee/i.test(item) &&
        !/^[^,]+,\s*\w+$/.test(item),
    ) ??
    infoItems[0] ??
    null;
  const profileLocation =
    infoItems.find((item) => /^[^,]+,\s*\w+$/.test(item) && item !== industry) ??
    null;

  return {
    name: text("h1.org-top-card-summary__title"),
    tagline: text("p.org-top-card-summary__tagline"),
    industry,
    location: profileLocation,
    followers,
    employeeCount,
    url: location.href,
    finalUrl: location.href,
  };
}

export async function runProfileCompanyTool(msg: {
  command: string;
  args: any;
}): Promise<unknown> {
  switch (msg.command) {
    case "profile.company.read.urn": {
      const selector = 'a[href*="currentCompany="]';
      await waitFor(
        () => document.querySelector(selector) !== null,
        8000,
        "company employee search link",
      );
      const link = document.querySelector<HTMLAnchorElement>(selector)!;
      let ids: unknown;
      try {
        ids = JSON.parse(new URL(link.href).searchParams.get("currentCompany") ?? "null");
      } catch {
        throw new ToolError("INTERNAL", "Invalid company ID in employee search link");
      }
      if (
        !Array.isArray(ids) || ids.length !== 1 ||
        typeof ids[0] !== "string" || !/^\d+$/.test(ids[0])
      ) {
        throw new ToolError("INTERNAL", "Expected one numeric company ID in employee search link");
      }
      return { urn: `urn:li:organization:${ids[0]}` };
    }
    case "profile.company.read":
      await waitForCompanyProfile();
      return readCompanyProfile();
    default:
      throw new ToolError(
        "BAD_ARGS",
        `Unknown company profile tool: ${msg.command}`,
      );
  }
}
