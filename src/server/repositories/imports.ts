import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/server/db/client";
import {
  importBatches,
  importItems,
  partsOfSpeech,
  reviewStates,
  vocabularyItems,
  wordSourceTypes,
} from "@/server/db/schema";
import type { AIProvider, ExistingVocabularyCandidate } from "@/server/ai/types";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { normalizeTopicName } from "./topics";
import { createVocabularySchema, VocabularyRepository } from "./vocabulary";

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportItem = typeof importItems.$inferSelect;
export type ImportBatchWithItems = ImportBatch & { items: ImportItem[] };

/** Upper bounds to protect the app and the AI provider from oversized input. */
export const MAX_IMPORT_TEXT_LENGTH = 20_000;
const MAX_EXISTING_CANDIDATES = 200;
const MAX_PROPOSALS = 200;

const sourceTypeSchema = z.enum(wordSourceTypes);

export const createImportSchema = z.object({
  rawText: z.string().trim().min(1).max(MAX_IMPORT_TEXT_LENGTH),
  lessonId: z.string().min(1).optional(),
  sourceType: sourceTypeSchema.default("tutor_lesson"),
});

export type CreateImportInput = z.input<typeof createImportSchema>;

const formSchema = z.object({
  form: z.string().min(1),
  formType: z.string().optional(),
  grammarNote: z.string().optional(),
});

export const updateImportItemSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["pending", "create", "merge", "skip"]).optional(),
  proposedLemma: z.string().min(1).nullable().optional(),
  proposedTranslation: z.string().min(1).nullable().optional(),
  proposedPartOfSpeech: z.enum(partsOfSpeech).nullable().optional(),
  proposedTopics: z.array(z.string().min(1)).optional(),
  proposedForms: z.array(formSchema).optional(),
  proposedExample: z.string().nullable().optional(),
  proposedExampleTranslation: z.string().nullable().optional(),
  matchVocabularyItemId: z.string().min(1).nullable().optional(),
});

export type UpdateImportItemInput = z.input<typeof updateImportItemSchema>;

export type ConfirmResult = {
  batch: ImportBatch;
  createdVocabularyItemIds: string[];
  mergedVocabularyItemIds: string[];
};

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Owns the import lifecycle: persist raw text, parse it into reviewable
 * proposals via the injected {@link AIProvider}, let the user edit decisions,
 * and confirm selected proposals into real vocabulary transactionally.
 *
 * The AI provider is injected (never imported here) so the repository stays
 * free of any vendor SDK and is testable with the mock provider.
 */
export class ImportRepository {
  private readonly vocabularyRepo: VocabularyRepository;

  constructor(private readonly db: Database) {
    this.vocabularyRepo = new VocabularyRepository(db);
  }

  /** Persists the raw import before any processing so retries never lose it. */
  async create(userId: string, input: CreateImportInput): Promise<ImportBatch> {
    const data = createImportSchema.parse(input);
    const [batch] = await this.db
      .insert(importBatches)
      .values({
        userId,
        rawText: data.rawText,
        lessonId: data.lessonId,
        status: "pending",
      })
      .returning();
    if (!batch) {
      throw new Error("Failed to create import batch");
    }
    return batch;
  }

  async getById(userId: string, id: string): Promise<ImportBatchWithItems | null> {
    const batch = await this.loadBatch(userId, id);
    if (!batch) {
      return null;
    }
    const items = await this.itemsFor(id);
    return { ...batch, items };
  }

  /**
   * Runs AI parsing for a batch and stores the resulting proposals for
   * review. Safe to call again after a failure: prior items are cleared and
   * the raw text is preserved. A provider failure marks the batch `failed`
   * rather than throwing, so the import can be retried later.
   */
  async process(userId: string, id: string, provider: AIProvider): Promise<ImportBatchWithItems> {
    const batch = await this.requireBatch(userId, id);
    if (batch.status === "confirmed") {
      throw new ConflictError("This import has already been confirmed.");
    }

    await this.db
      .update(importBatches)
      .set({ status: "processing", errorCode: null, updatedAt: new Date() })
      .where(eq(importBatches.id, id));
    await this.db.delete(importItems).where(eq(importItems.importBatchId, id));

    const candidates = await this.existingCandidates(userId);

    let proposals;
    try {
      proposals = await provider.parseVocabulary({
        text: batch.rawText,
        existingVocabulary: candidates,
      });
    } catch {
      const [failed] = await this.db
        .update(importBatches)
        .set({ status: "failed", errorCode: "ai_processing_failed", updatedAt: new Date() })
        .where(eq(importBatches.id, id))
        .returning();
      return { ...(failed ?? batch), status: "failed", items: [] };
    }

    const bounded = proposals.slice(0, MAX_PROPOSALS);
    const matcher = this.buildMatcher(candidates);

    if (bounded.length > 0) {
      await this.db.insert(importItems).values(
        bounded.map((proposal) => {
          const match = matcher(proposal.lemma);
          const decision = match ? "merge" : proposal.needsReview ? "pending" : "create";
          return {
            userId,
            importBatchId: id,
            proposedLemma: proposal.lemma,
            proposedTranslation: proposal.translation,
            proposedPartOfSpeech: proposal.partOfSpeech,
            proposedTopics: JSON.stringify(proposal.topics ?? []),
            proposedForms: JSON.stringify(proposal.forms ?? []),
            proposedExample: proposal.exampleSentence ?? null,
            proposedExampleTranslation: proposal.exampleTranslation ?? null,
            confidence: proposal.confidence ?? null,
            matchVocabularyItemId: match ?? null,
            decision,
          };
        }),
      );
    }

    const [updated] = await this.db
      .update(importBatches)
      .set({
        status: "needs_review",
        parsedPayload: JSON.stringify(bounded),
        updatedAt: new Date(),
      })
      .where(eq(importBatches.id, id))
      .returning();
    const items = await this.itemsFor(id);
    return { ...(updated ?? batch), status: "needs_review", items };
  }

