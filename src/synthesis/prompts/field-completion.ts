/**
 * @fileoverview Field-completion prompt for the closed-loop enrichment mode.
 *
 * Given an existing case and the fields it is missing, ask the LLM to return
 * the fully completed case WITHOUT altering any field that is already present.
 */

import type { AgentTaskType, BenchmarkCase } from "../../types.js";
import type { BuiltPrompt } from "./seeded.js";
import { renderFieldGuide } from "./shared.js";

export function buildFieldCompletionPrompt(input: {
  industry: string;
  taskType: AgentTaskType;
  missingFields: string[];
  caseRecord: BenchmarkCase;
}): BuiltPrompt {
  const { industry, taskType, missingFields, caseRecord } = input;

  const system = [
    "You are a benchmark data completion agent.",
    `Industry: ${industry}. Task type: ${taskType}.`,
    "You receive an existing benchmark case that is missing fields. Return the SAME case with only the missing fields filled in.",
    "CRITICAL: do NOT modify, rename, or remove any field that is already present. Only ADD the missing fields, consistent with the existing ones.",
    "Fields to add:\n" + renderFieldGuide(missingFields),
  ].join("\n\n");

  const user = [
    "Existing case (preserve every present field exactly, including caseId and taskType):",
    JSON.stringify(caseRecord),
    "",
    `Add these missing fields: ${missingFields.map((field) => `"${field}"`).join(", ")}.`,
    "Return the complete case — original fields unchanged plus the new fields — as a SINGLE JSON object. No prose, no markdown fences.",
  ].join("\n");

  return { system, user };
}
