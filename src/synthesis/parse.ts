/**
 * @fileoverview Robust parsing of LLM completions into JSON objects.
 *
 * The model is unreliable, so parsing strips markdown fences and surrounding
 * prose before JSON-parsing. extractJsonObject / tryParseJsonObject are shared
 * primitives (the judge reuses them); parseCaseCompletion adds the caseId
 * requirement on top.
 */

import type { BenchmarkCase } from "../types.js";

export type ParseResult =
  | { ok: true; caseRecord: BenchmarkCase }
  | { ok: false; reason: string; raw: string };

/**
 * Strip markdown fences and surrounding prose, returning the outermost {...}
 * block (or the trimmed text when no braces are present).
 */
export function extractJsonObject(text: string): string {
  let value = text.trim();

  // ```json ... ``` or ``` ... ```
  const fenceMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    value = fenceMatch[1].trim();
  }

  // Isolate the outermost {...} block if prose still surrounds it.
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    value = value.slice(first, last + 1);
  }

  return value;
}

/**
 * Parse a completion into a plain object, tolerating fences/prose.
 * Returns null on any parse failure or non-object result.
 */
export function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const json: unknown = JSON.parse(extractJsonObject(text));
    if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
    return json as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parse a single LLM completion into a BenchmarkCase (requires a string caseId).
 */
export function parseCaseCompletion(text: string): ParseResult {
  const cleaned = extractJsonObject(text);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (error) {
    return { ok: false, reason: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`, raw: text };
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, reason: "Expected a JSON object at top level", raw: text };
  }

  const record = json as Record<string, unknown>;
  if (typeof record.caseId !== "string" || record.caseId.trim() === "") {
    return { ok: false, reason: "Missing or non-string caseId", raw: text };
  }

  return { ok: true, caseRecord: json as BenchmarkCase };
}
