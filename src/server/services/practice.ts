import { inArray } from "drizzle-orm";
import { z } from "zod";

import type { AIProvider } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { reviewAttempts, reviewStates, vocabularyForms } from "@/server/db/schema";
import { NotFoundError } from "@/server/repositories/errors";
import { ReviewRepository, type PracticeSession } from "@/server/repositories/review";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import {
  acceptedAnswers,
  buildPrompt,
  type ExercisePrompt,
  type ExerciseType,
  type ExerciseWord,
  exerciseTypes,
  expectedMeaning,
  gradeObjective,
  normalizeAnswer,
  selectExerciseType,
} from "@/domain/review/exercises";
import {
  nextSchedulingState,
  type ReviewResult,
  type SchedulingState,
} from "@/domain/review/schedule";

/** Target number of new words to introduce per session, availability allowing. */
export const NEW_WORD_TARGET = 5;
/** Upper bound on due reviews pulled into a single session. */
export const DUE_REVIEW_LIMIT = 20;
const DISTRACTOR_POOL_SIZE = 50;
const MAX_DISTRACTORS = 3;

export const submitAttemptSchema = z.object({
  sessionId: z.string().min(1),
  vocabularyItemId: z.string().min(1),
  exerciseType: z.enum(exerciseTypes),
  submittedAnswer: z.string().optional(),
  usedHint: z.boolean().default(false),
  skipped: z.boolean().default(false),
  latencyMs: z.number().int().nonnegative().optional(),
  /** Client-generated id making re-submission idempotent. */
  attemptId: z.string().min(1).optional(),
});

export type SubmitAttemptInput = z.input<typeof submitAttemptSchema>;

export type SessionPlan = {
  session: PracticeSession | null;
  exercises: ExercisePrompt[];
};

