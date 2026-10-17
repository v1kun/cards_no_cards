import { describe, expect, it, vi } from "vitest";

import { OpenAIProvider, type ChatClient } from "@/server/ai/adapters/openai-provider";
import { AIResponseError } from "@/server/ai/errors";

function makeProvider(client: ChatClient, overrides?: { maxRetries?: number }) {
  return new OpenAIProvider({
    apiKey: "test",
    model: "test-model",
    timeoutMs: 1_000,
    maxRetries: overrides?.maxRetries ?? 0,
    minIntervalMs: 0,
    client,
  });
}

describe("OpenAIProvider error handling", () => {
  it("rejects non-JSON model output with AIResponseError", async () => {
    const provider = makeProvider({ complete: async () => "not json" });
    await expect(
      provider.generateExample({ lemma: "hablar", translation: "to speak" }),
    ).rejects.toBeInstanceOf(AIResponseError);
  });

  it("rejects structurally invalid output with AIResponseError", async () => {
    const provider = makeProvider({
      complete: async () => JSON.stringify({ sentence: "missing translation" }),
    });
    await expect(
      provider.generateExample({ lemma: "hablar", translation: "to speak" }),
    ).rejects.toBeInstanceOf(AIResponseError);
  });

  it("salvages partially-valid parse items by marking them for review", async () => {
    const provider = makeProvider({
      complete: async () =>
        JSON.stringify({
          items: [
            {
              lemma: "hablar",
              translation: "to speak",
              partOfSpeech: "verb",
              topics: [],
              forms: [],
              needsReview: false,
            },
            // Invalid partOfSpeech — should be salvaged, not dropped.
            { lemma: "correr", translation: "to run", partOfSpeech: "motion" },
            // No lemma — unsalvageable, dropped.
            { translation: "nothing" },
          ],
        }),
    });

    const proposals = await provider.parseVocabulary({ text: "x", existingVocabulary: [] });
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.needsReview).toBe(false);
    expect(proposals[1]?.lemma).toBe("correr");
    expect(proposals[1]?.needsReview).toBe(true);
    expect(proposals[1]?.partOfSpeech).toBe("other");
  });

  it("retries retryable provider failures and then succeeds", async () => {
    let calls = 0;
    const complete = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        const error = Object.assign(new Error("rate limited"), { status: 429 });
        throw error;
      }
      return JSON.stringify({ result: "correct", feedback: "ok" });
    });
    const provider = makeProvider({ complete }, { maxRetries: 2 });

    const evaluation = await provider.evaluateAnswer({
      expectedMeaning: "to speak",
      acceptedAnswers: ["to speak"],
      userAnswer: "to speak",
    });
    expect(evaluation.result).toBe("correct");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not retry malformed responses", async () => {
    const complete = vi.fn(async () => "not json");
    const provider = makeProvider({ complete }, { maxRetries: 3 });
    await expect(
      provider.generateExample({ lemma: "hablar", translation: "to speak" }),
    ).rejects.toBeInstanceOf(AIResponseError);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
