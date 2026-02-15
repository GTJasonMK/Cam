CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title_template` text NOT NULL,
	`prompt_template` text NOT NULL,
	`agent_definition_id` text,
	`repository_id` text,
	`repo_url` text,
	`base_branch` text,
	`work_dir` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_templates_name` ON `task_templates` (`name`);
--> statement-breakpoint
CREATE INDEX `idx_task_templates_agent_id` ON `task_templates` (`agent_definition_id`);
--> statement-breakpoint
CREATE INDEX `idx_task_templates_repo_id` ON `task_templates` (`repository_id`);
