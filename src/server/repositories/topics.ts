import { and, eq } from "drizzle-orm";

import type { Database, DbExecutor } from "@/server/db/client";
import { topics } from "@/server/db/schema";

export type Topic = typeof topics.$inferSelect;

/** Normalizes a topic name for duplicate detection: lowercase, collapsed whitespace. */
export function normalizeTopicName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export class TopicsRepository {
  constructor(private readonly db: Database) {}

  async list(userId: string): Promise<Topic[]> {
    return this.db.select().from(topics).where(eq(topics.userId, userId));
  }

  async getById(userId: string, id: string): Promise<Topic | null> {
    const rows = await this.db
      .select()
      .from(topics)
      .where(and(eq(topics.userId, userId), eq(topics.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Returns the existing topic for the user with the same normalized name,
   * or creates it. Prevents accidental duplicate topics that differ only
   * in casing or surrounding whitespace.
   */
  async findOrCreate(userId: string, name: string, executor: DbExecutor = this.db): Promise<Topic> {
    const trimmed = name.trim();
    const normalized = normalizeTopicName(trimmed);

    const existing = await executor
      .select()
      .from(topics)
      .where(and(eq(topics.userId, userId), eq(topics.normalizedName, normalized)))
      .limit(1);
    if (existing[0]) {
      return existing[0];
    }

    const inserted = await executor
      .insert(topics)
      .values({ userId, name: trimmed, normalizedName: normalized })
      .onConflictDoNothing({ target: [topics.userId, topics.normalizedName] })
      .returning();
    if (inserted[0]) {
      return inserted[0];
    }

    // Lost a race to a concurrent insert; read the winning row.
    const afterConflict = await executor
      .select()
      .from(topics)
      .where(and(eq(topics.userId, userId), eq(topics.normalizedName, normalized)))
      .limit(1);
    if (!afterConflict[0]) {
      throw new Error(`Failed to find or create topic: ${name}`);
    }
    return afterConflict[0];
  }
}
