/**
 * @fileoverview LLM configuration loaded from environment variables.
 *
 * Required: LLM_API_KEY, LLM_MODEL.
 * Optional: LLM_BASE_URL (default OpenAI), LLM_TEMPERATURE, LLM_TIMEOUT_MS,
 *           LLM_JSON_MODE.
 */

import { createOpenAICompatibleClient } from "./openai-compatible.js";
import type { LLMClient } from "./types.js";

export type LLMEnvConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  jsonMode: boolean;
};

const MISSING_CONFIG_HINT = `Set the following environment variables to enable LLM synthesis:

  LLM_API_KEY      your provider API key (required)
  LLM_MODEL        model id, e.g. gpt-4o-mini, deepseek-chat (required)
  LLM_BASE_URL     OpenAI-compatible endpoint (default: https://api.openai.com/v1)
  LLM_TEMPERATURE  sampling temperature (default: 0.8)
  LLM_TIMEOUT_MS   request timeout in ms (default: 60000)
  LLM_JSON_MODE    "false" if your endpoint rejects response_format (default: true)

Most providers (OpenAI, DeepSeek, Qwen, Zhipu, Moonshot, vLLM, Ollama) speak the
OpenAI /chat/completions format, so only LLM_API_KEY + LLM_MODEL are usually needed.`;

export class MissingLLMConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required LLM env var(s): ${missing.join(", ")}\n\n${MISSING_CONFIG_HINT}`);
    this.name = "MissingLLMConfigError";
  }
}

/**
 * Read and validate the LLM env config. Throws MissingLLMConfigError if a
 * required variable is absent.
 */
export function readLLMConfig(env: NodeJS.ProcessEnv = process.env): LLMEnvConfig {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  const missing: string[] = [];
  if (!apiKey) missing.push("LLM_API_KEY");
  if (!model) missing.push("LLM_MODEL");
  if (missing.length > 0) throw new MissingLLMConfigError(missing);

  return {
    baseUrl: env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
    apiKey: apiKey as string,
    model: model as string,
    temperature: parseNumber(env.LLM_TEMPERATURE, 0.8),
    timeoutMs: parseNumber(env.LLM_TIMEOUT_MS, 60000),
    jsonMode: parseBoolean(env.LLM_JSON_MODE, true),
  };
}

/**
 * Create an LLMClient from the current environment.
 */
export function createLLMClient(env: NodeJS.ProcessEnv = process.env): LLMClient {
  const config = readLLMConfig(env);
  return createOpenAICompatibleClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    jsonMode: config.jsonMode,
  });
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no"].includes(normalized)) return false;
  if (["true", "1", "yes"].includes(normalized)) return true;
  return fallback;
}
