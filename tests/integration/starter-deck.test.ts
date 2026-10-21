import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { reviewStates, vocabularyItems, wordSources } from "@/server/db/schema";
import { VocabularyRepository } from "@/server/repositories";
import { exampleContainsLemma, parseStarterDeckFile } from "@/server/starter-deck/parse";
import { seedStarterDeck } from "@/server/starter-deck/seed";

import { createTestDatabase, makeUserId } from "./helpers";

const SAMPLE = [
  "# topic: Дом",
  "el libro\tnoun\tmasculine\tкнига\tLeo el libro en casa.\tЯ читаю книгу дома.",
  "",
  "hablar\tverb\t-\tговорить\tQuiero hablar contigo.\tХочу поговорить с тобой.",
].join("\n");

describe("parseStarterDeckFile", () => {
  it("parses rows under the topic header", () => {
    const { entries, issues } = parseStarterDeckFile("x.tsv", SAMPLE);
    expect(issues).toEqual([]);
    expect(entries).toEqual([
      {
        lemma: "el libro",
        partOfSpeech: "noun",
        gender: "masculine",
        translation: "книга",
        exampleSentence: "Leo el libro en casa.",
        exampleTranslation: "Я читаю книгу дома.",
        topic: "Дом",
      },
      expect.objectContaining({ lemma: "hablar", gender: undefined, topic: "Дом" }),
    ]);
  });

  it("reports malformed rows with line numbers", () => {
    const { entries, issues } = parseStarterDeckFile(
      "bad.tsv",
      [
        "a\tnoun\t-\tb\tc\td",
        "# topic: T",
        "a\tnoun",
        "a\tthing\t-\tb\tc\td",
        "a\tnoun\tx\tb\tc\td",
      ].join("\n"),
    );
    expect(entries).toEqual([]);
    expect(issues.map((issue) => issue.line)).toEqual([1, 3, 4, 5]);
  });

  it("checks that the example contains the whole lemma", () => {
    expect(exampleContainsLemma({ lemma: "el libro", exampleSentence: "El libro es rojo." })).toBe(
      true,
    );
    expect(exampleContainsLemma({ lemma: "sol", exampleSentence: "Estoy solo." })).toBe(false);
  });
});

describe("seedStarterDeck", () => {
  let db: Database;
  let close: () => void;
  const user = makeUserId("deck");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
  });

  afterEach(() => {
    close();
  });

  it("creates words with topic, source, and review state, skipping known lemmas", async () => {
    await new VocabularyRepository(db).create(user, {
      lemma: "El Libro",
      translation: "книга",
      partOfSpeech: "noun",
    });
    const { entries } = parseStarterDeckFile("x.tsv", SAMPLE);

    const first = await seedStarterDeck(db, user, entries, "starter-deck:test");
    expect(first).toEqual({ created: 1, skipped: 1 });

    const [hablar] = await db
      .select()
      .from(vocabularyItems)
      .where(eq(vocabularyItems.lemma, "hablar"));
    expect(hablar?.exampleSentence).toBe("Quiero hablar contigo.");
    const words = await new VocabularyRepository(db).getById(user, hablar!.id);
    expect(words?.topics.map((topic) => topic.name)).toEqual(["Дом"]);
    const states = await db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.vocabularyItemId, hablar!.id));
    expect(states).toHaveLength(1);
    const sources = await db
      .select()
      .from(wordSources)
      .where(eq(wordSources.vocabularyItemId, hablar!.id));
    expect(sources[0]?.sourceType).toBe("starter_deck");

    const second = await seedStarterDeck(db, user, entries, "starter-deck:test");
    expect(second).toEqual({ created: 0, skipped: 2 });
  });
});
