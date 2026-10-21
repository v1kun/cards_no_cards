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

/** A word to generate practice questions for. `key` echoes back in the output. */
export type ExerciseGenerationWord = {
  key: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
  forms: string[];
  exampleSentence?: string | null;
};

export const generatedExerciseSchema = z.object({
  exerciseType: z.string(),
  instruction: z.string(),
  promptText: z.string(),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string(),
  acceptedAnswers: z.array(z.string()),
});

export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;

/**
 * Raw generated questions per word. Structurally parsed only; domain
 * validation (answer among options, no leaks, cloze blank) happens in the
 * bank service, which drops anything unusable.
 */
export type GeneratedExerciseSet = {
  key: string;
  exercises: GeneratedExercise[];
};

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

  /**
   * Generates a small set of practice questions for each word, in one
   * request for the whole batch. Translations and instructions are written
   * in `translationLanguage` ("en" or "ru").
   */
  generateExercises(input: {
    words: ExerciseGenerationWord[];
    translationLanguage: string;
  }): Promise<GeneratedExerciseSet[]>;
}
