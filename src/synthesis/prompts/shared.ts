/**
 * @fileoverview Shared prompt fragments used by both generation modes.
 */

import type { TaskSpec } from "../spec.js";

/**
 * Human-readable guidance for each BenchmarkCase field the generator may emit.
 * Keys mirror the SchemaSignal fields the profiler scores against.
 */
const FIELD_GUIDE: Record<string, string> = {
  input:
    "input: the task input object. For tool_use, include customerMessage, concrete identifiers (orderId/customerId), and availableTools.",
  expected:
    "expected: the gold answer as a structured object (e.g. intent, requiredAction, toolPlan[], responseMustInclude[]).",
  context: "context: array of policy/background strings the agent must ground its answer on.",
  rubric:
    "rubric: { passCriteria: string[], failCriteria: string[] } — explicit, checkable success and failure conditions.",
  checker:
    "checker: a deterministic check spec, e.g. { type: 'json_subset', requiredPaths: [...], forbiddenActions: [...] }.",
  trace:
    "trace: { allowedTools: string[], expectedToolOrder: string[] } describing the tool sequence for tool-using agents.",
  environment:
    "environment: fixture state the agent reads, e.g. { orders: { '<orderId>': { status, ... } }, refunds: [] }.",
  messages: "messages: a multi-turn dialogue array of { role, content }.",
  metadata: "metadata: { domain, workflow, split, difficulty, licenseName }.",
};

export function renderFieldGuide(fields: string[]): string {
  return fields
    .map((field) => `- ${FIELD_GUIDE[field] ?? `${field}: (custom field, populate meaningfully)`}`)
    .join("\n");
}

/**
 * The strict output contract appended to every generation prompt.
 */
export function outputContract(spec: TaskSpec): string {
  const requiredKeys = ["caseId", "taskType", ...spec.fields];
  return [
    "Output requirements:",
    "- Return a SINGLE valid JSON object. No markdown fences, no surrounding prose.",
    `- It must be a BenchmarkCase with at least these top-level keys: ${requiredKeys.map((key) => `"${key}"`).join(", ")}.`,
    '- caseId must be unique, snake_case, and distinct from the examples.',
    `- taskType must be "${spec.taskType}".`,
    "- Every value must be concrete and internally consistent: any tool referenced in input/expected must also appear in trace.allowedTools and be backed by environment fixtures.",
  ].join("\n");
}
