CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_url` text NOT NULL,
	`default_base_branch` text DEFAULT 'main' NOT NULL,
	`default_work_dir` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_repos_name` ON `repositories` (`name`);--> statement-breakpoint
CREATE INDEX `idx_repos_repo_url` ON `repositories` (`repo_url`);