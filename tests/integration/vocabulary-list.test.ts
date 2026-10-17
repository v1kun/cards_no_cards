import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/server/db/client";
import { ReviewRepository, TopicsRepository, VocabularyRepository } from "@/server/repositories";

import { createTestDatabase, makeUserId } from "./helpers";

describe("VocabularyRepository listing and filters", () => {
  let db: Database;
  let close: () => void;
  let repo: VocabularyRepository;
  let topicsRepo: TopicsRepository;
  let reviewRepo: ReviewRepository;
  const userA = makeUserId("a");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    repo = new VocabularyRepository(db);
    topicsRepo = new TopicsRepository(db);
    reviewRepo = new ReviewRepository(db);
  });

  afterEach(() => {
    close();
  });

  async function seed() {
    await repo.create(userA, {
      lemma: "hablar",
      translation: "to speak",
      partOfSpeech: "verb",
      topics: ["Verbs", "Daily"],
      forms: [{ form: "hablo" }],
      source: { sourceType: "manual", sourceText: "notes" },
    });
    await repo.create(userA, {
      lemma: "rojo",
      translation: "red",
      partOfSpeech: "adjective",
      topics: ["Colors"],
      forms: [],
    });
    await repo.create(userA, {
      lemma: "comer",
      translation: "to eat",
      partOfSpeech: "verb",
      topics: ["Verbs"],
      forms: [],
    });
  }

  it("paginates with a total count and stable ordering", async () => {
    await seed();
    const firstPage = await repo.listPage(userA, {}, { limit: 2, offset: 0 });
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);

    const secondPage = await repo.listPage(userA, {}, { limit: 2, offset: 2 });
    expect(secondPage.items).toHaveLength(1);

    const ids = [...firstPage.items, ...secondPage.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("applies part-of-speech and topic filters independently", async () => {
    await seed();
    const verbs = await repo.listPage(userA, { partOfSpeech: "verb" }, { limit: 50, offset: 0 });
    expect(verbs.total).toBe(2);

    const colors = (await topicsRepo.list(userA)).find((t) => t.name === "Colors");
    const byColor = await repo.listPage(userA, { topicId: colors!.id }, { limit: 50, offset: 0 });
    expect(byColor.total).toBe(1);
    expect(byColor.items[0]?.lemma).toBe("rojo");

    // Combining both filters narrows further and they do not interfere.
    const verbsInColors = await repo.listPage(
      userA,
      { partOfSpeech: "verb", topicId: colors!.id },
      { limit: 50, offset: 0 },
    );
    expect(verbsInColors.total).toBe(0);
  });

  it("filters by due state, including words with no review state", async () => {
    const due = await repo.create(userA, {
      lemma: "nuevo",
      translation: "new",
      partOfSpeech: "adjective",
      topics: [],
      forms: [],
    });
    const notDue = await repo.create(userA, {
      lemma: "viejo",
      translation: "old",
      partOfSpeech: "adjective",
      topics: [],
      forms: [],
    });
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    await reviewRepo.upsertState(userA, notDue.id, { dueAt: future });

    const dueItems = await repo.listPage(userA, { dueOnly: true }, { limit: 50, offset: 0 });
    const dueIds = dueItems.items.map((i) => i.id);
    expect(dueIds).toContain(due.id);
    expect(dueIds).not.toContain(notDue.id);
  });

  it("includes topics and a review summary on listed items", async () => {
    const item = await repo.create(userA, {
      lemma: "gato",
      translation: "cat",
      partOfSpeech: "noun",
      topics: ["Animals"],
      forms: [],
    });
    await reviewRepo.upsertState(userA, item.id, { successfulRecalls: 3, reviewStage: 2 });

    const page = await repo.listPage(userA, {}, { limit: 50, offset: 0 });
    const listed = page.items.find((i) => i.id === item.id);
    expect(listed?.topics.map((t) => t.name)).toEqual(["Animals"]);
    expect(listed?.reviewSummary?.successfulRecalls).toBe(3);
  });

  it("replaces topics without creating duplicate words", async () => {
    const item = await repo.create(userA, {
      lemma: "correr",
      translation: "to run",
      partOfSpeech: "verb",
      topics: ["Verbs"],
      forms: [],
    });

    const updated = await repo.setTopics(userA, item.id, ["Sports", "sports ", "Health"]);
    expect(updated.map((t) => t.name)).toEqual(["Sports", "Health"]);

    const detail = await repo.getDetail(userA, item.id);
    expect(detail?.topics.map((t) => t.name).sort()).toEqual(["Health", "Sports"]);
  });

  it("returns full detail with forms, sources, and topics", async () => {
    const item = await repo.create(userA, {
      lemma: "escribir",
      translation: "to write",
      partOfSpeech: "verb",
      topics: ["Verbs"],
      forms: [{ form: "escribo", formType: "present_1s" }],
      source: { sourceType: "manual", sourceText: "lesson 1" },
    });

    const detail = await repo.getDetail(userA, item.id);
    expect(detail?.forms).toHaveLength(1);
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.topics).toHaveLength(1);
  });
});
