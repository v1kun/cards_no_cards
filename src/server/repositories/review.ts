import { and, asc, count, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import {
  practiceSessions,
  reviewAttempts,
  reviewResults,
  reviewStates,
  vocabularyItems,
} from "@/server/db/schema";

export type ReviewState = typeof reviewStates.$inferSelect;
export type ReviewAttempt = typeof reviewAttempts.$inferSelect;
export type PracticeSession = typeof practiceSessions.$inferSelect;

export const recordAttemptSchema = z.object({
  vocabularyItemId: z.string().min(1),
  sessionId: z.string().optional(),
  exerciseType: z.string().min(1),
  promptSnapshot: z.record(z.string(), z.unknown()),
  submittedAnswer: z.string().optional(),
  result: z.enum(reviewResults),
  usedHint: z.boolean().default(false),
  latencyMs: z.number().int().nonnegative().optional(),
});

export type RecordAttemptInput = z.input<typeof recordAttemptSchema>;

export type ReviewStateUpdate = Partial<
  Pick<
    ReviewState,
    | "dueAt"
    | "introducedAt"
    | "successfulRecalls"
    | "consecutiveFailures"
    | "reviewStage"
    | "difficulty"
    | "lastResult"
    | "lastReviewedAt"
  >
>;

export class ReviewRepository {
  constructor(private readonly db: Database) {}

  async getState(userId: string, vocabularyItemId: string): Promise<ReviewState | null> {
    const rows = await this.db
      .select()
      .from(reviewStates)
      .where(
        and(eq(reviewStates.userId, userId), eq(reviewStates.vocabularyItemId, vocabularyItemId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Creates or updates the single review state for a vocabulary item. */
  async upsertState(
    userId: string,
    vocabularyItemId: string,
    update: ReviewStateUpdate,
  ): Promise<ReviewState> {
    const rows = await this.db
      .insert(reviewStates)
      .values({ userId, vocabularyItemId, ...update })
      .onConflictDoUpdate({
        target: reviewStates.vocabularyItemId,
        set: { ...update, updatedAt: new Date() },
      })
      .returning();
    if (!rows[0]) {
      throw new Error("Failed to upsert review state");
    }
    return rows[0];
  }

  /** Words that are due (due_at in the past) or never scheduled yet. */
  async listDue(userId: string, now: Date, limit = 20): Promise<ReviewState[]> {
    return this.db
      .select()
      .from(reviewStates)
      .where(
        and(
          eq(reviewStates.userId, userId),
          or(isNull(reviewStates.dueAt), lte(reviewStates.dueAt, now)),
        ),
      )
      .orderBy(asc(reviewStates.dueAt))
      .limit(limit);
  }

  /**
   * Appends an immutable attempt record. Attempt history is append-only;
   * review-state corrections never rewrite historical attempts.
   */
  async recordAttempt(userId: string, input: RecordAttemptInput): Promise<ReviewAttempt> {
    const data = recordAttemptSchema.parse(input);
    const rows = await this.db
      .insert(reviewAttempts)
      .values({
        userId,
        vocabularyItemId: data.vocabularyItemId,
        sessionId: data.sessionId,
        exerciseType: data.exerciseType,
        promptSnapshot: JSON.stringify(data.promptSnapshot),
        submittedAnswer: data.submittedAnswer,
        result: data.result,
        usedHint: data.usedHint,
        latencyMs: data.latencyMs,
      })
      .returning();
    if (!rows[0]) {
      throw new Error("Failed to record review attempt");
    }
    return rows[0];
  }

  async listAttempts(userId: string, vocabularyItemId: string): Promise<ReviewAttempt[]> {
    return this.db
      .select()
      .from(reviewAttempts)
      .where(
        and(
          eq(reviewAttempts.userId, userId),
          eq(reviewAttempts.vocabularyItemId, vocabularyItemId),
        ),
      )
      .orderBy(asc(reviewAttempts.createdAt));
  }

  /** Looks up a single attempt by id (used for idempotent submission). */
  async getAttemptById(userId: string, id: string): Promise<ReviewAttempt | null> {
    const rows = await this.db
      .select()
      .from(reviewAttempts)
      .where(and(eq(reviewAttempts.userId, userId), eq(reviewAttempts.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Attempts recorded for a given session, oldest first. */
  async attemptsForSession(userId: string, sessionId: string): Promise<ReviewAttempt[]> {
    return this.db
      .select()
      .from(reviewAttempts)
      .where(and(eq(reviewAttempts.userId, userId), eq(reviewAttempts.sessionId, sessionId)))
      .orderBy(asc(reviewAttempts.createdAt), asc(sql`rowid`));
  }

  async getSession(userId: string, id: string): Promise<PracticeSession | null> {
    const rows = await this.db
      .select()
      .from(practiceSessions)
      .where(and(eq(practiceSessions.userId, userId), eq(practiceSessions.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Count of active, already-introduced words whose review is due by `now`. */
  async countDue(userId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(reviewStates)
      .innerJoin(vocabularyItems, eq(vocabularyItems.id, reviewStates.vocabularyItemId))
      .where(
        and(
          eq(reviewStates.userId, userId),
          eq(vocabularyItems.status, "active"),
          sql`${reviewStates.introducedAt} is not null`,
          lte(reviewStates.dueAt, now),
        ),
      );
    return row?.value ?? 0;
  }

  /** Count of active words never introduced yet (no state or null introduced). */
  async countNew(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(vocabularyItems)
      .leftJoin(reviewStates, eq(reviewStates.vocabularyItemId, vocabularyItems.id))
      .where(
        and(
          eq(vocabularyItems.userId, userId),
          eq(vocabularyItems.status, "active"),
          or(isNull(reviewStates.id), isNull(reviewStates.introducedAt)),
        ),
      );
    return row?.value ?? 0;
  }
}
