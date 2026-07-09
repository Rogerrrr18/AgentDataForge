/**
 * @fileoverview LLM-as-judge quality filtering for synthesized cases.
 *
 * Optional stage (--judge): each generated case is scored by the LLM against a
 * structural-consistency rubric. Judge infra failures return null so callers
 * can fail open (keep the case, flag for review) rather than dropping data on a
 * transient error.
 */

import type { BenchmarkCase } from "../types.js";
import type { LLMClient, LLMMessage } from "./llm/types.js";
import { tryParseJsonObject } from "./parse.js";
import type { TaskSpec } from "./spec.js";

export type JudgeVerdict = {
  pass: boolean;
  score: number;
  reason: string;
};

export const DEFAULT_JUDGE_THRESHOLD = 0.6;

const JUDGE_SYSTEM_PROMPT =
  "You are a strict QA reviewer for synthetic agent evaluation data. " +
  "Return ONLY a JSON object with keys: pass (boolean), score (number 0..1), reason (string).";

/**
 * Score a single synthesized case. Returns null if the judge call or its output
 * could not be parsed (caller decides whether to keep or drop).
 */
export async function judgeCase(input: {
  client: LLMClient;
  caseRecord: BenchmarkCase;
  spec: TaskSpec;
  threshold?: number;
}): Promise<JudgeVerdict | null> {
  const { client, caseRecord, spec } = input;
  const threshold = input.threshold ?? DEFAULT_JUDGE_THRESHOLD;

  const messages: LLMMessage[] = [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: buildJudgeUser(caseRecord, spec, threshold) },
  ];

  let result;
  try {
    result = await client.generate(messages, { temperature: 0, label: "judge" });
  } catch {
    return null;
  }

  return interpretJudgeResult(result.text, threshold);
}

function interpretJudgeResult(text: string, threshold: number): JudgeVerdict | null {
  const obj = tryParseJsonObject(text);
  if (!obj) return null;

  const score = typeof obj.score === "number" ? clamp01(obj.score) : obj.pass === true ? 1 : 0;
  const pass = typeof obj.pass === "boolean" ? obj.pass : score >= threshold;
  const reason = typeof obj.reason === "string" ? obj.reason : "";
  return { pass, score, reason };
}

function buildJudgeUser(caseRecord: BenchmarkCase, spec: TaskSpec, threshold: number): string {
  return [
    "Evaluate this synthesized benchmark case. Return JSON: {\"pass\": boolean, \"score\": 0..1, \"reason\": string}.",
    "Check rigorously: (1) required fields are populated and non-trivial; (2) any tool in input/expected also appears in trace.allowedTools AND has a matching environment fixture; (3) rubric criteria are concrete and checkable; (4) identifiers are consistent across fields.",
    `Industry: ${spec.industry}. Task type: ${spec.taskType}. Pass threshold: ${threshold}.`,
    "Case JSON:",
    JSON.stringify(caseRecord),
  ].join("\n");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
