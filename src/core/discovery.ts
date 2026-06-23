/**
 * @fileoverview Unified discovery entrypoint.
 */

import { searchGitHubRepositories } from "../connectors/github.js";
import { searchHuggingFaceDatasets } from "../connectors/huggingface.js";
import type { DatasetCandidate, SourceKind } from "../types.js";
import { profileDatasetSchema } from "./schema-profiler.js";

/**
 * Discover dataset candidates and attach schema profile metadata.
 *
 * @param input Search query and source routing.
 * @returns Ranked candidates.
 */
export async function discoverCandidates(input: {
  query: string;
  source: Exclude<SourceKind, "manual"> | "all";
  limit: number;
}): Promise<Array<DatasetCandidate & { schemaCompleteness: number; readinessLevel: number }>> {
  const perSourceLimit = input.source === "all" ? Math.max(1, Math.ceil(input.limit / 2)) : input.limit;
  const batches: DatasetCandidate[][] = [];
  if (input.source === "all" || input.source === "huggingface") {
    batches.push(await runExpandedSearch(input.query, perSourceLimit, searchHuggingFaceDatasets));
  }
  if (input.source === "all" || input.source === "github") {
    batches.push(await runExpandedSearch(input.query, perSourceLimit, searchGitHubRepositories));
  }

  const deduped = new Map<string, DatasetCandidate>();
  for (const candidate of batches.flat()) {
    deduped.set(`${candidate.source}:${candidate.id}`, candidate);
  }

  return [...deduped.values()]
    .map((candidate) => {
      const profile = profileDatasetSchema({ candidate });
      return {
        ...candidate,
        schemaCompleteness: profile.completeness,
        readinessLevel: profile.readinessLevel,
      };
    })
    .sort((left, right) => right.readinessLevel - left.readinessLevel || right.schemaCompleteness - left.schemaCompleteness)
    .slice(0, input.limit);
}

/**
 * Run a source search with fallback query variants.
 *
 * @param query User query.
 * @param limit Desired result count.
 * @param search Source-specific search function.
 * @returns Deduplicated candidates.
 */
async function runExpandedSearch(
  query: string,
  limit: number,
  search: (input: { query: string; limit: number }) => Promise<DatasetCandidate[]>,
): Promise<DatasetCandidate[]> {
  const results = new Map<string, DatasetCandidate>();
  for (const queryVariant of buildQueryVariants(query)) {
    const batch = await search({ query: queryVariant, limit });
    for (const candidate of batch) {
      results.set(`${candidate.source}:${candidate.id}`, candidate);
    }
    if (results.size >= limit) break;
  }
  return [...results.values()].slice(0, limit);
}

/**
 * Build conservative search variants from a long natural-language query.
 *
 * @param query Raw user query.
 * @returns Ordered query variants.
 */
export function buildQueryVariants(query: string): string[] {
  const normalized = query.trim().replace(/\s+/g, " ");
  const stopwords = new Set(["agent", "benchmark", "dataset", "eval", "evaluation", "test", "testing"]);
  const tokens = normalized.split(" ").filter(Boolean);
  const stripped = tokens.filter((token) => !stopwords.has(token.toLowerCase())).join(" ");
  const firstTwo = tokens.slice(0, 2).join(" ");
  return [...new Set([normalized, stripped, firstTwo].map((item) => item.trim()).filter(Boolean))];
}
