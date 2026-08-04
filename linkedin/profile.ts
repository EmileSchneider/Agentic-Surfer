import { waitFor } from "./dom.ts";
import type { ProfileInfo } from "../types.ts";

export function scrapeProfile() {
  const text = (sel: string) =>
    document.querySelector(sel)?.textContent?.trim() ?? null;

  const infoItems = Array.from(
    document.querySelectorAll(".org-top-card-summary-info-list__info-item")
  ).map((el) => el.textContent?.trim() ?? "");

  const followers = infoItems.find((t) => /follower/i.test(t)) ?? null;
  const employeeCount = infoItems.find((t) => /employee/i.test(t)) ?? null;
  const industry =
    infoItems.find(
      (t) =>
        !/follower|employee/i.test(t) &&
        !/^[^,]+,\s*\w+$/.test(t)
    ) ??
    infoItems[0] ??
    null;
  const location =
    infoItems.find((t) => /^[^,]+,\s*\w+$/.test(t) && t !== industry) ?? null;

  return {
    name: text("h1.org-top-card-summary__title"),
    tagline: text("p.org-top-card-summary__tagline"),
    industry,
    location,
    followers,
    employeeCount,
  };
}

export function waitForProfile(timeoutMs = 8000): Promise<void> {
  return waitFor(
    () => !!document.querySelector("h1.org-top-card-summary__title")?.textContent?.trim(),
    timeoutMs,
    "profile render"
  );
}
