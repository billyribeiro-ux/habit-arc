-- ============================================================================
-- 006: Insights (weekly AI-generated or fallback)
-- ============================================================================
-- Cached weekly insights keyed by (user_id, week_start_date).
-- week_start_date is always a Monday (ISO 8601 week).
-- The source column distinguishes Claude-generated from deterministic fallback.
-- ============================================================================

CREATE TABLE insights (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Monday of the ISO week this insight covers
    week_start_date     DATE NOT NULL,

    -- How was this insight generated?
    source              insight_source NOT NULL DEFAULT 'claude',

    -- Content fields
    summary             TEXT NOT NULL,
    wins                JSONB NOT NULL DEFAULT '[]',
    improvements        JSONB NOT NULL DEFAULT '[]',
    mood_correlation    TEXT,
    streak_analysis     TEXT NOT NULL,
    tip_of_the_week     TEXT NOT NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One insight per user per week
    CONSTRAINT uq_insight_user_week UNIQUE (user_id, week_start_date),

    -- week_start_date must be a Monday (ISO day_of_week = 1)
    CONSTRAINT chk_week_start_is_monday CHECK (
        EXTRACT(ISODOW FROM week_start_date) = 1
    ),

    -- Summary must not be empty
    CONSTRAINT chk_summary_not_empty CHECK (char_length(summary) > 0),

    -- wins and improvements must be JSON arrays
    CONSTRAINT chk_wins_is_array CHECK (jsonb_typeof(wins) = 'array'),
    CONSTRAINT chk_improvements_is_array CHECK (jsonb_typeof(improvements) = 'array')
);

-- Primary query: latest insights for a user
CREATE INDEX idx_insights_user_week_desc
    ON insights (user_id, week_start_date DESC);
