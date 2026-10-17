import { and, desc, eq, like } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import {
  partsOfSpeech,
  genders,
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
};

export type VocabularyWithRelations = VocabularyItem & {
  forms: VocabularyForm[];
  topics: Topic[];
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

    return this.db.transaction(async (tx) => {
      const [item] = await tx
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
        await tx.insert(vocabularyForms).values(
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
        const topic = await this.topicsRepo.findOrCreate(userId, name, tx);
        await tx
          .insert(vocabularyTopics)
          .values({ userId, vocabularyItemId: item.id, topicId: topic.id })
          .onConflictDoNothing();
        linkedTopics.push(topic);
      }

      if (data.source) {
        await tx.insert(wordSources).values({
          userId,
          vocabularyItemId: item.id,
          lessonId: data.source.lessonId,
          sourceType: data.source.sourceType,
          sourceText: data.source.sourceText,
        });
      }

      const forms = await tx
        .select()
        .from(vocabularyForms)
        .where(eq(vocabularyForms.vocabularyItemId, item.id));

      return { ...item, forms, topics: linkedTopics };
    });
  }

  async list(userId: string, filters: VocabularyFilters = {}): Promise<VocabularyItem[]> {
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

    if (filters.topicId) {
      const topicId = filters.topicId;
      const rows = await this.db
        .select()
        .from(vocabularyItems)
        .innerJoin(vocabularyTopics, eq(vocabularyTopics.vocabularyItemId, vocabularyItems.id))
        .where(and(...conditions, eq(vocabularyTopics.topicId, topicId)))
        .orderBy(desc(vocabularyItems.createdAt));
      return rows.map((row) => row.vocabulary_items);
    }

    return this.db
      .select()
      .from(vocabularyItems)
      .where(and(...conditions))
      .orderBy(desc(vocabularyItems.createdAt));
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

  async update(userId: string, id: string, input: UpdateVocabularyInput): Promise<VocabularyItem> {
    const data = updateVocabularySchema.parse(input);
    const updated = await this.db
      .update(vocabularyItems)
      .set(data)
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
