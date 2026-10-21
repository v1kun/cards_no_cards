CREATE TABLE `local_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_accounts_login_unique` ON `local_accounts` (`login`);--> statement-breakpoint
CREATE UNIQUE INDEX `local_accounts_user_id_unique` ON `local_accounts` (`user_id`);