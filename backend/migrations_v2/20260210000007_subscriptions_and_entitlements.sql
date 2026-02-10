-- ============================================================================
-- 007: Subscriptions + Feature Entitlements + Stripe Events
-- ============================================================================
-- Normalizes billing state out of the users table into dedicated tables.
--
-- subscriptions: one active subscription per user (Stripe-driven lifecycle)
-- feature_entitlements: tier-to-feature mapping (seed data, not user-mutable)
-- stripe_events: webhook deduplication table
-- ============================================================================

CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier                subscription_tier NOT NULL DEFAULT 'free',
    status              subscription_status NOT NULL DEFAULT 'active',

    -- Stripe identifiers (NULL for free-tier users who never checked out)
    stripe_customer_id      TEXT UNIQUE,
    stripe_subscription_id  TEXT UNIQUE,

    -- Billing period
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,

    -- When the subscription was canceled (NULL if active)
    canceled_at             TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Period start must be before period end when both are set
    CONSTRAINT chk_period_order CHECK (
        current_period_start IS NULL
        OR current_period_end IS NULL
        OR current_period_start < current_period_end
    ),

    -- canceled_at only set when status is canceled
    CONSTRAINT chk_canceled_consistency CHECK (
        (status = 'canceled' AND canceled_at IS NOT NULL)
        OR
        (status != 'canceled' AND canceled_at IS NULL)
    )
);

-- One active/trialing subscription per user at a time
CREATE UNIQUE INDEX idx_subscriptions_user_active
    ON subscriptions (user_id)
    WHERE status IN ('active', 'trialing');

-- Query by user + status
CREATE INDEX idx_subscriptions_user_status
    ON subscriptions (user_id, status);

-- Lookup by Stripe customer
CREATE INDEX idx_subscriptions_stripe_customer
    ON subscriptions (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- Triggers
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscriptions_protect_created
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION protect_created_at();

-- ============================================================================
-- Feature Entitlements: what each tier gets
-- ============================================================================
-- This is reference data, not user data. Populated by seed migration.
-- Application code reads this to enforce limits.
-- ============================================================================

CREATE TABLE feature_entitlements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier                subscription_tier NOT NULL,
    feature_key         TEXT NOT NULL,
    value_int           INTEGER,
    value_bool          BOOLEAN,
    value_text          TEXT,

    -- Each tier has exactly one row per feature
    CONSTRAINT uq_entitlement_tier_feature UNIQUE (tier, feature_key),

    -- feature_key must be a known identifier
    CONSTRAINT chk_feature_key_format CHECK (
        feature_key ~ '^[a-z][a-z0-9_]*$'
    ),

    -- At least one value column must be set
    CONSTRAINT chk_at_least_one_value CHECK (
        value_int IS NOT NULL OR value_bool IS NOT NULL OR value_text IS NOT NULL
    )
);

-- Lookup by tier
CREATE INDEX idx_entitlements_tier
    ON feature_entitlements (tier);

-- ============================================================================
-- Stripe Events: webhook deduplication
-- ============================================================================

CREATE TABLE stripe_events (
    event_id        TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cleanup: find old events for periodic purge
CREATE INDEX idx_stripe_events_processed
    ON stripe_events (processed_at);
