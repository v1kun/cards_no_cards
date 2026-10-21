/**
 * Pre-generated question bank: payload shape, validation, and the source hash
 * used to detect stale questions. Pure and shared by the client and server.
 */
import { z } from "zod";

import {
  CLOZE_BLANK,
  exerciseTypes,
  isMultipleChoice,
  normalizeAnswer,
  orderOptions,
  type ExerciseType,
  type PracticeExercise,
} from "./exercises";

export const bankPayloadSchema = z.object({
  instruction: z.string().trim().min(1).max(200),
  promptText: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  correctAnswer: z.string().trim().min(1).max(200),
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
});

export type BankPayload = z.infer<typeof bankPayloadSchema>;

/** A bank exercise as stored and shipped to the client. */
export type BankItem = {
  id: string;
  vocabularyItemId: string;
  exerciseType: ExerciseType;
  payload: BankPayload;
  sourceHash: string;
};

export const bankExerciseTypeSchema = z.enum(exerciseTypes);

/** The word fields that, when changed, make generated questions stale. */
export type HashableWord = {
  lemma: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence?: string | null;
  forms?: string[];
};

/**
 * A stable, short hash of the word fields questions depend on. Uses
 * cyrb53 (fast, synchronous, good distribution); not cryptographic.
 */
export function wordSourceHash(word: HashableWord, translationLanguage: string): string {
  const forms = [...(word.forms ?? [])].map(normalizeAnswer).sort().join(",");
  const input = [
    "v1",
    translationLanguage,
    normalizeAnswer(word.lemma),
    word.translation.trim().toLowerCase(),
    word.partOfSpeech,
    (word.exampleSentence ?? "").trim(),
    forms,
  ].join("|");
  return cyrb53(input).toString(16).padStart(14, "0");
}

function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Validates a generated exercise. Returns a cleaned payload, or null when
 * the question is unusable (it is then simply dropped):
 * - multiple choice needs 3–6 distinct options containing the answer;
 * - accepted answers always include the correct answer;
 * - cloze prompts contain a blank;
 * - the answer must not leak into the prompt (except recognition prompts,
 *   which show the Spanish word by design).
 */
export function validateBankPayload(type: ExerciseType, raw: unknown): BankPayload | null {
  const parsed = bankPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const payload = parsed.data;

  const accepted = dedupe([payload.correctAnswer, ...payload.acceptedAnswers]);
  const correctKey = normalizeAnswer(payload.correctAnswer);
  if (correctKey.length === 0) return null;

  if (isMultipleChoice(type)) {
    const options = dedupe(payload.options ?? []);
    if (options.length < 3) return null;
    if (!options.some((option) => normalizeAnswer(option) === correctKey)) return null;
    // Only the correct option may be accepted, otherwise grading is ambiguous.
    const acceptedKeys = new Set(accepted.map(normalizeAnswer));
    if (options.filter((option) => acceptedKeys.has(normalizeAnswer(option))).length !== 1) {
      return null;
    }
    return { ...payload, options, acceptedAnswers: accepted };
  }

  if (type === "cloze" && !payload.promptText.includes(CLOZE_BLANK)) {
    return null;
  }
  const promptKey = ` ${normalizeAnswer(payload.promptText)} `;
  if (accepted.some((answer) => promptKey.includes(` ${normalizeAnswer(answer)} `))) {
    return null;
  }
  return {
    instruction: payload.instruction,
    promptText: payload.promptText,
    correctAnswer: payload.correctAnswer,
    acceptedAnswers: accepted,
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeAnswer(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/** Turns a stored bank item into a gradable exercise. */
export function bankItemToExercise(item: BankItem, isNew: boolean): PracticeExercise {
  const { payload } = item;
  return {
    vocabularyItemId: item.vocabularyItemId,
    exerciseType: item.exerciseType,
    instruction: payload.instruction,
    promptText: payload.promptText,
    options: payload.options
      ? orderOptions(
          payload.correctAnswer,
          payload.options.filter(
            (option) => normalizeAnswer(option) !== normalizeAnswer(payload.correctAnswer),
          ),
        )
      : undefined,
    isNew,
    correctAnswer: payload.correctAnswer,
    acceptedAnswers: payload.acceptedAnswers,
    bankItemId: item.id,
  };
}
