/**
 * Deterministic exercise selection, prompt construction, and objective answer
 * evaluation. No database, UI, or AI concerns live here.
 *
 * The starter exercise set is intentionally small and objective so that answers
 * can be graded deterministically. Open-ended grading (synonyms, free text) is
 * delegated to the AI adapter by the practice service, not by this module.
 */

export const exerciseTypes = ["multiple_choice", "recall", "cloze"] as const;

export type ExerciseType = (typeof exerciseTypes)[number];

/** The minimal word shape an exercise needs. */
export type ExerciseWord = {
  id: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence?: string | null;
  forms?: string[];
};

export type ExercisePrompt = {
  vocabularyItemId: string;
  exerciseType: ExerciseType;
  /** Short instruction shown to the learner. */
  instruction: string;
  /** The text the learner reads (lemma, translation, or cloze sentence). */
  promptText: string;
  /** For multiple choice only: the answer options in a stable order. */
  options?: string[];
  /** Whether the word is being introduced for the first time this session. */
  isNew: boolean;
};

/** Strips diacritics, case, surrounding punctuation, and extra whitespace. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,!?¡¿;:"'()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Picks an exercise type from the learner's history with a word. New words and
 * words with few recalls get the most supportive format; cloze is only used
 * when a usable example sentence is available.
 */
export function selectExerciseType(input: {
  isNew: boolean;
  successfulRecalls: number;
  exampleSentence?: string | null;
  lemma: string;
}): ExerciseType {
  if (input.isNew || input.successfulRecalls < 1) {
    return "multiple_choice";
  }
  if (input.successfulRecalls >= 3 && hasUsableCloze(input.exampleSentence, input.lemma)) {
    return "cloze";
  }
  return "recall";
}

function hasUsableCloze(sentence: string | null | undefined, lemma: string): boolean {
  if (!sentence) return false;
  return clozeSentence(sentence, lemma) !== null;
}

const CLOZE_BLANK = "_____";

/** Replaces the first whole-word occurrence of the lemma with a blank. */
function clozeSentence(sentence: string, lemma: string): string | null {
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\p{L}])(${escaped})([^\\p{L}]|$)`, "iu");
  const match = pattern.exec(sentence);
  if (!match) return null;
  const prefix = match[1] ?? "";
  const word = match[2] ?? "";
  const start = match.index + prefix.length;
  return sentence.slice(0, start) + CLOZE_BLANK + sentence.slice(start + word.length);
}

/** The set of answers accepted as correct for a given word and exercise type. */
export function acceptedAnswers(word: ExerciseWord, type: ExerciseType): string[] {
  switch (type) {
    case "multiple_choice":
      return [word.translation];
    case "recall":
    case "cloze":
      return [word.lemma, ...(word.forms ?? [])];
  }
}

/** The human-readable "expected meaning" used for feedback and AI evaluation. */
export function expectedMeaning(word: ExerciseWord, type: ExerciseType): string {
  return type === "multiple_choice" ? word.translation : word.lemma;
}

/**
 * Builds the prompt shown to the learner. The correct answer is never leaked
 * except, inherently, as one of the multiple-choice options.
 */
export function buildPrompt(
  word: ExerciseWord,
  type: ExerciseType,
  isNew: boolean,
  distractors: string[] = [],
): ExercisePrompt {
  const base = { vocabularyItemId: word.id, exerciseType: type, isNew };

  switch (type) {
    case "multiple_choice": {
      const options = orderOptions(word.translation, distractors);
      return {
        ...base,
        instruction: "Choose the correct translation.",
        promptText: word.lemma,
        options,
      };
    }
    case "recall":
      return {
        ...base,
        instruction: "Type the Spanish word.",
        promptText: word.translation,
      };
    case "cloze": {
      const sentence = word.exampleSentence
        ? clozeSentence(word.exampleSentence, word.lemma)
        : null;
      if (!sentence) {
        // Fall back to recall if no usable sentence is available.
        return {
          ...base,
          exerciseType: "recall",
          instruction: "Type the Spanish word.",
          promptText: word.translation,
        };
      }
      return {
        ...base,
        instruction: "Fill in the missing word.",
        promptText: sentence,
      };
    }
  }
}

/** Correct option plus distractors, ordered deterministically (alphabetical). */
function orderOptions(correct: string, distractors: string[]): string[] {
  const unique = new Set<string>([correct]);
  for (const distractor of distractors) {
    if (normalizeAnswer(distractor) !== normalizeAnswer(correct)) {
      unique.add(distractor);
    }
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

/**
 * Grades an objective answer deterministically. Returns `true` when the
 * normalized answer matches any accepted answer. Returns `null` when the
 * answer cannot be graded objectively (empty handled by the caller).
 */
export function gradeObjective(
  word: ExerciseWord,
  type: ExerciseType,
  submittedAnswer: string,
): boolean {
  const normalized = normalizeAnswer(submittedAnswer);
  if (normalized.length === 0) return false;
  return acceptedAnswers(word, type).some((answer) => normalizeAnswer(answer) === normalized);
}
