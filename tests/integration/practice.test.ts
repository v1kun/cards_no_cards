import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import type { Database } from "@/server/db/client";
import { ReviewRepository } from "@/server/repositories/review";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import { ExerciseBankService } from "@/server/services/exercise-bank";
import { MAX_OFFLINE_AGE_MS, PracticeService } from "@/server/services/practice";
import { createTestDatabase, makeUserId } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

describe("PracticeService (offline snapshot + sync)", () => {
  let db: Database;
  let close: () => void;
  let vocab: VocabularyRepository;
  let reviews: ReviewRepository;
  let service: PracticeService;
  const userId = makeUserId("practice");
  const otherUser = makeUserId("practice-other");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    vocab = new VocabularyRepository(db);
    reviews = new ReviewRepository(db);
    service = new PracticeService(db);
  });

  afterEach(() => close());

  const seedWord = (lemma: string, translation: string, user = userId) =>
    vocab.create(user, {
      lemma,
      translation,
      partOfSpeech: "verb",
      forms: [{ form: `${lemma.slice(0, -2)}o`, formType: "present_1s" }],
      topics: ["Daily"],
    });

  const attempt = (vocabularyItemId: string, overrides: Record<string, unknown> = {}) => ({
    attemptId: randomUUID(),
    vocabularyItemId,
    exerciseType: "recall" as const,
    submittedAnswer: "hablar",
    answeredAt: Date.now(),
    ...overrides,
  });

  it("builds a snapshot with words, topics, states, and only fresh bank questions", async () => {
    const word = await seedWord("hablar", "to speak");
    await seedWord("comer", "to eat", otherUser);
    await new ExerciseBankService(db, new MockAIProvider()).refresh(userId);

    let snapshot = await service.snapshot(userId);
    expect(snapshot.translationLanguage).toBe("en");
    expect(snapshot.words).toHaveLength(1);
    expect(snapshot.words[0]).toMatchObject({ lemma: "hablar", forms: ["hablo"] });
    expect(snapshot.words[0]?.topicIds).toHaveLength(1);
    expect(snapshot.topics.map((topic) => topic.name)).toEqual(["Daily"]);
    expect(snapshot.bank).toHaveLength(4);

    await vocab.update(userId, word.id, { translation: "to talk" });
    snapshot = await service.snapshot(userId);
    expect(snapshot.bank).toHaveLength(0);
  });

  it("re-grades answers on the server and updates scheduling", async () => {
    const word = await seedWord("hablar", "to speak");
    const answeredAt = Date.now() - 1000;

    const result = await service.sync(userId, {
      attempts: [
        attempt(word.id, { answeredAt, submittedAnswer: "Hablo" }),
        attempt(word.id, {
          answeredAt: answeredAt + 10,
          exerciseType: "multiple_choice",
          submittedAnswer: "wrong",
        }),
      ],
    });

    expect(result.accepted.map((entry) => entry.result)).toEqual(["recalled", "wrong"]);
    expect(result.states).toHaveLength(1);
    const state = await reviews.getState(userId, word.id);
    expect(state?.lastResult).toBe("wrong");
    expect(state?.introducedAt).not.toBeNull();
    const history = await reviews.listAttempts(userId, word.id);
    expect(history.map((row) => row.createdAt.getTime())).toEqual([answeredAt, answeredAt + 10]);
  });

  it("is idempotent per attempt id", async () => {
    const word = await seedWord("hablar", "to speak");
    const single = attempt(word.id);

    await service.sync(userId, { attempts: [single] });
    const before = await reviews.getState(userId, word.id);
    const again = await service.sync(userId, { attempts: [single] });

    expect(again.accepted).toEqual([
      { attemptId: single.attemptId, result: "recalled", duplicate: true },
    ]);
    expect(await reviews.listAttempts(userId, word.id)).toHaveLength(1);
    expect((await reviews.getState(userId, word.id))?.successfulRecalls).toBe(
      before?.successfulRecalls,
    );
  });

  it("grades bank questions against their own accepted answers", async () => {
    const word = await seedWord("hablar", "to speak");
    await new ExerciseBankService(db, new MockAIProvider()).refresh(userId);
    const { bank } = await service.snapshot(userId);
    const mc = bank.find((item) => item.exerciseType === "multiple_choice_reverse");
    expect(mc).toBeDefined();

    const result = await service.sync(userId, {
      attempts: [
        attempt(word.id, {
          exerciseType: "multiple_choice_reverse",
          bankItemId: mc?.id,
          submittedAnswer: mc?.payload.correctAnswer,
        }),
      ],
    });
    expect(result.accepted[0]?.result).toBe("recalled");
  });

  it("rejects attempts for deleted, archived, or foreign words", async () => {
    const deleted = await seedWord("hablar", "to speak");
    const archived = await seedWord("vivir", "to live");
    const foreign = await seedWord("comer", "to eat", otherUser);
    await vocab.delete(userId, deleted.id);
    await vocab.archive(userId, archived.id);

    const result = await service.sync(userId, {
      attempts: [attempt(deleted.id), attempt(archived.id), attempt(foreign.id)],
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "word_unavailable",
      "word_unavailable",
      "word_unavailable",
    ]);
    expect(await reviews.getState(otherUser, foreign.id)).toBeNull();
  });

  it("clamps timestamps and never moves the schedule backwards", async () => {
    const word = await seedWord("hablar", "to speak");
    const now = new Date();

    await service.sync(
      userId,
      { attempts: [attempt(word.id, { answeredAt: now.getTime() })] },
      now,
    );
    const after = await reviews.getState(userId, word.id);

    await service.sync(
      userId,
      { attempts: [attempt(word.id, { answeredAt: now.getTime() - 5 * DAY })] },
      now,
    );
    const later = await reviews.getState(userId, word.id);
    expect(later?.lastReviewedAt?.getTime()).toBeGreaterThanOrEqual(
      after?.lastReviewedAt?.getTime() ?? 0,
    );

    const ancient = attempt(word.id, { answeredAt: 0 });
    const future = attempt(word.id, { answeredAt: now.getTime() + 365 * DAY });
    await service.sync(userId, { attempts: [ancient, future] }, now);
    const times = (await reviews.listAttempts(userId, word.id)).map((row) =>
      row.createdAt.getTime(),
    );
    expect(Math.min(...times)).toBe(now.getTime() - MAX_OFFLINE_AGE_MS);
    expect(Math.max(...times)).toBe(now.getTime());
  });

  it("records client sessions with a summary when finished", async () => {
    const word = await seedWord("hablar", "to speak");
    const sessionId = randomUUID();
    const startedAt = Date.now() - 60_000;

    await service.sync(userId, {
      sessions: [{ id: sessionId, startedAt, finishedAt: Date.now() }],
      attempts: [
        attempt(word.id, { sessionId }),
        attempt(word.id, { sessionId, skipped: true, answeredAt: Date.now() + 1 }),
      ],
    });

    const session = await reviews.getSession(userId, sessionId);
    expect(session?.status).toBe("completed");
    expect(JSON.parse(session?.summary ?? "{}")).toMatchObject({
      wordsPracticed: 1,
      totalAttempts: 2,
      recalled: 1,
      skipped: 1,
    });

    // Another user cannot hijack the session id.
    const foreignWord = await seedWord("comer", "to eat", otherUser);
    await service.sync(otherUser, {
      sessions: [{ id: sessionId, startedAt }],
      attempts: [attempt(foreignWord.id, { sessionId, submittedAnswer: "comer" })],
    });
    expect(await reviews.attemptsForSession(userId, sessionId)).toHaveLength(2);
    expect(await reviews.attemptsForSession(otherUser, sessionId)).toHaveLength(0);
  });

  it("rejects an attempt id already used by another user", async () => {
    const mine = await seedWord("hablar", "to speak");
    const theirs = await seedWord("comer", "to eat", otherUser);
    const shared = randomUUID();
    await service.sync(otherUser, {
      attempts: [attempt(theirs.id, { attemptId: shared, submittedAnswer: "comer" })],
    });
    const result = await service.sync(userId, {
      attempts: [attempt(mine.id, { attemptId: shared })],
    });
    expect(result.rejected).toEqual([{ attemptId: shared, reason: "id_conflict" }]);
  });
});
