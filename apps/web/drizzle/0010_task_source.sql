-- 新增 source 字段区分任务来源（scheduler / terminal）
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'scheduler';
