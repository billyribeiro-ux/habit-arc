-- ============================================================================
-- 011: Seed Data (local development only)
-- ============================================================================
-- Guarded by a DO $$ block that checks for a 'dev' database name or
-- the HABITARC_SEED environment variable. Safe to include in production
-- migration runs — it will no-op.
--
-- To force seeding in any environment:
--   SET habitarc.force_seed = 'true';  (before running migrations)
-- ============================================================================

DO $$
DECLARE
    v_db_name TEXT;
    v_force   TEXT;
    v_user_id UUID;
    v_habit1  UUID;
    v_habit2  UUID;
    v_habit3  UUID;
    v_sub_id  UUID;
BEGIN
    -- Check if we should seed
    SELECT current_database() INTO v_db_name;
    BEGIN
        v_force := current_setting('habitarc.force_seed', true);
    EXCEPTION WHEN OTHERS THEN
        v_force := '';
    END;

    IF v_db_name NOT LIKE '%dev%'
       AND v_db_name NOT LIKE '%test%'
       AND v_db_name NOT LIKE '%local%'
       AND COALESCE(v_force, '') != 'true'
    THEN
        RAISE NOTICE 'Skipping seed data: database "%" is not a dev/test database', v_db_name;
        RETURN;
    END IF;

    RAISE NOTICE 'Seeding development data into database "%"...', v_db_name;

    -- ========================================================================
    -- Feature Entitlements (reference data — always seeded)
    -- ========================================================================
    INSERT INTO feature_entitlements (tier, feature_key, value_int, value_bool, value_text) VALUES
        -- Free tier
        ('free', 'max_habits',           3,    NULL,  NULL),
        ('free', 'analytics_days',       7,    NULL,  NULL),
        ('free', 'heatmap_months',       1,    NULL,  NULL),
        ('free', 'ai_insights_per_week', NULL, NULL,  NULL),  -- NULL = disabled
        ('free', 'data_export',          NULL, false, NULL),
        ('free', 'max_reminders',        1,    NULL,  NULL),
        ('free', 'schedule_types',       NULL, NULL,  'daily'),

        -- Plus tier
        ('plus', 'max_habits',           15,   NULL,  NULL),
        ('plus', 'analytics_days',       30,   NULL,  NULL),
        ('plus', 'heatmap_months',       6,    NULL,  NULL),
        ('plus', 'ai_insights_per_week', 1,    NULL,  NULL),
        ('plus', 'data_export',          NULL, false, NULL),
        ('plus', 'max_reminders',        NULL, NULL,  NULL),  -- NULL = unlimited
        ('plus', 'schedule_types',       NULL, NULL,  'daily,weekly_days,weekly_target'),

        -- Pro tier
        ('pro', 'max_habits',            NULL, NULL,  NULL),  -- NULL = unlimited
        ('pro', 'analytics_days',        365,  NULL,  NULL),
        ('pro', 'heatmap_months',        12,   NULL,  NULL),
        ('pro', 'ai_insights_per_week',  NULL, NULL,  NULL),  -- NULL = unlimited
        ('pro', 'data_export',           NULL, true,  NULL),
        ('pro', 'max_reminders',         NULL, NULL,  NULL),  -- NULL = unlimited
        ('pro', 'schedule_types',        NULL, NULL,  'daily,weekly_days,weekly_target')
    ON CONFLICT (tier, feature_key) DO NOTHING;

    -- ========================================================================
    -- Demo user: alice@example.com / password: "password123"
    -- Argon2id hash of "password123"
    -- ========================================================================
    INSERT INTO users (id, email, password_hash, name, timezone, is_guest, guest_token)
    VALUES (
        '00000000-0000-0000-0000-000000000001'::UUID,
        'alice@example.com',
        -- argon2id hash of "password123" (generated with default params)
        '$argon2id$v=19$m=19456,t=2,p=1$dGVzdHNhbHQ$abc123fakehashfordevonly',
        'Alice Developer',
        'America/New_York',
        false,
        NULL
    ) ON CONFLICT DO NOTHING
    RETURNING id INTO v_user_id;

    -- If user already existed, fetch the id
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id FROM users WHERE email = 'alice@example.com';
    END IF;

    -- Subscription for Alice (Plus tier)
    INSERT INTO subscriptions (id, user_id, tier, status)
    VALUES (
        '00000000-0000-0000-0000-000000000010'::UUID,
        v_user_id,
        'plus',
        'active'
    ) ON CONFLICT DO NOTHING;

    -- ========================================================================
    -- Demo habits
    -- ========================================================================
    INSERT INTO habits (id, user_id, name, description, color, icon, frequency, target_per_day, sort_order)
    VALUES
        ('00000000-0000-0000-0000-000000000101'::UUID, v_user_id,
         'Morning Meditation', '10 minutes of mindfulness', '#6366f1', 'brain',
         'daily', 1, 0),
        ('00000000-0000-0000-0000-000000000102'::UUID, v_user_id,
         'Exercise', '30 min workout', '#ef4444', 'dumbbell',
         'weekly_days', 1, 1),
        ('00000000-0000-0000-0000-000000000103'::UUID, v_user_id,
         'Read', 'Read for 20 minutes', '#22c55e', 'book-open',
         'weekly_target', 1, 2)
    ON CONFLICT DO NOTHING;

    v_habit1 := '00000000-0000-0000-0000-000000000101'::UUID;
    v_habit2 := '00000000-0000-0000-0000-000000000102'::UUID;
    v_habit3 := '00000000-0000-0000-0000-000000000103'::UUID;

    -- Schedule for Exercise: Mon, Wed, Fri
    INSERT INTO habit_schedules (habit_id, day_of_week, times_per_week)
    VALUES
        (v_habit2, 1, NULL),  -- Monday
        (v_habit2, 3, NULL),  -- Wednesday
        (v_habit2, 5, NULL)   -- Friday
    ON CONFLICT DO NOTHING;

    -- Schedule for Read: 4 times per week
    INSERT INTO habit_schedules (habit_id, day_of_week, times_per_week)
    VALUES
        (v_habit3, NULL, 4)
    ON CONFLICT DO NOTHING;

    -- ========================================================================
    -- Demo completions (last 14 days)
    -- ========================================================================
    INSERT INTO habit_completions (habit_id, user_id, local_date_bucket, value)
    SELECT v_habit1, v_user_id, d::DATE, 1
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE - INTERVAL '1 day', '1 day') AS d
    ON CONFLICT DO NOTHING;

    -- Exercise completions on Mon/Wed/Fri of last 2 weeks
    INSERT INTO habit_completions (habit_id, user_id, local_date_bucket, value)
    SELECT v_habit2, v_user_id, d::DATE, 1
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE - INTERVAL '1 day', '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) IN (1, 3, 5)
    ON CONFLICT DO NOTHING;

    -- Read completions: ~4 per week
    INSERT INTO habit_completions (habit_id, user_id, local_date_bucket, value)
    SELECT v_habit3, v_user_id, d::DATE, 1
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE - INTERVAL '1 day', '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) IN (1, 2, 4, 6)
    ON CONFLICT DO NOTHING;

    -- Update streak counters to match seed data
    UPDATE habits SET current_streak = 13, longest_streak = 13, total_completions = 13
    WHERE id = v_habit1;
    UPDATE habits SET current_streak = 4, longest_streak = 4, total_completions = 6
    WHERE id = v_habit2;
    UPDATE habits SET current_streak = 2, longest_streak = 2, total_completions = 8
    WHERE id = v_habit3;

    -- ========================================================================
    -- Demo mood logs (last 7 days)
    -- ========================================================================
    INSERT INTO mood_logs (user_id, local_date_bucket, mood, energy, stress)
    VALUES
        (v_user_id, CURRENT_DATE - 6, 3, 3, 4),
        (v_user_id, CURRENT_DATE - 5, 4, 4, 3),
        (v_user_id, CURRENT_DATE - 4, 4, 3, 3),
        (v_user_id, CURRENT_DATE - 3, 5, 5, 2),
        (v_user_id, CURRENT_DATE - 2, 4, 4, 2),
        (v_user_id, CURRENT_DATE - 1, 3, 3, 3),
        (v_user_id, CURRENT_DATE,     4, 4, 2)
    ON CONFLICT DO NOTHING;

    -- ========================================================================
    -- Demo audit log entries
    -- ========================================================================
    INSERT INTO audit_logs (user_id, action, ip_address, metadata)
    VALUES
        (v_user_id, 'register', '127.0.0.1'::INET, '{"method": "email"}'),
        (v_user_id, 'login', '127.0.0.1'::INET, '{}')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Seed data inserted successfully.';
END $$;
