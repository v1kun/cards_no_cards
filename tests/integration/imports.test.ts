import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAIProvider } from "@/server/ai/adapters/mock-provider";
import type { AIProvider, ParsedVocabularyProposal } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { importItems, vocabularyItems } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { ImportRepository } from "@/server/repositories/imports";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import { createTestDatabase, makeUserId } from "./helpers";

/** AI provider stub that returns a fixed set of proposals (or throws). */
function stubProvider(
  proposals: ParsedVocabularyProposal[] | (() => Promise<ParsedVocabularyProposal[]>),
): AIProvider {
  const base = new MockAIProvider();
  return {
    name: "stub",
    parseVocabulary: typeof proposals === "function" ? proposals : async () => proposals,
    generateExample: base.generateExample.bind(base),
    evaluateAnswer: base.evaluateAnswer.bind(base),
    generateExercises: base.generateExercises.bind(base),
  };
}

const proposal = (overrides: Partial<ParsedVocabularyProposal>): ParsedVocabularyProposal => ({
  lemma: "hablar",
  translation: "to speak",
  partOfSpeech: "verb",
  topics: [],
  forms: [],
  needsReview: false,
  ...overrides,
});

describe("ImportRepository", () => {
  let db: Database;
  let close: () => void;
  let imports: ImportRepository;
  let vocab: VocabularyRepository;
  const userId = makeUserId("import");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    imports = new ImportRepository(db);
    vocab = new VocabularyRepository(db);
  });

  afterEach(() => close());

  it("persists the raw text before processing so it can be retried", async () => {
    const batch = await imports.create(userId, {
      rawText: "hablar - to speak",
      sourceType: "manual",
    });
    expect(batch.status).toBe("pending");
    expect(batch.rawText).toBe("hablar - to speak");
  });

  it("turns free text into reviewable proposals", async () => {
    const batch = await imports.create(userId, { rawText: "x" });
    const processed = await imports.process(
      userId,
      batch.id,
      stubProvider([
        proposal({ lemma: "hablar", topics: ["Verbs"], forms: [{ form: "hablo" }] }),
        proposal({
          lemma: "rojo",
          translation: "red",
          partOfSpeech: "adjective",
          needsReview: true,
        }),
      ]),
    );
    expect(processed.status).toBe("needs_review");
    expect(processed.items).toHaveLength(2);
    expect(processed.items[0]?.decision).toBe("create");
    expect(processed.items[1]?.decision).toBe("pending");
  });

  it("flags likely duplicates against existing vocabulary as merges", async () => {
    await vocab.create(userId, { lemma: "hablar", translation: "to speak", partOfSpeech: "verb" });
    const batch = await imports.create(userId, { rawText: "x" });
    const processed = await imports.process(
      userId,
      batch.id,
      stubProvider([proposal({ lemma: "Hablar", forms: [{ form: "hablamos" }] })]),
    );
    expect(processed.items[0]?.decision).toBe("merge");
    expect(processed.items[0]?.matchVocabularyItemId).toBeTruthy();
  });

  it("marks the batch failed on AI error without losing the raw text", async () => {
    const batch = await imports.create(userId, { rawText: "keep me" });
    const processed = await imports.process(
      userId,
      batch.id,
      stubProvider(async () => {
        throw new Error("ai down");
      }),
    );
    expect(processed.status).toBe("failed");
    const reloaded = await imports.getById(userId, batch.id);
    expect(reloaded?.rawText).toBe("keep me");
    expect(reloaded?.status).toBe("failed");
  });

  it("can be reprocessed after a failure and replaces old items", async () => {
    const batch = await imports.create(userId, { rawText: "x" });
    await imports.process(
      userId,
      batch.id,
      stubProvider(async () => {
        throw new Error("ai down");
      }),
    );
    const processed = await imports.process(
      userId,
      batch.id,
      stubProvider([proposal({ lemma: "correr", translation: "to run" })]),
    );
    expect(processed.status).toBe("needs_review");
    expect(processed.items).toHaveLength(1);
    expect(processed.items[0]?.proposedLemma).toBe("correr");
  });

  it("confirms create and merge decisions transactionally", async () => {
    const existing = await vocab.create(userId, {
      lemma: "hablar",
      translation: "to speak",
      partOfSpeech: "verb",
    });
    const batch = await imports.create(userId, { rawText: "x" });
    await imports.process(
      userId,
      batch.id,
      stubProvider([
        proposal({ lemma: "correr", translation: "to run", topics: ["Verbs"] }),
        proposal({ lemma: "hablar", forms: [{ form: "hablamos" }] }),
      ]),
    );

    const result = await imports.confirm(userId, batch.id);
    expect(result.batch.status).toBe("confirmed");
    expect(result.createdVocabularyItemIds).toHaveLength(1);
    expect(result.mergedVocabularyItemIds).toEqual([existing.id]);

    const all = await vocab.list(userId);
    expect(all.map((w) => w.lemma).sort()).toEqual(["correr", "hablar"]);
    const detail = await vocab.getDetail(userId, existing.id);
    expect(detail?.forms.map((f) => f.form)).toContain("hablamos");
  });

  it("is idempotent: re-confirming does not create duplicates", async () => {
    const batch = await imports.create(userId, { rawText: "x" });
    await imports.process(
      userId,
      batch.id,
      stubProvider([proposal({ lemma: "correr", translation: "to run" })]),
    );
    const first = await imports.confirm(userId, batch.id);
    const second = await imports.confirm(userId, batch.id);
    expect(second.createdVocabularyItemIds).toEqual(first.createdVocabularyItemIds);
    const all = await vocab.list(userId);
    expect(all).toHaveLength(1);
  });

  it("leaves vocabulary unchanged when confirmation fails", async () => {
    const batch = await imports.create(userId, { rawText: "x" });
    await imports.process(
      userId,
      batch.id,
      stubProvider([
        proposal({ lemma: "correr", translation: "to run" }),
        proposal({ lemma: "roto", translation: "broken" }),
      ]),
    );
    // Corrupt the second item so confirmation must roll back everything.
    const items = await db
      .select()
      .from(importItems)
      .where(eq(importItems.importBatchId, batch.id));
    const second = items.find((i) => i.proposedLemma === "roto");
    await db
      .update(importItems)
      .set({ proposedTranslation: null })
      .where(eq(importItems.id, second!.id));

    await expect(imports.confirm(userId, batch.id)).rejects.toThrow();
    const created = await db
      .select()
      .from(vocabularyItems)
      .where(eq(vocabularyItems.userId, userId));
    expect(created).toHaveLength(0);
  });

  it("applies user edits to decisions before confirming", async () => {
    const batch = await imports.create(userId, { rawText: "x" });
    const processed = await imports.process(
      userId,
      batch.id,
      stubProvider([proposal({ lemma: "mentira", translation: "lie", needsReview: true })]),
    );
    const itemId = processed.items[0]!.id;
    await imports.updateItems(userId, batch.id, [
      { id: itemId, decision: "create", proposedTopics: ["Nouns"] },
    ]);
    const result = await imports.confirm(userId, batch.id);
    expect(result.createdVocabularyItemIds).toHaveLength(1);
  });
});
