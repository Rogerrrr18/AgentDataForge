/**
 * @fileoverview OpenAI-compatible chat completion client.
 *
 * Works with any endpoint that mirrors POST /chat/completions: OpenAI, DeepSeek,
 * Qwen (DashScope compatible mode), Zhipu, Moonshot, local vLLM, Ollama (OpenAI
 * shim), and others. Users only need to configure base URL + key + model.
 */

import { fetchWithRetry } from "../../connectors/http.js";
import type { GenerateOptions, LLMClient, LLMMessage, LLMResult } from "./types.js";

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** Request JSON-mode output. Disable if the endpoint rejects response_format. */
  jsonMode?: boolean;
};

type ChatChoice = {
  message?: { content?: string | null };
};

type ChatResponse = {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Create an LLMClient backed by an OpenAI-compatible /chat/completions endpoint.
 */
export function createOpenAICompatibleClient(config: OpenAICompatibleConfig): LLMClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 60000;
  const jsonMode = config.jsonMode ?? true;

  return {
    model: config.model,

    async generate(messages: LLMMessage[], opts: GenerateOptions = {}): Promise<LLMResult> {
      const url = new URL(`${baseUrl}/chat/completions`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchWithRetry(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: opts.temperature ?? config.temperature ?? 0.8,
            ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 300)}`);
        }

        const data = (await response.json()) as ChatResponse;
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text) {
          throw new Error("LLM returned an empty completion");
        }

        return {
          text,
          usage: {
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
          },
          raw: data,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
