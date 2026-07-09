/**
 * @fileoverview Tests for the synthesis engine (LLM-mocked, no network).
 *
 * Mirrors the project's existing test style: node:test + node:assert/strict,
 * no real API calls. A mock LLMClient returns canned completions so the parse
 * retry loop, provenance injection, judge/dedupe, enrichment, and manifest
 * re-scoring are exercised fully offline.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildBenchmarkManifest } from "../src/core/manifest.js";
import type { BenchmarkCase } from "../src/types.js";
import { dedupeCases, dedupeCasesByEmbedding, jaccardSimilarity } from "../src/synthesis/dedupe.js";
import { enrichCases, mergeCompletion, missingFieldsFromManifest } from "../src/synthesis/enrich.js";
import { generateCase } from "../src/synthesis/generate.js";
import { cosineSimilarity } from "../src/synthesis/llm/embeddings.js";
import { judgeCase } from "../src/synthesis/judge.js";
import type { GenerateOptions, LLMClient, LLMMessage, LLMResult } from "../src/synthesis/llm/types.js";
import { parseCaseCompletion, tryParseJsonObject } from "../src/synthesis/parse.js";
import { synthesizeCases } from "../src/synthesis/pipeline.js";
import { buildFromScratchPrompt } from "../src/synthesis/prompts/from-scratch.js";
import { buildSeededPrompt } from "../src/synthesis/prompts/seeded.js";
import { loadTaskSpec, parseSpecText, parseTaskSpec } from "../src/synthesis/spec.js";

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

test("tryParseJsonObject tolerates fences/prose and rejects non-objects", () => {
  assert.equal(tryParseJsonObject('```json\n{"a":1}\n```')?.a, 1);
  assert.equal(tryParseJsonObject('prose {"a":1} trailing')?.a, 1);
  assert.equal(tryParseJsonObject("not json"), null);
  assert.equal(tryParseJsonObject("[1,2,3]"), null);
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

test("synthesizeCases drops low-scoring cases when judge is enabled", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const client = createMockClient({
    texts: [
      JSON.stringify({ caseId: "g1", taskType: "tool_use", input: {} }),
      JSON.stringify({ pass: false, score: 0.2, reason: "inconsistent tools" }),
    ],
  });
  const { cases, report } = await synthesizeCases({ spec, client, options: { judge: {} } });
  assert.equal(report.judged, 1);
  assert.equal(report.judgeDropped, 1);
  assert.equal(cases.length, 0);
});

test("synthesizeCases keeps high-scoring cases through judge", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 1 });
  const client = createMockClient({
    texts: [
      JSON.stringify({ caseId: "g1", taskType: "tool_use", input: {} }),
      JSON.stringify({ pass: true, score: 0.9, reason: "consistent" }),
    ],
  });
  const { cases, report } = await synthesizeCases({ spec, client, options: { judge: {} } });
  assert.equal(report.judgeDropped, 0);
  assert.equal(cases.length, 1);
});

test("synthesizeCases dedupes near-identical cases", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 2 });
  const identical = { caseId: "dup", taskType: "tool_use", input: { msg: "refund for damaged order 123 today" }, expected: { action: "verify" } };
  const client = createMockClient({ text: JSON.stringify(identical) });
  const { cases, report } = await synthesizeCases({ spec, client, options: { dedupe: true } });
  assert.equal(report.dedupedRemoved, 1);
  assert.equal(cases.length, 1);
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

test("judgeCase returns a verdict for valid output", async () => {
  const spec = parseTaskSpec(VALID_SPEC);
  const client = createMockClient({ text: JSON.stringify({ pass: true, score: 0.9, reason: "consistent" }) });
  const verdict = await judgeCase({
    client,
    caseRecord: { caseId: "g1", taskType: "tool_use", input: {} } as BenchmarkCase,
    spec,
  });
  assert.equal(verdict?.pass, true);
  assert.equal(verdict?.score, 0.9);
});

test("judgeCase returns null on unparseable output", async () => {
  const spec = parseTaskSpec(VALID_SPEC);
  const client = createMockClient({ text: "garbage" });
  const verdict = await judgeCase({
    client,
    caseRecord: { caseId: "g1", taskType: "tool_use" } as BenchmarkCase,
    spec,
  });
  assert.equal(verdict, null);
});

test("jaccardSimilarity is 1 for identical and low for disjoint", () => {
  const text = "the quick brown fox jumps over the lazy dog again and again";
  const a = { caseId: "case_alpha", input: { x: text } } as BenchmarkCase;
  assert.equal(jaccardSimilarity(a, a), 1);
  const b = { caseId: "case_beta", input: { x: text } } as BenchmarkCase;
  assert.ok(jaccardSimilarity(a, b) > 0.8);
  const c = { caseId: "case_gamma", input: { x: "zzzzz totally different content here" } } as BenchmarkCase;
  assert.ok(jaccardSimilarity(a, c) < 0.4);
});

test("dedupeCases keeps the first of near-duplicates", () => {
  const base = { taskType: "tool_use", input: { msg: "the customer wants a refund for order 123 because the item arrived damaged and unusable today" } };
  const a = { caseId: "case_a", ...base } as BenchmarkCase;
  const b = { caseId: "case_b", ...base } as BenchmarkCase; // identical except caseId
  const distinct = { caseId: "case_c", taskType: "rag_qa", input: { query: "what is the company policy on final sale returns and exchanges" } } as BenchmarkCase;
  const result = dedupeCases([a, b, distinct]);
  assert.equal(result.length, 2);
  assert.equal(result[0].caseId, "case_a");
  assert.equal(result[1].caseId, "case_c");
});

test("mergeCompletion only fills absent fields, never overwrites", () => {
  const original = { caseId: "o1", taskType: "tool_use", input: { user: "hi" } } as BenchmarkCase;
  const completed = {
    caseId: "o1",
    taskType: "tool_use",
    input: { user: "CHANGED" },
    expected: { action: "verify" },
    rubric: { passCriteria: ["greet"] },
  } as BenchmarkCase;
  const merged = mergeCompletion(original, completed, ["input", "expected", "rubric"]);
  assert.deepEqual(merged.input, { user: "hi" }); // preserved, not overwritten
  assert.deepEqual(merged.expected, { action: "verify" }); // added
  assert.deepEqual(merged.rubric, { passCriteria: ["greet"] }); // added
});

test("missingFieldsFromManifest derives gaps from the schema profile", () => {
  const manifest = buildBenchmarkManifest({ sourceName: "thin.jsonl", cases: [{ caseId: "t1", input: "hi" }] });
  const fields = missingFieldsFromManifest(manifest);
  assert.ok(fields.includes("expected"));
  assert.ok(fields.includes("rubric"));
  assert.ok(fields.includes("checker"));
});

test("enrichCases fills missing fields and preserves originals", async () => {
  const manifest = buildBenchmarkManifest({ sourceName: "thin.jsonl", cases: [{ caseId: "t1", input: "hi" }] });
  const completed = { caseId: "t1", input: "hi", expected: { answer: "hello" }, rubric: { passCriteria: ["greet"] } };
  const client = createMockClient({ text: JSON.stringify(completed) });
  const { cases, report } = await enrichCases({
    client,
    manifest,
    cases: [{ caseId: "t1", input: "hi" }],
  });
  assert.equal(report.enrichedCases, 1);
  assert.deepEqual(cases[0].expected, { answer: "hello" });
  assert.equal(cases[0].input, "hi"); // original preserved
});

test("enrichCases keeps the original case when completion fails", async () => {
  const manifest = buildBenchmarkManifest({ sourceName: "thin.jsonl", cases: [{ caseId: "t1", input: "hi" }] });
  const client = createMockClient({ text: "not json" });
  const { cases, report } = await enrichCases({
    client,
    manifest,
    cases: [{ caseId: "t1", input: "hi" }],
  });
  assert.equal(report.failed, 1);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].input, "hi"); // original kept on failure
});

test("synthesizeCases stops early when the token budget is exceeded", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 10 });
  // each call reports 10 prompt + 20 completion = 30 tokens
  const client = createMockClient({ text: JSON.stringify({ caseId: "g", taskType: "tool_use", input: {} }) });
  const { cases, report } = await synthesizeCases({
    spec,
    client,
    options: { budget: { maxTokens: 50 } },
  });
  assert.equal(report.stoppedByBudget, true);
  assert.ok(cases.length < 10, `expected early stop, got ${cases.length}`);
  assert.ok(cases.length >= 1);
});

test("synthesizeCases runs to completion when budget is not hit", async () => {
  const spec = parseTaskSpec({ ...VALID_SPEC, count: 2 });
  const client = createMockClient({ text: JSON.stringify({ caseId: "g", taskType: "tool_use", input: {} }) });
  const { cases, report } = await synthesizeCases({
    spec,
    client,
    options: { budget: { maxTokens: 100000 } },
  });
  assert.equal(report.stoppedByBudget, undefined);
  assert.equal(cases.length, 2);
});

test("parseSpecText parses YAML for .yaml files and JSON otherwise", () => {
  const yamlText = "name: y\nindustry: finance\ntaskType: tool_use\ncount: 3\n";
  assert.deepEqual(parseSpecText(yamlText, "spec.yaml"), {
    name: "y",
    industry: "finance",
    taskType: "tool_use",
    count: 3,
  });
  assert.deepEqual(parseSpecText('{"name":"j"}', "spec.json"), { name: "j" });
});

test("loadTaskSpec accepts a YAML spec file", async () => {
  const spec = await loadTaskSpec("examples/synth-specs/customer-support.yaml");
  assert.equal(spec.industry, "customer-service");
  assert.equal(spec.mode, "seeded");
  assert.equal(spec.count, 10);
  assert.deepEqual(spec.fields, ["input", "expected", "context", "rubric", "checker", "trace", "environment"]);
});

test("cosineSimilarity is 1 for identical and 0 for orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-9); // parallel
  assert.equal(cosineSimilarity([], [1]), 0); // mismatched/empty
});

test("dedupeCasesByEmbedding removes near-parallel vectors", () => {
  const a = { caseId: "a", taskType: "tool_use" } as BenchmarkCase;
  const b = { caseId: "b", taskType: "tool_use" } as BenchmarkCase;
  const c = { caseId: "c", taskType: "tool_use" } as BenchmarkCase;
  const vectors = [
    [1, 0, 0],
    [0.99, 0.01, 0], // near-parallel to a -> duplicate
    [0, 1, 0], // orthogonal -> keep
  ];
  const result = dedupeCasesByEmbedding([a, b, c], vectors);
  assert.equal(result.length, 2);
  assert.equal(result[0].caseId, "a");
  assert.equal(result[1].caseId, "c");
});

test("dedupeCasesByEmbedding throws on vector count mismatch", () => {
  const a = { caseId: "a", taskType: "tool_use" } as BenchmarkCase;
  assert.throws(() => dedupeCasesByEmbedding([a], [[1, 0], [0, 1]]), /mismatch/);
});
