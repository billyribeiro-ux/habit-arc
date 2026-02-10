-- ============================================================================
-- 004: Habit Completions
-- ============================================================================
-- Records each completion event. The local_date_bucket column stores the
-- completion date in the USER's timezone (a NaiveDate / DATE), while
-- created_at stores the exact UTC instant.
--
-- Key constraint: UNIQUE(habit_id, local_date_bucket) ensures one completion
-- per habit per local calendar day. The toggle endpoint relies on this for
-- idempotent create-or-delete behavior.
-- ============================================================================

CREATE TABLE habit_completions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id            UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The date in the user's local timezone (e.g., 2026-02-10)
    -- This is the "bucket" for streak calculation and dedup.
    local_date_bucket   DATE NOT NULL,

    -- How many units completed (default 1; supports multi-target habits)
    value               INTEGER NOT NULL DEFAULT 1,

    -- Optional note attached to this completion
    note                TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- value must be positive
    CONSTRAINT chk_completion_value CHECK (value >= 1),

    -- Note length limit
    CONSTRAINT chk_completion_note_length CHECK (
        note IS NULL OR char_length(note) <= 5000
    ),

    -- One completion per habit per local date (idempotency key)
    CONSTRAINT uq_completion_habit_date UNIQUE (habit_id, local_date_bucket)
);

-- Primary query: "what did this habit do recently?" (streak walks, heatmap)
CREATE INDEX idx_completions_habit_date_desc
    ON habit_completions (habit_id, local_date_bucket DESC);

-- "What did this user complete on a given date range?" (daily stats, review)
CREATE INDEX idx_completions_user_date
    ON habit_completions (user_id, local_date_bucket DESC);

-- Covering index for toggle: look up by all three columns
CREATE INDEX idx_completions_toggle_lookup
    ON habit_completions (habit_id, user_id, local_date_bucket);
