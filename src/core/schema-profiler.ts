/**
 * @fileoverview Schema completeness profiler for benchmark-ready Agent datasets.
 */

import type {
  AgentTaskType,
  BenchmarkCase,
  DatasetCandidate,
  SchemaProfile,
  SchemaSignal,
  SchemaSignalKey,
} from "../types.js";

const SIGNAL_WEIGHTS: Record<SchemaSignalKey, number> = {
  taskInstruction: 0.11,
  input: 0.11,
  expectedOutput: 0.12,
  acceptanceCriteria: 0.1,
  rubric: 0.09,
  checker: 0.11,
  retrievalContext: 0.08,
  toolTrace: 0.08,
  environmentState: 0.08,
  metadata: 0.05,
  license: 0.04,
  split: 0.03,
};

/**
 * Build a schema profile from candidate metadata and optional sample cases.
 *
 * @param input Candidate metadata and optional benchmark cases.
 * @returns Completeness profile with evaluator routing hints.
 */
export function profileDatasetSchema(input: {
  candidate?: DatasetCandidate;
  cases?: BenchmarkCase[];
}): SchemaProfile {
  const cases = input.cases ?? [];
  const sampleText = JSON.stringify({
    candidate: input.candidate,
    cases: cases.slice(0, 20),
  }).toLowerCase();

  const taskType = inferTaskType(input.candidate, sampleText, cases);
  const signals = buildSignals(input.candidate, cases, sampleText);
  const completeness = clamp01(
    signals.reduce((sum, signal) => sum + (signal.present ? SIGNAL_WEIGHTS[signal.key] * signal.confidence : 0), 0),
  );
  const readinessLevel = toReadinessLevel(completeness, signals);
  const missingCriticalFields = signals
    .filter((signal) => !signal.present && isCriticalSignal(signal.key))
    .map((signal) => signal.key);

  return {
    taskType,
    completeness,
    readinessLevel,
    signals,
    evaluatorCandidates: inferEvaluatorCandidates(signals, taskType),
    missingCriticalFields,
    notes: buildNotes(taskType, signals, completeness),
  };
}

/**
 * Infer the most likely Agent task type.
 *
 * @param candidate Optional source candidate metadata.
 * @param sampleText Lower-cased sample text.
 * @param cases Optional parsed cases.
 * @returns Inferred task type.
 */
export function inferTaskType(
  candidate: DatasetCandidate | undefined,
  sampleText: string,
  cases: BenchmarkCase[] = [],
): AgentTaskType {
  const explicitTaskType = cases.find((item) => item.taskType)?.taskType;
  if (explicitTaskType) return explicitTaskType;

  const taskTags = new Set(candidate?.taskTypes ?? []);
  if (taskTags.has("question-answering") || /context|retrieval|rag|documents/.test(sampleText)) return "rag_qa";
  if (/tool[_-]?calls?|function[_-]?calls?|api call|service_call/.test(sampleText)) return "tool_use";
  if (/unit test|patch|repository|github issue|swe-bench|code/.test(sampleText)) return "code";
  if (/plan|dag|workflow|dependency/.test(sampleText)) return "planning";
  if (/label|class|category|sentiment/.test(sampleText)) return "classification";
  if (/entity|slot|extract|schema/.test(sampleText)) return "data_extraction";
  if (cases.some((item) => Array.isArray(item.messages))) return "dialogue";
  return "custom";
}

