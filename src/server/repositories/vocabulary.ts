import { and, desc, eq, inArray, isNull, like, lte, or } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/server/db/client";
import {
  partsOfSpeech,
  genders,
  reviewStates,
  topics as topicsTable,
  vocabularyForms,
  vocabularyItems,
  vocabularyStatuses,
  vocabularyTopics,
  wordSources,
  wordSourceTypes,
} from "@/server/db/schema";
import { NotFoundError } from "./errors";
import { normalizeTopicName, TopicsRepository, type Topic } from "./topics";

export type VocabularyItem = typeof vocabularyItems.$inferSelect;
export type VocabularyForm = typeof vocabularyForms.$inferSelect;
export type WordSource = typeof wordSources.$inferSelect;

export type ReviewSummary = {
  dueAt: Date | null;
  introducedAt: Date | null;
  reviewStage: number;
  successfulRecalls: number;
  consecutiveFailures: number;
  lastResult: string | null;
  lastReviewedAt: Date | null;
} | null;

const formInputSchema = z.object({
  form: z.string().min(1),
  formType: z.string().optional(),
  grammarNote: z.string().optional(),
});

export const createVocabularySchema = z.object({
  lemma: z.string().min(1),
  translation: z.string().min(1),
  partOfSpeech: z.enum(partsOfSpeech),
  definition: z.string().optional(),
  gender: z.enum(genders).optional(),
  exampleSentence: z.string().optional(),
  exampleTranslation: z.string().optional(),
  languageCode: z.string().min(2).default("es"),
  aiConfidence: z.number().min(0).max(1).optional(),
  topics: z.array(z.string().min(1)).default([]),
  forms: z.array(formInputSchema).default([]),
  source: z
    .object({
      sourceType: z.enum(wordSourceTypes),
      sourceText: z.string().optional(),
      lessonId: z.string().optional(),
    })
    .optional(),
});

export type CreateVocabularyInput = z.input<typeof createVocabularySchema>;

export const updateVocabularySchema = z.object({
  lemma: z.string().min(1).optional(),
  translation: z.string().min(1).optional(),
  partOfSpeech: z.enum(partsOfSpeech).optional(),
  definition: z.string().nullable().optional(),
  gender: z.enum(genders).nullable().optional(),
  exampleSentence: z.string().nullable().optional(),
  exampleTranslation: z.string().nullable().optional(),
});

export type UpdateVocabularyInput = z.infer<typeof updateVocabularySchema>;

export type VocabularyFilters = {
  partOfSpeech?: (typeof partsOfSpeech)[number];
  status?: (typeof vocabularyStatuses)[number];
  topicId?: string;
  search?: string;
  dueOnly?: boolean;
};

export type Pagination = {
  limit: number;
  offset: number;
};

export type VocabularyWithRelations = VocabularyItem & {
  forms: VocabularyForm[];
  topics: Topic[];
};

export type VocabularyListItem = VocabularyItem & {
  topics: Topic[];
  reviewSummary: ReviewSummary;
};

export type VocabularyDetail = VocabularyWithRelations & {
  sources: WordSource[];
  reviewSummary: ReviewSummary;
};

export type VocabularyPage = {
  items: VocabularyListItem[];
  total: number;
  limit: number;
  offset: number;
};

export class VocabularyRepository {
  private readonly topicsRepo: TopicsRepository;

  constructor(private readonly db: Database) {
    this.topicsRepo = new TopicsRepository(db);
  }

  /**
   * Creates a vocabulary item together with its forms, topic links, and an
   * optional source, atomically. Topic names are normalized and deduplicated
   * so an inflected form never becomes an accidental separate word.
   */
  async create(userId: string, input: CreateVocabularyInput): Promise<VocabularyWithRelations> {
    const data = createVocabularySchema.parse(input);
    return this.db.transaction((tx) => this.createWithin(tx, userId, data));
  }

