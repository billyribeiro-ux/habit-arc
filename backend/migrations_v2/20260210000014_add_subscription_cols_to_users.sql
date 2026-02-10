-- ============================================================================
-- 014: Add subscription columns directly to users table
-- ============================================================================
-- The handlers reference subscription_tier and subscription_status on the
-- users table. The subscriptions table exists for Stripe-specific data,
-- but the user-facing tier/status lives on users for simplicity.
-- ============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS subscription_tier subscription_tier NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS subscription_status subscription_status NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
