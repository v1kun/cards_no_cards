import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import {
  importBatches,
  importItems,
  lessons,
  practiceSessions,
  profiles,
  reviewAttempts,
  reviewStates,
  topics,
  vocabularyForms,
  vocabularyItems,
  vocabularyTopics,
  wordSources,
} from "@/server/db/schema";
import type { AuthSession } from "@/server/auth/types";
import { NotFoundError } from "./errors";

export type Profile = typeof profiles.$inferSelect;

export const updateProfileSchema = z.object({
  preferredLocale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).nullish(),
  onboardingCompletedAt: z.date().nullish(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Data access for user profiles.
 *
 * A profile row mirrors an external identity: its primary key IS the
 * `userId` (Cognito `sub` in production). The row stores only application
 * preferences — never Apple/Cognito tokens or credentials.
 */
export class ProfilesRepository {
  constructor(private readonly db: Database) {}

  async get(userId: string): Promise<Profile | null> {
    const rows = await this.db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Ensures a profile exists for the session's user, creating it on first
   * sign-in, and returns it. Idempotent: concurrent calls converge on the
   * same row without failing.
   */
  async ensure(session: AuthSession): Promise<Profile> {
    await this.db.insert(profiles).values({ id: session.userId }).onConflictDoNothing();

    const profile = await this.get(session.userId);
    if (!profile) {
      // Should be unreachable: the insert above guarantees a row.
      throw new NotFoundError("Profile", session.userId);
    }
    return profile;
  }

  async update(userId: string, input: UpdateProfileInput): Promise<Profile> {
    const changes: Partial<typeof profiles.$inferInsert> = {};
    if (input.preferredLocale !== undefined) changes.preferredLocale = input.preferredLocale;
    if (input.timezone !== undefined) changes.timezone = input.timezone ?? null;
    if (input.onboardingCompletedAt !== undefined) {
      changes.onboardingCompletedAt = input.onboardingCompletedAt ?? null;
    }

    const updated = await this.db
      .update(profiles)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();

    if (!updated[0]) {
      throw new NotFoundError("Profile", userId);
    }
    return updated[0];
  }

  /**
   * Deletes the user's profile and all of their owned application data.
   *
   * Owned rows carry a plain `user_id` (the external identity) rather than a
   * foreign key to `profiles`, so deletion is performed explicitly across
   * every user-scoped table inside a single transaction. Children are
   * removed before parents to satisfy foreign-key enforcement. This is the
   * account-deletion behavior required by the retention policy.
   */
  async delete(userId: string): Promise<void> {
    const existing = await this.get(userId);
    if (!existing) {
      throw new NotFoundError("Profile", userId);
    }

    await this.db.transaction(async (tx) => {
      const scoped = [
        reviewAttempts,
        reviewStates,
        vocabularyTopics,
        vocabularyForms,
        wordSources,
        importItems,
        importBatches,
        practiceSessions,
        vocabularyItems,
        topics,
        lessons,
      ];
      for (const table of scoped) {
        await tx.delete(table).where(eq(table.userId, userId));
      }
      await tx.delete(profiles).where(eq(profiles.id, userId));
    });
  }
}
