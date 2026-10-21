import { and, asc, eq } from "drizzle-orm";

import type { SnapshotWord } from "@/domain/review/snapshot";
import type { Database } from "@/server/db/client";
import {
  reviewStates,
  topics,
  vocabularyForms,
  vocabularyItems,
  vocabularyTopics,
} from "@/server/db/schema";

export type PracticeWord = SnapshotWord;

export type ReviewStateRow = typeof reviewStates.$inferSelect;

/**
 * Loads every active word of a user with forms and topic links, plus the
 * user's topics and review states, in a handful of set-based queries.
 * Shared by the offline snapshot, the question bank, and sync.
 */
export async function loadPracticeData(db: Database, userId: string) {
  const [items, forms, links, topicRows, states] = await Promise.all([
    db
      .select()
      .from(vocabularyItems)
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.status, "active")))
      .orderBy(asc(vocabularyItems.createdAt), asc(vocabularyItems.id)),
    db
      .select({ itemId: vocabularyForms.vocabularyItemId, form: vocabularyForms.form })
      .from(vocabularyForms)
      .where(eq(vocabularyForms.userId, userId)),
    db
      .select({ itemId: vocabularyTopics.vocabularyItemId, topicId: vocabularyTopics.topicId })
      .from(vocabularyTopics)
      .where(eq(vocabularyTopics.userId, userId)),
    db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(eq(topics.userId, userId))
      .orderBy(asc(topics.name)),
    db.select().from(reviewStates).where(eq(reviewStates.userId, userId)),
  ]);

  const formsByItem = groupBy(
    forms,
    (row) => row.itemId,
    (row) => row.form,
  );
  const topicsByItem = groupBy(
    links,
    (row) => row.itemId,
    (row) => row.topicId,
  );

  const words: PracticeWord[] = items.map((item) => ({
    id: item.id,
    lemma: item.lemma,
    translation: item.translation,
    secondaryTranslation: item.secondaryTranslation,
    partOfSpeech: item.partOfSpeech,
    exampleSentence: item.exampleSentence,
    exampleTranslation: item.exampleTranslation,
    gender: item.gender,
    forms: formsByItem.get(item.id) ?? [],
    topicIds: topicsByItem.get(item.id) ?? [],
    createdAt: item.createdAt.getTime(),
  }));
  const activeIds = new Set(words.map((word) => word.id));

  return {
    words,
    topics: topicRows,
    states: states.filter((state) => activeIds.has(state.vocabularyItemId)),
  };
}

function groupBy<T, V>(rows: T[], key: (row: T) => string, value: (row: T) => V) {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(value(row));
    map.set(key(row), list);
  }
  return map;
}
