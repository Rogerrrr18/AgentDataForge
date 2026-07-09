/**
 * @fileoverview TaskSpec: the user-facing requirement description for synthesis.
 *
 * Validated with zod (an existing project dependency). Industry slugs are
 * checked against the shared taxonomy so specs fail fast with an actionable
 * error rather than producing off-domain data.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getIndustryTaxonomy } from "../core/industry.js";
import type { AgentTaskType } from "../types.js";

const TASK_TYPES: AgentTaskType[] = [
  "dialogue",
  "rag_qa",
  "tool_use",
  "code",
  "planning",
  "classification",
  "data_extraction",
  "custom",
];

const VALID_INDUSTRIES = new Set(getIndustryTaxonomy().map((item) => item.slug));

const DEFAULT_FIELDS = ["input", "expected", "rubric", "checker"];

export const TaskSpecSchema = z
  .object({
    name: z.string().min(1),
    industry: z
      .string()
      .min(1)
      .refine((slug) => VALID_INDUSTRIES.has(slug), (slug) => ({
        message: `Unknown industry "${slug}". Valid: ${[...VALID_INDUSTRIES].sort().join(", ")}`,
      })),
    taskType: z.enum(TASK_TYPES as [AgentTaskType, ...AgentTaskType[]]),
    count: z.number().int().positive().default(10),
    mode: z.enum(["seeded", "from-scratch"]).default("from-scratch"),
    seedCases: z.string().optional(),
    fields: z.array(z.string()).default(() => [...DEFAULT_FIELDS]),
    constraints: z.array(z.string()).default(() => []),
    diversity: z
      .object({
        personas: z.array(z.string()).default(() => []),
      })
      .default({ personas: [] }),
  })
  .refine((spec) => spec.mode !== "seeded" || Boolean(spec.seedCases), {
    message: "seedCases is required when mode is 'seeded'",
    path: ["seedCases"],
  });

export type TaskSpec = z.infer<typeof TaskSpecSchema>;

/**
 * Parse and validate a TaskSpec object. Throws with a readable issue list.
 */
export function parseTaskSpec(input: unknown, source = "<inline>"): TaskSpec {
  const result = TaskSpecSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid TaskSpec at ${source}:\n${issues}`);
  }
  return result.data;
}

/**
 * Load and validate a TaskSpec from a JSON file.
 */
export async function loadTaskSpec(filePath: string): Promise<TaskSpec> {
  const text = await readFile(filePath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `TaskSpec JSON is invalid at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseTaskSpec(json, filePath);
}