  /** Edits proposals/decisions before confirmation. Validates every field. */
  async updateItems(
    userId: string,
    id: string,
    updates: UpdateImportItemInput[],
  ): Promise<ImportBatchWithItems> {
    const batch = await this.requireBatch(userId, id);
    if (batch.status === "confirmed") {
      throw new ConflictError("A confirmed import can no longer be edited.");
    }

    const parsed = updates.map((u) => updateImportItemSchema.parse(u));
    const existing = await this.itemsFor(id);
    const byId = new Map(existing.map((item) => [item.id, item]));

    for (const update of parsed) {
      if (!byId.has(update.id)) {
        throw new NotFoundError("Import item", update.id);
      }
      const patch: Partial<ImportItem> = {};
      if (update.decision !== undefined) patch.decision = update.decision;
      if (update.proposedLemma !== undefined) patch.proposedLemma = update.proposedLemma;
      if (update.proposedTranslation !== undefined)
        patch.proposedTranslation = update.proposedTranslation;
      if (update.proposedPartOfSpeech !== undefined)
        patch.proposedPartOfSpeech = update.proposedPartOfSpeech;
      if (update.proposedTopics !== undefined)
        patch.proposedTopics = JSON.stringify(update.proposedTopics);
      if (update.proposedForms !== undefined)
        patch.proposedForms = JSON.stringify(update.proposedForms);
      if (update.proposedExample !== undefined) patch.proposedExample = update.proposedExample;
      if (update.proposedExampleTranslation !== undefined)
        patch.proposedExampleTranslation = update.proposedExampleTranslation;
      if (update.matchVocabularyItemId !== undefined)
        patch.matchVocabularyItemId = update.matchVocabularyItemId;

      if (Object.keys(patch).length > 0) {
        await this.db
          .update(importItems)
          .set(patch)
          .where(and(eq(importItems.id, update.id), eq(importItems.importBatchId, id)));
      }
    }

    const items = await this.itemsFor(id);
    return { ...batch, items };
  }

  /**
   * Confirms the batch: creates words for `create` items, enriches existing
   * words for `merge` items, and ignores `skip`/`pending`. The whole batch
   * runs in one transaction, so a failure leaves existing vocabulary
   * untouched. Re-confirming a confirmed batch is a no-op that returns the
   * already-created ids, so retries never create duplicates.
   */
  async confirm(userId: string, id: string): Promise<ConfirmResult> {
    const batch = await this.requireBatch(userId, id);

    if (batch.status === "confirmed") {
      const items = await this.itemsFor(id);
      return this.resultFrom(batch, items);
    }
    if (batch.status !== "needs_review") {
      throw new ConflictError("This import is not ready to be confirmed.");
    }

    const sourceType = this.resolveSourceType();

    const confirmed = await this.db.transaction(async (tx) => {
      const items = await tx
        .select()
        .from(importItems)
        .where(eq(importItems.importBatchId, id))
        .orderBy(asc(importItems.createdAt), asc(sql`rowid`));

      for (const item of items) {
        if (item.createdVocabularyItemId) {
          continue; // Already applied in a prior (partial) attempt.
        }
        if (item.decision === "create") {
          await this.applyCreate(tx, userId, id, item, sourceType);
        } else if (item.decision === "merge") {
          await this.applyMerge(tx, userId, id, item, sourceType);
        }
      }

      const [row] = await tx
        .update(importBatches)
        .set({ status: "confirmed", updatedAt: new Date() })
        .where(eq(importBatches.id, id))
        .returning();
      return row ?? { ...batch, status: "confirmed" as const };
    });

    const items = await this.itemsFor(id);
    return this.resultFrom(confirmed, items);
  }

