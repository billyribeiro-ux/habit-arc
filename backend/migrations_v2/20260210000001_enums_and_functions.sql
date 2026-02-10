-- ============================================================================
-- 001: Enums + Utility Functions
-- ============================================================================
-- All custom types and reusable trigger functions.
-- Must run first — every subsequent migration depends on these.
-- ============================================================================

-- Subscription tier: strict ordering free < plus < pro
CREATE TYPE subscription_tier AS ENUM ('free', 'plus', 'pro');

-- Subscription lifecycle status
CREATE TYPE subscription_status AS ENUM (
    'active',
    'trialing',
    'past_due',
    'canceled',
    'inactive'
);

-- Habit schedule frequency type
CREATE TYPE habit_frequency AS ENUM ('daily', 'weekly_days', 'weekly_target');

-- Insight generation source
CREATE TYPE insight_source AS ENUM ('claude', 'fallback');

-- Notification job status
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'dead_letter');

-- Notification channel
CREATE TYPE notification_channel AS ENUM ('web_push', 'email');

-- Audit action categories
CREATE TYPE audit_action AS ENUM (
    'login',
    'login_failed',
    'register',
    'guest_created',
    'guest_merged',
    'password_changed',
    'token_refreshed',
    'token_revoked',
    'subscription_changed',
    'account_deleted',
    'data_exported'
);

-- ============================================================================
-- Utility: auto-update updated_at on row modification
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Utility: prevent mutation of created_at
-- ============================================================================
CREATE OR REPLACE FUNCTION protect_created_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = OLD.created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
