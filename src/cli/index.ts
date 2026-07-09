/**
 * @fileoverview AgentDataForge CLI.
 */

import { readFile } from "node:fs/promises";
import { discoverCandidates } from "../core/discovery.js";
import { buildBenchmarkManifest } from "../core/manifest.js";
import { loadCasesJsonl } from "../synthesis/case-loader.js";
import { createLLMClient } from "../synthesis/llm/config.js";
import { buildFromScratchPrompt } from "../synthesis/prompts/from-scratch.js";
import { buildSeededPrompt } from "../synthesis/prompts/seeded.js";
import { runEnrichment, runSynthesis, type SynthesisOptions } from "../synthesis/pipeline.js";
import { loadTaskSpec } from "../synthesis/spec.js";
import type { BenchmarkCase } from "../types.js";

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "discover") {
  const query = args[0];
  if (!query) fail("Usage: agent-data-forge discover <query> [--source huggingface|github|all] [--limit 10]");
  const source = readFlag(args, "--source") ?? "all";
  const limit = Number(readFlag(args, "--limit") ?? 10);
  if (source !== "all" && source !== "huggingface" && source !== "github") {
    fail(`Unsupported source: ${source}`);
  }
  const candidates = await discoverCandidates({ query, source, limit });
  writeJson({ query, source, limit, count: candidates.length, candidates });
  process.exit(0);
}

if (command === "manifest") {
  const filePath = args[0];
  if (!filePath) fail("Usage: agent-data-forge manifest <cases.jsonl>");
  const text = await readFile(filePath, "utf8");
  const cases = parseJsonlCases(text);
  const manifest = buildBenchmarkManifest({
    sourceName: filePath,
    cases,
  });
  writeJson(manifest);
  process.exit(0);
}

if (command === "synthesize") {
  const outPath = readFlag(args, "--out");
  const dryRun = args.includes("--dry-run");

  // Closed-loop enrichment mode.
  const fromManifest = readFlag(args, "--from-manifest");
  if (fromManifest) {
    const casesPath = readFlag(args, "--cases");
    if (!casesPath) {
      fail("Usage: agent-data-forge synthesize --from-manifest <manifest.json> --cases <cases.jsonl> [--out path]");
    }
    try {
      const client = createLLMClient();
      const { report } = await runEnrichment({ manifestPath: fromManifest, casesPath, client, outPath });
      writeJson(report);
      process.exit(0);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  // Spec-driven generation mode.
  const specPath = args[0];
  if (!specPath) {
    fail("Usage: agent-data-forge synthesize <spec.json> [--limit 10] [--out path] [--judge] [--dedupe] [--dry-run]");
  }
  const limitFlag = readFlag(args, "--limit");
  const limit = limitFlag ? Number(limitFlag) : undefined;
  const options: SynthesisOptions = {};
  if (args.includes("--judge")) options.judge = {};
  if (args.includes("--dedupe")) options.dedupe = true;
  const maxTokensFlag = readFlag(args, "--max-tokens");
  if (maxTokensFlag) options.budget = { maxTokens: Number(maxTokensFlag) };

  try {
    if (dryRun) {
      await printSynthesizePreview(specPath, limit);
    } else {
      const client = createLLMClient();
      const { report } = await runSynthesis({ specPath, client, limit, outPath, options });
      writeJson(report);
    }
    process.exit(0);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

fail(`Unknown command: ${command}`);

function parseJsonlCases(text: string): BenchmarkCase[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as BenchmarkCase;
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function printSynthesizePreview(specPath: string, limit: number | undefined): Promise<void> {
  const spec = await loadTaskSpec(specPath);
  const count = limit ?? spec.count;
  const seeds = spec.mode === "seeded" && spec.seedCases
    ? await loadCasesJsonl(specPath, spec.seedCases)
    : undefined;
  const built = spec.mode === "seeded" && seeds && seeds.length > 0
    ? buildSeededPrompt({ spec, seeds, index: 0, count })
    : buildFromScratchPrompt({ spec, index: 0, count });
  process.stdout.write(`--- spec: ${spec.name} (mode=${spec.mode}, count=${count}) ---\n`);
  process.stdout.write(`\n=== SYSTEM ===\n${built.system}\n`);
  process.stdout.write(`\n=== USER ===\n${built.user}\n`);
}

function printHelp(): void {
  process.stdout.write(`AgentDataForge

Commands:
  discover <query> [--source huggingface|github|all] [--limit 10]
  manifest <cases.jsonl>
  synthesize <spec.json> [--limit 10] [--out path] [--judge] [--dedupe] [--max-tokens N] [--dry-run]
  synthesize --from-manifest <manifest.json> --cases <cases.jsonl> [--out path]

Environment (synthesize):
  LLM_API_KEY, LLM_MODEL (required)  ·  LLM_BASE_URL, LLM_TEMPERATURE,
  LLM_TIMEOUT_MS, LLM_JSON_MODE (optional)

Examples:
  npm run forge -- discover "customer support agent benchmark" --source huggingface --limit 5
  npm run forge -- manifest examples/minimal-cases.jsonl
  npm run forge -- synthesize examples/synth-specs/customer-support.json --dry-run
  npm run forge -- synthesize examples/synth-specs/customer-support.json --judge --dedupe
  npm run forge -- synthesize --from-manifest manifest.json --cases cases.jsonl
`);
}
