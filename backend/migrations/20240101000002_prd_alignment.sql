-- Migration: Align schema with PRD v1.0.0
-- Addresses gaps: G-1, G-2, G-3, G-4, G-5, G-14, G-15, G-18

-- G-3: Change subscription tiers from free/pro/team → free/plus/pro
ALTER TYPE subscription_tier RENAME VALUE 'team' TO 'plus';
-- Now enum is: free, pro, plus — we need to swap pro and plus semantically.
-- Postgres doesn't support reordering enum values, so we rename:
--   old 'pro'  → new 'pro' (stays)
--   old 'team' → renamed to 'plus' above
-- This means existing 'pro' users stay 'pro', and 'team' becomes 'plus'.
-- For new signups the tiers are: free < plus ($4.99) < pro ($9.99).

-- G-1: Guest user support
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_token UUID UNIQUE;

-- G-2: Timezone support
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- G-5: Change habit_frequency enum to match PRD schedule types
ALTER TYPE habit_frequency RENAME VALUE 'weekly' TO 'weekly_days';
ALTER TYPE habit_frequency RENAME VALUE 'custom' TO 'weekly_target';
-- Now enum is: daily, weekly_days, weekly_target

-- G-14: Daily logs table (mood/energy/stress)
CREATE TABLE IF NOT EXISTS daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    mood INTEGER CHECK (mood BETWEEN 1 AND 5),
    energy INTEGER CHECK (energy BETWEEN 1 AND 5),
    stress INTEGER CHECK (stress BETWEEN 1 AND 5),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_id, log_date);

CREATE TRIGGER update_daily_logs_updated_at
    BEFORE UPDATE ON daily_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- G-15: Weekly insights cache table
CREATE TABLE IF NOT EXISTS weekly_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    iso_year INTEGER NOT NULL,
    iso_week INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude', -- 'claude' or 'fallback'
    summary TEXT NOT NULL,
    wins JSONB NOT NULL DEFAULT '[]',
    improvements JSONB NOT NULL DEFAULT '[]',
    mood_correlation TEXT,
    streak_analysis TEXT NOT NULL,
    tip_of_the_week TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, iso_year, iso_week)
);

CREATE INDEX IF NOT EXISTS idx_weekly_insights_user ON weekly_insights(user_id, iso_year, iso_week);

-- G-18: Stripe event deduplication table
CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add is_due_today helper: not a column, computed at query time.
-- No schema change needed — computed in application layer.

-- Guest account cleanup: add index for background purge job
CREATE INDEX IF NOT EXISTS idx_users_guest_cleanup
    ON users(updated_at) WHERE is_guest = true;
