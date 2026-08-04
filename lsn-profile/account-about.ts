import { prepareAccountAboutRoot } from "./dom.ts";

function cleanDescription(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const paragraphs = value
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const cleaned = paragraphs.join("\n\n");
  return cleaned || null;
}

export async function readAccountAbout(): Promise<string | null> {
  const root = await prepareAccountAboutRoot();
  const blurb = root.querySelector<HTMLElement>(
    '[data-anonymize="company-blurb"]',
  );

  return cleanDescription(
    blurb?.getAttribute("title") ?? blurb?.textContent,
  );
}
