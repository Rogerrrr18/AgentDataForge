/**
 * @fileoverview Load seed BenchmarkCase records from a JSONL file.
 *
 * Paths are resolved relative to the spec file directory so specs stay portable.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BenchmarkCase } from "../types.js";

export async function loadCasesJsonl(specFilePath: string, seedCasesPath: string): Promise<BenchmarkCase[]> {
  const resolved = resolve(specFilePath, "..", seedCasesPath);
  const text = await readFile(resolved, "utf8");
  return parseJsonlCases(text, resolved);
}

export function parseJsonlCases(text: string, source = "<inline>"): BenchmarkCase[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as BenchmarkCase;
      } catch (error) {
        throw new Error(
          `Invalid JSONL at ${source}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
}
