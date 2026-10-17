CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text,
	`raw_text` text NOT NULL,
	`status` text NOT NULL,
	`parsed_payload` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_batches_status_chk" CHECK(status in ('pending', 'processing', 'needs_review', 'confirmed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `import_batches_user_idx` ON `import_batches` (`user_id`);--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`import_batch_id` text NOT NULL,
	`proposed_lemma` text,
	`proposed_translation` text,
	`proposed_part_of_speech` text,
	`proposed_topics` text DEFAULT '[]' NOT NULL,
	`proposed_forms` text DEFAULT '[]' NOT NULL,
	`proposed_example` text,
	`proposed_example_translation` text,
	`confidence` real,
	`match_vocabulary_item_id` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`created_vocabulary_item_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`match_vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_items_decision_chk" CHECK(decision in ('pending', 'create', 'merge', 'skip'))
);
--> statement-breakpoint
CREATE INDEX `import_items_batch_idx` ON `import_items` (`import_batch_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`lesson_date` text,
	`source_type` text NOT NULL,
	`source_note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "lessons_source_type_chk" CHECK(source_type in ('tutor_lesson', 'homework', 'manual', 'voice', 'other'))
);
--> statement-breakpoint
CREATE INDEX `lessons_user_idx` ON `lessons` (`user_id`);--> statement-breakpoint
CREATE TABLE `practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`target_duration_seconds` integer DEFAULT 180 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`summary` text,
	CONSTRAINT "practice_sessions_status_chk" CHECK(status in ('active', 'completed', 'abandoned'))
);
--> statement-breakpoint
CREATE INDEX `practice_sessions_user_idx` ON `practice_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`preferred_locale` text DEFAULT 'en' NOT NULL,
	`timezone` text,
	`onboarding_completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `review_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`session_id` text,
	`exercise_type` text NOT NULL,
	`prompt_snapshot` text NOT NULL,
	`submitted_answer` text,
	`result` text NOT NULL,
	`used_hint` integer DEFAULT false NOT NULL,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_attempts_result_chk" CHECK(result in ('recalled', 'recalled_with_hint', 'wrong', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `review_attempts_item_idx` ON `review_attempts` (`vocabulary_item_id`);--> statement-breakpoint
CREATE INDEX `review_attempts_session_idx` ON `review_attempts` (`session_id`);--> statement-breakpoint
CREATE TABLE `review_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`due_at` integer,
	`introduced_at` integer,
	`successful_recalls` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`review_stage` integer DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0.5 NOT NULL,
	`last_result` text,
	`last_reviewed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_states_last_result_chk" CHECK(last_result is null or last_result in ('recalled', 'recalled_with_hint', 'wrong', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_states_vocabulary_item_id_unique` ON `review_states` (`vocabulary_item_id`);--> statement-breakpoint
CREATE INDEX `review_states_user_due_idx` ON `review_states` (`user_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_user_normalized_uidx` ON `topics` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `vocabulary_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`form` text NOT NULL,
	`form_type` text,
	`grammar_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vocabulary_forms_item_idx` ON `vocabulary_forms` (`vocabulary_item_id`);--> statement-breakpoint
CREATE TABLE `vocabulary_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lemma` text NOT NULL,
	`translation` text NOT NULL,
	`part_of_speech` text NOT NULL,
	`definition` text,
	`gender` text,
	`example_sentence` text,
	`example_translation` text,
	`language_code` text DEFAULT 'es' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`ai_confidence` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "vocabulary_part_of_speech_chk" CHECK(part_of_speech in ('noun', 'verb', 'adjective', 'adverb', 'preposition', 'pronoun', 'conjunction', 'expression', 'other')),
	CONSTRAINT "vocabulary_status_chk" CHECK(status in ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `vocabulary_user_lemma_idx` ON `vocabulary_items` (`user_id`,`lemma`);--> statement-breakpoint
CREATE INDEX `vocabulary_user_status_idx` ON `vocabulary_items` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `vocabulary_topics` (
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`topic_id` text NOT NULL,
	PRIMARY KEY(`vocabulary_item_id`, `topic_id`),
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vocabulary_topics_topic_idx` ON `vocabulary_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `word_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`lesson_id` text,
	`source_type` text NOT NULL,
	`source_text` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "word_sources_source_type_chk" CHECK(source_type in ('tutor_lesson', 'homework', 'manual', 'voice', 'ai_suggested', 'other'))
);
--> statement-breakpoint
CREATE INDEX `word_sources_item_idx` ON `word_sources` (`vocabulary_item_id`);