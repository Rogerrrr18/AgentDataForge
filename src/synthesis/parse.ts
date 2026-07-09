/**
 * @fileoverview Robust parsing of an LLM completion into a BenchmarkCase.
 *
 * The model is unreliable, so parsing strips markdown fences and surrounding
 * prose, then validates the minimal structure (an object with a string caseId).
 * Field-level completeness is left to the schema profiler downstream.
 */

import type { BenchmarkCase } from "../types.js";

export type ParseResult =
  | { ok: true; caseRecord: BenchmarkCase }
  | { ok: false; reason: string; raw: string };

/**
 * Parse a single LLM completion into a BenchmarkCase.
 */
export function parseCaseCompletion(text: string): ParseResult {
  const cleaned = stripFencesAndProse(text);
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

function stripFencesAndProse(text: string): string {
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