  private async applyCreate(
    tx: DbExecutor,
    userId: string,
    batchId: string,
    item: ImportItem,
    sourceType: (typeof wordSourceTypes)[number],
  ): Promise<void> {
    const lemma = item.proposedLemma?.trim() ?? "";
    const translation = item.proposedTranslation?.trim() ?? "";
    if (lemma.length === 0 || translation.length === 0 || !item.proposedPartOfSpeech) {
      throw new ValidationError(
        `Import item ${item.id} is missing a lemma, translation, or part of speech.`,
      );
    }

    const data = createVocabularySchema.parse({
      lemma,
      translation,
      partOfSpeech: item.proposedPartOfSpeech,
      exampleSentence: item.proposedExample ?? undefined,
      exampleTranslation: item.proposedExampleTranslation ?? undefined,
      aiConfidence: item.confidence ?? undefined,
      topics: parseJsonArray<string>(item.proposedTopics),
      forms: parseJsonArray<{ form: string }>(item.proposedForms),
      source: { sourceType, sourceText: item.proposedLemma ?? undefined },
    });

    const created = await this.vocabularyRepo.createWithin(tx, userId, data);
    await tx
      .insert(reviewStates)
      .values({ userId, vocabularyItemId: created.id })
      .onConflictDoNothing({ target: reviewStates.vocabularyItemId });
    await tx
      .update(importItems)
      .set({ createdVocabularyItemId: created.id })
      .where(and(eq(importItems.id, item.id), eq(importItems.importBatchId, batchId)));
  }

  private async applyMerge(
    tx: DbExecutor,
    userId: string,
    batchId: string,
    item: ImportItem,
    sourceType: (typeof wordSourceTypes)[number],
  ): Promise<void> {
    if (!item.matchVocabularyItemId) {
      throw new ValidationError(`Import item ${item.id} is marked to merge but has no match.`);
    }
    await this.vocabularyRepo.attachWithin(tx, userId, item.matchVocabularyItemId, {
      forms: parseJsonArray<{ form: string }>(item.proposedForms),
      topics: parseJsonArray<string>(item.proposedTopics),
      source: { sourceType, sourceText: item.proposedLemma ?? undefined },
    });
    await tx
      .update(importItems)
      .set({ createdVocabularyItemId: item.matchVocabularyItemId })
      .where(and(eq(importItems.id, item.id), eq(importItems.importBatchId, batchId)));
  }

  private resolveSourceType(): (typeof wordSourceTypes)[number] {
    return "tutor_lesson";
  }

  private resultFrom(batch: ImportBatch, items: ImportItem[]): ConfirmResult {
    const created: string[] = [];
    const merged: string[] = [];
    for (const item of items) {
      if (!item.createdVocabularyItemId) {
        continue;
      }
      if (item.decision === "create") {
        created.push(item.createdVocabularyItemId);
      } else if (item.decision === "merge") {
        merged.push(item.createdVocabularyItemId);
      }
    }
    return { batch, createdVocabularyItemIds: created, mergedVocabularyItemIds: merged };
  }

  private async existingCandidates(userId: string): Promise<ExistingVocabularyCandidate[]> {
    const rows = await this.db
      .select({
        id: vocabularyItems.id,
        lemma: vocabularyItems.lemma,
        translation: vocabularyItems.translation,
        partOfSpeech: vocabularyItems.partOfSpeech,
      })
      .from(vocabularyItems)
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.status, "active")))
      .limit(MAX_EXISTING_CANDIDATES);
    return rows;
  }

  /** Returns a lookup that matches a proposal to an existing word id. */
  /**
   * Returns a lookup that flags a proposal as a likely duplicate of an
   * existing word. Matching is by normalized lemma only: a shared lemma is a
   * strong duplicate signal, and because the AI often disagrees on part of
   * speech, including it would miss real duplicates. The user still reviews
   * and can override the suggested merge.
   */
  private buildMatcher(
    candidates: ExistingVocabularyCandidate[],
  ): (lemma: string) => string | null {
    const index = new Map<string, string>();
    for (const candidate of candidates) {
      index.set(this.matchKey(candidate.lemma), candidate.id);
    }
    return (lemma) => index.get(this.matchKey(lemma)) ?? null;
  }

  private matchKey(lemma: string): string {
    return normalizeTopicName(lemma);
  }

  private async loadBatch(userId: string, id: string): Promise<ImportBatch | null> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async requireBatch(userId: string, id: string): Promise<ImportBatch> {
    const batch = await this.loadBatch(userId, id);
    if (!batch) {
      throw new NotFoundError("Import batch", id);
    }
    return batch;
  }

  private async itemsFor(batchId: string): Promise<ImportItem[]> {
    return this.db
      .select()
      .from(importItems)
      .where(eq(importItems.importBatchId, batchId))
      .orderBy(asc(importItems.createdAt), asc(sql`rowid`));
  }
}
