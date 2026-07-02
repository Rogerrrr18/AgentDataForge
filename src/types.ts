/**
 * @fileoverview Core contracts for AgentDataForge.
 */

export type SourceKind = "huggingface" | "github" | "manual";

export type RecordKind = "dataset" | "benchmark" | "repository" | "paper" | "collection" | "other";

export type RiskLevel = "low" | "medium" | "high" | "restricted" | "unknown";

export type AgentTaskType =
  | "dialogue"
  | "rag_qa"
  | "tool_use"
  | "code"
  | "planning"
  | "classification"
  | "data_extraction"
  | "custom";

export type DatasetCandidate = {
  id: string;
  source: SourceKind;
  recordKind: RecordKind;
  title: string;
  summary: string | null;
  sourceUrl: string;
  downloadUrl?: string | null;
  licenseName?: string | null;
  languages: string[];
  taskTypes: string[];
  modalities: string[];
  domains: string[];
  fileFormats: string[];
  hasDownload: boolean;
  hasSamples: boolean;
  commercialRisk: RiskLevel;
  redistributionRisk: RiskLevel;
  rawPayload: unknown;
  metadata: Record<string, unknown>;
};

export type SchemaSignalKey =
  | "taskInstruction"
  | "input"
  | "expectedOutput"
  | "acceptanceCriteria"
  | "rubric"
  | "checker"
  | "retrievalContext"
  | "toolTrace"
  | "environmentState"
  | "metadata"
  | "license"
  | "split";

export type SchemaSignal = {
  key: SchemaSignalKey;
  present: boolean;
  confidence: number;
  evidence: string[];
};

export type SchemaProfile = {
  taskType: AgentTaskType;
  completeness: number;
  readinessLevel: 1 | 2 | 3 | 4 | 5;
  signals: SchemaSignal[];
  evaluatorCandidates: Array<"llm_judge" | "exact_match" | "regex_match" | "f1_match" | "unit_test" | "environment_state_test" | "human_label">;
  missingCriticalFields: SchemaSignalKey[];
  notes: string[];
};

export type BenchmarkCase = {
  caseId: string;
  taskType?: AgentTaskType;
  input?: unknown;
  expected?: unknown;
  context?: unknown;
  messages?: unknown;
  trace?: unknown;
  environment?: unknown;
  rubric?: unknown;
  checker?: unknown;
  metadata?: Record<string, unknown>;
};

export type BenchmarkManifest = {
  schemaVersion: "agent-data-forge.manifest.v0";
  generatedAt: string;
  source: {
    name: string;
    url?: string;
    licenseName?: string | null;
  };
  summary: {
    caseCount: number;
    taskTypes: AgentTaskType[];
    schemaCompleteness: number;
    readinessLevel: 1 | 2 | 3 | 4 | 5;
  };
  industryProfile: IndustryProfile;
  schemaProfile: SchemaProfile;
  enrichmentPlan: DataValueEnhancementPlan;
  recommendedNextActions: string[];
};

export type IndustryTaxonomyItem = {
  slug: string;
  label: string;
  description: string;
  agentWorkflows: string[];
};

export type IndustryMatch = {
  slug: string;
  label: string;
  confidence: number;
  matchedKeywords: string[];
  workflowHints: string[];
};

export type IndustryProfile = {
  primaryIndustry: string;
  matches: IndustryMatch[];
  isIndustrySpecific: boolean;
};

export type DataValueTier = "raw_metadata" | "candidate_dataset" | "benchmark_seed" | "eval_ready_pack" | "commercial_pack";

export type EnrichmentStep = {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium";
  automatable: boolean;
  inputs: string[];
  outputs: string[];
};

export type DataValueEnhancementPlan = {
  currentTier: DataValueTier;
  targetTier: DataValueTier;
  estimatedReadinessLift: number;
  industry: string;
  workflowFocus: string[];
  steps: EnrichmentStep[];
  packagingRisks: string[];
};
