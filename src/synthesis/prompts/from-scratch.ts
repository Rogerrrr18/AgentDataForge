/**
 * @fileoverview Requirement-driven (no-seed) prompt construction.
 *
 * Uses persona rotation for diversity when the spec provides personas.
 */

import type { TaskSpec } from "../spec.js";
import type { BuiltPrompt } from "./seeded.js";
import { outputContract, renderFieldGuide } from "./shared.js";

export function buildFromScratchPrompt(input: {
  spec: TaskSpec;
  index: number;
  count: number;
}): BuiltPrompt {
  const { spec, index, count } = input;
  const personas = spec.diversity.personas;
  const persona = personas.length > 0 ? personas[index % personas.length] : undefined;

  const system = [
    "You are a synthetic data generator for AI agent evaluation benchmarks.",
    `Industry: ${spec.industry}. Task type: ${spec.taskType}.`,
    spec.constraints.length > 0
      ? `Constraints:\n${spec.constraints.map((constraint) => `- ${constraint}`).join("\n")}`
      : "",
    "Fields to populate:\n" + renderFieldGuide(spec.fields),
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Generate ONE new benchmark case for the ${spec.industry} domain.`,
    persona ? `Frame the scenario around this user persona: "${persona}".` : "",
    `This is case ${index + 1} of ${count}. Make it distinct and realistic; vary the concrete identifiers and difficulty.`,
    outputContract(spec),
    'Mark the case as synthetic by setting metadata.provenance = "synthetic".',
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
