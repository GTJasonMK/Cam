ALTER TABLE `workers` ADD COLUMN `mode` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workers` ADD COLUMN `reported_env_vars` text DEFAULT '[]' NOT NULL;
