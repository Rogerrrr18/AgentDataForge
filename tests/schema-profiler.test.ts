/**
 * @fileoverview Tests for schema completeness profiling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryVariants } from "../src/core/discovery.js";
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
