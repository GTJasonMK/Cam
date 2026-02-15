CREATE TABLE `agent_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`icon` text,
	`docker_image` text NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`required_env_vars` text DEFAULT '[]' NOT NULL,
	`capabilities` text NOT NULL,
	`default_resource_limits` text DEFAULT '{}' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `system_events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `system_events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`agent_definition_id` text NOT NULL,
	`repo_url` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`work_branch` text NOT NULL,
	`work_dir` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`group_id` text,
	`assigned_worker_id` text,
	`pr_url` text,
	`summary` text,
	`log_file_url` text,
	`review_comment` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`queued_at` text,
	`started_at` text,
	`completed_at` text,
	`feedback` text,
	FOREIGN KEY (`agent_definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_agent_def_id` ON `tasks` (`agent_definition_id`);--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`supported_agent_ids` text DEFAULT '[]' NOT NULL,
	`max_concurrent` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`current_task_id` text,
	`last_heartbeat_at` text NOT NULL,
	`cpu_usage` real,
	`memory_usage_mb` real,
	`disk_usage_mb` real,
	`total_tasks_completed` integer DEFAULT 0 NOT NULL,
	`total_tasks_failed` integer DEFAULT 0 NOT NULL,
	`uptime_since` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workers_status` ON `workers` (`status`);