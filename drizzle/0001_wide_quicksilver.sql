CREATE TABLE `exercise_bank_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`exercise_type` text NOT NULL,
	`payload` text NOT NULL,
	`source_hash` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercise_bank_user_idx` ON `exercise_bank_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `exercise_bank_item_idx` ON `exercise_bank_items` (`vocabulary_item_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_word_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocabulary_item_id` text NOT NULL,
	`lesson_id` text,
	`source_type` text NOT NULL,
	`source_text` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vocabulary_item_id`) REFERENCES `vocabulary_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "word_sources_source_type_chk" CHECK(source_type in ('tutor_lesson', 'homework', 'manual', 'voice', 'ai_suggested', 'starter_deck', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_word_sources`("id", "user_id", "vocabulary_item_id", "lesson_id", "source_type", "source_text", "created_at") SELECT "id", "user_id", "vocabulary_item_id", "lesson_id", "source_type", "source_text", "created_at" FROM `word_sources`;--> statement-breakpoint
DROP TABLE `word_sources`;--> statement-breakpoint
ALTER TABLE `__new_word_sources` RENAME TO `word_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `word_sources_item_idx` ON `word_sources` (`vocabulary_item_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `translation_language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary_items` ADD `secondary_translation` text;