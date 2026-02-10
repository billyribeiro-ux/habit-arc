-- ============================================================================
-- 005: Mood Logs
-- ============================================================================
-- Daily mood/energy/stress tracking. One row per user per local calendar day.
-- Uses local_date_bucket (same concept as habit_completions) so that a user
-- in America/Los_Angeles logging at 11pm local gets the correct date.
-- ============================================================================

CREATE TABLE mood_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Date in user's local timezone
    local_date_bucket   DATE NOT NULL,

    -- All three are optional — user can log any subset
    mood                SMALLINT,
    energy              SMALLINT,
    stress              SMALLINT,

    -- Free-text reflection
    note                TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One log per user per local day (upsert idempotency key)
    CONSTRAINT uq_mood_log_user_date UNIQUE (user_id, local_date_bucket),

    -- Strict 1-5 scale
    CONSTRAINT chk_mood_range   CHECK (mood   IS NULL OR mood   BETWEEN 1 AND 5),
    CONSTRAINT chk_energy_range CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
    CONSTRAINT chk_stress_range CHECK (stress IS NULL OR stress BETWEEN 1 AND 5),

    -- At least one value must be provided
    CONSTRAINT chk_at_least_one_value CHECK (
        mood IS NOT NULL OR energy IS NOT NULL OR stress IS NOT NULL
    ),

    -- Note length
    CONSTRAINT chk_mood_note_length CHECK (
        note IS NULL OR char_length(note) <= 5000
    )
);

-- Primary query: user's mood history, most recent first
CREATE INDEX idx_mood_logs_user_date_desc
    ON mood_logs (user_id, local_date_bucket DESC);

-- Triggers
CREATE TRIGGER trg_mood_logs_updated_at
    BEFORE UPDATE ON mood_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_mood_logs_protect_created
    BEFORE UPDATE ON mood_logs
    FOR EACH ROW EXECUTE FUNCTION protect_created_at();
