-- ============================================================================
-- 013: Habits Schema Reconciliation
-- ============================================================================
-- The Habit model expects columns (is_archived, frequency_config, reminder_time)
-- that were not in the original migration (which used deleted_at + habit_schedules).
-- This migration adds the missing columns so the application code works correctly.
-- ============================================================================

-- Add is_archived column (used by handlers instead of deleted_at soft-delete)
ALTER TABLE habits
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Add frequency_config JSONB (used by handlers for schedule data alongside habit_schedules)
ALTER TABLE habits
    ADD COLUMN IF NOT EXISTS frequency_config JSONB NOT NULL DEFAULT '{}';

-- Add reminder_time (used by habit create/update handlers)
ALTER TABLE habits
    ADD COLUMN IF NOT EXISTS reminder_time TIME;

-- Index for active habits query (is_archived = false)
CREATE INDEX IF NOT EXISTS idx_habits_user_active_archived
    ON habits (user_id, sort_order)
    WHERE is_archived = false;
