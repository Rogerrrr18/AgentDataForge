/**
 * @fileoverview Closed-loop enrichment: read a manifest's missing fields and
 * complete the corresponding cases, preserving all original data.
 *
 * The complement to synthesis: instead of generating new cases from scratch,
 * fill the gaps the manifest already identified (missingCriticalFields etc.).
 */

import type { AgentTaskType, BenchmarkCase, BenchmarkManifest } from "../types.js";
import type { LLMClient, LLMMessage } from "./llm/types.js";
import { buildFieldCompletionPrompt } from "./prompts/field-completion.js";
import { parseCaseCompletion } from "./parse.js";

const MAX_ATTEMPTS = 3;

export type EnrichReport = {
  inputCases: number;
  enrichedCases: number;
  failed: number;
  fieldsTargeted: string[];
  failures: Array<{ caseId: string; reason: string }>;
};

/**
 * Derive the fields a manifest says are missing (both critical and any
 * non-present schema signal).
 */
const SIGNAL_TO_FIELD: Record<string, string> = {
  taskInstruction: "input",
  input: "input",
  expectedOutput: "expected",
  acceptanceCriteria: "rubric",
  rubric: "rubric",
  checker: "checker",
  retrievalContext: "context",
  toolTrace: "trace",
  environmentState: "environment",
  metadata: "metadata",
};

export function missingFieldsFromManifest(manifest: BenchmarkManifest): string[] {
  const profile = manifest.schemaProfile;
  const fields = new Set<string>();
  for (const signal of profile.signals) {
    if (signal.present) continue;
    const field = SIGNAL_TO_FIELD[signal.key];
    if (field) fields.add(field);
  }
  return [...fields];
}

/**
 * Complete each case's missing fields. On per-case failure the original case is
 * kept unchanged (data is never lost to a transient error).
 */
export async function enrichCases(input: {
  client: LLMClient;
  manifest: BenchmarkManifest;
  cases: BenchmarkCase[];
}): Promise<{ cases: BenchmarkCase[]; report: EnrichReport }> {
  const { client, manifest, cases } = input;
  const fields = missingFieldsFromManifest(manifest);
  const taskType = manifest.schemaProfile.taskType;
  const industry = manifest.industryProfile.primaryIndustry;

  const enriched: BenchmarkCase[] = [];
  const failures: EnrichReport["failures"] = [];
  let enrichedCount = 0;

  for (const caseRecord of cases) {
    const result = await enrichOne({ client, caseRecord, fields, industry, taskType });
    if (result.ok) {
      enriched.push(result.caseRecord);
      enrichedCount += 1;
    } else {
      failures.push({ caseId: caseRecord.caseId, reason: result.reason });
      enriched.push(caseRecord);
    }
  }

  return {
    cases: enriched,
    report: {
      inputCases: cases.length,
      enrichedCases: enrichedCount,
      failed: failures.length,
      fieldsTargeted: fields,
      failures: failures.slice(0, 50),
    },
  };
}

async function enrichOne(input: {
  client: LLMClient;
  caseRecord: BenchmarkCase;
  fields: string[];
  industry: string;
  taskType: AgentTaskType;
}): Promise<{ ok: true; caseRecord: BenchmarkCase } | { ok: false; reason: string }> {
  const { client, caseRecord, fields, industry, taskType } = input;
  const built = buildFieldCompletionPrompt({ industry, taskType, missingFields: fields, caseRecord });
  const messages: LLMMessage[] = [
    { role: "system", content: built.system },
    { role: "user", content: built.user },
  ];

  let lastReason = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await client.generate(messages, { label: `enrich-${caseRecord.caseId}-${attempt}` });
    } catch (error) {
      lastReason = `LLM error: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const parsed = parseCaseCompletion(result.text);
    if (parsed.ok) {
      return { ok: true, caseRecord: mergeCompletion(caseRecord, parsed.caseRecord, fields) };
    }
    lastReason = parsed.reason;
  }
  return { ok: false, reason: lastReason };
}

/**
 * Merge a completed case onto the original, taking ONLY fields that were absent.
 * Never overwrites a present field — original data is authoritative.
 */
export function mergeCompletion(
  original: BenchmarkCase,
  completed: BenchmarkCase,
  fields: string[],
): BenchmarkCase {
  const merged: BenchmarkCase = { ...original };
  const originalRecord = original as Record<string, unknown>;
  const completedRecord = completed as Record<string, unknown>;
  const mergedRecord = merged as Record<string, unknown>;
  for (const field of fields) {
    if (originalRecord[field] === undefined && completedRecord[field] !== undefined) {
      mergedRecord[field] = completedRecord[field];
    }
  }
  return merged;
}
