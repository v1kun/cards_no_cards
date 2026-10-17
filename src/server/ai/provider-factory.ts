import "server-only";

import { env } from "@/lib/env";
import type { AIProvider } from "./types";
import { MockAIProvider } from "./adapters/mock-provider";
import { OpenAIProvider } from "./adapters/openai-provider";

/**
 * Returns the configured AI provider adapter.
 *
 * Selection is configuration-driven via `AI_PROVIDER`. Real adapters
 * (e.g. OpenAI) are added here behind the same interface; domain code
 * never imports a vendor SDK directly.
 */
export function createAIProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case "mock":
      return new MockAIProvider();
    case "openai":
      return new OpenAIProvider({
        // `env` validation guarantees the key is present when provider=openai.
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.AI_MODEL ?? "gpt-4o-mini",
        baseURL: env.AI_BASE_URL,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
        minIntervalMs: env.AI_MIN_REQUEST_INTERVAL_MS,
      });
    default: {
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Unsupported AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}
