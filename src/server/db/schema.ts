import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite schema for Cards No Cards.
 *
 * Notes:
 * - Primary keys are application-generated UUIDs (text).
 * - Timestamps are stored as integer epoch-milliseconds (UTC); the UI
 *   formats them for the user's locale.
 * - `user_id` holds the external identity subject (Amazon Cognito `sub`).
 *   There is no local `auth.users` table, so user ownership is enforced
 *   by application code and repository scoping rather than a DB FK.
 * - Foreign keys require `PRAGMA foreign_keys = ON` (set by the client).
 */

const uuid = () =>
  text()
    .primaryKey()
    .$defaultFn(() => randomUUID());

const userId = () => text("user_id").notNull();

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const partsOfSpeech = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "pronoun",
  "conjunction",
  "expression",
  "other",
] as const;

export const genders = ["masculine", "feminine", "common", "unknown"] as const;
export const vocabularyStatuses = ["active", "archived"] as const;
export const reviewResults = ["recalled", "recalled_with_hint", "wrong", "skipped"] as const;
export const lessonSourceTypes = ["tutor_lesson", "homework", "manual", "voice", "other"] as const;
export const wordSourceTypes = [
  "tutor_lesson",
  "homework",
  "manual",
  "voice",
  "ai_suggested",
  "other",
] as const;
export const importBatchStatuses = [
  "pending",
  "processing",
  "needs_review",
  "confirmed",
  "failed",
] as const;
export const importItemDecisions = ["pending", "create", "merge", "skip"] as const;
export const sessionStatuses = ["active", "completed", "abandoned"] as const;

function inList(column: string, values: readonly string[]) {
  const quoted = values.map((v) => `'${v}'`).join(", ");
  return sql.raw(`${column} in (${quoted})`);
}

export const profiles = sqliteTable("profiles", {
  // For profiles the primary key IS the external user id.
  id: text().primaryKey(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  preferredLocale: text("preferred_locale").notNull().default("en"),
  timezone: text(),
  onboardingCompletedAt: integer("onboarding_completed_at", { mode: "timestamp_ms" }),
});

export const lessons = sqliteTable(
  "lessons",
  {
    id: uuid(),
    userId: userId(),
    title: text(),
    lessonDate: text("lesson_date"),
    sourceType: text("source_type").notNull(),
    sourceNote: text("source_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("lessons_user_idx").on(t.userId),
    check("lessons_source_type_chk", inList("source_type", lessonSourceTypes)),
  ],
);

export const vocabularyItems = sqliteTable(
  "vocabulary_items",
  {
    id: uuid(),
    userId: userId(),
    lemma: text().notNull(),
    translation: text().notNull(),
    partOfSpeech: text("part_of_speech").notNull(),
    definition: text(),
    gender: text(),
    exampleSentence: text("example_sentence"),
    exampleTranslation: text("example_translation"),
    languageCode: text("language_code").notNull().default("es"),
    status: text().notNull().default("active"),
    aiConfidence: real("ai_confidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vocabulary_user_lemma_idx").on(t.userId, t.lemma),
    index("vocabulary_user_status_idx").on(t.userId, t.status),
    check("vocabulary_part_of_speech_chk", inList("part_of_speech", partsOfSpeech)),
    check("vocabulary_status_chk", inList("status", vocabularyStatuses)),
  ],
);

export const vocabularyForms = sqliteTable(
  "vocabulary_forms",
  {
    id: uuid(),
    userId: userId(),
    vocabularyItemId: text("vocabulary_item_id")
      .notNull()
      .references(() => vocabularyItems.id, { onDelete: "cascade" }),
    form: text().notNull(),
    formType: text("form_type"),
    grammarNote: text("grammar_note"),
    createdAt: createdAt(),
  },
  (t) => [index("vocabulary_forms_item_idx").on(t.vocabularyItemId)],
);

export const topics = sqliteTable(
  "topics",
  {
    id: uuid(),
    userId: userId(),
    name: text().notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("topics_user_normalized_uidx").on(t.userId, t.normalizedName)],
);

export const vocabularyTopics = sqliteTable(
  "vocabulary_topics",
  {
    userId: userId(),
    vocabularyItemId: text("vocabulary_item_id")
      .notNull()
      .references(() => vocabularyItems.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.vocabularyItemId, t.topicId] }),
    index("vocabulary_topics_topic_idx").on(t.topicId),
  ],
);

