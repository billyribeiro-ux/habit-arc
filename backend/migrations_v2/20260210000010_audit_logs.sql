-- ============================================================================
-- 010: Audit Logs
-- ============================================================================
-- Immutable append-only table for security-sensitive actions.
-- No UPDATE or DELETE should ever be performed on this table.
-- The protect_audit_immutable trigger enforces this at the DB level.
-- ============================================================================

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The user who performed the action (NULL for system-initiated events)
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,

    -- What happened
    action          audit_action NOT NULL,

    -- IP address of the request (IPv4 or IPv6, stored as text)
    ip_address      INET,

    -- User-Agent header
    user_agent      TEXT,

    -- Additional context (e.g., old tier → new tier for subscription_changed)
    metadata        JSONB NOT NULL DEFAULT '{}',

    -- Immutable timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query: user's security history
CREATE INDEX idx_audit_logs_user
    ON audit_logs (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Query: recent actions of a specific type (e.g., login_failed for brute-force detection)
CREATE INDEX idx_audit_logs_action_recent
    ON audit_logs (action, created_at DESC);

-- Query: brute-force detection — failed logins from an IP in the last hour
CREATE INDEX idx_audit_logs_ip_action
    ON audit_logs (ip_address, action, created_at DESC)
    WHERE action = 'login_failed';

-- ============================================================================
-- Immutability enforcement: prevent UPDATE and DELETE on audit_logs
-- ============================================================================
CREATE OR REPLACE FUNCTION protect_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is immutable: % operations are not allowed', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION protect_audit_immutable();

CREATE TRIGGER trg_audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION protect_audit_immutable();
