ALTER TABLE `system_events` ADD COLUMN `actor` text;
--> statement-breakpoint
CREATE INDEX `idx_events_actor` ON `system_events` (`actor`);