export const wordSources = sqliteTable(
  "word_sources",
  {
    id: uuid(),
    userId: userId(),
    vocabularyItemId: text("vocabulary_item_id")
      .notNull()
      .references(() => vocabularyItems.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    sourceType: text("source_type").notNull(),
    sourceText: text("source_text"),
    createdAt: createdAt(),
  },
  (t) => [
    index("word_sources_item_idx").on(t.vocabularyItemId),
    check("word_sources_source_type_chk", inList("source_type", wordSourceTypes)),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: uuid(),
    userId: userId(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    rawText: text("raw_text").notNull(),
    status: text().notNull(),
    parsedPayload: text("parsed_payload"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("import_batches_user_idx").on(t.userId),
    check("import_batches_status_chk", inList("status", importBatchStatuses)),
  ],
);

export const importItems = sqliteTable(
  "import_items",
  {
    id: uuid(),
    userId: userId(),
    importBatchId: text("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    proposedLemma: text("proposed_lemma"),
    proposedTranslation: text("proposed_translation"),
    proposedPartOfSpeech: text("proposed_part_of_speech"),
    proposedTopics: text("proposed_topics").notNull().default("[]"),
    proposedForms: text("proposed_forms").notNull().default("[]"),
    proposedExample: text("proposed_example"),
    proposedExampleTranslation: text("proposed_example_translation"),
    confidence: real(),
    matchVocabularyItemId: text("match_vocabulary_item_id").references(() => vocabularyItems.id, {
      onDelete: "set null",
    }),
    decision: text().notNull().default("pending"),
    createdVocabularyItemId: text("created_vocabulary_item_id").references(
      () => vocabularyItems.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
  },
  (t) => [
    index("import_items_batch_idx").on(t.importBatchId),
    check("import_items_decision_chk", inList("decision", importItemDecisions)),
  ],
);

export const reviewStates = sqliteTable(
  "review_states",
  {
    id: uuid(),
    userId: userId(),
    vocabularyItemId: text("vocabulary_item_id")
      .notNull()
      .unique()
      .references(() => vocabularyItems.id, { onDelete: "cascade" }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    introducedAt: integer("introduced_at", { mode: "timestamp_ms" }),
    successfulRecalls: integer("successful_recalls").notNull().default(0),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    reviewStage: integer("review_stage").notNull().default(0),
    difficulty: real().notNull().default(0.5),
    lastResult: text("last_result"),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("review_states_user_due_idx").on(t.userId, t.dueAt),
    check(
      "review_states_last_result_chk",
      sql`last_result is null or ${inList("last_result", reviewResults)}`,
    ),
  ],
);

export const reviewAttempts = sqliteTable(
  "review_attempts",
  {
    id: uuid(),
    userId: userId(),
    vocabularyItemId: text("vocabulary_item_id")
      .notNull()
      .references(() => vocabularyItems.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    exerciseType: text("exercise_type").notNull(),
    promptSnapshot: text("prompt_snapshot").notNull(),
    submittedAnswer: text("submitted_answer"),
    result: text().notNull(),
    usedHint: integer("used_hint", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("review_attempts_item_idx").on(t.vocabularyItemId),
    index("review_attempts_session_idx").on(t.sessionId),
    check("review_attempts_result_chk", inList("result", reviewResults)),
  ],
);

export const practiceSessions = sqliteTable(
  "practice_sessions",
  {
    id: uuid(),
    userId: userId(),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    targetDurationSeconds: integer("target_duration_seconds").notNull().default(180),
    status: text().notNull().default("active"),
    summary: text(),
  },
  (t) => [
    index("practice_sessions_user_idx").on(t.userId),
    check("practice_sessions_status_chk", inList("status", sessionStatuses)),
  ],
);

export const schema = {
  profiles,
  lessons,
  vocabularyItems,
  vocabularyForms,
  topics,
  vocabularyTopics,
  wordSources,
  importBatches,
  importItems,
  reviewStates,
  reviewAttempts,
  practiceSessions,
};
