/**
 * @fileoverview Synthesis pipeline orchestration.
 *
 * spec -> load seeds (if seeded) -> batch generate -> inject provenance ->
 * write cases.jsonl + generation-report.json.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BenchmarkCase } from "../types.js";
import { loadCasesJsonl } from "./case-loader.js";
import { generateCase } from "./generate.js";
import type { LLMClient } from "./llm/types.js";
import { loadTaskSpec, type TaskSpec } from "./spec.js";

export type SynthesisReport = {
  specName: string;
  model: string;
  mode: TaskSpec["mode"];
  requested: number;
  generated: number;
  failed: number;
  failures: Array<{ index: number; reason: string }>;
  tokenUsage: { promptTokens: number; completionTokens: number };
  outputCasesPath: string;
};

export async function synthesizeCases(input: {
  spec: TaskSpec;
  client: LLMClient;
  seeds?: BenchmarkCase[];
  limit?: number;
}): Promise<{ cases: BenchmarkCase[]; report: Omit<SynthesisReport, "outputCasesPath"> }> {
  const { spec, client, seeds } = input;
  const count = input.limit ?? spec.count;

  const cases: BenchmarkCase[] = [];
  const failures: SynthesisReport["failures"] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let index = 0; index < count; index += 1) {
    const result = await generateCase({ client, spec, index, count, seeds });
    if (result.ok && result.caseRecord) {
      cases.push(withProvenance(result.caseRecord, { spec, model: client.model }));
    } else {
      failures.push({ index, reason: result.reason ?? "unknown" });
    }
    if (result.promptTokens) promptTokens += result.promptTokens;
    if (result.completionTokens) completionTokens += result.completionTokens;
  }

  return {
    cases,
    report: {
      specName: spec.name,
      model: client.model,
      mode: spec.mode,
      requested: count,
      generated: cases.length,
      failed: failures.length,
      failures: failures.slice(0, 50),
      tokenUsage: { promptTokens, completionTokens },
    },
  };
}

export async function runSynthesis(input: {
  specPath: string;
  client: LLMClient;
  limit?: number;
  outPath?: string;
}): Promise<{ cases: BenchmarkCase[]; report: SynthesisReport; outPath: string }> {
  const spec = await loadTaskSpec(input.specPath);
  const outPath = input.outPath ?? defaultOutPath(spec.name);
  const seeds = spec.mode === "seeded" && spec.seedCases
    ? await loadCasesJsonl(input.specPath, spec.seedCases)
    : undefined;

  const { cases, report } = await synthesizeCases({ spec, client: input.client, seeds, limit: input.limit });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeJsonl(cases), "utf8");

  const fullReport: SynthesisReport = { ...report, outputCasesPath: outPath };
  await writeFile(join(dirname(outPath), "generation-report.json"), `${JSON.stringify(fullReport, null, 2)}\n`, "utf8");

  return { cases, report: fullReport, outPath };
}

function defaultOutPath(specName: string): string {
  const slug = specName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `data/synthetic/${slug}/cases.jsonl`;
}

function serializeJsonl(cases: BenchmarkCase[]): string {
  if (cases.length === 0) return "";
  return `${cases.map((caseRecord) => JSON.stringify(caseRecord)).join("\n")}\n`;
}

function withProvenance(caseRecord: BenchmarkCase, meta: { spec: TaskSpec; model: string }): BenchmarkCase {
  const existingMetadata = caseRecord.metadata ?? {};
  return {
    ...caseRecord,
    metadata: {
      ...existingMetadata,
      provenance: "synthetic",
      generator: {
        engine: "agent-data-forge",
        model: meta.model,
        specName: meta.spec.name,
      },
    },
  };
}
