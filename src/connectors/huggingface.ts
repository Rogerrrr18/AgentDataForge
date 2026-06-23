/**
 * @fileoverview Hugging Face dataset discovery connector.
 */

import type { DatasetCandidate, RiskLevel } from "../types.js";

type HuggingFaceDataset = {
  id: string;
  author?: string;
  gated?: boolean;
  private?: boolean;
  disabled?: boolean;
  createdAt?: string;
  lastModified?: string;
  likes?: number;
  downloads?: number;
  description?: string;
  tags?: string[];
};

/**
 * Search Hugging Face datasets and normalize metadata into AgentDataForge candidates.
 *
 * @param input Search options.
 * @returns Candidate records.
 */
export async function searchHuggingFaceDatasets(input: {
  query: string;
  limit: number;
}): Promise<DatasetCandidate[]> {
  const url = new URL("https://huggingface.co/api/datasets");
  url.searchParams.set("search", input.query);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");

  const response = await fetch(url, {
    headers: { "User-Agent": "agent-data-forge/0.1" },
  });
  if (!response.ok) {
    throw new Error(`Hugging Face search failed (${response.status})`);
  }
  const items = (await response.json()) as HuggingFaceDataset[];
  return items.filter((item) => item.id && !item.disabled).map(mapHuggingFaceDataset);
}

function mapHuggingFaceDataset(item: HuggingFaceDataset): DatasetCandidate {
  const tags = item.tags ?? [];
  const licenseName = firstTagValue(tags, "license:");
  const risk = inferRisk(licenseName, Boolean(item.gated));
  return {
    id: item.id,
    source: "huggingface",
    recordKind: tags.includes("benchmark") ? "benchmark" : "dataset",
    title: item.id,
    summary: item.description ?? null,
    sourceUrl: `https://huggingface.co/datasets/${item.id}`,
    downloadUrl: `https://huggingface.co/datasets/${item.id}/resolve/main/README.md`,
    licenseName,
    languages: tagValues(tags, "language:"),
    taskTypes: [...tagValues(tags, "task_categories:"), ...(tags.includes("benchmark") ? ["benchmark"] : [])],
    modalities: tagValues(tags, "modality:"),
    domains: inferDomains(`${item.id} ${item.description ?? ""} ${tags.join(" ")}`),
    fileFormats: tagValues(tags, "format:"),
    hasDownload: Boolean(item.downloads && item.downloads > 0),
    hasSamples: Boolean(item.description),
    commercialRisk: risk,
    redistributionRisk: risk,
    rawPayload: item,
    metadata: {
      author: item.author ?? null,
      likes: item.likes ?? 0,
      downloads: item.downloads ?? 0,
      createdAt: item.createdAt ?? null,
      lastModified: item.lastModified ?? null,
    },
  };
}

function tagValues(tags: string[], prefix: string): string[] {
  return tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length)).filter(Boolean);
}

function firstTagValue(tags: string[], prefix: string): string | null {
  return tagValues(tags, prefix)[0] ?? null;
}

function inferRisk(licenseName: string | null, gated: boolean): RiskLevel {
  if (gated) return "restricted";
  if (!licenseName) return "unknown";
  if (/noncommercial|non-commercial|cc-by-nc|nc-/i.test(licenseName)) return "restricted";
  if (/mit|apache|bsd|cc-by|cc0/i.test(licenseName)) return "low";
  if (/gpl|agpl|cc-by-sa|cc-by-nc/i.test(licenseName)) return "medium";
  return "medium";
}

function inferDomains(text: string): string[] {
  const normalized = text.toLowerCase();
  const domains = new Set<string>();
  if (/finance|financial|bank|insurance|claim/.test(normalized)) domains.add("finance");
  if (/medical|health|clinical|patient/.test(normalized)) domains.add("healthcare");
  if (/legal|law|contract/.test(normalized)) domains.add("legal");
  if (/support|customer|complaint|refund/.test(normalized)) domains.add("customer-service");
  if (/education|exam|student|tutor/.test(normalized)) domains.add("education");
  if (/code|software|github|repository/.test(normalized)) domains.add("software");
  if (domains.size === 0) domains.add("general");
  return [...domains];
}
