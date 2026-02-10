-- ============================================================================
-- 002: Users table
-- ============================================================================
-- Core identity table. Supports both guest and registered users.
-- email is nullable for guests; unique partial index enforces uniqueness
-- only for non-null emails.
-- ============================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT,
    password_hash   TEXT,
    name            TEXT NOT NULL DEFAULT 'Guest',
    avatar_url      TEXT,
    is_guest        BOOLEAN NOT NULL DEFAULT false,
    guest_token     UUID UNIQUE,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Guests must have a guest_token; registered users must have email + password
    CONSTRAINT chk_guest_fields CHECK (
        (is_guest = true  AND guest_token IS NOT NULL)
        OR
        (is_guest = false AND email IS NOT NULL AND password_hash IS NOT NULL)
    ),

    -- Timezone must look like an IANA identifier (basic validation)
    CONSTRAINT chk_timezone_format CHECK (
        timezone ~ '^[A-Z][a-zA-Z_]+/[a-zA-Z_/]+$'
        OR timezone = 'UTC'
    )
);

-- Unique email for registered users only (guests have NULL email)
CREATE UNIQUE INDEX idx_users_email_unique
    ON users (lower(email))
    WHERE email IS NOT NULL;

-- Guest cleanup job: find stale guests efficiently
CREATE INDEX idx_users_guest_cleanup
    ON users (updated_at)
    WHERE is_guest = true;

-- Triggers
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_protect_created
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION protect_created_at();
