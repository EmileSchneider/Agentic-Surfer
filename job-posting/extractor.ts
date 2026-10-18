import { ToolError } from "../types.ts";

export interface JobPostingExtractor {
  extract(): Promise<string>;
}

export function linkedinJobUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ToolError("BAD_ARGS", "Invalid job posting URL");
  }
  if (url.protocol !== "https:" || !["www.linkedin.com", "linkedin.com"].includes(url.hostname)) {
    throw new ToolError("UNSUPPORTED_MODE", "Only LinkedIn job postings are supported");
  }
  const id = /^\/jobs\/view\/(\d+)\/?$/.exec(url.pathname)?.[1]
    ?? (/^\/jobs\/(search|search-results)\/?$/.test(url.pathname)
      ? url.searchParams.get("currentJobId") : null);
  if (!id || !/^\d+$/.test(id)) throw new ToolError("BAD_ARGS", "LinkedIn job ID not found in URL");
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

function markdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ").replace(/([\\`*_\[\]])/g, "\\$1");
  if (!(node instanceof HTMLElement)) return "";
  if (["SCRIPT", "STYLE", "BUTTON"].includes(node.tagName) || node.getAttribute("aria-hidden") === "true") return "";
  const text = Array.from(node.childNodes).map(markdown).join("");
  switch (node.tagName) {
    case "BR": return "\n";
    case "SPAN": {
      if (!text.trim()) return text;
      const bold = node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 700;
      const italic = node.style.fontStyle === "italic";
      const marker = `${bold ? "**" : ""}${italic ? "*" : ""}`;
      if (!marker) return text;
      return `${text.match(/^\s*/)?.[0] ?? ""}${marker}${text.trim()}${marker}${text.match(/\s*$/)?.[0] ?? ""}`;
    }
    case "STRONG": case "B":
    case "EM": case "I": {
      const marker = ["STRONG", "B"].includes(node.tagName) ? "**" : "*";
      return `${text.match(/^\s*/)?.[0] ?? ""}${marker}${text.trim()}${marker}${text.match(/\s*$/)?.[0] ?? ""}`;
    }
    case "A": return `[${text.trim()}](${(node as HTMLAnchorElement).href})`;
    case "UL": case "OL": return "\n\n" + Array.from(node.children).filter(el => el.tagName === "LI").map((el, i) => `${node.tagName === "OL" ? `${i + 1}.` : "-"} ${Array.from(el.childNodes).map(markdown).join("").trim().replace(/\n/g, "\n  ")}`).join("\n") + "\n\n";
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
      return `\n\n${"#".repeat(Number(node.tagName[1]))} ${text.trim()}\n\n`;
    case "P": case "DIV": return `\n\n${text.trim()}\n\n`;
    default: return text;
  }
}

export function jobPostingUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ToolError("BAD_ARGS", "Invalid job posting URL");
  }
  if (["linkedin.com", "www.linkedin.com"].includes(url.hostname)) return linkedinJobUrl(value);
  if (url.protocol === "https:" && url.hostname === "jobs.ashbyhq.com") {
    if (!/^\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname)) {
      throw new ToolError("BAD_ARGS", "Ashby job posting URL must contain a company and job ID");
    }
    url.hash = "";
    return url.href;
  }
  if (url.protocol === "https:" && url.hostname === "job-boards.greenhouse.io") {
    if (!/^\/[^/]+\/jobs\/\d+\/?$/.test(url.pathname)) {
      throw new ToolError("BAD_ARGS", "Greenhouse job posting URL must contain a company and job ID");
    }
    url.hash = "";
    return url.href;
  }
  if (url.protocol === "https:" && /^[^.]+\.bamboohr\.com$/.test(url.hostname)) {
    if (!/^\/careers\/\d+\/?$/.test(url.pathname)) {
      throw new ToolError("BAD_ARGS", "BambooHR job posting URL must contain a job ID");
    }
    url.hash = "";
    return url.href;
  }
  if (url.protocol === "https:" && url.hostname === "jobs.lever.co") {
    if (!/^\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname)) {
      throw new ToolError("BAD_ARGS", "Lever job posting URL must contain a company and job ID");
    }
    url.hash = "";
    return url.href;
  }
  if (url.protocol === "https:" && ["jobs.workable.com", "apply.workable.com"].includes(url.hostname)) {
    const validPath = url.hostname === "jobs.workable.com"
      ? /^\/view\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname)
      : /^\/[^/]+\/j\/[^/]+\/?$/.test(url.pathname);
    if (!validPath) {
      throw new ToolError("BAD_ARGS", "Workable job posting URL must contain a job ID");
    }
    url.hash = "";
    return url.href;
  }
  if (url.protocol === "https:" && ["indeed.com", "www.indeed.com"].includes(url.hostname)) {
    const id = /^\/viewjob\/?$/.test(url.pathname)
      ? url.searchParams.get("jk")
      : /^\/jobs\/?$/.test(url.pathname) ? url.searchParams.get("vjk") : null;
    if (!id || !/^[0-9a-f]{16}$/i.test(id)) {
      throw new ToolError("BAD_ARGS", "Indeed job ID not found in URL");
    }
    return `https://www.indeed.com/viewjob?jk=${id}`;
  }
  if (url.protocol !== "https:") {
    throw new ToolError("UNSUPPORTED_MODE", "Job posting URL must use HTTPS");
  }
  return url.href;
}