function buildSignals(candidate: DatasetCandidate | undefined, cases: BenchmarkCase[], sampleText: string): SchemaSignal[] {
  return [
    signal("taskInstruction", hasAnyCaseField(cases, ["instruction", "prompt", "query", "input"]) || /instruction|prompt|query/.test(sampleText), cases),
    signal("input", hasAnyCaseField(cases, ["input", "messages", "context"]) || /input|messages|question/.test(sampleText), cases),
    signal("expectedOutput", hasAnyCaseField(cases, ["expected", "answer", "label", "target", "gold"]) || /expected|answer|label|target|gold/.test(sampleText), cases),
    signal("acceptanceCriteria", /acceptancecriteria|successcriteria|criteria|must pass/.test(sampleText), cases),
    signal("rubric", hasAnyCaseField(cases, ["rubric"]) || /rubric|score level|评分/.test(sampleText), cases),
    signal("checker", hasAnyCaseField(cases, ["checker"]) || /checker|unit_test|assert|environment_state/.test(sampleText), cases),
    signal("retrievalContext", hasAnyCaseField(cases, ["context", "documents", "retrievalContext"]) || /retrieval|documents|context/.test(sampleText), cases),
    signal("toolTrace", hasAnyCaseField(cases, ["trace", "toolCalls", "tool_calls"]) || /tool_calls?|trace|span/.test(sampleText), cases),
    signal("environmentState", hasAnyCaseField(cases, ["environment", "state"]) || /environment|state|sandbox|filesystem|database/.test(sampleText), cases),
    signal("metadata", Boolean(candidate) || hasAnyCaseField(cases, ["metadata"]), cases),
    signal("license", Boolean(candidate?.licenseName), cases, candidate?.licenseName ? [`license=${candidate.licenseName}`] : []),
    signal("split", /train|test|validation|dev/.test(sampleText), cases),
  ];
}

function signal(key: SchemaSignalKey, present: boolean, cases: BenchmarkCase[], extraEvidence: string[] = []): SchemaSignal {
  return {
    key,
    present,
    confidence: present ? (cases.length > 0 ? 0.86 : 0.7) : 0,
    evidence: present ? [...extraEvidence, `matched ${key}`].slice(0, 3) : [],
  };
}

function hasAnyCaseField(cases: BenchmarkCase[], fields: string[]): boolean {
  return cases.some((item) => {
    const record = item as Record<string, unknown>;
    return fields.some((field) => typeof record[field] !== "undefined");
  });
}

function inferEvaluatorCandidates(
  signals: SchemaSignal[],
  taskType: AgentTaskType,
): SchemaProfile["evaluatorCandidates"] {
  const present = new Set(signals.filter((signal) => signal.present).map((signal) => signal.key));
  const candidates: SchemaProfile["evaluatorCandidates"] = ["llm_judge", "human_label"];
  if (present.has("expectedOutput")) candidates.unshift("exact_match", "f1_match");
  if (present.has("checker")) candidates.unshift("unit_test");
  if (present.has("environmentState")) candidates.unshift("environment_state_test");
  if (taskType === "data_extraction" || taskType === "classification") candidates.unshift("regex_match");
  return [...new Set(candidates)];
}

function buildNotes(taskType: AgentTaskType, signals: SchemaSignal[], completeness: number): string[] {
  const missing = signals.filter((signal) => !signal.present).map((signal) => signal.key);
  const notes = [`Inferred task type: ${taskType}.`, `Schema completeness: ${Math.round(completeness * 100)}%.`];
  if (missing.length > 0) notes.push(`Missing fields: ${missing.join(", ")}.`);
  if (missing.includes("checker")) notes.push("Add deterministic checkers before selling this as a high-confidence benchmark pack.");
  if (missing.includes("license")) notes.push("License metadata must be resolved before redistribution.");
  return notes;
}

function isCriticalSignal(key: SchemaSignalKey): boolean {
  return key === "input" || key === "expectedOutput" || key === "license";
}

function toReadinessLevel(completeness: number, signals: SchemaSignal[]): 1 | 2 | 3 | 4 | 5 {
  const present = new Set(signals.filter((signal) => signal.present).map((signal) => signal.key));
  if (completeness >= 0.82 && present.has("checker") && present.has("license")) return 5;
  if (completeness >= 0.68 && present.has("expectedOutput")) return 4;
  if (completeness >= 0.48 && present.has("input")) return 3;
  if (completeness >= 0.25) return 2;
  return 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
