import { describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import { answerEvaluationSchema, parsedVocabularyProposalSchema } from "@/server/ai/types";

describe("MockAIProvider", () => {
  const provider = new MockAIProvider();

  it("parses 'lemma - translation' lines into schema-valid proposals", async () => {
    const proposals = await provider.parseVocabulary({
      text: "hola - hello\ngato = cat",
      existingVocabulary: [],
    });

    expect(proposals).toHaveLength(2);
    for (const proposal of proposals) {
      expect(() => parsedVocabularyProposalSchema.parse(proposal)).not.toThrow();
    }
    expect(proposals[0]?.lemma).toBe("hola");
    expect(proposals[0]?.translation).toBe("hello");
    expect(proposals[0]?.needsReview).toBe(false);
  });

  it("flags lines without a translation for review", async () => {
    const [proposal] = await provider.parseVocabulary({
      text: "incomprensible",
      existingVocabulary: [],
    });

    expect(proposal?.needsReview).toBe(true);
  });

  it("evaluates an exact answer as correct", async () => {
    const result = await provider.evaluateAnswer({
      expectedMeaning: "hello",
      acceptedAnswers: ["hello", "hi"],
      userAnswer: "Hello",
    });

    expect(() => answerEvaluationSchema.parse(result)).not.toThrow();
    expect(result.result).toBe("correct");
  });

  it("evaluates an unrelated answer as incorrect", async () => {
    const result = await provider.evaluateAnswer({
      expectedMeaning: "hello",
      acceptedAnswers: ["hello"],
      userAnswer: "goodbye",
    });

    expect(result.result).toBe("incorrect");
  });
});
