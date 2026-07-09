/**
 * @fileoverview Tests for the synthesis engine (LLM-mocked, no network).
 *
 * Mirrors the project's existing test style: node:test + node:assert/strict,
 * no real API calls. A mock LLMClient returns canned completions so the parse
 * retry loop, provenance injection, and manifest re-scoring are exercised fully
 * offline.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildBenchmarkManifest } from "../src/core/manifest.js";
import { generateCase } from "../src/synthesis/generate.js";
import type { GenerateOptions, LLMClient, LLMMessage, LLMResult } from "../src/synthesis/llm/types.js";
import { parseCaseCompletion } from "../src/synthesis/parse.js";
import { synthesizeCases } from "../src/synthesis/pipeline.js";
import { buildFromScratchPrompt } from "../src/synthesis/prompts/from-scratch.js";
import { buildSeededPrompt } from "../src/synthesis/prompts/seeded.js";
import { parseTaskSpec } from "../src/synthesis/spec.js";

function createMockClient(behavior: { text?: string; texts?: string[]; error?: string }): LLMClient {
  let calls = 0;
  return {
    model: "mock-model",
    async generate(_messages: LLMMessage[], _opts?: GenerateOptions): Promise<LLMResult> {
      calls += 1;
      if (behavior.error) throw new Error(behavior.error);
      const text = behavior.texts
        ? behavior.texts[(calls - 1) % behavior.texts.length]
        : behavior.text ?? "{}";
      return { text, usage: { promptTokens: 10, completionTokens: 20 } };
    },
  };
}

const VALID_SPEC = { name: "x", industry: "finance", taskType: "tool_use" as const };

test("TaskSpec rejects unknown industry", () => {
  assert.throws(
    () => parseTaskSpec({ name: "x", industry: "nope", taskType: "tool_use" }),
    /Unknown industry/,
  );
});

test("TaskSpec requires seedCases in seeded mode", () => {
  assert.throws(
    () => parseTaskSpec({ name: "x", industry: "finance", taskType: "tool_use", mode: "seeded" }),
    /seedCases is required/,
  );
});

test("TaskSpec applies sensible defaults", () => {
  const spec = parseTaskSpec(VALID_SPEC);
  assert.equal(spec.mode, "from-scratch");
  assert.equal(spec.count, 10);
  assert.deepEqual(spec.fields, ["input", "expected", "rubric", "checker"]);
  assert.deepEqual(spec.diversity.personas, []);
});

test("parseCaseCompletion parses plain JSON", () => {
  const result = parseCaseCompletion('{"caseId":"a","taskType":"tool_use","input":{}}');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.caseRecord.caseId, "a");
});

test("parseCaseCompletion strips markdown fences", () => {
  const result = parseCaseCompletion('```json\n{"caseId":"a","taskType":"tool_use"}\n```');
  assert.equal(result.ok, true);
});

test("parseCaseCompletion isolates JSON from surrounding prose", () => {
  const result = parseCaseCompletion('Here you go:\n{"caseId":"b","taskType":"dialogue"}\nHope this helps!');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.caseRecord.caseId, "b");
});

test("parseCaseCompletion rejects missing caseId", () => {
  const result = parseCaseCompletion('{"taskType":"dialogue"}');
  assert.equal(result.ok, false);
});

test("parseCaseCompletion rejects invalid JSON", () => {
  const result = parseCaseCompletion("not json at all");
  assert.equal(result.ok, false);
});

test("generateCase succeeds on first valid output", async () => {
  const client = createMockClient({ text: JSON.stringify({ caseId: "g1", taskType: "tool_use", input: {} }) });
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const result = await generateCase({ client, spec, index: 0, count: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
});

test("generateCase retries on bad parse then fails", async () => {
  const client = createMockClient({ text: "not json" });
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const result = await generateCase({ client, spec, index: 0, count: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
});

test("generateCase recovers after a transient bad parse", async () => {
  const client = createMockClient({
    texts: ["nope", JSON.stringify({ caseId: "g2", taskType: "tool_use" })],
  });
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const result = await generateCase({ client, spec, index: 0, count: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("synthesizeCases injects synthetic provenance", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 2 });
  const client = createMockClient({ text: JSON.stringify({ caseId: "p1", taskType: "tool_use", input: {} }) });
  const { cases, report } = await synthesizeCases({ spec, client });
  assert.equal(cases.length, 2);
  assert.equal(cases[0].metadata?.provenance, "synthetic");
  assert.equal(report.generated, 2);
  assert.equal(report.failed, 0);
});

test("synthesizeCases reports and skips failures without aborting the batch", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const client = createMockClient({ text: "not json" });
  const { cases, report } = await synthesizeCases({ spec, client });
  assert.equal(cases.length, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.failures[0]?.index, 0);
});

test("synthesized rich cases re-score through manifest (closed loop)", async () => {
  const richCase = {
    caseId: "rich-1",
    taskType: "tool_use",
    input: { user: "I need a refund for a damaged order" },
    expected: { action: "verify_order_before_refund" },
    context: ["Refund requires order verification before payout."],
    rubric: { passCriteria: ["Verify order before issuing refund"] },
    checker: { type: "json_subset", requiredPaths: ["expected.action"] },
    trace: { expectedToolOrder: ["orders.lookup", "refunds.create"] },
    environment: { orders: { A1: { status: "delivered" } } },
    metadata: { domain: "customer-service", licenseName: "CC-BY-4.0" },
  };
  const spec = parseTaskSpec({ name: "x", industry: "customer-service", taskType: "tool_use", count: 1 });
  const client = createMockClient({ text: JSON.stringify(richCase) });
  const { cases } = await synthesizeCases({ spec, client });
  const manifest = buildBenchmarkManifest({ sourceName: "synth", cases });
  assert.ok(
    manifest.summary.readinessLevel >= 4,
    `expected readiness >= 4, got ${manifest.summary.readinessLevel}`,
  );
  assert.equal(cases[0].metadata?.provenance, "synthetic");
});

test("seeded prompt embeds reference cases and industry", () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, mode: "seeded", seedCases: "ignored-in-this-test.jsonl" });
  const seeds = [{ caseId: "seed-1", taskType: "tool_use" as const, input: {} }];
  const built = buildSeededPrompt({ spec, seeds, index: 0, count: 5 });
  assert.match(built.user, /seed-1/);
  assert.match(built.system, /finance/);
});

test("from-scratch prompt rotates personas by index", () => {
  const spec = parseTaskSpec({
    ...VALID_SPEC,
    diversity: { personas: ["angry customer", "confused user"] },
  });
  const first = buildFromScratchPrompt({ spec, index: 0, count: 2 });
  const second = buildFromScratchPrompt({ spec, index: 1, count: 2 });
  assert.match(first.user, /angry customer/);
  assert.match(second.user, /confused user/);
});
