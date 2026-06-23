/**
 * @fileoverview AgentDataForge CLI.
 */

import { readFile } from "node:fs/promises";
import { discoverCandidates } from "../core/discovery.js";
import { buildBenchmarkManifest } from "../core/manifest.js";
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

function printHelp(): void {
  process.stdout.write(`AgentDataForge

Commands:
  discover <query> [--source huggingface|github|all] [--limit 10]
  manifest <cases.jsonl>

Examples:
  npm run forge -- discover "customer support agent benchmark" --source huggingface --limit 5
  npm run forge -- manifest examples/minimal-cases.jsonl
`);
}