  /**
   * Inserts a vocabulary item and its relations using the provided executor,
   * so callers (such as import confirmation) can compose it into a larger
   * transaction. Input is assumed already validated by the schema.
   */
  async createWithin(
    executor: DbExecutor,
    userId: string,
    data: z.infer<typeof createVocabularySchema>,
  ): Promise<VocabularyWithRelations> {
    const [item] = await executor
      .insert(vocabularyItems)
      .values({
        userId,
        lemma: data.lemma,
        translation: data.translation,
        partOfSpeech: data.partOfSpeech,
        definition: data.definition,
        gender: data.gender,
        exampleSentence: data.exampleSentence,
        exampleTranslation: data.exampleTranslation,
        languageCode: data.languageCode,
        aiConfidence: data.aiConfidence,
      })
      .returning();
    if (!item) {
      throw new Error("Failed to insert vocabulary item");
    }

    if (data.forms.length > 0) {
      await executor.insert(vocabularyForms).values(
        data.forms.map((form) => ({
          userId,
          vocabularyItemId: item.id,
          form: form.form,
          formType: form.formType,
          grammarNote: form.grammarNote,
        })),
      );
    }

    const linkedTopics: Topic[] = [];
    const seen = new Set<string>();
    for (const name of data.topics) {
      const normalized = normalizeTopicName(name);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      const topic = await this.topicsRepo.findOrCreate(userId, name, executor);
      await executor
        .insert(vocabularyTopics)
        .values({ userId, vocabularyItemId: item.id, topicId: topic.id })
        .onConflictDoNothing();
      linkedTopics.push(topic);
    }

    if (data.source) {
      await executor.insert(wordSources).values({
        userId,
        vocabularyItemId: item.id,
        lessonId: data.source.lessonId,
        sourceType: data.source.sourceType,
        sourceText: data.source.sourceText,
      });
    }

    const forms = await executor
      .select()
      .from(vocabularyForms)
      .where(eq(vocabularyForms.vocabularyItemId, item.id));

    return { ...item, forms, topics: linkedTopics };
  }

  async list(userId: string, filters: VocabularyFilters = {}): Promise<VocabularyItem[]> {
    const rows = await this.buildFilteredQuery(userId, filters).orderBy(
      desc(vocabularyItems.createdAt),
      desc(vocabularyItems.id),
    );
    return rows.map((row) => row.item);
  }

  /**
   * Adds forms, topic links, and an optional source to an existing word
   * using the provided executor. Used by import "merge" decisions so that
   * duplicates enrich the existing lemma instead of creating a new word.
   * Verifies ownership and returns the ids of forms that were newly added.
   */
  async attachWithin(
    executor: DbExecutor,
    userId: string,
    vocabularyItemId: string,
    data: {
      forms?: { form: string; formType?: string; grammarNote?: string }[];
      topics?: string[];
      source?: {
        sourceType: (typeof wordSourceTypes)[number];
        sourceText?: string;
        lessonId?: string;
      };
    },
  ): Promise<void> {
    const owned = await executor
      .select({ id: vocabularyItems.id })
      .from(vocabularyItems)
      .where(and(eq(vocabularyItems.id, vocabularyItemId), eq(vocabularyItems.userId, userId)))
      .limit(1);
    if (!owned[0]) {
      throw new NotFoundError("Vocabulary item", vocabularyItemId);
    }

    const existingForms = await executor
      .select({ form: vocabularyForms.form })
      .from(vocabularyForms)
      .where(eq(vocabularyForms.vocabularyItemId, vocabularyItemId));
    const seenForms = new Set(existingForms.map((f) => f.form.trim().toLowerCase()));
    const newForms = (data.forms ?? []).filter((f) => {
      const key = f.form.trim().toLowerCase();
      if (key.length === 0 || seenForms.has(key)) {
        return false;
      }
      seenForms.add(key);
      return true;
    });
    if (newForms.length > 0) {
      await executor.insert(vocabularyForms).values(
        newForms.map((form) => ({
          userId,
          vocabularyItemId,
          form: form.form,
          formType: form.formType,
          grammarNote: form.grammarNote,
        })),
      );
    }

    const seenTopics = new Set<string>();
    for (const name of data.topics ?? []) {
      const normalized = normalizeTopicName(name);
      if (normalized.length === 0 || seenTopics.has(normalized)) {
        continue;
      }
      seenTopics.add(normalized);
      const topic = await this.topicsRepo.findOrCreate(userId, name, executor);
      await executor
        .insert(vocabularyTopics)
        .values({ userId, vocabularyItemId, topicId: topic.id })
        .onConflictDoNothing();
    }

    if (data.source) {
      await executor.insert(wordSources).values({
        userId,
        vocabularyItemId,
        lessonId: data.source.lessonId,
        sourceType: data.source.sourceType,
        sourceText: data.source.sourceText,
      });
    }
  }

