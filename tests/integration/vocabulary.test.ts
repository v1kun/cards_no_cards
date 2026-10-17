import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/server/db/client";
import {
  NotFoundError,
  TopicsRepository,
  VocabularyRepository,
  normalizeTopicName,
} from "@/server/repositories";
import { vocabularyForms, vocabularyTopics, wordSources } from "@/server/db/schema";
import { eq } from "drizzle-orm";

import { createTestDatabase, makeUserId } from "./helpers";

describe("VocabularyRepository", () => {
  let db: Database;
  let close: () => void;
  let repo: VocabularyRepository;
  let topicsRepo: TopicsRepository;
  const userA = makeUserId("a");
  const userB = makeUserId("b");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    repo = new VocabularyRepository(db);
    topicsRepo = new TopicsRepository(db);
  });

  afterEach(() => {
    close();
  });

  it("creates an item with forms, topics, and a source in one transaction", async () => {
    const item = await repo.create(userA, {
      lemma: "hablar",
      translation: "to speak",
      partOfSpeech: "verb",
      topics: ["Verbs", "verbs ", "Daily life"],
      forms: [
        { form: "hablo", formType: "present_1s" },
        { form: "hablé", formType: "preterite_1s" },
      ],
      source: { sourceType: "manual", sourceText: "lesson notes" },
    });

    expect(item.id).toBeTruthy();
    expect(item.forms).toHaveLength(2);
    // "Verbs" and "verbs " normalize to the same topic -> deduplicated.
    expect(item.topics).toHaveLength(2);

    const sources = await db
      .select()
      .from(wordSources)
      .where(eq(wordSources.vocabularyItemId, item.id));
    expect(sources).toHaveLength(1);
  });

  it("reuses an existing topic instead of duplicating it", async () => {
    const first = await repo.create(userA, {
      lemma: "gato",
      translation: "cat",
      partOfSpeech: "noun",
      topics: ["Animals"],
    });
    const second = await repo.create(userA, {
      lemma: "perro",
      translation: "dog",
      partOfSpeech: "noun",
      topics: ["animals"],
    });

    expect(first.topics[0]?.id).toBe(second.topics[0]?.id);
    const allTopics = await topicsRepo.list(userA);
    expect(allTopics).toHaveLength(1);
  });

  it("enforces ownership: user B cannot read, update, or delete user A's item", async () => {
    const item = await repo.create(userA, {
      lemma: "casa",
      translation: "house",
      partOfSpeech: "noun",
    });

    expect(await repo.getById(userB, item.id)).toBeNull();
    await expect(repo.update(userB, item.id, { translation: "home" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repo.delete(userB, item.id)).rejects.toBeInstanceOf(NotFoundError);

    // Still intact for the owner.
    const owned = await repo.getById(userA, item.id);
    expect(owned?.translation).toBe("house");
  });

  it("filters by status, part of speech, topic, and search independently", async () => {
    await repo.create(userA, {
      lemma: "rojo",
      translation: "red",
      partOfSpeech: "adjective",
      topics: ["Colors"],
    });
    const verb = await repo.create(userA, {
      lemma: "correr",
      translation: "to run",
      partOfSpeech: "verb",
      topics: ["Sports"],
    });
    await repo.archive(userA, verb.id);

    expect(await repo.list(userA, { status: "active" })).toHaveLength(1);
    expect(await repo.list(userA, { status: "archived" })).toHaveLength(1);
    expect(await repo.list(userA, { partOfSpeech: "adjective" })).toHaveLength(1);
    expect(await repo.list(userA, { search: "corr" })).toHaveLength(1);

    const colors = await topicsRepo.list(userA);
    const colorsTopic = colors.find((t) => t.normalizedName === "colors");
    expect(colorsTopic).toBeDefined();
    const byTopic = await repo.list(userA, { topicId: colorsTopic!.id });
    expect(byTopic).toHaveLength(1);
    expect(byTopic[0]?.lemma).toBe("rojo");
  });

  it("archives and restores instead of deleting by default", async () => {
    const item = await repo.create(userA, {
      lemma: "libro",
      translation: "book",
      partOfSpeech: "noun",
    });
    const archived = await repo.archive(userA, item.id);
    expect(archived.status).toBe("archived");
    const restored = await repo.restore(userA, item.id);
    expect(restored.status).toBe("active");
  });

  it("cascades deletes to forms, topic links, and sources", async () => {
    const item = await repo.create(userA, {
      lemma: "comer",
      translation: "to eat",
      partOfSpeech: "verb",
      topics: ["Food"],
      forms: [{ form: "como" }],
      source: { sourceType: "manual" },
    });

    await repo.delete(userA, item.id);

    expect(
      await db.select().from(vocabularyForms).where(eq(vocabularyForms.vocabularyItemId, item.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(vocabularyTopics)
        .where(eq(vocabularyTopics.vocabularyItemId, item.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(wordSources).where(eq(wordSources.vocabularyItemId, item.id)),
    ).toHaveLength(0);
  });

  it("rejects an invalid part of speech at the validation boundary", async () => {
    await expect(
      repo.create(userA, {
        lemma: "x",
        translation: "y",
        // @ts-expect-error intentionally invalid
        partOfSpeech: "not-a-pos",
      }),
    ).rejects.toThrow();
  });
});

describe("normalizeTopicName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeTopicName("  Daily   Life ")).toBe("daily life");
  });
});
