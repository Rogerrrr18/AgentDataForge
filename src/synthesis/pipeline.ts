/**
 * @fileoverview Synthesis pipeline orchestration.
 *
 * spec -> load seeds (if seeded) -> batch generate -> [judge] -> [dedupe] ->
 * inject provenance -> write cases.jsonl + generation-report.json.
 *
 * A token budget can stop generation early. runEnrichment provides the
 * closed-loop mode: read a manifest's missing fields and complete existing
 * cases in place.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BenchmarkCase, BenchmarkManifest } from "../types.js";
import { loadCasesJsonl, parseJsonlCases } from "./case-loader.js";
import { DEFAULT_DEDUPE_THRESHOLD, dedupeCases } from "./dedupe.js";
import { enrichCases, type EnrichReport } from "./enrich.js";
import { generateCase } from "./generate.js";
import { judgeCase } from "./judge.js";
import type { LLMClient } from "./llm/types.js";
import { loadTaskSpec, type TaskSpec } from "./spec.js";

export type SynthesisOptions = {
  /** Enable LLM-as-judge filtering. Defaults to the primary client if omitted. */
  judge?: { client?: LLMClient; threshold?: number };
  /** true = default threshold; number = custom Jaccard threshold. */
  dedupe?: boolean | number;
  /** Stop generating once cumulative token usage reaches maxTokens. */
  budget?: { maxTokens: number };
};

export type SynthesisReport = {
  specName: string;
  model: string;
  mode: TaskSpec["mode"];
  requested: number;
  generated: number;
  failed: number;
  failures: Array<{ index: number; reason: string }>;
  tokenUsage: { promptTokens: number; completionTokens: number };
  judged?: number;
  judgeDropped?: number;
  judgeFlagged?: number;
  dedupedRemoved?: number;
  stoppedByBudget?: boolean;
  outputCasesPath: string;
};

export async function synthesizeCases(input: {
  spec: TaskSpec;
  client: LLMClient;
  seeds?: BenchmarkCase[];
  limit?: number;
  options?: SynthesisOptions;
}): Promise<{ cases: BenchmarkCase[]; report: Omit<SynthesisReport, "outputCasesPath"> }> {
  const { spec, client, seeds, options } = input;
  const count = input.limit ?? spec.count;
  const budget = options?.budget;

  const generated: BenchmarkCase[] = [];
  const failures: SynthesisReport["failures"] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let stoppedByBudget = false;

  for (let index = 0; index < count; index += 1) {
    const result = await generateCase({ client, spec, index, count, seeds });
    if (result.ok && result.caseRecord) {
      generated.push(withProvenance(result.caseRecord, { spec, model: client.model }));
    } else {
      failures.push({ index, reason: result.reason ?? "unknown" });
    }
    if (result.promptTokens) promptTokens += result.promptTokens;
    if (result.completionTokens) completionTokens += result.completionTokens;
    if (budget && promptTokens + completionTokens >= budget.maxTokens) {
      stoppedByBudget = true;
      break;
    }
  }

  let cases = generated;
  const extras: Pick<SynthesisReport, "judged" | "judgeDropped" | "judgeFlagged" | "dedupedRemoved"> = {};

  if (options?.judge) {
    const result = await applyJudge({
      cases,
      judgeClient: options.judge.client ?? client,
      spec,
      threshold: options.judge.threshold,
    });
    cases = result.cases;
    extras.judged = result.judged;
    extras.judgeDropped = result.dropped;
    extras.judgeFlagged = result.flagged;
  }

  if (options?.dedupe) {
    const threshold = typeof options.dedupe === "number" ? options.dedupe : DEFAULT_DEDUPE_THRESHOLD;
    const before = cases.length;
    cases = dedupeCases(cases, threshold);
    extras.dedupedRemoved = before - cases.length;
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
      ...extras,
      ...(stoppedByBudget ? { stoppedByBudget: true } : {}),
    },
  };
}

export async function runSynthesis(input: {
  specPath: string;
  client: LLMClient;
  limit?: number;
  outPath?: string;
  options?: SynthesisOptions;
}): Promise<{ cases: BenchmarkCase[]; report: SynthesisReport; outPath: string }> {
  const spec = await loadTaskSpec(input.specPath);
  const outPath = input.outPath ?? defaultOutPath(spec.name);
  const seeds = spec.mode === "seeded" && spec.seedCases
    ? await loadCasesJsonl(input.specPath, spec.seedCases)
    : undefined;

  const { cases, report } = await synthesizeCases({
    spec,
    client: input.client,
    seeds,
    limit: input.limit,
    options: input.options,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeJsonl(cases), "utf8");
  const fullReport: SynthesisReport = { ...report, outputCasesPath: outPath };
  await writeFile(join(dirname(outPath), "generation-report.json"), `${JSON.stringify(fullReport, null, 2)}\n`, "utf8");

  return { cases, report: fullReport, outPath };
}

export async function runEnrichment(input: {
  manifestPath: string;
  casesPath: string;
  client: LLMClient;
  outPath?: string;
}): Promise<{ cases: BenchmarkCase[]; report: EnrichReport; outPath: string }> {
  const manifest = await loadManifest(input.manifestPath);
  const cases = await loadCasesFile(input.casesPath);
  const { cases: enriched, report } = await enrichCases({ client: input.client, manifest, cases });

  const outPath = input.outPath ?? defaultEnrichOutPath(input.casesPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeJsonl(enriched), "utf8");
  await writeFile(join(dirname(outPath), "enrichment-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return { cases: enriched, report, outPath };
}

async function applyJudge(input: {
  cases: BenchmarkCase[];
  judgeClient: LLMClient;
  spec: TaskSpec;
  threshold?: number;
}): Promise<{ cases: BenchmarkCase[]; judged: number; dropped: number; flagged: number }> {
  const { cases, judgeClient, spec, threshold } = input;
  const kept: BenchmarkCase[] = [];
  let judged = 0;
  let dropped = 0;
  let flagged = 0;
  for (const caseRecord of cases) {
    const verdict = await judgeCase({ client: judgeClient, caseRecord, spec, threshold });
    judged += 1;
    if (verdict === null) {
      kept.push(markReview(caseRecord, "judge-unavailable"));
      flagged += 1;
    } else if (verdict.pass) {
      kept.push(caseRecord);
    } else {
      dropped += 1;
    }
  }
  return { cases: kept, judged, dropped, flagged };
}

async function loadManifest(path: string): Promise<BenchmarkManifest> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as BenchmarkManifest;
  } catch (error) {
    throw new Error(`Invalid manifest JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadCasesFile(path: string): Promise<BenchmarkCase[]> {
  const text = await readFile(path, "utf8");
  return parseJsonlCases(text, path);
}

function defaultOutPath(specName: string): string {
  const slug = specName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `data/synthetic/${slug}/cases.jsonl`;
}

function defaultEnrichOutPath(casesPath: string): string {
  const stem = basename(casesPath).replace(/\.[^.]+$/, "");
  return `data/synthetic/enriched/${stem}.jsonl`;
}

function serializeJsonl(cases: BenchmarkCase[]): string {
  if (cases.length === 0) return "";
  return `${cases.map((caseRecord) => JSON.stringify(caseRecord)).join("\n")}\n`;
}

function markReview(caseRecord: BenchmarkCase, reason: string): BenchmarkCase {
  const metadata = caseRecord.metadata ?? {};
  return {
    ...caseRecord,
    metadata: { ...metadata, review: true, reviewReason: reason },
  };
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
