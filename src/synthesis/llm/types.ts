/**
 * @fileoverview LLM client contracts for the synthesis engine.
 *
 * Provider-agnostic: the synthesis engine depends only on LLMClient. Concrete
 * implementations (OpenAI-compatible by default) are created in config.ts and
 * can be swapped by pointing at a different endpoint/credential set.
 */

export type LLMRole = "system" | "user" | "assistant";

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

export type GenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  /** Free-form label for logging/telemetry (e.g. "seeded-case-3"). */
  label?: string;
};

export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

export type LLMResult = {
  text: string;
  usage?: LLMUsage;
  /** Raw provider response, retained for debugging. */
  raw?: unknown;
};

/**
 * Minimal LLM interface the synthesis engine relies on.
 * Implementations call a provider and return a single completion string.
 */
export interface LLMClient {
  readonly model: string;
  generate(messages: LLMMessage[], opts?: GenerateOptions): Promise<LLMResult>;
}
