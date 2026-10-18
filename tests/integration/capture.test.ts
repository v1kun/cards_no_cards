import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import type { Database } from "@/server/db/client";
import { ImportRepository } from "@/server/repositories/imports";
import { ReviewRepository } from "@/server/repositories/review";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import { CaptureService } from "@/server/services/capture";
import { createTestDatabase, makeUserId } from "./helpers";

describe("CaptureService", () => {
  let db: Database;
  let close: () => void;
  let vocab: VocabularyRepository;
  let reviews: ReviewRepository;
  const provider = new MockAIProvider();
  const userId = makeUserId("capture");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    vocab = new VocabularyRepository(db);
    reviews = new ReviewRepository(db);
  });

  afterEach(() => close());

  it("captures dictated text as a voice-sourced import needing review", async () => {
    const service = new CaptureService(db, provider);

    const result = await service.capture(userId, {
      text: "despedirse - to say goodbye\nla reunión - the meeting",
    });

    expect(result.count).toBe(2);
    expect(result.status).toBe("needs_review");
    expect(result.words.map((w) => w.lemma)).toEqual(["despedirse", "la reunión"]);
    expect(result.message).toContain("Captured 2 words");

    // The batch exists and is tagged as a voice source, not auto-confirmed.
    const imports = new ImportRepository(db);
    const batch = await imports.getById(userId, result.batchId);
    expect(batch?.status).toBe("needs_review");
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items.every((item) => item.createdVocabularyItemId === null)).toBe(true);
  });

  it("rejects empty dictation", async () => {
    const service = new CaptureService(db, provider);
    await expect(service.capture(userId, { text: "   " })).rejects.toThrow();
  });

  it("summarizes due and new words for a voice query", async () => {
    const service = new CaptureService(db, provider);
    const now = new Date("2026-01-10T00:00:00.000Z");

    // One never-introduced (new) word.
    await vocab.create(userId, { lemma: "nuevo", translation: "new", partOfSpeech: "adjective" });

    // One introduced word that is due.
    const due = await vocab.create(userId, {
      lemma: "vencido",
      translation: "due",
      partOfSpeech: "adjective",
    });
    await reviews.upsertState(userId, due.id, {
      introducedAt: new Date("2026-01-01T00:00:00.000Z"),
      dueAt: new Date("2026-01-05T00:00:00.000Z"),
      reviewStage: 1,
    });

    // One introduced word not yet due.
    const future = await vocab.create(userId, {
      lemma: "futuro",
      translation: "future",
      partOfSpeech: "noun",
    });
    await reviews.upsertState(userId, future.id, {
      introducedAt: new Date("2026-01-01T00:00:00.000Z"),
      dueAt: new Date("2026-02-01T00:00:00.000Z"),
      reviewStage: 2,
    });

    const summary = await service.reviewSummary(userId, now);
    expect(summary.due).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.message).toContain("1 due for review");
    expect(summary.message).toContain("1 new");
  });

  it("reports an all-caught-up summary when nothing is pending", async () => {
    const service = new CaptureService(db, provider);
    const summary = await service.reviewSummary(userId, new Date());
    expect(summary.due).toBe(0);
    expect(summary.new).toBe(0);
    expect(summary.message).toContain("caught up");
  });
});
