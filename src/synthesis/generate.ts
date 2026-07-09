/**
 * @fileoverview Core case generation: build prompt -> call LLM -> parse -> retry.
 *
 * A single bad completion never aborts the batch: parsing retries up to
 * MAX_ATTEMPTS times, after which the slot is reported as failed and skipped.
 */

import type { BenchmarkCase } from "../types.js";
import { buildFromScratchPrompt } from "./prompts/from-scratch.js";
import { buildSeededPrompt } from "./prompts/seeded.js";
import type { BuiltPrompt } from "./prompts/seeded.js";
import { parseCaseCompletion } from "./parse.js";
import type { GenerateOptions, LLMClient, LLMMessage } from "./llm/types.js";
import type { TaskSpec } from "./spec.js";

export type GenerateCaseResult = {
  ok: boolean;
  attempts: number;
  caseRecord?: BenchmarkCase;
  reason?: string;
  promptTokens?: number;
  completionTokens?: number;
};

const MAX_ATTEMPTS = 3;

export async function generateCase(input: {
  client: LLMClient;
  spec: TaskSpec;
  index: number;
  count: number;
  seeds?: BenchmarkCase[];
  options?: GenerateOptions;
}): Promise<GenerateCaseResult> {
  const { client, spec, index, count, seeds, options } = input;
  const built = buildPrompt({ spec, index, count, seeds });

  const messages: LLMMessage[] = [
    { role: "system", content: built.system },
    { role: "user", content: built.user },
  ];

  let lastReason = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await client.generate(messages, { ...options, label: `case-${index + 1}-${attempt}` });
    } catch (error) {
      lastReason = `LLM error: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }

    const parsed = parseCaseCompletion(result.text);
    if (parsed.ok) {
      return {
        ok: true,
        attempts: attempt,
        caseRecord: parsed.caseRecord,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
      };
    }
    lastReason = parsed.reason;
  }

  return { ok: false, attempts: MAX_ATTEMPTS, reason: lastReason };
}

function buildPrompt(input: {
  spec: TaskSpec;
  index: number;
  count: number;
  seeds?: BenchmarkCase[];
}): BuiltPrompt {
  const { spec, index, count, seeds } = input;
  if (spec.mode === "seeded" && seeds && seeds.length > 0) {
    return buildSeededPrompt({ spec, seeds, index, count });
  }
  return buildFromScratchPrompt({ spec, index, count });
}
