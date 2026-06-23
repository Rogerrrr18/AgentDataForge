/**
 * @fileoverview Benchmark manifest generation.
 */

import type { BenchmarkCase, BenchmarkManifest, DatasetCandidate } from "../types.js";
import { profileDatasetSchema } from "./schema-profiler.js";

/**
 * Build a portable benchmark manifest from candidate metadata and cases.
 *
 * @param input Source metadata and normalized cases.
 * @returns Benchmark manifest.
 */
export function buildBenchmarkManifest(input: {
  sourceName: string;
  sourceUrl?: string;
  candidate?: DatasetCandidate;
  cases: BenchmarkCase[];
}): BenchmarkManifest {
  const schemaProfile = profileDatasetSchema({ candidate: input.candidate, cases: input.cases });
  const taskTypes = [...new Set([schemaProfile.taskType, ...input.cases.map((item) => item.taskType).filter(Boolean)])] as BenchmarkManifest["summary"]["taskTypes"];

  return {
    schemaVersion: "agent-data-forge.manifest.v0",
    generatedAt: new Date().toISOString(),
    source: {
      name: input.sourceName,
      url: input.sourceUrl ?? input.candidate?.sourceUrl,
      licenseName: input.candidate?.licenseName ?? null,
    },
    summary: {
      caseCount: input.cases.length,
      taskTypes,
      schemaCompleteness: schemaProfile.completeness,
      readinessLevel: schemaProfile.readinessLevel,
    },
    schemaProfile,
    recommendedNextActions: recommendedNextActions(schemaProfile.missingCriticalFields),
  };
}

function recommendedNextActions(missing: string[]): string[] {
  const actions: string[] = [];
  if (missing.includes("license")) actions.push("Resolve license and redistribution policy before publishing a data pack.");
  if (missing.includes("expectedOutput")) actions.push("Add gold expected outputs or acceptance criteria.");
  if (missing.includes("input")) actions.push("Normalize source samples into explicit input fields.");
  actions.push("Add deterministic checker artifacts for high-value Agent benchmark tasks.");
  actions.push("Attach provenance snapshots for source README, metadata JSON, and sample rows.");
  return [...new Set(actions)];
}
