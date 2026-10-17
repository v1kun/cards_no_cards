import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/server/db/client";
import { ReviewRepository, VocabularyRepository } from "@/server/repositories";

import { createTestDatabase, makeUserId } from "./helpers";

describe("ReviewRepository", () => {
  let db: Database;
  let close: () => void;
  let review: ReviewRepository;
  let vocab: VocabularyRepository;
  const user = makeUserId("r");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    review = new ReviewRepository(db);
    vocab = new VocabularyRepository(db);
  });

  afterEach(() => {
    close();
  });

  async function newWord() {
    return vocab.create(user, {
      lemma: "aprender",
      translation: "to learn",
      partOfSpeech: "verb",
    });
  }

  it("upserts a single review state per vocabulary item", async () => {
    const word = await newWord();
    const created = await review.upsertState(user, word.id, {
      introducedAt: new Date(),
      successfulRecalls: 1,
    });
    expect(created.successfulRecalls).toBe(1);

    const updated = await review.upsertState(user, word.id, { successfulRecalls: 2 });
    expect(updated.id).toBe(created.id);
    expect(updated.successfulRecalls).toBe(2);
  });

  it("lists words that are due or never scheduled", async () => {
    const word = await newWord();
    const past = new Date(Date.now() - 1000);
    await review.upsertState(user, word.id, { dueAt: past });

    const due = await review.listDue(user, new Date());
    expect(due.map((s) => s.vocabularyItemId)).toContain(word.id);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    await review.upsertState(user, word.id, { dueAt: future });
    const dueAfter = await review.listDue(user, new Date());
    expect(dueAfter.map((s) => s.vocabularyItemId)).not.toContain(word.id);
  });

  it("appends attempts immutably in order", async () => {
    const word = await newWord();
    await review.recordAttempt(user, {
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      promptSnapshot: { options: ["a", "b"] },
      submittedAnswer: "a",
      result: "wrong",
    });
    await review.recordAttempt(user, {
      vocabularyItemId: word.id,
      exerciseType: "recall",
      promptSnapshot: { prompt: "to learn" },
      submittedAnswer: "aprender",
      result: "recalled",
    });

    const attempts = await review.listAttempts(user, word.id);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.result).toBe("wrong");
    expect(attempts[1]?.result).toBe("recalled");
    expect(JSON.parse(attempts[0]!.promptSnapshot)).toEqual({ options: ["a", "b"] });
  });

  it("rejects an invalid review result", async () => {
    const word = await newWord();
    await expect(
      review.recordAttempt(user, {
        vocabularyItemId: word.id,
        exerciseType: "recall",
        promptSnapshot: {},
        // @ts-expect-error intentionally invalid
        result: "maybe",
      }),
    ).rejects.toThrow();
  });
});
