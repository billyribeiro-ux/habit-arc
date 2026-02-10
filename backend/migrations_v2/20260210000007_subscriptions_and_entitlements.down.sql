-- Rollback 007: Drop subscriptions, feature_entitlements, stripe_events
DROP TABLE IF EXISTS stripe_events CASCADE;
DROP TABLE IF EXISTS feature_entitlements CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
