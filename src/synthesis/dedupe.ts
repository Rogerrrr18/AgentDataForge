/**
 * @fileoverview Near-duplicate detection for synthesized cases.
 *
 * Two strategies:
 *  - dedupeCases: token-set Jaccard similarity over JSON text (no network).
 *  - dedupeCasesByEmbedding: cosine similarity over precomputed embedding
 *    vectors (semantic; needs an embedding model, M3).
 *
 * Both keep the first occurrence of each cluster and are O(n^2), which is fine
 * for typical batch sizes (a few hundred).
 */

import type { BenchmarkCase } from "../types.js";
import { cosineSimilarity } from "./llm/embeddings.js";

export const DEFAULT_DEDUPE_THRESHOLD = 0.85;
export const DEFAULT_EMBEDDING_THRESHOLD = 0.92;

/**
 * Remove near-duplicate cases by Jaccard similarity, keeping the first of each.
 *
 * @param cases Generated cases.
 * @param threshold Jaccard similarity at or above which two cases are duplicates.
 */
export function dedupeCases(cases: BenchmarkCase[], threshold: number = DEFAULT_DEDUPE_THRESHOLD): BenchmarkCase[] {
  const kept: BenchmarkCase[] = [];
  const keptTokenSets: Set<string>[] = [];

  for (const caseRecord of cases) {
    const tokens = tokenize(JSON.stringify(caseRecord));
    const isDuplicate = keptTokenSets.some((existing) => jaccard(tokens, existing) >= threshold);
    if (!isDuplicate) {
      kept.push(caseRecord);
      keptTokenSets.push(tokens);
    }
  }

  return kept;
}

export function jaccardSimilarity(a: BenchmarkCase, b: BenchmarkCase): number {
  return jaccard(tokenize(JSON.stringify(a)), tokenize(JSON.stringify(b)));
}

/**
 * Remove near-duplicate cases using precomputed embedding vectors and cosine
 * similarity (semantic dedupe). Requires one vector per case, in order.
 */
export function dedupeCasesByEmbedding(
  cases: BenchmarkCase[],
  vectors: number[][],
  threshold: number = DEFAULT_EMBEDDING_THRESHOLD,
): BenchmarkCase[] {
  if (cases.length !== vectors.length) {
    throw new Error(`embedding/vector length mismatch: ${cases.length} cases vs ${vectors.length} vectors`);
  }
  const keptIndices: number[] = [];
  for (let i = 0; i < cases.length; i += 1) {
    const isDuplicate = keptIndices.some((k) => cosineSimilarity(vectors[i], vectors[k]) >= threshold);
    if (!isDuplicate) keptIndices.push(i);
  }
  return keptIndices.map((i) => cases[i]);
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}
