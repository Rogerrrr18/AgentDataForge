/**
 * @fileoverview Shared helpers for benchmark case records.
 */

import type { BenchmarkCase } from "../types.js";

/**
 * Infer a license name from case-level metadata, checking the record root and
 * the nested `metadata` object for `licenseName` or `license`.
 *
 * @param cases Benchmark cases to scan.
 * @returns First non-empty license name found, or null.
 */
export function inferCaseLicenseName(cases: BenchmarkCase[]): string | null {
  for (const item of cases) {
    const record = item as Record<string, unknown>;
    const metadata = item.metadata ?? {};
    const licenseName = record.licenseName ?? record.license ?? metadata.licenseName ?? metadata.license;
    if (typeof licenseName === "string" && licenseName.trim()) return licenseName.trim();
  }
  return null;
}
