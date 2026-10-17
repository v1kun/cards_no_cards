import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import { reviewAttempts, reviewResults, reviewStates } from "@/server/db/schema";

export type ReviewState = typeof reviewStates.$inferSelect;
export type ReviewAttempt = typeof reviewAttempts.$inferSelect;

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
}
