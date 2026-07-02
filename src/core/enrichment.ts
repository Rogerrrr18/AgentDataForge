/**
 * @fileoverview Automated data value enhancement workflow planning.
 */

import type {
  DataValueEnhancementPlan,
  DataValueTier,
  EnrichmentStep,
  IndustryProfile,
  SchemaProfile,
} from "../types.js";

/**
 * Build an actionable plan for turning thin public data into a benchmark-ready pack.
 *
 * @param input Schema and industry profiles.
 * @returns Prioritized enrichment workflow.
 */
export function buildDataValueEnhancementPlan(input: {
  schemaProfile: SchemaProfile;
  industryProfile: IndustryProfile;
}): DataValueEnhancementPlan {
  const currentTier = inferCurrentTier(input.schemaProfile);
  const targetTier = inferTargetTier(input.schemaProfile);
  const steps = buildSteps(input.schemaProfile, input.industryProfile);
  const packagingRisks = buildPackagingRisks(input.schemaProfile);
  const estimatedReadinessLift = estimateReadinessLift(input.schemaProfile, steps);
  const primary = input.industryProfile.matches[0];

  return {
    currentTier,
    targetTier,
    estimatedReadinessLift,
    industry: input.industryProfile.primaryIndustry,
    workflowFocus: primary?.workflowHints.slice(0, 3) ?? [],
    steps,
    packagingRisks,
  };
}

function inferCurrentTier(profile: SchemaProfile): DataValueTier {
  const present = new Set(profile.signals.filter((signal) => signal.present).map((signal) => signal.key));
  if (profile.readinessLevel >= 4 && present.has("checker")) return "eval_ready_pack";
  if (profile.readinessLevel >= 3 && present.has("expectedOutput")) return "benchmark_seed";
  if (profile.readinessLevel >= 2 || present.has("input")) return "candidate_dataset";
  return "raw_metadata";
}

function inferTargetTier(profile: SchemaProfile): DataValueTier {
  if (profile.missingCriticalFields.includes("license")) return "eval_ready_pack";
  if (profile.readinessLevel >= 4) return "commercial_pack";
  return "eval_ready_pack";
}

function buildSteps(profile: SchemaProfile, industry: IndustryProfile): EnrichmentStep[] {
  const missing = new Set(profile.signals.filter((signal) => !signal.present).map((signal) => signal.key));
  const steps: EnrichmentStep[] = [];

  if (missing.has("input")) {
    steps.push({
      id: "normalize-input",
      title: "Normalize raw samples into explicit Agent inputs",
      priority: "critical",
      automatable: true,
      inputs: ["source samples", "README schema notes"],
      outputs: ["input field", "caseId", "task instruction"],
    });
  }

  if (missing.has("expectedOutput")) {
    steps.push({
      id: "derive-gold-expected",
      title: "Derive or annotate gold expected outputs",
      priority: "critical",
      automatable: false,
      inputs: ["source labels", "accepted answers", "human review rubric"],
      outputs: ["expected field", "gold answer provenance"],
    });
  }

  if (missing.has("license")) {
    steps.push({
      id: "resolve-license",
      title: "Resolve license and redistribution policy",
      priority: "critical",
      automatable: true,
      inputs: ["dataset card", "repository license", "source terms"],
      outputs: ["licenseName", "commercialRisk", "redistributionRisk"],
    });
  }

  if (missing.has("rubric") || missing.has("acceptanceCriteria")) {
    steps.push({
      id: "generate-rubric",
      title: "Generate task-specific rubrics and acceptance criteria",
      priority: "high",
      automatable: true,
      inputs: ["task type", "industry workflow", "expected outputs"],
      outputs: ["rubric", "acceptanceCriteria"],
    });
  }

  if (missing.has("checker")) {
    steps.push({
      id: "synthesize-checkers",
      title: "Synthesize deterministic checker candidates",
      priority: "high",
      automatable: true,
      inputs: ["expected outputs", "rubric", "case metadata"],
      outputs: ["exact/regex/unit checker specs", "checker confidence"],
    });
  }

  if (missing.has("retrievalContext") && profile.taskType === "rag_qa") {
    steps.push({
      id: "attach-context",
      title: "Attach retrieval context and provenance snapshots",
      priority: "high",
      automatable: true,
      inputs: ["source documents", "dataset references"],
      outputs: ["context", "provenance snapshots"],
    });
  }

  if (missing.has("toolTrace") || missing.has("environmentState")) {
    steps.push({
      id: "spec-agent-environment",
      title: "Add tool trace and environment state specifications",
      priority: "medium",
      automatable: true,
      inputs: ["workflow focus", "tool API assumptions", "state fixtures"],
      outputs: ["toolTrace", "environment", "state assertions"],
    });
  }

  if (missing.has("split") || missing.has("metadata")) {
    steps.push({
      id: "package-splits",
      title: "Package train/dev/test splits with provenance metadata",
      priority: "medium",
      automatable: true,
      inputs: ["normalized cases", "source metadata"],
      outputs: ["split", "metadata", "manifest provenance"],
    });
  }

  if (profile.readinessLevel >= 5) {
    steps.push({
      id: "commercial-hardening",
      title: "Calibrate reviewer rubrics and executable checker adapters",
      priority: "high",
      automatable: false,
      inputs: ["rubric", "checker specs", "pilot model runs"],
      outputs: ["reviewer calibration examples", "executable checker adapters", "quality report"],
    });
  }

  steps.push({
    id: "industry-packaging",
    title: `Package as ${industry.primaryIndustry} Agent benchmark workflow`,
    priority: "medium",
    automatable: true,
    inputs: ["industry taxonomy", "workflow focus", "readiness profile"],
    outputs: ["benchmark pack description", "buyer-facing gap report"],
  });

  return dedupeSteps(steps);
}

function buildPackagingRisks(profile: SchemaProfile): string[] {
  const risks: string[] = [];
  const missing = new Set(profile.signals.filter((signal) => !signal.present).map((signal) => signal.key));
  if (missing.has("license")) risks.push("Cannot redistribute or sell until license metadata is resolved.");
  if (missing.has("expectedOutput")) risks.push("Cannot claim benchmark validity without gold expected outputs.");
  if (missing.has("checker")) risks.push("Needs deterministic checkers before being positioned as a high-confidence eval pack.");
  if (missing.has("environmentState")) risks.push("Long-horizon Agent claims are weak without environment fixtures or state assertions.");
  return risks;
}

function estimateReadinessLift(profile: SchemaProfile, steps: EnrichmentStep[]): number {
  const lift = steps.reduce((sum, step) => {
    if (step.priority === "critical") return sum + 0.13;
    if (step.priority === "high") return sum + 0.09;
    return sum + 0.05;
  }, 0);
  return Math.max(0, Math.min(1, Number((profile.completeness + lift).toFixed(2))));
}

function dedupeSteps(steps: EnrichmentStep[]): EnrichmentStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.id)) return false;
    seen.add(step.id);
    return true;
  });
}
