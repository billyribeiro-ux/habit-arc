-- ============================================================================
-- 003: Habits + Habit Schedules
-- ============================================================================
-- Habits use soft delete (deleted_at). The habit_schedules table normalizes
-- the schedule configuration out of JSONB into a proper relational structure.
--
-- Key constraint: UNIQUE(user_id, lower(name)) WHERE deleted_at IS NULL
-- prevents duplicate active habit names per user.
-- ============================================================================

CREATE TABLE habits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    color               TEXT NOT NULL DEFAULT '#6366f1',
    icon                TEXT NOT NULL DEFAULT 'target',
    frequency           habit_frequency NOT NULL DEFAULT 'daily',
    target_per_day      INTEGER NOT NULL DEFAULT 1,
    sort_order          INTEGER NOT NULL DEFAULT 0,

    -- Denormalized streak counters (updated by application on completion events)
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    total_completions   BIGINT  NOT NULL DEFAULT 0,

    -- Soft delete
    deleted_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- target_per_day must be 1..100
    CONSTRAINT chk_target_per_day CHECK (target_per_day BETWEEN 1 AND 100),

    -- Streaks must be non-negative
    CONSTRAINT chk_streaks_non_negative CHECK (
        current_streak >= 0 AND longest_streak >= 0 AND total_completions >= 0
    ),

    -- longest_streak must always be >= current_streak
    CONSTRAINT chk_longest_gte_current CHECK (longest_streak >= current_streak),

    -- Name length: 1..200
    CONSTRAINT chk_habit_name_length CHECK (
        char_length(name) BETWEEN 1 AND 200
    ),

    -- Description length: 0..2000
    CONSTRAINT chk_habit_desc_length CHECK (
        description IS NULL OR char_length(description) <= 2000
    )
);

-- Unique active habit name per user (soft-delete aware)
CREATE UNIQUE INDEX idx_habits_unique_name_per_user
    ON habits (user_id, lower(name))
    WHERE deleted_at IS NULL;

-- Primary query path: list active habits for a user
CREATE INDEX idx_habits_user_active
    ON habits (user_id, sort_order)
    WHERE deleted_at IS NULL;

-- Soft-delete cleanup / admin queries
CREATE INDEX idx_habits_user_deleted
    ON habits (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Triggers
CREATE TRIGGER trg_habits_updated_at
    BEFORE UPDATE ON habits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_habits_protect_created
    BEFORE UPDATE ON habits
    FOR EACH ROW EXECUTE FUNCTION protect_created_at();

-- ============================================================================
-- Habit Schedules: normalized schedule configuration
-- ============================================================================
-- For 'daily' habits: no rows needed (implicit every day).
-- For 'weekly_days': one row per active day (day_of_week 1=Mon .. 7=Sun).
-- For 'weekly_target': one row with times_per_week set.
--
-- This replaces the previous JSONB frequency_config column.
-- ============================================================================

CREATE TABLE habit_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id        UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,

    -- For weekly_days: which ISO day (1=Mon..7=Sun). NULL for weekly_target.
    day_of_week     SMALLINT,

    -- For weekly_target: how many times per week. NULL for weekly_days.
    times_per_week  SMALLINT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- day_of_week must be 1..7 when present
    CONSTRAINT chk_day_of_week CHECK (
        day_of_week IS NULL OR day_of_week BETWEEN 1 AND 7
    ),

    -- times_per_week must be 1..7 when present
    CONSTRAINT chk_times_per_week CHECK (
        times_per_week IS NULL OR times_per_week BETWEEN 1 AND 7
    ),

    -- Exactly one of day_of_week or times_per_week must be set
    CONSTRAINT chk_schedule_type CHECK (
        (day_of_week IS NOT NULL AND times_per_week IS NULL)
        OR
        (day_of_week IS NULL AND times_per_week IS NOT NULL)
    )
);

-- One row per day per habit (prevents duplicate day entries)
CREATE UNIQUE INDEX idx_habit_schedules_day
    ON habit_schedules (habit_id, day_of_week)
    WHERE day_of_week IS NOT NULL;

-- Only one weekly_target row per habit
CREATE UNIQUE INDEX idx_habit_schedules_target
    ON habit_schedules (habit_id)
    WHERE times_per_week IS NOT NULL;

-- Lookup by habit
CREATE INDEX idx_habit_schedules_habit
    ON habit_schedules (habit_id);
