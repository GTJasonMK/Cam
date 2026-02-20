ALTER TABLE task_templates ADD COLUMN pipeline_steps TEXT;
--> statement-breakpoint
ALTER TABLE task_templates ADD COLUMN max_retries INTEGER DEFAULT 2;
