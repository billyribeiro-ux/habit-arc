-- Rollback 010: Drop audit_logs and immutability function
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
DROP FUNCTION IF EXISTS protect_audit_immutable() CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
