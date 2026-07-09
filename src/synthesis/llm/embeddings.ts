/**
 * @fileoverview Embedding client for semantic (near-)duplicate detection.
 *
 * Optional capability (M3): cosine-similarity dedupe needs an embedding model.
 * Configured via LLM_EMBED_MODEL (falls back to LLM_MODEL) over the same
 * OpenAI-compatible /embeddings endpoint. Pure helpers (cosineSimilarity) are
 * exported separately so they can be unit-tested without any network.
 */

import { fetchWithRetry } from "../../connectors/http.js";

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export type EmbeddingClient = {
  readonly model: string;
  embed(input: string | string[]): Promise<number[][]>;
};

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

/**
 * Create an embedding client against an OpenAI-compatible /embeddings endpoint.
 */
export function createEmbeddingClient(config: EmbeddingConfig): EmbeddingClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 60000;

  return {
    model: config.model,
    async embed(input: string | string[]): Promise<number[][]> {
      const texts = Array.isArray(input) ? input : [input];
      if (texts.length === 0) return [];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL(`${baseUrl}/embeddings`);
        const response = await fetchWithRetry(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model: config.model, input: texts }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 300)}`);
        }

        const data = (await response.json()) as EmbeddingResponse;
        const vectors = (data.data ?? [])
          .map((item) => item.embedding ?? [])
          .filter((vector) => vector.length > 0);
        if (vectors.length !== texts.length) {
          throw new Error(`Embedding count mismatch: expected ${texts.length}, got ${vectors.length}`);
        }
        return vectors;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 for empty or
 * mismatched lengths (never throws).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
