-- Rollback: remove reconciliation columns
DROP INDEX IF EXISTS idx_habits_user_active_archived;
ALTER TABLE habits DROP COLUMN IF EXISTS reminder_time;
ALTER TABLE habits DROP COLUMN IF EXISTS frequency_config;
ALTER TABLE habits DROP COLUMN IF EXISTS is_archived;
