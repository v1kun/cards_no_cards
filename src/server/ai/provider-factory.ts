import "server-only";

import { env } from "@/lib/env";
import type { AIProvider } from "./types";
import { MockAIProvider } from "./adapters/mock-provider";

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
      // The OpenAI adapter is introduced in the AI-provider phase.
      throw new Error(
        "AI_PROVIDER=openai is not implemented yet. Set AI_PROVIDER=mock for local development.",
      );
    default: {
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Unsupported AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}
