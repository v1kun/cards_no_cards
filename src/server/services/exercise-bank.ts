import { and, eq } from "drizzle-orm";

import { bankExerciseTypeSchema, validateBankPayload, wordSourceHash } from "@/domain/review/bank";
import type { AIProvider, GeneratedExercise } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { vocabularyItems } from "@/server/db/schema";
import { ExerciseBankRepository, type NewBankExercise } from "@/server/repositories/exercise-bank";
import { NotFoundError } from "@/server/repositories/errors";
import { ProfilesRepository } from "@/server/repositories/profiles";
import { loadPracticeData, type PracticeWord } from "./practice-data";

/** Words processed per refresh call; the client loops to show progress. */
export const REFRESH_BATCH_SIZE = 10;
/** Words sent to the AI in a single request. */
const AI_CHUNK_SIZE = 5;
/** Upper bound on stored questions per word, per type. */
const MAX_VARIANTS_PER_TYPE = 2;

export type BankStatus = {
  totalWords: number;
  upToDate: number;
  missing: number;
  stale: number;
  /** Words that a refresh would send to the AI. */
  pending: number;
};

export type RefreshResult = {
  processed: number;
  succeeded: number;
  failed: { id: string; lemma: string }[];
  remaining: number;
};

/**
 * Manages the pre-generated question bank. AI is only called from
 * {@link refresh} and {@link regenerate}, which the learner triggers
 * explicitly; practice itself only reads the stored questions.
 */
export class ExerciseBankService {
  private readonly bank: ExerciseBankRepository;
  private readonly profiles: ProfilesRepository;

  constructor(
    private readonly db: Database,
    private readonly provider?: AIProvider,
  ) {
    this.bank = new ExerciseBankRepository(db);
    this.profiles = new ProfilesRepository(db);
  }

  private async translationLanguage(userId: string): Promise<string> {
    return (await this.profiles.get(userId))?.translationLanguage ?? "en";
  }

  /** Classifies each active word as up to date, missing, or stale. */
  private async classify(userId: string) {
    const [{ words }, language] = await Promise.all([
      loadPracticeData(this.db, userId),
      this.translationLanguage(userId),
    ]);
    const items = await this.bank.listForUser(userId);
    const hashesByWord = new Map<string, Set<string>>();
    for (const item of items) {
      const set = hashesByWord.get(item.vocabularyItemId) ?? new Set<string>();
      set.add(item.sourceHash);
      hashesByWord.set(item.vocabularyItemId, set);
    }
    const upToDate: PracticeWord[] = [];
    const missing: PracticeWord[] = [];
    const stale: PracticeWord[] = [];
    for (const word of words) {
      const hashes = hashesByWord.get(word.id);
      if (!hashes) missing.push(word);
      else if (hashes.has(wordSourceHash(word, language))) upToDate.push(word);
      else stale.push(word);
    }
    return { words, language, upToDate, missing, stale };
  }

  async status(userId: string): Promise<BankStatus> {
    const { words, upToDate, missing, stale } = await this.classify(userId);
    return {
      totalWords: words.length,
      upToDate: upToDate.length,
      missing: missing.length,
      stale: stale.length,
      pending: missing.length + stale.length,
    };
  }

  /**
   * Generates questions for up to {@link REFRESH_BATCH_SIZE} words that have
   * none or whose content changed. One word failing never fails the batch.
   * `exclude` lets the client skip words that already failed this run.
   */
  async refresh(userId: string, options: { exclude?: string[] } = {}): Promise<RefreshResult> {
    const { language, missing, stale } = await this.classify(userId);
    const excluded = new Set(options.exclude ?? []);
    const queue = [...missing, ...stale].filter((word) => !excluded.has(word.id));
    const batch = queue.slice(0, REFRESH_BATCH_SIZE);

    const failed: { id: string; lemma: string }[] = [];
    let succeeded = 0;
    for (let i = 0; i < batch.length; i += AI_CHUNK_SIZE) {
      const chunk = batch.slice(i, i + AI_CHUNK_SIZE);
      const results = await this.generateFor(chunk, language);
      for (const word of chunk) {
        const exercises = results.get(word.id) ?? [];
        if (exercises.length === 0) {
          failed.push({ id: word.id, lemma: word.lemma });
          continue;
        }
        await this.bank.replaceForWord(
          this.db,
          userId,
          word.id,
          exercises,
          wordSourceHash(word, language),
          this.requireProvider().name,
        );
        succeeded += 1;
      }
    }

    return {
      processed: batch.length,
      succeeded,
      failed,
      remaining: Math.max(queue.length - batch.length, 0),
    };
  }

  /** Regenerates the questions of one word regardless of staleness. */
  async regenerate(userId: string, vocabularyItemId: string): Promise<{ count: number }> {
    const owned = await this.db
      .select({ id: vocabularyItems.id })
      .from(vocabularyItems)
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, vocabularyItemId)))
      .limit(1);
    if (!owned[0]) throw new NotFoundError("Vocabulary item", vocabularyItemId);

    const { words, language } = await this.classify(userId);
    const word = words.find((candidate) => candidate.id === vocabularyItemId);
    if (!word) throw new NotFoundError("Vocabulary item", vocabularyItemId);

    const exercises = (await this.generateFor([word], language)).get(word.id) ?? [];
    if (exercises.length > 0) {
      await this.bank.replaceForWord(
        this.db,
        userId,
        word.id,
        exercises,
        wordSourceHash(word, language),
        this.requireProvider().name,
      );
    }
    return { count: exercises.length };
  }

  private requireProvider(): AIProvider {
    if (!this.provider) throw new Error("An AI provider is required to generate questions");
    return this.provider;
  }

  private async generateFor(
    words: PracticeWord[],
    language: string,
  ): Promise<Map<string, NewBankExercise[]>> {
    const sets = await this.requireProvider().generateExercises({
      words: words.map((word) => ({
        key: word.id,
        lemma: word.lemma,
        translation: word.translation,
        partOfSpeech: word.partOfSpeech,
        forms: word.forms ?? [],
        exampleSentence: word.exampleSentence,
      })),
      translationLanguage: language,
    });
    const known = new Set(words.map((word) => word.id));
    const result = new Map<string, NewBankExercise[]>();
    for (const set of sets) {
      if (!known.has(set.key)) continue;
      result.set(set.key, sanitizeExercises(set.exercises));
    }
    return result;
  }
}

/** Validates generated questions, dropping invalid ones and capping variants. */
export function sanitizeExercises(exercises: GeneratedExercise[]): NewBankExercise[] {
  const perType = new Map<string, number>();
  const out: NewBankExercise[] = [];
  for (const exercise of exercises) {
    const type = bankExerciseTypeSchema.safeParse(exercise.exerciseType);
    if (!type.success) continue;
    const count = perType.get(type.data) ?? 0;
    if (count >= MAX_VARIANTS_PER_TYPE) continue;
    const payload = validateBankPayload(type.data, exercise);
    if (!payload) continue;
    perType.set(type.data, count + 1);
    out.push({ exerciseType: type.data, payload });
  }
  return out;
}
