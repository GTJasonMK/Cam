CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repository_id` text,
	`agent_definition_id` text,
	`value_encrypted` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_secrets_scope` ON `secrets` (`name`,`repository_id`,`agent_definition_id`);--> statement-breakpoint
CREATE INDEX `idx_secrets_name` ON `secrets` (`name`);--> statement-breakpoint
CREATE INDEX `idx_secrets_repo_id` ON `secrets` (`repository_id`);--> statement-breakpoint
CREATE INDEX `idx_secrets_agent_def_id` ON `secrets` (`agent_definition_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `repository_id` text REFERENCES repositories(id);--> statement-breakpoint
CREATE INDEX `idx_tasks_repo_id` ON `tasks` (`repository_id`);