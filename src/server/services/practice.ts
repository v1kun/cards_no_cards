import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { wordSourceHash } from "@/domain/review/bank";
import { acceptedAnswers, exerciseTypes, gradeAnswer } from "@/domain/review/exercises";
import {
  initialSchedulingState,
  type ReviewResult,
  type SchedulingState,
} from "@/domain/review/schedule";
import {
  applyAnswer,
  toSnapshotState,
  type PracticeSnapshot,
  type SnapshotState,
} from "@/domain/review/snapshot";
import type { Database } from "@/server/db/client";
import { practiceSessions, reviewAttempts, reviewStates } from "@/server/db/schema";
import { ExerciseBankRepository } from "@/server/repositories/exercise-bank";
import { ProfilesRepository } from "@/server/repositories/profiles";
import { loadPracticeData, type ReviewStateRow } from "./practice-data";

/** Offline answers older than this are clamped; protects the schedule from bad clocks. */
export const MAX_OFFLINE_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_SYNC_ATTEMPTS = 500;
const MAX_SYNC_SESSIONS = 100;

const idSchema = z.string().trim().min(8).max(64);

export const syncInputSchema = z.object({
  sessions: z
    .array(
      z.object({
        id: idSchema,
        startedAt: z.number().int().nonnegative(),
        finishedAt: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .max(MAX_SYNC_SESSIONS)
    .default([]),
  attempts: z
    .array(
      z.object({
        attemptId: idSchema,
        sessionId: idSchema.nullable().optional(),
        vocabularyItemId: z.string().min(1).max(64),
        exerciseType: z.enum(exerciseTypes),
        bankItemId: z.string().min(1).max(64).nullable().optional(),
        submittedAnswer: z.string().max(500).nullable().optional(),
        usedHint: z.boolean().default(false),
        skipped: z.boolean().default(false),
        latencyMs: z.number().int().nonnegative().max(3_600_000).nullable().optional(),
        answeredAt: z.number().int().nonnegative(),
      }),
    )
    .max(MAX_SYNC_ATTEMPTS)
    .default([]),
});

export type SyncInput = z.input<typeof syncInputSchema>;

export type SyncResult = {
  accepted: { attemptId: string; result: ReviewResult; duplicate: boolean }[];
  rejected: { attemptId: string; reason: "word_unavailable" | "id_conflict" }[];
  states: SnapshotState[];
  serverTime: number;
};

/**
 * Practice runs on the client from an offline snapshot; this service builds
 * that snapshot and applies the answers the client syncs back. Grading is
 * deterministic and re-done here — the client result is never trusted.
 */
export class PracticeService {
  private readonly bank: ExerciseBankRepository;
  private readonly profiles: ProfilesRepository;

  constructor(private readonly db: Database) {
    this.bank = new ExerciseBankRepository(db);
    this.profiles = new ProfilesRepository(db);
  }

  async snapshot(userId: string, now: Date = new Date()): Promise<PracticeSnapshot> {
    const [data, profile, bankItems] = await Promise.all([
      loadPracticeData(this.db, userId),
      this.profiles.get(userId),
      this.bank.listForUser(userId),
    ]);
    const translationLanguage = profile?.translationLanguage ?? "en";
    const hashes = new Map(
      data.words.map((word) => [word.id, wordSourceHash(word, translationLanguage)]),
    );
    return {
      serverTime: now.getTime(),
      translationLanguage,
      words: data.words,
      states: data.states.map((row) => toSnapshotState(row.vocabularyItemId, fromRow(row))),
      // Stale questions may contradict the edited word, so only fresh ones ship.
      bank: bankItems.filter((item) => hashes.get(item.vocabularyItemId) === item.sourceHash),
      topics: data.topics,
    };
  }

  async sync(userId: string, input: SyncInput, now: Date = new Date()): Promise<SyncResult> {
    const data = syncInputSchema.parse(input);
    const nowMs = now.getTime();
    const clamp = (ms: number) => Math.min(Math.max(ms, nowMs - MAX_OFFLINE_AGE_MS), nowMs);

    const { words, states } = await loadPracticeData(this.db, userId);
    const wordsById = new Map(words.map((word) => [word.id, word]));
    const stateById = new Map<string, SchedulingState>(
      states.map((row) => [row.vocabularyItemId, fromRow(row)]),
    );
    const bankIds = data.attempts.flatMap((attempt) => attempt.bankItemId ?? []);
    const bankById = new Map(
      (bankIds.length > 0 ? await this.bank.listForWords(userId, [...wordsById.keys()]) : [])
        .filter((item) => bankIds.includes(item.id))
        .map((item) => [item.id, item]),
    );

    const result: SyncResult = { accepted: [], rejected: [], states: [], serverTime: nowMs };
    const touched = new Set<string>();

    await this.db.transaction(async (tx) => {
      const ownSessions = new Set<string>();
      for (const session of data.sessions) {
        const existing = await tx
          .select({ userId: practiceSessions.userId })
          .from(practiceSessions)
          .where(eq(practiceSessions.id, session.id))
          .limit(1);
        if (existing[0] && existing[0].userId !== userId) continue;
        ownSessions.add(session.id);
        if (!existing[0]) {
          await tx.insert(practiceSessions).values({
            id: session.id,
            userId,
            startedAt: new Date(clamp(session.startedAt)),
          });
        }
      }

      const attempts = [...data.attempts].sort((a, b) => a.answeredAt - b.answeredAt);
      const attemptIds = attempts.map((attempt) => attempt.attemptId);
      const existingAttempts =
        attemptIds.length > 0
          ? await tx
              .select({
                id: reviewAttempts.id,
                userId: reviewAttempts.userId,
                result: reviewAttempts.result,
              })
              .from(reviewAttempts)
              .where(inArray(reviewAttempts.id, attemptIds))
          : [];
      const existingById = new Map(existingAttempts.map((row) => [row.id, row]));

      for (const attempt of attempts) {
        const existing = existingById.get(attempt.attemptId);
        if (existing) {
          if (existing.userId !== userId) {
            result.rejected.push({ attemptId: attempt.attemptId, reason: "id_conflict" });
          } else {
            result.accepted.push({
              attemptId: attempt.attemptId,
              result: existing.result as ReviewResult,
              duplicate: true,
            });
          }
          continue;
        }

        const word = wordsById.get(attempt.vocabularyItemId);
        if (!word) {
          result.rejected.push({ attemptId: attempt.attemptId, reason: "word_unavailable" });
          continue;
        }

        const bankItem = attempt.bankItemId ? bankById.get(attempt.bankItemId) : undefined;
        const usableBank =
          bankItem &&
          bankItem.vocabularyItemId === word.id &&
          bankItem.exerciseType === attempt.exerciseType
            ? bankItem
            : undefined;
        const accepted =
          usableBank?.payload.acceptedAnswers ?? acceptedAnswers(word, attempt.exerciseType);
        const grade = gradeAnswer(accepted, attempt.submittedAnswer, {
          usedHint: attempt.usedHint,
          skipped: attempt.skipped,
        });

        const answeredAt = clamp(attempt.answeredAt);
        const current = stateById.get(word.id) ?? initialSchedulingState();
        const next = applyAnswer(current, grade, answeredAt);
        stateById.set(word.id, next);
        touched.add(word.id);

        const sessionId =
          attempt.sessionId && ownSessions.has(attempt.sessionId) ? attempt.sessionId : null;
        await tx.insert(reviewAttempts).values({
          id: attempt.attemptId,
          userId,
          vocabularyItemId: word.id,
          sessionId,
          exerciseType: attempt.exerciseType,
          promptSnapshot: JSON.stringify({
            exerciseType: attempt.exerciseType,
            bankItemId: usableBank?.id ?? null,
            acceptedAnswers: accepted,
          }),
          submittedAnswer: attempt.submittedAnswer?.trim() || null,
          result: grade,
          usedHint: attempt.usedHint,
          latencyMs: attempt.latencyMs ?? null,
          createdAt: new Date(answeredAt),
        });
        result.accepted.push({ attemptId: attempt.attemptId, result: grade, duplicate: false });
      }

      for (const wordId of touched) {
        const next = stateById.get(wordId);
        if (!next) continue;
        await tx
          .insert(reviewStates)
          .values({ userId, vocabularyItemId: wordId, ...next })
          .onConflictDoUpdate({
            target: reviewStates.vocabularyItemId,
            set: { ...next, updatedAt: now },
          });
      }

      for (const session of data.sessions) {
        if (!ownSessions.has(session.id) || session.finishedAt == null) continue;
        const summary = await summarize(tx, userId, session.id);
        await tx
          .update(practiceSessions)
          .set({
            status: "completed",
            finishedAt: new Date(clamp(session.finishedAt)),
            summary: JSON.stringify(summary),
          })
          .where(and(eq(practiceSessions.id, session.id), eq(practiceSessions.userId, userId)));
      }
    });

    result.states = [...touched].flatMap((id) => {
      const state = stateById.get(id);
      return state ? [toSnapshotState(id, state)] : [];
    });
    return result;
  }
}

async function summarize(executor: Pick<Database, "select">, userId: string, sessionId: string) {
  const rows = await executor
    .select({ vocabularyItemId: reviewAttempts.vocabularyItemId, result: reviewAttempts.result })
    .from(reviewAttempts)
    .where(and(eq(reviewAttempts.userId, userId), eq(reviewAttempts.sessionId, sessionId)))
    .orderBy(asc(reviewAttempts.createdAt), asc(sql`rowid`));
  const counts = { recalled: 0, recalled_with_hint: 0, wrong: 0, skipped: 0 };
  for (const row of rows) counts[row.result as ReviewResult] += 1;
  return {
    sessionId,
    wordsPracticed: new Set(rows.map((row) => row.vocabularyItemId)).size,
    totalAttempts: rows.length,
    recalled: counts.recalled,
    recalledWithHint: counts.recalled_with_hint,
    wrong: counts.wrong,
    skipped: counts.skipped,
  };
}

function fromRow(row: ReviewStateRow): SchedulingState {
  return {
    dueAt: row.dueAt,
    introducedAt: row.introducedAt,
    successfulRecalls: row.successfulRecalls,
    consecutiveFailures: row.consecutiveFailures,
    reviewStage: row.reviewStage,
    difficulty: row.difficulty,
    lastResult: row.lastResult as ReviewResult | null,
    lastReviewedAt: row.lastReviewedAt,
  };
}
