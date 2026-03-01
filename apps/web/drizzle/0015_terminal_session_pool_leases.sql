CREATE TABLE `terminal_session_pool_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_key` text NOT NULL,
	`lease_token` text NOT NULL,
	`session_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_terminal_session_pool_leases_user_key` ON `terminal_session_pool_leases` (`user_id`,`session_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_terminal_session_pool_leases_token` ON `terminal_session_pool_leases` (`lease_token`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_leases_user` ON `terminal_session_pool_leases` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_leases_session` ON `terminal_session_pool_leases` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_terminal_session_pool_leases_updated` ON `terminal_session_pool_leases` (`updated_at`);
