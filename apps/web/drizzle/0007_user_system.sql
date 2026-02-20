-- 用户系统：users / sessions / oauth_accounts / api_tokens
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`password_hash` text,
	`role` text DEFAULT 'developer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`avatar_url` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_users_username` ON `users` (`username`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_users_email` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);
--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_sessions_token` ON `sessions` (`token`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`provider_username` text,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_oauth_provider_account` ON `oauth_accounts` (`provider`,`provider_account_id`);
--> statement-breakpoint
CREATE INDEX `idx_oauth_user_id` ON `oauth_accounts` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_oauth_provider` ON `oauth_accounts` (`provider`);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_api_tokens_hash` ON `api_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_api_tokens_user_id` ON `api_tokens` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_api_tokens_prefix` ON `api_tokens` (`token_prefix`);
