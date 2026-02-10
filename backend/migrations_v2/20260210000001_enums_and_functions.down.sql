-- Rollback 001: Drop utility functions and all custom enums
DROP FUNCTION IF EXISTS protect_created_at() CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP TYPE IF EXISTS audit_action CASCADE;
DROP TYPE IF EXISTS notification_channel CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS insight_source CASCADE;
DROP TYPE IF EXISTS habit_frequency CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;
DROP TYPE IF EXISTS subscription_tier CASCADE;