  /**
   * Builds a scoped, filtered query selecting whole vocabulary items.
   *
   * The selection is fixed to `{ item }` regardless of joins, so `topicId`
   * and `dueOnly` can add joins without changing the result shape. A single
   * topic join and the unique review-state join both yield at most one row
   * per item, so counts and pages are not inflated.
   */
  private buildFilteredQuery(userId: string, filters: VocabularyFilters) {
    const conditions = [eq(vocabularyItems.userId, userId)];
    if (filters.status) {
      conditions.push(eq(vocabularyItems.status, filters.status));
    }
    if (filters.partOfSpeech) {
      conditions.push(eq(vocabularyItems.partOfSpeech, filters.partOfSpeech));
    }
    if (filters.search) {
      conditions.push(like(vocabularyItems.lemma, `%${filters.search}%`));
    }

    let query = this.db.select({ item: vocabularyItems }).from(vocabularyItems).$dynamic();

    if (filters.topicId) {
      query = query.innerJoin(
        vocabularyTopics,
        and(
          eq(vocabularyTopics.vocabularyItemId, vocabularyItems.id),
          eq(vocabularyTopics.topicId, filters.topicId),
        ),
      );
    }

    if (filters.dueOnly) {
      query = query.leftJoin(reviewStates, eq(reviewStates.vocabularyItemId, vocabularyItems.id));
      // No review state (left-join null) or a due state both count as due.
      conditions.push(or(isNull(reviewStates.dueAt), lte(reviewStates.dueAt, new Date()))!);
    }

    return query.where(and(...conditions));
  }

  /** Paginated listing with filters, enriched with topics and review summary. */
  async listPage(
    userId: string,
    filters: VocabularyFilters,
    pagination: Pagination,
  ): Promise<VocabularyPage> {
    const totalRows = await this.buildFilteredQuery(userId, filters);
    const total = totalRows.length;

    const rows = await this.buildFilteredQuery(userId, filters)
      .orderBy(desc(vocabularyItems.createdAt), desc(vocabularyItems.id))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const items = rows.map((row) => row.item);

    const [topicsByItem, summaryByItem] = await Promise.all([
      this.topicsForItems(items.map((item) => item.id)),
      this.reviewSummariesForItems(
        userId,
        items.map((item) => item.id),
      ),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        topics: topicsByItem.get(item.id) ?? [],
        reviewSummary: summaryByItem.get(item.id) ?? null,
      })),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  private async topicsForItems(ids: string[]): Promise<Map<string, Topic[]>> {
    const byItem = new Map<string, Topic[]>();
    if (ids.length === 0) {
      return byItem;
    }
    const rows = await this.db
      .select({ vocabularyItemId: vocabularyTopics.vocabularyItemId, topic: topicsTable })
      .from(vocabularyTopics)
      .innerJoin(topicsTable, eq(topicsTable.id, vocabularyTopics.topicId))
      .where(inArray(vocabularyTopics.vocabularyItemId, ids));
    for (const row of rows) {
      const list = byItem.get(row.vocabularyItemId) ?? [];
      list.push(row.topic);
      byItem.set(row.vocabularyItemId, list);
    }
    return byItem;
  }

  private async reviewSummariesForItems(
    userId: string,
    ids: string[],
  ): Promise<Map<string, ReviewSummary>> {
    const byItem = new Map<string, ReviewSummary>();
    if (ids.length === 0) {
      return byItem;
    }
    const rows = await this.db
      .select()
      .from(reviewStates)
      .where(and(eq(reviewStates.userId, userId), inArray(reviewStates.vocabularyItemId, ids)));
    for (const row of rows) {
      byItem.set(row.vocabularyItemId, {
        dueAt: row.dueAt,
        introducedAt: row.introducedAt,
        reviewStage: row.reviewStage,
        successfulRecalls: row.successfulRecalls,
        consecutiveFailures: row.consecutiveFailures,
        lastResult: row.lastResult,
        lastReviewedAt: row.lastReviewedAt,
      });
    }
    return byItem;
  }

