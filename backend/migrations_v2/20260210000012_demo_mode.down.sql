DROP TABLE IF EXISTS demo_events;
DROP INDEX IF EXISTS idx_users_demo_cleanup;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_demo_expiry;
ALTER TABLE users DROP COLUMN IF EXISTS demo_insight_calls_used;
ALTER TABLE users DROP COLUMN IF EXISTS demo_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS is_demo;
