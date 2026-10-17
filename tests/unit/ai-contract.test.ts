import { describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import { OpenAIProvider, type ChatClient } from "@/server/ai/adapters/openai-provider";
import {
  answerEvaluationSchema,
  generatedExampleSchema,
  parsedVocabularyProposalSchema,
  type AIProvider,
} from "@/server/ai/types";

/**
 * Contract tests: every adapter must satisfy the vendor-neutral
 * {@link AIProvider} interface and return schema-valid output. The OpenAI
 * adapter runs against a canned {@link ChatClient} so no live AI request is
 * made.
 */

const cannedClient: ChatClient = {
  async complete({ system }) {
    if (system.includes("extract Spanish vocabulary")) {
      return JSON.stringify({
        items: [
          {
            lemma: "hablar",
            translation: "to speak",
            partOfSpeech: "verb",
            topics: ["Verbs"],
            forms: [{ form: "hablo", formType: "present_1s" }],
            needsReview: false,
          },
        ],
      });
    }
    if (system.includes("example sentence")) {
      return JSON.stringify({ sentence: "Hablo español.", translation: "I speak Spanish." });
    }
    return JSON.stringify({ result: "correct", feedback: "Well done." });
  },
};

const providers: Array<{ label: string; provider: AIProvider }> = [
  { label: "mock", provider: new MockAIProvider() },
  {
    label: "openai",
    provider: new OpenAIProvider({
      apiKey: "test",
      model: "test-model",
      timeoutMs: 1_000,
      maxRetries: 0,
      minIntervalMs: 0,
      client: cannedClient,
    }),
  },
];

describe.each(providers)("AIProvider contract: $label", ({ provider }) => {
  it("exposes a stable name", () => {
    expect(typeof provider.name).toBe("string");
    expect(provider.name.length).toBeGreaterThan(0);
  });

  it("parseVocabulary returns schema-valid proposals", async () => {
    const proposals = await provider.parseVocabulary({
      text: "hablar - to speak",
      existingVocabulary: [],
    });
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(() => parsedVocabularyProposalSchema.parse(proposal)).not.toThrow();
    }
  });

  it("generateExample returns a schema-valid example", async () => {
    const example = await provider.generateExample({ lemma: "hablar", translation: "to speak" });
    expect(() => generatedExampleSchema.parse(example)).not.toThrow();
  });

  it("evaluateAnswer returns a schema-valid evaluation", async () => {
    const evaluation = await provider.evaluateAnswer({
      expectedMeaning: "to speak",
      acceptedAnswers: ["to speak"],
      userAnswer: "to speak",
    });
    expect(() => answerEvaluationSchema.parse(evaluation)).not.toThrow();
  });
});
