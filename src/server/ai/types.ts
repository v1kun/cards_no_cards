import { z } from "zod";

/**
 * Vendor-neutral AI provider contract.
 *
 * Domain services depend on these types only. Provider-specific request
 * and response shapes, SDK imports, and credentials live inside the
 * individual adapters under `./adapters`.
 */

export const partOfSpeechValues = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "pronoun",
  "conjunction",
  "expression",
  "other",
] as const;

export const genderValues = ["masculine", "feminine", "common", "unknown"] as const;

export const parsedVocabularyProposalSchema = z.object({
  lemma: z.string().min(1),
  translation: z.string().min(1),
  partOfSpeech: z.enum(partOfSpeechValues),
  definition: z.string().optional(),
  gender: z.enum(genderValues).optional(),
  topics: z.array(z.string()),
  forms: z.array(
    z.object({
      form: z.string().min(1),
      formType: z.string().optional(),
      grammarNote: z.string().optional(),
    }),
  ),
  exampleSentence: z.string().optional(),
  exampleTranslation: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  needsReview: z.boolean(),
});

export type ParsedVocabularyProposal = z.infer<typeof parsedVocabularyProposalSchema>;

export const generatedExampleSchema = z.object({
  sentence: z.string().min(1),
  translation: z.string().min(1),
});

export type GeneratedExample = z.infer<typeof generatedExampleSchema>;

export const answerEvaluationSchema = z.object({
  result: z.enum(["correct", "partially_correct", "incorrect", "uncertain"]),
  feedback: z.string(),
});

export type AnswerEvaluation = z.infer<typeof answerEvaluationSchema>;

export type ExistingVocabularyCandidate = {
  id: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
};

export interface AIProvider {
  readonly name: string;

  parseVocabulary(input: {
    text: string;
    existingVocabulary: ExistingVocabularyCandidate[];
  }): Promise<ParsedVocabularyProposal[]>;

  generateExample(input: {
    lemma: string;
    translation: string;
    level?: string;
    topic?: string;
  }): Promise<GeneratedExample>;

  evaluateAnswer(input: {
    expectedMeaning: string;
    acceptedAnswers: string[];
    userAnswer: string;
    context?: string;
  }): Promise<AnswerEvaluation>;
}