export class GenericJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const text = document.body?.innerText.trim();
      if (text) return text;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Page text not found");
  }
}

export class IndeedJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const description = document.querySelector(".simple-job-description-html, #jobDescriptionText");
      if (description?.textContent?.trim()) {
        return markdown(description).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Indeed job description not found");
  }
}

export class WorkableJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const description = document.querySelector('[data-ui="job-breakdown-description-parsed-html"]');
      if (description?.textContent?.trim()) {
        const content = document.querySelectorAll('[data-ui="job-breakdown-description-parsed-html"], [data-ui="job-breakdown-requirements-parsed-html"], [data-ui="job-breakdown-benefits-parsed-html"]');
        const sections = Array.from(new Set(Array.from(content, element => element.closest("section") ?? element)));
        return sections.map(markdown).join("\n\n")
          .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Workable job description not found");
  }
}

export class LeverJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const introduction = document.querySelector('.content [data-qa="job-description"]');
      if (introduction?.textContent?.trim()) {
        const sections = document.querySelectorAll(".content .section.page-centered:not(.posting-header):not(.last-section-apply)");
        return Array.from(sections).map(markdown).join("\n\n")
          .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Lever job description not found");
  }
}

export class BambooHrJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const description = document.querySelector(".BambooRichText");
      if (description?.textContent?.trim()) {
        return markdown(description).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "BambooHR job description not found");
  }
}

export class GreenhouseJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const description = document.querySelector(".job__description");
      if (description?.textContent?.trim()) {
        return markdown(description).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Greenhouse job description not found");
  }
}

export class AshbyJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const description = document.querySelector(".ashby-job-posting-description");
      if (description?.textContent?.trim()) {
        return markdown(description).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "Ashby job description not found");
  }
}

export class LinkedinJobPostingExtractor implements JobPostingExtractor {
  async extract(): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const heading = Array.from(document.querySelectorAll("h2")).find(el => el.textContent?.trim() === "About the job");
      let section: Element | null = heading?.parentElement ?? null;
      let description: Element | null = null;
      while (section && section !== document.body) {
        description = section.querySelector('[data-testid="expandable-text-box"]');
        if (description) break;
        section = section.parentElement;
      }
      if (description?.textContent?.trim()) {
        return markdown(description).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ToolError("NOT_FOUND", "LinkedIn About the job description not found");
  }
}

export function createJobPostingExtractor(url: string): JobPostingExtractor {
  const posting = new URL(jobPostingUrl(url));
  if (["indeed.com", "www.indeed.com"].includes(posting.hostname)) return new IndeedJobPostingExtractor();
  if (["jobs.workable.com", "apply.workable.com"].includes(posting.hostname)) return new WorkableJobPostingExtractor();
  if (posting.hostname === "jobs.lever.co") return new LeverJobPostingExtractor();
  if (posting.hostname === "jobs.ashbyhq.com") return new AshbyJobPostingExtractor();
  if (posting.hostname === "job-boards.greenhouse.io") return new GreenhouseJobPostingExtractor();
  if (posting.hostname.endsWith(".bamboohr.com")) return new BambooHrJobPostingExtractor();
  if (["linkedin.com", "www.linkedin.com"].includes(posting.hostname)) return new LinkedinJobPostingExtractor();
  return new GenericJobPostingExtractor();
}
