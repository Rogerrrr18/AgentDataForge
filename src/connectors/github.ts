/**
 * @fileoverview GitHub benchmark and dataset repository discovery connector.
 */

import type { DatasetCandidate, RiskLevel } from "../types.js";

type GitHubRepository = {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
  topics?: string[];
  stargazers_count?: number;
  language?: string | null;
  private?: boolean;
  visibility?: string;
  license?: { spdx_id?: string | null } | null;
};

type GitHubSearchResponse = {
  items?: GitHubRepository[];
};

/**
 * Search GitHub repositories for benchmark or dataset candidates.
 *
 * @param input Search options.
 * @returns Candidate records.
 */
export async function searchGitHubRepositories(input: {
  query: string;
  limit: number;
}): Promise<DatasetCandidate[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${input.query} benchmark dataset`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(input.limit));

  const response = await fetch(url, {
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GitHub search failed (${response.status})`);
  }
  const payload = (await response.json()) as GitHubSearchResponse;
  return (payload.items ?? []).map(mapRepository);
}

function mapRepository(repo: GitHubRepository): DatasetCandidate {
  const topics = (repo.topics ?? []).map((topic) => topic.toLowerCase());
  const text = `${repo.full_name} ${repo.description ?? ""} ${topics.join(" ")}`;
  const licenseName = repo.license?.spdx_id?.trim() || null;
  const risk = inferRisk(licenseName, Boolean(repo.private));
  return {
    id: String(repo.id),
    source: "github",
    recordKind: /\bbenchmark\b/i.test(text) ? "benchmark" : /\bdataset|corpus\b/i.test(text) ? "dataset" : "repository",
    title: repo.full_name,
    summary: repo.description ?? null,
    sourceUrl: repo.html_url,
    downloadUrl: `${repo.html_url}/archive/refs/heads/main.zip`,
    licenseName,
    languages: repo.language ? [repo.language.toLowerCase()] : [],
    taskTypes: inferTasks(text),
    modalities: inferModalities(text),
    domains: inferDomains(text),
    fileFormats: [],
    hasDownload: true,
    hasSamples: Boolean(repo.description),
    commercialRisk: risk,
    redistributionRisk: risk,
    rawPayload: repo,
    metadata: {
      topics,
      stars: repo.stargazers_count ?? 0,
      visibility: repo.visibility ?? null,
    },
  };
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-data-forge/0.1",
  };
  if (process.env.GITHUB_TOKEN?.trim()) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }
  return headers;
}

function inferRisk(licenseName: string | null, isPrivate: boolean): RiskLevel {
  if (isPrivate) return "restricted";
  if (!licenseName) return "unknown";
  if (/noncommercial|non-commercial|cc-by-nc|nc-/i.test(licenseName)) return "restricted";
  if (/mit|apache|bsd|cc0/i.test(licenseName)) return "low";
  if (/gpl|agpl|lgpl/i.test(licenseName)) return "medium";
  return "medium";
}

function inferTasks(text: string): string[] {
  const normalized = text.toLowerCase();
  const tasks = new Set<string>();
  if (/rag|retrieval|question answering|qa/.test(normalized)) tasks.add("rag_qa");
  if (/tool|agent|function call/.test(normalized)) tasks.add("tool_use");
  if (/code|swe|programming/.test(normalized)) tasks.add("code");
  if (/classification|label/.test(normalized)) tasks.add("classification");
  if (tasks.size === 0) tasks.add("benchmark");
  return [...tasks];
}

function inferModalities(text: string): string[] {
  const normalized = text.toLowerCase();
  const modalities = new Set<string>(["text"]);
  if (/image|vision/.test(normalized)) modalities.add("image");
  if (/audio|speech/.test(normalized)) modalities.add("audio");
  if (/video/.test(normalized)) modalities.add("video");
  return [...modalities];
}

function inferDomains(text: string): string[] {
  const normalized = text.toLowerCase();
  const domains = new Set<string>();
  if (/finance|bank|insurance/.test(normalized)) domains.add("finance");
  if (/medical|health|clinical/.test(normalized)) domains.add("healthcare");
  if (/legal|law|contract/.test(normalized)) domains.add("legal");
  if (/customer|support|complaint/.test(normalized)) domains.add("customer-service");
  if (/education|student|exam/.test(normalized)) domains.add("education");
  if (/code|software|swe/.test(normalized)) domains.add("software");
  if (domains.size === 0) domains.add("general");
  return [...domains];
}
