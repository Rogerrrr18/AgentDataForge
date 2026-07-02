/**
 * @fileoverview Shared industry segmentation for Agent benchmark data.
 */

import taxonomyJson from "../../data/taxonomy/industries.json" with { type: "json" };
import type { BenchmarkCase, DatasetCandidate, IndustryProfile, IndustryTaxonomyItem } from "../types.js";

const TAXONOMY = taxonomyJson as IndustryTaxonomyItem[];

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  "customer-service": ["customer", "support", "ticket", "complaint", "refund", "return", "escalation", "faq", "service"],
  finance: ["finance", "financial", "bank", "banking", "insurance", "claim", "risk", "fraud", "payment", "loan"],
  healthcare: ["medical", "health", "clinical", "patient", "doctor", "triage", "diagnosis", "hospital", "medicine"],
  legal: ["legal", "law", "contract", "compliance", "policy", "case", "court", "clause", "regulation"],
  education: ["education", "exam", "student", "tutor", "course", "curriculum", "grading", "learning", "school"],
  software: ["code", "software", "github", "repository", "swe", "bug", "programming", "pull request", "test"],
  research: ["research", "paper", "citation", "literature", "study", "evidence synthesis"],
  procurement: ["procurement", "vendor", "purchase", "quote", "supplier", "rfp", "sourcing", "contract intake"],
  hr: ["hr", "human resources", "recruiting", "resume", "interview", "onboarding", "employee", "policy"],
  ecommerce: ["ecommerce", "e-commerce", "shopping", "order", "product", "review", "cart", "merchant", "returns"],
  logistics: ["logistics", "shipment", "shipping", "warehouse", "route", "delivery", "eta", "tracking"],
  manufacturing: ["manufacturing", "factory", "maintenance", "quality control", "inventory", "incident", "operations"],
  government: ["government", "public service", "citizen", "form", "agency", "policy guidance", "open data"],
};

/**
 * Infer an industry profile from candidate metadata, sample cases, and optional query text.
 *
 * @param input Candidate, cases, and query context.
 * @returns Ranked industry profile.
 */
export function profileIndustry(input: {
  candidate?: DatasetCandidate;
  cases?: BenchmarkCase[];
  query?: string;
}): IndustryProfile {
  const explicitDomains = input.candidate?.domains ?? [];
  const text = searchableText(input).toLowerCase();

  const matches = TAXONOMY.map((item) => {
    const keywords = INDUSTRY_KEYWORDS[item.slug] ?? [];
    const matchedKeywords = keywords.filter((keyword) => matchesKeyword(text, keyword));
    const explicitBoost = explicitDomains.includes(item.slug) ? 0.45 : 0;
    const keywordScore = Math.min(0.45, matchedKeywords.length * 0.11);
    const workflowMatches = item.agentWorkflows.filter((workflow) => matchesKeyword(text, workflow.toLowerCase()));
    const workflowBoost = Math.min(0.1, workflowMatches.length * 0.05);
    return {
      slug: item.slug,
      label: item.label,
      confidence: clamp01(explicitBoost + keywordScore + workflowBoost),
      matchedKeywords: [...new Set([...matchedKeywords, ...workflowMatches])],
      workflowHints: item.agentWorkflows,
    };
  })
    .filter((match) => match.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence || left.slug.localeCompare(right.slug));

  const fallback = TAXONOMY.find((item) => item.slug === "general") ?? TAXONOMY[0];
  const rankedMatches = matches.length > 0
    ? matches
    : [{
      slug: fallback.slug,
      label: fallback.label,
      confidence: 0.2,
      matchedKeywords: [],
      workflowHints: fallback.agentWorkflows,
    }];

  return {
    primaryIndustry: rankedMatches[0]?.slug ?? "general",
    matches: rankedMatches.slice(0, 3),
    isIndustrySpecific: rankedMatches[0]?.slug !== "general" && (rankedMatches[0]?.confidence ?? 0) >= 0.3,
  };
}

/**
 * Infer industry slugs for connector-level candidate normalization.
 *
 * @param text Searchable metadata text.
 * @returns Ranked industry slugs.
 */
export function inferIndustrySlugs(text: string): string[] {
  const slugs = profileIndustry({ query: text }).matches.map((match) => match.slug);
  const specificSlugs = slugs.filter((slug) => slug !== "general");
  return specificSlugs.length > 0 ? specificSlugs : slugs;
}

export function getIndustryTaxonomy(): IndustryTaxonomyItem[] {
  return TAXONOMY;
}

function searchableText(input: { candidate?: DatasetCandidate; cases?: BenchmarkCase[]; query?: string }): string {
  return [
    input.query,
    input.candidate?.title,
    input.candidate?.summary,
    input.candidate?.sourceUrl,
    ...(input.candidate?.domains ?? []),
    ...(input.candidate?.taskTypes ?? []),
    ...(input.candidate?.modalities ?? []),
    JSON.stringify(input.candidate?.metadata ?? {}),
    JSON.stringify((input.cases ?? []).slice(0, 20)),
  ].filter(Boolean).join(" ");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
