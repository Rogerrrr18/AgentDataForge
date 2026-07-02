/**
 * @fileoverview Tests for schema completeness profiling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryVariants } from "../src/core/discovery.js";
import { buildDataValueEnhancementPlan } from "../src/core/enrichment.js";
import { profileIndustry } from "../src/core/industry.js";
import { buildBenchmarkManifest } from "../src/core/manifest.js";
import { profileDatasetSchema } from "../src/core/schema-profiler.js";

test("profiles rich cases above thin metadata", () => {
  const profile = profileDatasetSchema({
    cases: [
      {
        caseId: "tool-1",
        taskType: "tool_use",
        input: { task: "book a meeting" },
        expected: { tool: "calendar.create" },
        trace: { spans: [] },
        checker: { type: "exact" },
        environment: { calendar: [] },
        metadata: { split: "test" },
      },
    ],
  });

  assert.equal(profile.taskType, "tool_use");
  assert.ok(profile.completeness > 0.55);
  assert.ok(profile.evaluatorCandidates.includes("environment_state_test"));
});

test("manifest exposes missing critical fields", () => {
  const manifest = buildBenchmarkManifest({
    sourceName: "thin.jsonl",
    cases: [{ caseId: "thin-1", input: "hello" }],
  });

  assert.equal(manifest.schemaVersion, "agent-data-forge.manifest.v0");
  assert.ok(manifest.schemaProfile.missingCriticalFields.includes("expectedOutput"));
});

test("builds fallback query variants for long benchmark searches", () => {
  assert.deepEqual(buildQueryVariants("customer support agent benchmark"), [
    "customer support agent benchmark",
    "customer support",
  ]);
});

test("segments customer support cases by industry", () => {
  const industry = profileIndustry({
    query: "customer support agent benchmark",
    cases: [
      {
        caseId: "refund-1",
        input: { user: "I need a refund for a damaged package" },
        expected: { resolution: "verify order and explain refund path" },
        metadata: { domain: "customer-service" },
      },
    ],
  });

  assert.equal(industry.primaryIndustry, "customer-service");
  assert.equal(industry.isIndustrySpecific, true);
  assert.ok(industry.matches[0]?.workflowHints.includes("ticket triage"));
});

test("industry segmentation avoids substring false positives", () => {
  const industry = profileIndustry({
    query: "metadata format:csv generated dataset",
  });

  assert.equal(industry.primaryIndustry, "general");
  assert.ok(!industry.matches.some((match) => match.slug === "government"));
  assert.ok(!industry.matches.some((match) => match.slug === "logistics"));
});

test("builds enrichment workflow for thin benchmark data", () => {
  const schemaProfile = profileDatasetSchema({
    cases: [{ caseId: "thin-1", input: "hello" }],
  });
  const industryProfile = profileIndustry({ query: "customer support benchmark" });
  const plan = buildDataValueEnhancementPlan({ schemaProfile, industryProfile });

  assert.equal(plan.currentTier, "candidate_dataset");
  assert.ok(plan.steps.some((step) => step.id === "derive-gold-expected"));
  assert.ok(plan.steps.some((step) => step.id === "resolve-license"));
  assert.ok(plan.packagingRisks.some((risk) => risk.includes("license")));
});

test("local rich benchmark cases can carry license metadata", () => {
  const manifest = buildBenchmarkManifest({
    sourceName: "customer-support-bench.jsonl",
    cases: [
      {
        caseId: "cs-rich-1",
        taskType: "tool_use",
        input: { customerMessage: "Refund my damaged order" },
        expected: { action: "verify_order_before_refund" },
        context: ["Refund policy context"],
        trace: { expectedToolOrder: ["orders.lookup", "refunds.create"] },
        environment: { orders: { A102: { status: "delivered" } } },
        rubric: { passCriteria: ["Verify order before refund"] },
        checker: { type: "json_subset" },
        metadata: {
          domain: "customer-service",
          split: "test",
          licenseName: "CC-BY-4.0",
        },
      },
    ],
  });

  assert.equal(manifest.source.licenseName, "CC-BY-4.0");
  assert.equal(manifest.summary.readinessLevel, 5);
  assert.ok(!manifest.schemaProfile.missingCriticalFields.includes("license"));
});
