import type {
  AIProvider,
  AnswerEvaluation,
  ExerciseGenerationWord,
  ExistingVocabularyCandidate,
  GeneratedExample,
  GeneratedExerciseSet,
  ParsedVocabularyProposal,
} from "../types";

/**
 * Deterministic mock AI provider.
 *
 * Used for local development and automated tests so the app runs with no
 * paid API calls and produces stable, assertable output. It performs a
 * naive line-based parse of the input text and never contacts a network.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async parseVocabulary(input: {
    text: string;
    existingVocabulary: ExistingVocabularyCandidate[];
  }): Promise<ParsedVocabularyProposal[]> {
    const lines = input.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.map((line) => {
      // Supports "lemma - translation" or "lemma = translation"; falls back
      // to the whole line as the lemma with an empty translation.
      const [rawLemma, rawTranslation] = line.split(/\s*[-=:]\s*/, 2);
      const lemma = (rawLemma ?? line).trim();
      const translation = (rawTranslation ?? "").trim();

      return {
        lemma,
        translation: translation.length > 0 ? translation : lemma,
        partOfSpeech: "other",
        topics: [],
        forms: [],
        confidence: 0.5,
        needsReview: translation.length === 0,
      } satisfies ParsedVocabularyProposal;
    });
  }

  async generateExample(input: {
    lemma: string;
    translation: string;
    level?: string;
    topic?: string;
  }): Promise<GeneratedExample> {
    return {
      sentence: `Esta es una frase de ejemplo con "${input.lemma}".`,
      translation: `This is an example sentence with "${input.translation}".`,
    };
  }

  async evaluateAnswer(input: {
    expectedMeaning: string;
    acceptedAnswers: string[];
    userAnswer: string;
    context?: string;
  }): Promise<AnswerEvaluation> {
    const normalize = (value: string) => value.trim().toLowerCase();
    const answer = normalize(input.userAnswer);
    const accepted = input.acceptedAnswers.map(normalize);

    if (answer.length === 0) {
      return { result: "incorrect", feedback: "No answer was provided." };
    }
    if (accepted.includes(answer)) {
      return { result: "correct", feedback: "Correct." };
    }
    if (accepted.some((candidate) => candidate.includes(answer) || answer.includes(candidate))) {
      return { result: "partially_correct", feedback: "Close — check the exact wording." };
    }
    return { result: "incorrect", feedback: `Expected: ${input.expectedMeaning}.` };
  }

  async generateExercises(input: {
    words: ExerciseGenerationWord[];
    translationLanguage: string;
  }): Promise<GeneratedExerciseSet[]> {
    return input.words.map((word) => ({
      key: word.key,
      exercises: [
        {
          exerciseType: "multiple_choice",
          instruction: "Choose the correct translation.",
          promptText: word.lemma,
          options: [word.translation, `not ${word.translation}`, `${word.translation} again`],
          correctAnswer: word.translation,
          acceptedAnswers: [word.translation],
        },
        {
          exerciseType: "multiple_choice_reverse",
          instruction: "Choose the Spanish word.",
          promptText: word.translation,
          options: [word.lemma, `${word.lemma}ito`, `re${word.lemma}`],
          correctAnswer: word.lemma,
          acceptedAnswers: [word.lemma],
        },
        {
          exerciseType: "recall",
          instruction: "Type the Spanish word.",
          promptText: word.translation,
          correctAnswer: word.lemma,
          acceptedAnswers: [word.lemma, ...word.forms],
        },
        {
          exerciseType: "cloze",
          instruction: "Fill in the missing word.",
          promptText: `Cada día uso _____ con cuidado. (${word.translation})`,
          correctAnswer: word.lemma,
          acceptedAnswers: [word.lemma, ...word.forms],
        },
      ],
    }));
  }
}
