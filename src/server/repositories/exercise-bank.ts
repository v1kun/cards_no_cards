import { and, asc, eq, inArray } from "drizzle-orm";

import type { BankItem, BankPayload } from "@/domain/review/bank";
import { exerciseTypes, type ExerciseType } from "@/domain/review/exercises";
import type { Database, DbExecutor } from "@/server/db/client";
import { exerciseBankItems } from "@/server/db/schema";

export type NewBankExercise = { exerciseType: ExerciseType; payload: BankPayload };

function toBankItem(row: typeof exerciseBankItems.$inferSelect): BankItem | null {
  if (!(exerciseTypes as readonly string[]).includes(row.exerciseType)) return null;
  try {
    return {
      id: row.id,
      vocabularyItemId: row.vocabularyItemId,
      exerciseType: row.exerciseType as ExerciseType,
      payload: JSON.parse(row.payload) as BankPayload,
      sourceHash: row.sourceHash,
    };
  } catch {
    return null;
  }
}

/** Data access for the pre-generated question bank. Always user-scoped. */
export class ExerciseBankRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<BankItem[]> {
    const rows = await this.db
      .select()
      .from(exerciseBankItems)
      .where(eq(exerciseBankItems.userId, userId))
      .orderBy(asc(exerciseBankItems.createdAt), asc(exerciseBankItems.id));
    return rows.flatMap((row) => toBankItem(row) ?? []);
  }

  async listForWords(userId: string, wordIds: string[]): Promise<BankItem[]> {
    if (wordIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(exerciseBankItems)
      .where(
        and(
          eq(exerciseBankItems.userId, userId),
          inArray(exerciseBankItems.vocabularyItemId, wordIds),
        ),
      )
      .orderBy(asc(exerciseBankItems.createdAt), asc(exerciseBankItems.id));
    return rows.flatMap((row) => toBankItem(row) ?? []);
  }

  async getById(userId: string, id: string): Promise<BankItem | null> {
    const rows = await this.db
      .select()
      .from(exerciseBankItems)
      .where(and(eq(exerciseBankItems.userId, userId), eq(exerciseBankItems.id, id)))
      .limit(1);
    return rows[0] ? toBankItem(rows[0]) : null;
  }

  /** Atomically replaces every bank question of one word. */
  async replaceForWord(
    executor: DbExecutor,
    userId: string,
    vocabularyItemId: string,
    exercises: NewBankExercise[],
    sourceHash: string,
    provider: string,
  ): Promise<void> {
    await executor
      .delete(exerciseBankItems)
      .where(
        and(
          eq(exerciseBankItems.userId, userId),
          eq(exerciseBankItems.vocabularyItemId, vocabularyItemId),
        ),
      );
    if (exercises.length === 0) return;
    const now = Date.now();
    await executor.insert(exerciseBankItems).values(
      exercises.map((exercise, index) => ({
        userId,
        vocabularyItemId,
        exerciseType: exercise.exerciseType,
        payload: JSON.stringify(exercise.payload),
        sourceHash,
        provider,
        // Preserve generation order for stable variant rotation.
        createdAt: new Date(now + index),
      })),
    );
  }
}
