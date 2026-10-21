import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import type { AIProvider } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { NotFoundError, VocabularyRepository } from "@/server/repositories";
import { ExerciseBankRepository } from "@/server/repositories/exercise-bank";
import type { GeneratedExercise } from "@/server/ai/types";
import { ExerciseBankService, sanitizeExercises } from "@/server/services/exercise-bank";

import { createTestDatabase, makeUserId } from "./helpers";

describe("ExerciseBankService", () => {
  let db: Database;
  let close: () => void;
  let vocab: VocabularyRepository;
  let bank: ExerciseBankRepository;
  const userId = makeUserId("bank");
  const otherUser = makeUserId("bank-other");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    vocab = new VocabularyRepository(db);
    bank = new ExerciseBankRepository(db);
  });

  afterEach(() => close());

  const addWord = (lemma: string, translation: string, user = userId) =>
    vocab.create(user, { lemma, translation, partOfSpeech: "noun" });

  it("reports missing words and fills them on refresh", async () => {
    await addWord("casa", "house");
    await addWord("perro", "dog");
    await addWord("gato", "cat", otherUser);
    const service = new ExerciseBankService(db, new MockAIProvider());

    expect(await service.status(userId)).toMatchObject({
      totalWords: 2,
      missing: 2,
      pending: 2,
      upToDate: 0,
    });

    const result = await service.refresh(userId);
    expect(result).toEqual({ processed: 2, succeeded: 2, failed: [], remaining: 0 });
    expect(await service.status(userId)).toMatchObject({ upToDate: 2, pending: 0 });

    const items = await bank.listForUser(userId);
    expect(items).toHaveLength(8);
    expect(new Set(items.map((item) => item.exerciseType))).toEqual(
      new Set(["multiple_choice", "multiple_choice_reverse", "recall", "cloze"]),
    );
    expect(await bank.listForUser(otherUser)).toHaveLength(0);
  });

  it("sends same-topic words to the AI as distractor candidates", async () => {
    const gato = await addWord("gato", "cat");
    const perro = await addWord("perro", "dog");
    const pan = await addWord("pan", "bread");
    await vocab.setTopics(userId, gato.id, ["Animals"]);
    await vocab.setTopics(userId, perro.id, ["Animals"]);
    await vocab.setTopics(userId, pan.id, ["Food"]);
    const provider = new MockAIProvider();
    const calls: Parameters<AIProvider["generateExercises"]>[0][] = [];
    const original = provider.generateExercises.bind(provider);
    provider.generateExercises = (input) => {
      calls.push(input);
      return original(input);
    };
    await new ExerciseBankService(db, provider).refresh(userId);

    const sent = calls.flatMap((call) => call.words);
    const forGato = sent.find((word) => word.key === gato.id)!;
    expect(forGato.topics).toEqual(["Animals"]);
    expect(forGato.topicWords).toEqual([{ lemma: "perro", translation: "dog" }]);
    expect(sent.find((word) => word.key === pan.id)!.topicWords).toEqual([]);

    const choice = (await bank.listForUser(userId)).find(
      (item) => item.vocabularyItemId === gato.id && item.exerciseType === "multiple_choice",
    );
    expect(choice?.payload.options).toContain("dog");
    expect(choice?.payload.options).not.toContain("bread");
  });

  it("marks words stale after their content changes", async () => {
    const word = await addWord("casa", "house");
    const service = new ExerciseBankService(db, new MockAIProvider());
    await service.refresh(userId);

    await vocab.update(userId, word.id, { translation: "home" });
    expect(await service.status(userId)).toMatchObject({ stale: 1, pending: 1 });

    await service.refresh(userId);
    const items = await bank.listForUser(userId);
    expect(items).toHaveLength(4);
    expect(
      items.find((item) => item.exerciseType === "multiple_choice")?.payload.correctAnswer,
    ).toBe("home");
  });

  it("processes words in batches and reports the remainder", async () => {
    for (let i = 0; i < 12; i++) await addWord(`palabra${i}`, `word${i}`);
    const service = new ExerciseBankService(db, new MockAIProvider());

    const first = await service.refresh(userId);
    expect(first).toMatchObject({ processed: 10, succeeded: 10, remaining: 2 });
    const second = await service.refresh(userId);
    expect(second).toMatchObject({ processed: 2, succeeded: 2, remaining: 0 });
  });

  it("reports words without valid questions as failed and supports exclusion", async () => {
    const word = await addWord("casa", "house");
    const base = new MockAIProvider();
    const broken: AIProvider = {
      ...base,
      name: "broken",
      parseVocabulary: base.parseVocabulary.bind(base),
      generateExample: base.generateExample.bind(base),
      evaluateAnswer: base.evaluateAnswer.bind(base),
      generateExercises: async (input) =>
        input.words.map((w) => ({
          key: w.key,
          exercises: [
            {
              exerciseType: "recall",
              instruction: "Type it",
              promptText: `the answer is ${w.lemma}`,
              correctAnswer: w.lemma,
              acceptedAnswers: [w.lemma],
            },
          ],
        })),
    };
    const service = new ExerciseBankService(db, broken);

    const result = await service.refresh(userId);
    expect(result).toEqual({
      processed: 1,
      succeeded: 0,
      failed: [{ id: word.id, lemma: "casa" }],
      remaining: 0,
    });
    expect(await service.refresh(userId, { exclude: [word.id] })).toMatchObject({ processed: 0 });
  });

  it("regenerates a single word and enforces ownership", async () => {
    const word = await addWord("casa", "house");
    const foreign = await addWord("gato", "cat", otherUser);
    const service = new ExerciseBankService(db, new MockAIProvider());

    expect(await service.regenerate(userId, word.id)).toEqual({ count: 4 });
    await expect(service.regenerate(userId, foreign.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes bank questions together with the word", async () => {
    const word = await addWord("casa", "house");
    await new ExerciseBankService(db, new MockAIProvider()).refresh(userId);
    await vocab.delete(userId, word.id);
    expect(await bank.listForUser(userId)).toHaveLength(0);
  });
});

describe("sanitizeExercises", () => {
  it("drops invalid questions and caps variants per type", () => {
    const mc: GeneratedExercise = {
      exerciseType: "multiple_choice",
      instruction: "Choose",
      promptText: "casa",
      options: ["house", "dog", "cat"],
      correctAnswer: "house",
      acceptedAnswers: ["house"],
    };
    const result = sanitizeExercises([
      mc,
      mc,
      mc,
      { ...mc, options: ["house", "dog"] },
      { ...mc, exerciseType: "cloze", promptText: "no blank here" },
    ]);
    expect(result).toHaveLength(2);
  });
});
