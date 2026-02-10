-- ============================================================================
-- 012: Demo Mode (Try Me)
-- ============================================================================
-- Adds demo session support: ephemeral users with auto-expiry,
-- demo event tracking for product analytics, and AI call quotas.
-- ============================================================================

-- Add demo columns to users table
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS demo_insight_calls_used INTEGER NOT NULL DEFAULT 0;

-- Constraint: demo_expires_at must be set when is_demo is true
ALTER TABLE users
    ADD CONSTRAINT chk_demo_expiry CHECK (
        (is_demo = true AND demo_expires_at IS NOT NULL)
        OR
        (is_demo = false)
    );

-- Index for cleanup worker: find expired demo sessions
CREATE INDEX idx_users_demo_cleanup
    ON users (is_demo, demo_expires_at)
    WHERE is_demo = true;

-- Demo event tracking for product analytics / conversion funnel
CREATE TABLE demo_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_name      TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_event_name_length CHECK (char_length(event_name) <= 100)
);

CREATE INDEX idx_demo_events_user
    ON demo_events (demo_user_id, created_at DESC);

CREATE INDEX idx_demo_events_name
    ON demo_events (event_name, created_at DESC);
