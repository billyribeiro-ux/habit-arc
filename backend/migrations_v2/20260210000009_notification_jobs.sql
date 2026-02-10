-- ============================================================================
-- 009: Notification Jobs
-- ============================================================================
-- Generic job queue for async notification delivery (push, email).
-- Supports retries with exponential backoff and dead-letter tracking.
--
-- The Tokio interval task polls for pending jobs, processes them, and
-- updates status. Failed jobs are retried up to max_attempts before
-- being moved to dead_letter status.
-- ============================================================================

CREATE TABLE notification_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What triggered this notification
    -- e.g., 'habit_reminder', 'streak_at_risk', 'weekly_review_ready'
    job_type        TEXT NOT NULL,

    -- Delivery channel
    channel         notification_channel NOT NULL DEFAULT 'web_push',

    -- Job lifecycle
    status          job_status NOT NULL DEFAULT 'pending',

    -- Payload: channel-specific data (push subscription, email address, etc.)
    payload         JSONB NOT NULL DEFAULT '{}',

    -- Scheduling
    scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Retry tracking
    attempts        SMALLINT NOT NULL DEFAULT 0,
    max_attempts    SMALLINT NOT NULL DEFAULT 3,
    last_error      TEXT,

    -- Timestamps
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- attempts must be non-negative and <= max_attempts
    CONSTRAINT chk_attempts_range CHECK (
        attempts >= 0 AND attempts <= max_attempts
    ),

    -- max_attempts must be 1..10
    CONSTRAINT chk_max_attempts CHECK (max_attempts BETWEEN 1 AND 10),

    -- job_type must be a known identifier format
    CONSTRAINT chk_job_type_format CHECK (
        job_type ~ '^[a-z][a-z0-9_]*$'
    ),

    -- completed_at only set for terminal states
    CONSTRAINT chk_completed_consistency CHECK (
        (status IN ('completed', 'failed', 'dead_letter') AND completed_at IS NOT NULL)
        OR
        (status IN ('pending', 'running') AND completed_at IS NULL)
    )
);

-- Worker poll: find next pending job that's due
CREATE INDEX idx_notification_jobs_pending
    ON notification_jobs (scheduled_for)
    WHERE status = 'pending';

-- User's notification history
CREATE INDEX idx_notification_jobs_user
    ON notification_jobs (user_id, created_at DESC);

-- Dead letter monitoring
CREATE INDEX idx_notification_jobs_dead_letter
    ON notification_jobs (created_at DESC)
    WHERE status = 'dead_letter';

-- Cleanup: find old completed jobs for periodic purge
CREATE INDEX idx_notification_jobs_cleanup
    ON notification_jobs (completed_at)
    WHERE status IN ('completed', 'failed');

-- Triggers
CREATE TRIGGER trg_notification_jobs_updated_at
    BEFORE UPDATE ON notification_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
