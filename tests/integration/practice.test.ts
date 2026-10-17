import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import type { AIProvider, AnswerEvaluation } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { reviewAttempts } from "@/server/db/schema";
import { ReviewRepository } from "@/server/repositories/review";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import { PracticeService } from "@/server/services/practice";
import { createTestDatabase, makeUserId } from "./helpers";

function providerWith(evaluate: () => Promise<AnswerEvaluation>): AIProvider {
  const base = new MockAIProvider();
  return {
    name: "stub",
    parseVocabulary: base.parseVocabulary.bind(base),
    generateExample: base.generateExample.bind(base),
    evaluateAnswer: evaluate,
  };
}

describe("PracticeService", () => {
  let db: Database;
  let close: () => void;
  let vocab: VocabularyRepository;
  let reviews: ReviewRepository;
  const userId = makeUserId("practice");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    vocab = new VocabularyRepository(db);
    reviews = new ReviewRepository(db);
  });

  afterEach(() => close());

  async function seedWord(lemma: string, translation: string) {
    return vocab.create(userId, { lemma, translation, partOfSpeech: "verb" });
  }

  it("prioritizes due reviews and caps new words at the target", async () => {
    // One due word (introduced, overdue) and many new words.
    const due = await seedWord("hablar", "to speak");
    await reviews.upsertState(userId, due.id, {
      introducedAt: new Date("2026-01-01T00:00:00Z"),
      dueAt: new Date("2026-01-02T00:00:00Z"),
      reviewStage: 1,
      successfulRecalls: 1,
    });
    for (let i = 0; i < 8; i += 1) {
      await seedWord(`palabra${i}`, `word ${i}`);
    }

    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId, new Date("2026-02-01T00:00:00Z"));

    expect(plan.session).not.toBeNull();
    // Due word first, then at most NEW_WORD_TARGET (5) new words.
    expect(plan.exercises[0]!.vocabularyItemId).toBe(due.id);
    expect(plan.exercises[0]!.isNew).toBe(false);
    const newCount = plan.exercises.filter((exercise) => exercise.isNew).length;
    expect(newCount).toBe(5);
  });

  it("returns an empty plan when there is nothing to practice", async () => {
    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId);
    expect(plan.session).toBeNull();
    expect(plan.exercises).toHaveLength(0);
  });

  it("persists attempts and lets them affect subsequent scheduling", async () => {
    const word = await seedWord("comer", "to eat");
    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId);
    const sessionId = plan.session!.id;

    const outcome = await service.submitAttempt(userId, {
      sessionId,
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      submittedAnswer: "to eat",
    });

    expect(outcome.status).toBe("graded");
    if (outcome.status !== "graded") return;
    expect(outcome.result).toBe("recalled");
    expect(outcome.correct).toBe(true);

    const state = await reviews.getState(userId, word.id);
    expect(state?.successfulRecalls).toBe(1);
    expect(state?.reviewStage).toBe(1);
    expect(state?.introducedAt).not.toBeNull();
    expect(state?.dueAt).not.toBeNull();

    const attempts = await reviews.attemptsForSession(userId, sessionId);
    expect(attempts).toHaveLength(1);
  });

  it("records a hint-assisted answer separately from independent recall", async () => {
    const word = await seedWord("beber", "to drink");
    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId);

    const outcome = await service.submitAttempt(userId, {
      sessionId: plan.session!.id,
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      submittedAnswer: "to drink",
      usedHint: true,
    });

    expect(outcome.status).toBe("graded");
    if (outcome.status !== "graded") return;
    expect(outcome.result).toBe("recalled_with_hint");
  });

  it("is idempotent for a repeated attempt id", async () => {
    const word = await seedWord("vivir", "to live");
    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId);
    const sessionId = plan.session!.id;
    const attemptId = "attempt-1";

    await service.submitAttempt(userId, {
      sessionId,
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      submittedAnswer: "to live",
      attemptId,
    });
    const second = await service.submitAttempt(userId, {
      sessionId,
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      submittedAnswer: "to live",
      attemptId,
    });

    expect(second.status).toBe("graded");
    if (second.status === "graded") {
      expect(second.duplicate).toBe(true);
    }

    const rows = await db
      .select()
      .from(reviewAttempts)
      .where(eq(reviewAttempts.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    const state = await reviews.getState(userId, word.id);
    // Scheduling advanced only once despite two submissions.
    expect(state?.successfulRecalls).toBe(1);
  });

  it("does not punish the learner on an uncertain AI evaluation", async () => {
    const word = await seedWord("ser", "to be");
    // Give it prior progress so the exercise is open-ended recall.
    await reviews.upsertState(userId, word.id, {
      introducedAt: new Date("2026-01-01T00:00:00Z"),
      dueAt: new Date("2026-01-02T00:00:00Z"),
      reviewStage: 1,
      successfulRecalls: 1,
    });
    const before = await reviews.getState(userId, word.id);

    const service = new PracticeService(
      db,
      providerWith(async () => ({ result: "uncertain", feedback: "Not sure about that." })),
    );
    const plan = await service.startSession(userId, new Date("2026-02-01T00:00:00Z"));

    const outcome = await service.submitAttempt(userId, {
      sessionId: plan.session!.id,
      vocabularyItemId: word.id,
      exerciseType: "recall",
      submittedAnswer: "existir",
    });

    expect(outcome.status).toBe("uncertain");
    const after = await reviews.getState(userId, word.id);
    expect(after?.successfulRecalls).toBe(before?.successfulRecalls);
    expect(after?.consecutiveFailures).toBe(before?.consecutiveFailures);
    const attempts = await reviews.attemptsForSession(userId, plan.session!.id);
    expect(attempts).toHaveLength(0);
  });

  it("records a skip distinctly and summarizes the session", async () => {
    const word = await seedWord("tener", "to have");
    const service = new PracticeService(db, new MockAIProvider());
    const plan = await service.startSession(userId);
    const sessionId = plan.session!.id;

    const outcome = await service.submitAttempt(userId, {
      sessionId,
      vocabularyItemId: word.id,
      exerciseType: "multiple_choice",
      skipped: true,
    });
    expect(outcome.status).toBe("graded");
    if (outcome.status === "graded") {
      expect(outcome.result).toBe("skipped");
      expect(outcome.correct).toBe(false);
    }

    const summary = await service.completeSession(userId, sessionId);
    expect(summary.skipped).toBe(1);
    expect(summary.wordsPracticed).toBe(1);
    expect(summary.totalAttempts).toBe(1);

    const session = await reviews.getSession(userId, sessionId);
    expect(session?.status).toBe("completed");
  });
});
