import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { reviewStates, vocabularyItems } from "@/server/db/schema";
import { createVocabularySchema, VocabularyRepository } from "@/server/repositories/vocabulary";

import { parseStarterDeckFile, type StarterDeckEntry, type StarterDeckIssue } from "./parse";

/** Reads and parses every `*.tsv` file in a starter-deck directory, in name order. */
export async function loadStarterDeck(
  dir: string,
): Promise<{ entries: StarterDeckEntry[]; issues: StarterDeckIssue[] }> {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".tsv")).sort();
  const entries: StarterDeckEntry[] = [];
  const issues: StarterDeckIssue[] = [];
  for (const file of files) {
    const parsed = parseStarterDeckFile(file, await readFile(join(dir, file), "utf8"));
    entries.push(...parsed.entries);
    issues.push(...parsed.issues);
  }
  return { entries, issues };
}

/**
 * Adds starter-deck words to a user's vocabulary with a fresh review state.
 * Lemmas the user already has (case-insensitive), and duplicates within the
 * deck, are skipped, so re-running is safe.
 */
export async function seedStarterDeck(
  db: Database,
  userId: string,
  entries: StarterDeckEntry[],
  deckName: string,
): Promise<{ created: number; skipped: number }> {
  const existing = await db
    .select({ lemma: vocabularyItems.lemma })
    .from(vocabularyItems)
    .where(eq(vocabularyItems.userId, userId));
  const known = new Set(existing.map((row) => row.lemma.toLocaleLowerCase("es")));

  const toCreate: StarterDeckEntry[] = [];
  for (const entry of entries) {
    const key = entry.lemma.toLocaleLowerCase("es");
    if (known.has(key)) continue;
    known.add(key);
    toCreate.push(entry);
  }

  const repo = new VocabularyRepository(db);
  await db.transaction(async (tx) => {
    for (const entry of toCreate) {
      const data = createVocabularySchema.parse({
        lemma: entry.lemma,
        translation: entry.translation,
        partOfSpeech: entry.partOfSpeech,
        gender: entry.gender,
        exampleSentence: entry.exampleSentence,
        exampleTranslation: entry.exampleTranslation,
        topics: [entry.topic],
        source: { sourceType: "starter_deck", sourceText: deckName },
      });
      const created = await repo.createWithin(tx, userId, data);
      await tx
        .insert(reviewStates)
        .values({ userId, vocabularyItemId: created.id })
        .onConflictDoNothing({ target: reviewStates.vocabularyItemId });
    }
  });

  return { created: toCreate.length, skipped: entries.length - toCreate.length };
}