  async getById(userId: string, id: string): Promise<VocabularyWithRelations | null> {
    const rows = await this.db
      .select()
      .from(vocabularyItems)
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
      .limit(1);
    const item = rows[0];
    if (!item) {
      return null;
    }

    const forms = await this.db
      .select()
      .from(vocabularyForms)
      .where(eq(vocabularyForms.vocabularyItemId, id));

    const topicRows = await this.db
      .select({ topics: topicsTable })
      .from(vocabularyTopics)
      .innerJoin(topicsTable, eq(topicsTable.id, vocabularyTopics.topicId))
      .where(eq(vocabularyTopics.vocabularyItemId, id));

    return { ...item, forms, topics: topicRows.map((row) => row.topics) };
  }

  /** Full detail view: item, forms, topics, sources, and review summary. */
  async getDetail(userId: string, id: string): Promise<VocabularyDetail | null> {
    const base = await this.getById(userId, id);
    if (!base) {
      return null;
    }

    const sources = await this.db
      .select()
      .from(wordSources)
      .where(eq(wordSources.vocabularyItemId, id));

    const summaries = await this.reviewSummariesForItems(userId, [id]);

    return { ...base, sources, reviewSummary: summaries.get(id) ?? null };
  }

  /**
   * Replaces the item's topic links with the given names, normalizing and
   * deduplicating them. Keeps inflected forms attached to the lemma rather
   * than creating duplicate words. Verifies ownership of the item first.
   */
  async setTopics(userId: string, id: string, names: string[]): Promise<Topic[]> {
    return this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: vocabularyItems.id })
        .from(vocabularyItems)
        .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
        .limit(1);
      if (!owned[0]) {
        throw new NotFoundError("VocabularyItem", id);
      }

      await tx
        .delete(vocabularyTopics)
        .where(and(eq(vocabularyTopics.userId, userId), eq(vocabularyTopics.vocabularyItemId, id)));

      const linked: Topic[] = [];
      const seen = new Set<string>();
      for (const name of names) {
        const normalized = normalizeTopicName(name);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        const topic = await this.topicsRepo.findOrCreate(userId, name, tx);
        await tx
          .insert(vocabularyTopics)
          .values({ userId, vocabularyItemId: id, topicId: topic.id })
          .onConflictDoNothing();
        linked.push(topic);
      }
      return linked;
    });
  }

  async update(userId: string, id: string, input: UpdateVocabularyInput): Promise<VocabularyItem> {
    const data = updateVocabularySchema.parse(input);
    const updated = await this.db
      .update(vocabularyItems)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
      .returning();
    if (!updated[0]) {
      throw new NotFoundError("VocabularyItem", id);
    }
    return updated[0];
  }

  /** Soft-delete: archival is preferred over deletion for ordinary management. */
  async archive(userId: string, id: string): Promise<VocabularyItem> {
    const updated = await this.db
      .update(vocabularyItems)
      .set({ status: "archived" })
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
      .returning();
    if (!updated[0]) {
      throw new NotFoundError("VocabularyItem", id);
    }
    return updated[0];
  }

  async restore(userId: string, id: string): Promise<VocabularyItem> {
    const updated = await this.db
      .update(vocabularyItems)
      .set({ status: "active" })
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
      .returning();
    if (!updated[0]) {
      throw new NotFoundError("VocabularyItem", id);
    }
    return updated[0];
  }

  /**
   * Hard-deletes a vocabulary item. Cascades remove its forms, topic links,
   * sources, review state, and attempts via foreign-key constraints.
   */
  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(vocabularyItems)
      .where(and(eq(vocabularyItems.userId, userId), eq(vocabularyItems.id, id)))
      .returning({ id: vocabularyItems.id });
    if (!deleted[0]) {
      throw new NotFoundError("VocabularyItem", id);
    }
  }
}
