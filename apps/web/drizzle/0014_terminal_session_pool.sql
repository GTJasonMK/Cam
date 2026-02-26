CREATE TABLE `terminal_session_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_key` text NOT NULL,
	`repo_path` text NOT NULL,
	`agent_definition_id` text NOT NULL,
	`mode` text NOT NULL,
	`resume_session_id` text,
	`source` text DEFAULT 'external' NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_terminal_session_pool_user_key` ON `terminal_session_pool` (`user_id`,`session_key`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_user` ON `terminal_session_pool` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_repo` ON `terminal_session_pool` (`repo_path`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_agent` ON `terminal_session_pool` (`agent_definition_id`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_updated` ON `terminal_session_pool` (`updated_at`);