export type Reinforcement = {
  correctAnswer: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

export type AttemptOutcome =
  | {
      status: "graded";
      result: ReviewResult;
      correct: boolean;
      feedback: string;
      correctAnswer: string;
      reinforcement: Reinforcement | null;
      nextDueAt: string | null;
      duplicate: boolean;
    }
  | {
      // An uncertain AI evaluation must not automatically punish the learner.
      status: "uncertain";
      feedback: string;
    };

export type SessionSummary = {
  sessionId: string;
  wordsPracticed: number;
  totalAttempts: number;
  recalled: number;
  recalledWithHint: number;
  wrong: number;
  skipped: number;
};

/**
 * Orchestrates a practice session: selecting words, building exercises, grading
 * answers (deterministically, with the AI adapter only for open-ended recall),
 * and persisting attempts and deterministic scheduling updates.
 */
export class PracticeService {
  private readonly reviews: ReviewRepository;
  private readonly vocabulary: VocabularyRepository;

  constructor(
    private readonly db: Database,
    private readonly provider?: AIProvider,
  ) {
    this.reviews = new ReviewRepository(db);
    this.vocabulary = new VocabularyRepository(db);
  }

  /**
   * Starts a session. Due reviews are prioritized over introducing new words.
   * Returns a null session (and no exercises) when nothing is available so the
   * caller can show an empty state without creating a throwaway session.
   */
  async startSession(userId: string, now: Date = new Date()): Promise<SessionPlan> {
    const due = await this.reviews.listDueReviews(userId, now, DUE_REVIEW_LIMIT);
    const introduced = await this.reviews.listNewWords(userId, NEW_WORD_TARGET);
    const selected = [...due, ...introduced];

    if (selected.length === 0) {
      return { session: null, exercises: [] };
    }

    const session = await this.reviews.createSession(userId);
    const formsById = await this.formsFor(selected.map((word) => word.item.id));
    const pool = await this.reviews.translationPool(userId, DISTRACTOR_POOL_SIZE);

    const exercises = selected.map((word) => {
      const exerciseWord: ExerciseWord = {
        ...word.item,
        forms: formsById.get(word.item.id) ?? [],
      };
      const successfulRecalls = word.state?.successfulRecalls ?? 0;
      let type = selectExerciseType({
        isNew: word.isNew,
        successfulRecalls,
        exampleSentence: word.item.exampleSentence,
        lemma: word.item.lemma,
      });
      const distractors =
        type === "multiple_choice" ? this.pickDistractors(word.item.translation, pool) : [];
      // Multiple choice needs at least one distractor to be meaningful.
      if (type === "multiple_choice" && distractors.length === 0) {
        type = "recall";
      }
      return buildPrompt(exerciseWord, type, word.isNew, distractors);
    });

    return { session, exercises };
  }

  /** Grades a single attempt, persists it, and updates scheduling. */
  async submitAttempt(userId: string, input: SubmitAttemptInput): Promise<AttemptOutcome> {
    const data = submitAttemptSchema.parse(input);

    const session = await this.reviews.getSession(userId, data.sessionId);
    if (!session) {
      throw new NotFoundError("Practice session", data.sessionId);
    }

    const word = await this.vocabulary.getById(userId, data.vocabularyItemId);
    if (!word) {
      throw new NotFoundError("Vocabulary item", data.vocabularyItemId);
    }

    const exerciseWord: ExerciseWord = {
      id: word.id,
      lemma: word.lemma,
      translation: word.translation,
      partOfSpeech: word.partOfSpeech,
      exampleSentence: word.exampleSentence,
      forms: word.forms.map((form) => form.form),
    };
    const type = data.exerciseType;
    const answer = data.submittedAnswer?.trim() ?? "";
    const correctAnswer = expectedMeaning(exerciseWord, type);

    const graded = await this.grade(exerciseWord, type, answer, data);
    if (graded.status === "uncertain") {
      return graded;
    }
    const { result } = graded;

    // Idempotency: a repeated attemptId returns the first outcome unchanged.
    if (data.attemptId) {
      const existing = await this.reviews.getAttemptById(userId, data.attemptId);
      if (existing) {
        return this.outcomeFor(
          existing.result as ReviewResult,
          exerciseWord,
          type,
          correctAnswer,
          word,
          null,
          true,
        );
      }
    }

    const current = await this.reviews.getState(userId, word.id);
    const base: SchedulingState = current
      ? {
          dueAt: current.dueAt,
          introducedAt: current.introducedAt,
          successfulRecalls: current.successfulRecalls,
          consecutiveFailures: current.consecutiveFailures,
          reviewStage: current.reviewStage,
          difficulty: current.difficulty,
          lastResult: current.lastResult as ReviewResult | null,
          lastReviewedAt: current.lastReviewedAt,
        }
      : {
          dueAt: null,
          introducedAt: null,
          successfulRecalls: 0,
          consecutiveFailures: 0,
          reviewStage: 0,
          difficulty: 0.5,
          lastResult: null,
          lastReviewedAt: null,
        };
    const next = nextSchedulingState(base, result, new Date());

    await this.db.transaction(async (tx) => {
      await tx.insert(reviewAttempts).values({
        ...(data.attemptId ? { id: data.attemptId } : {}),
        userId,
        vocabularyItemId: word.id,
        sessionId: data.sessionId,
        exerciseType: type,
        promptSnapshot: JSON.stringify({ exerciseType: type, expectedMeaning: correctAnswer }),
        submittedAnswer: answer.length > 0 ? answer : null,
        result,
        usedHint: data.usedHint,
        latencyMs: data.latencyMs,
      });
      await tx
        .insert(reviewStates)
        .values({ userId, vocabularyItemId: word.id, ...next })
        .onConflictDoUpdate({
          target: reviewStates.vocabularyItemId,
          set: { ...next, updatedAt: new Date() },
        });
    });

    return this.outcomeFor(result, exerciseWord, type, correctAnswer, word, next.dueAt, false);
  }

  /** Completes a session and returns an aggregate summary of its attempts. */
  async completeSession(userId: string, sessionId: string): Promise<SessionSummary> {
    const session = await this.reviews.getSession(userId, sessionId);
    if (!session) {
      throw new NotFoundError("Practice session", sessionId);
    }
    const summary = await this.summarize(userId, sessionId);
    if (session.status === "active") {
      await this.reviews.completeSession(userId, sessionId, summary);
    }
    return summary;
  }

  /** Reads the current session and an aggregate summary without mutating it. */
  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session: PracticeSession; summary: SessionSummary }> {
    const session = await this.reviews.getSession(userId, sessionId);
    if (!session) {
      throw new NotFoundError("Practice session", sessionId);
    }
    return { session, summary: await this.summarize(userId, sessionId) };
  }

  private async summarize(userId: string, sessionId: string): Promise<SessionSummary> {
    const attempts = await this.reviews.attemptsForSession(userId, sessionId);
    const words = new Set<string>();
    const counts = { recalled: 0, recalled_with_hint: 0, wrong: 0, skipped: 0 };
    for (const attempt of attempts) {
      words.add(attempt.vocabularyItemId);
      counts[attempt.result as ReviewResult] += 1;
    }
    return {
      sessionId,
      wordsPracticed: words.size,
      totalAttempts: attempts.length,
      recalled: counts.recalled,
      recalledWithHint: counts.recalled_with_hint,
      wrong: counts.wrong,
      skipped: counts.skipped,
    };
  }

  private async grade(
    word: ExerciseWord,
    type: ExerciseType,
    answer: string,
    data: z.infer<typeof submitAttemptSchema>,
  ): Promise<
    { status: "graded"; result: ReviewResult } | { status: "uncertain"; feedback: string }
  > {
    if (data.skipped) {
      return { status: "graded", result: "skipped" };
    }
    if (gradeObjective(word, type, answer)) {
      return { status: "graded", result: data.usedHint ? "recalled_with_hint" : "recalled" };
    }

    // Open-ended recall/cloze may accept synonyms the deterministic check misses.
    // Multiple choice is fully objective and never consults the AI.
    if (this.provider && answer.length > 0 && (type === "recall" || type === "cloze")) {
      const evaluation = await this.provider.evaluateAnswer({
        expectedMeaning: expectedMeaning(word, type),
        acceptedAnswers: acceptedAnswers(word, type),
        userAnswer: answer,
      });
      switch (evaluation.result) {
        case "correct":
          return { status: "graded", result: data.usedHint ? "recalled_with_hint" : "recalled" };
        case "partially_correct":
          return { status: "graded", result: "recalled_with_hint" };
        case "incorrect":
          return { status: "graded", result: "wrong" };
        case "uncertain":
          return { status: "uncertain", feedback: evaluation.feedback };
      }
    }

    return { status: "graded", result: "wrong" };
  }

  private outcomeFor(
    result: ReviewResult,
    _word: ExerciseWord,
    _type: ExerciseType,
    correctAnswer: string,
    full: { exampleSentence: string | null; exampleTranslation: string | null },
    nextDueAt: Date | null,
    duplicate: boolean,
  ): AttemptOutcome {
    const correct = result === "recalled" || result === "recalled_with_hint";
    const feedback = feedbackFor(result, correctAnswer);
    const reinforcement: Reinforcement | null = correct
      ? null
      : {
          correctAnswer,
          exampleSentence: full.exampleSentence,
          exampleTranslation: full.exampleTranslation,
        };
    return {
      status: "graded",
      result,
      correct,
      feedback,
      correctAnswer,
      reinforcement,
      nextDueAt: nextDueAt ? nextDueAt.toISOString() : null,
      duplicate,
    };
  }

  private pickDistractors(correct: string, pool: string[]): string[] {
    const correctKey = normalizeAnswer(correct);
    const seen = new Set<string>([correctKey]);
    const picked: string[] = [];
    for (const candidate of pool) {
      const key = normalizeAnswer(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(candidate);
      if (picked.length >= MAX_DISTRACTORS) break;
    }
    return picked;
  }

  private async formsFor(ids: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select({ itemId: vocabularyForms.vocabularyItemId, form: vocabularyForms.form })
      .from(vocabularyForms)
      .where(inArray(vocabularyForms.vocabularyItemId, ids));
    for (const row of rows) {
      const list = map.get(row.itemId) ?? [];
      list.push(row.form);
      map.set(row.itemId, list);
    }
    return map;
  }
}

function feedbackFor(result: ReviewResult, correctAnswer: string): string {
  switch (result) {
    case "recalled":
      return "Correct.";
    case "recalled_with_hint":
      return "Correct, with a hint. Keep practicing for independent recall.";
    case "wrong":
      return `Not quite. The answer is "${correctAnswer}".`;
    case "skipped":
      return `Skipped. The answer is "${correctAnswer}".`;
  }
}
