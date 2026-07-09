/**
 * @fileoverview Seeded (few-shot) prompt construction.
 *
 * Mirrors Self-Instruct: present a few reference cases from the same domain and
 * ask for one NEW case in the same style but a different scenario.
 */

import type { BenchmarkCase } from "../../types.js";
import type { TaskSpec } from "../spec.js";
import { outputContract, renderFieldGuide } from "./shared.js";

export type BuiltPrompt = { system: string; user: string };

export function buildSeededPrompt(input: {
  spec: TaskSpec;
  seeds: BenchmarkCase[];
  index: number;
  count: number;
}): BuiltPrompt {
  const { spec, seeds, index, count } = input;
  const examples = seeds.slice(0, 3);

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
    `Here are ${examples.length} reference cases from this domain. Generate ONE NEW case in the same style but a DIFFERENT scenario — do not reuse the example entities or wording.`,
    "Reference cases:",
    ...examples.map((seed, i) => `### Example ${i + 1}\n${JSON.stringify(seed)}`),
    "",
    `This is case ${index + 1} of ${count}. Vary the sub-scenario, the concrete identifiers (order/customer ids), and the difficulty level.`,
    outputContract(spec),
    'Mark the case as synthetic by setting metadata.provenance = "synthetic".',
  ].join("\n\n");

  return { system, user };
}
