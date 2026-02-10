-- ============================================================================
-- 008: Refresh Tokens
-- ============================================================================
-- Stores SHA-256 hashes of refresh tokens. Raw tokens are NEVER persisted.
-- Supports single-use rotation: each token can only be used once.
-- If a revoked token is presented, all tokens for that user are revoked
-- (potential theft detection).
-- ============================================================================

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- SHA-256 hash of the raw refresh token (hex-encoded, 64 chars)
    token_hash      TEXT NOT NULL,

    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,

    -- Which token was this rotated from? NULL for the first token in a chain.
    parent_token_id UUID REFERENCES refresh_tokens(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- token_hash must be exactly 64 hex characters (SHA-256)
    CONSTRAINT chk_token_hash_format CHECK (
        token_hash ~ '^[a-f0-9]{64}$'
    ),

    -- expires_at must be in the future at creation time
    -- (enforced by application; DB constraint is a safety net)
    CONSTRAINT chk_expires_future CHECK (
        expires_at > created_at
    ),

    -- revoked_at only set when revoked is true
    CONSTRAINT chk_revoked_consistency CHECK (
        (revoked = true AND revoked_at IS NOT NULL)
        OR
        (revoked = false AND revoked_at IS NULL)
    )
);

-- Primary lookup: find token by hash (used on every refresh request)
CREATE INDEX idx_refresh_tokens_hash
    ON refresh_tokens (token_hash)
    WHERE revoked = false;

-- Cleanup: find expired/revoked tokens for periodic purge
CREATE INDEX idx_refresh_tokens_user
    ON refresh_tokens (user_id, revoked, expires_at);

-- Revoke-all query: find all active tokens for a user
CREATE INDEX idx_refresh_tokens_user_active
    ON refresh_tokens (user_id)
    WHERE revoked = false;
