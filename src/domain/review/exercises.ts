/**
 * Deterministic exercise selection, prompt construction, and objective answer
 * evaluation. No database, UI, or AI concerns live here.
 *
 * The starter exercise set is intentionally small and objective so that answers
 * can be graded deterministically. Open-ended grading (synonyms, free text) is
 * delegated to the AI adapter by the practice service, not by this module.
 */

export const exerciseTypes = [
  "multiple_choice",
  "multiple_choice_reverse",
  "recall",
  "cloze",
] as const;

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

/**
 * A fully prepared exercise: the prompt plus everything needed to grade it
 * locally. Produced either from the pre-generated question bank or
 * deterministically by {@link buildPrompt}.
 */
export type PracticeExercise = ExercisePrompt & {
  /** The canonical answer shown as feedback. */
  correctAnswer: string;
  /** Every answer accepted as correct (compared after normalization). */
  acceptedAnswers: string[];
  /** The bank item this exercise came from, or null when built deterministically. */
  bankItemId: string | null;
  /** Extra practice beyond the schedule: only wrong answers reschedule. */
  extra?: boolean;
};

/** True for the two multiple-choice exercise types. */
export function isMultipleChoice(type: ExerciseType): boolean {
  return type === "multiple_choice" || type === "multiple_choice_reverse";
}

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
 * Picks an exercise type from the learner's history with a word. Difficulty
 * grows gradually: recognition (Spanish → translation), then reverse
 * recognition (translation → Spanish), then typed recall, and finally cloze
 * once a usable sentence (example or pre-generated bank cloze) is available.
 */
export function selectExerciseType(input: {
  isNew: boolean;
  successfulRecalls: number;
  exampleSentence?: string | null;
  lemma: string;
  /** Whether a pre-generated cloze exercise exists for the word. */
  clozeAvailable?: boolean;
  /**
   * When given, known words get a random mix of types weighted towards the
   * stage's main type; without it the main type is always returned.
   */
  random?: () => number;
}): ExerciseType {
  if (input.isNew || input.successfulRecalls < 1) {
    return "multiple_choice";
  }
  const cloze =
    input.successfulRecalls >= 3 &&
    (input.clozeAvailable || hasUsableCloze(input.exampleSentence, input.lemma));
  const weights: [ExerciseType, number][] =
    input.successfulRecalls === 1
      ? [
          ["multiple_choice_reverse", 0.5],
          ["recall", 0.5],
        ]
      : input.successfulRecalls === 2
        ? [
            ["recall", 0.6],
            ["multiple_choice_reverse", 0.25],
            ["multiple_choice", 0.15],
          ]
        : cloze
          ? [
              ["cloze", 0.5],
              ["recall", 0.35],
              ["multiple_choice_reverse", 0.15],
            ]
          : [
              ["recall", 0.75],
              ["multiple_choice_reverse", 0.25],
            ];
  if (!input.random) return weights[0]![0];
  let roll = input.random();
  for (const [type, weight] of weights) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return weights[weights.length - 1]![0];
}

function hasUsableCloze(sentence: string | null | undefined, lemma: string): boolean {
  if (!sentence) return false;
  return clozeSentence(sentence, lemma) !== null;
}

export const CLOZE_BLANK = "_____";

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
    case "multiple_choice_reverse":
      return [word.lemma];
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
 * Builds a gradable exercise deterministically from the word itself, used
 * when the question bank has nothing for the requested type.
 */
export function buildExercise(
  word: ExerciseWord,
  type: ExerciseType,
  isNew: boolean,
  distractors: string[] = [],
): PracticeExercise {
  const prompt = buildPrompt(word, type, isNew, distractors);
  return {
    ...prompt,
    correctAnswer: expectedMeaning(word, prompt.exerciseType),
    acceptedAnswers: acceptedAnswers(word, prompt.exerciseType),
    bankItemId: null,
  };
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
    case "multiple_choice_reverse": {
      const options = orderOptions(word.lemma, distractors);
      return {
        ...base,
        instruction: "Choose the Spanish word.",
        promptText: word.translation,
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
export function orderOptions(correct: string, distractors: string[]): string[] {
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

export type AnswerGrade = "recalled" | "recalled_with_hint" | "wrong" | "skipped";

/**
 * Grades an answer against a prepared exercise. Purely local and
 * deterministic, so the client (offline) and the server (on sync) always
 * agree. A mismatch is wrong; there is no AI fallback.
 */
export function gradeAnswer(
  accepted: string[],
  submittedAnswer: string | null | undefined,
  options: { usedHint?: boolean; skipped?: boolean } = {},
): AnswerGrade {
  if (options.skipped) return "skipped";
  const normalized = normalizeAnswer(submittedAnswer ?? "");
  if (normalized.length === 0) return "wrong";
  const match = accepted.some((answer) => normalizeAnswer(answer) === normalized);
  if (!match) return "wrong";
  return options.usedHint ? "recalled_with_hint" : "recalled";
}
