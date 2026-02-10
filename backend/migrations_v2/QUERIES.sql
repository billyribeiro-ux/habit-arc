-- ============================================================================
-- HabitArc — Production SQL Query Snippets
-- ============================================================================
-- These are the core queries used by the Axum handlers. Each is annotated
-- with its SQLx usage pattern and bind parameter types.
--
-- Conventions:
--   $1, $2, ...   = SQLx bind parameters
--   -- BIND:      = documents the Rust type for each parameter
--   -- RETURNS:   = documents the expected row shape
-- ============================================================================


-- ============================================================================
-- 1. TODAY LIST: habits due today with completion status
-- ============================================================================
-- Returns all active habits for a user, annotated with:
--   - completed_today: how many completions exist for today's local_date_bucket
--   - is_complete: completed_today >= target_per_day
--   - is_due_today: whether the habit's schedule includes today
--
-- BIND: $1 = user_id (Uuid), $2 = local_today (NaiveDate)
-- RETURNS: HabitWithStatus rows
-- ============================================================================

SELECT
    h.id,
    h.user_id,
    h.name,
    h.description,
    h.color,
    h.icon,
    h.frequency,
    h.target_per_day,
    h.sort_order,
    h.current_streak,
    h.longest_streak,
    h.total_completions,
    h.deleted_at,
    h.created_at,
    h.updated_at,

    -- How many completions today?
    COALESCE(c.day_count, 0)::INT                          AS completed_today,

    -- Is the daily target met?
    COALESCE(c.day_count, 0) >= h.target_per_day           AS is_complete,

    -- Is this habit scheduled for today?
    CASE h.frequency
        -- Daily: always due
        WHEN 'daily' THEN true

        -- Weekly days: check if today's ISO day_of_week is in the schedule
        WHEN 'weekly_days' THEN EXISTS (
            SELECT 1 FROM habit_schedules hs
            WHERE hs.habit_id = h.id
              AND hs.day_of_week = EXTRACT(ISODOW FROM $2::DATE)::SMALLINT
        )

        -- Weekly target: due if this week's completions < times_per_week
        WHEN 'weekly_target' THEN (
            SELECT COALESCE(wc.week_count, 0) < COALESCE(hs.times_per_week, 1)
            FROM habit_schedules hs
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::INT AS week_count
                FROM habit_completions hc2
                WHERE hc2.habit_id = h.id
                  AND hc2.local_date_bucket >= date_trunc('week', $2::DATE)::DATE
                  AND hc2.local_date_bucket <= $2::DATE
            ) wc ON true
            WHERE hs.habit_id = h.id
              AND hs.times_per_week IS NOT NULL
            LIMIT 1
        )

        ELSE true
    END                                                     AS is_due_today

FROM habits h

-- Left join today's completions (aggregated)
LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS day_count
    FROM habit_completions hc
    WHERE hc.habit_id = h.id
      AND hc.local_date_bucket = $2::DATE
) c ON true

WHERE h.user_id = $1
  AND h.deleted_at IS NULL

ORDER BY h.sort_order, h.created_at;


-- ============================================================================
-- 2. CURRENT STREAK: consecutive scheduled days with completions
-- ============================================================================
-- Walks backwards from today. For 'daily' habits, every calendar day counts.
-- For 'weekly_days', only scheduled days count. For 'weekly_target', each
-- full ISO week where completions >= times_per_week counts as one streak unit.
--
-- This query handles the 'daily' case. weekly_days and weekly_target require
-- application-level logic (see note below).
--
-- BIND: $1 = habit_id (Uuid), $2 = local_today (NaiveDate)
-- RETURNS: { current_streak: i32 }
-- ============================================================================

-- Daily habit: count consecutive days backwards from today
WITH completion_dates AS (
    SELECT DISTINCT local_date_bucket AS d
    FROM habit_completions
    WHERE habit_id = $1
    ORDER BY d DESC
),
streak AS (
    SELECT d,
           d - (ROW_NUMBER() OVER (ORDER BY d DESC))::INT AS grp
    FROM completion_dates
    WHERE d <= $2::DATE
)
SELECT COUNT(*)::INT AS current_streak
FROM streak
WHERE grp = (
    SELECT grp FROM streak WHERE d = $2::DATE
    UNION ALL
    SELECT grp FROM streak WHERE d = ($2::DATE - 1)
    LIMIT 1
);

-- NOTE: For weekly_days habits, the application must:
--   1. Fetch all completion dates for the habit
--   2. Fetch the scheduled days from habit_schedules
--   3. Walk backwards from today, only counting scheduled days
--   4. A gap on a non-scheduled day does NOT break the streak
--
-- For weekly_target habits:
--   1. Group completions by ISO week
--   2. For each week, check if count >= times_per_week
--   3. Count consecutive qualifying weeks backwards from current week


-- ============================================================================
-- 3. LONGEST STREAK: maximum consecutive run in the habit's history
-- ============================================================================
-- Uses the gaps-and-islands technique to find all streaks, then takes the max.
--
-- BIND: $1 = habit_id (Uuid)
-- RETURNS: { longest_streak: i32 }
-- ============================================================================

WITH completion_dates AS (
    SELECT DISTINCT local_date_bucket AS d
    FROM habit_completions
    WHERE habit_id = $1
    ORDER BY d
),
islands AS (
    SELECT d,
           d - (ROW_NUMBER() OVER (ORDER BY d))::INT AS island_id
    FROM completion_dates
),
island_sizes AS (
    SELECT island_id,
           COUNT(*) AS streak_length
    FROM islands
    GROUP BY island_id
)
SELECT COALESCE(MAX(streak_length), 0)::INT AS longest_streak
FROM island_sizes;


-- ============================================================================
-- 4. WEEKLY REVIEW AGGREGATION
-- ============================================================================
-- Summarizes the previous ISO week:
--   - Per-habit: completions vs possible days, completion rate
--   - Overall: total completions, total possible, overall rate
--   - Best/worst day of the week
--
-- BIND: $1 = user_id (Uuid), $2 = week_start (DATE, Monday), $3 = week_end (DATE, Sunday)
-- RETURNS: WeeklyReview composite
-- ============================================================================

-- 4a. Per-habit breakdown
WITH active_habits AS (
    SELECT id, name, color, frequency, target_per_day
    FROM habits
    WHERE user_id = $1
      AND deleted_at IS NULL
      AND created_at < ($3::DATE + 1)::TIMESTAMPTZ
),
week_days AS (
    SELECT d::DATE AS day
    FROM generate_series($2::DATE, $3::DATE, '1 day'::INTERVAL) AS d
),
habit_possible AS (
    -- For each habit, how many days in the week was it scheduled?
    SELECT
        ah.id AS habit_id,
        ah.name,
        ah.color,
        COUNT(wd.day)::INT AS possible
    FROM active_habits ah
    CROSS JOIN week_days wd
    WHERE
        CASE ah.frequency
            WHEN 'daily' THEN true
            WHEN 'weekly_days' THEN EXISTS (
                SELECT 1 FROM habit_schedules hs
                WHERE hs.habit_id = ah.id
                  AND hs.day_of_week = EXTRACT(ISODOW FROM wd.day)::SMALLINT
            )
            WHEN 'weekly_target' THEN true  -- all days count toward target
            ELSE true
        END
    GROUP BY ah.id, ah.name, ah.color
),
habit_completed AS (
    SELECT
        hc.habit_id,
        COUNT(*)::INT AS completed
    FROM habit_completions hc
    WHERE hc.user_id = $1
      AND hc.local_date_bucket BETWEEN $2::DATE AND $3::DATE
    GROUP BY hc.habit_id
)
SELECT
    hp.habit_id                                             AS id,
    hp.name,
    hp.color,
    COALESCE(hcm.completed, 0)                              AS completed,
    hp.possible,
    CASE WHEN hp.possible > 0
         THEN ROUND(COALESCE(hcm.completed, 0)::NUMERIC / hp.possible, 4)
         ELSE 0
    END                                                     AS rate
FROM habit_possible hp
LEFT JOIN habit_completed hcm ON hcm.habit_id = hp.habit_id
ORDER BY rate DESC, hp.name;


-- 4b. Overall stats + best/worst day
WITH daily_counts AS (
    SELECT
        hc.local_date_bucket                                AS day,
        to_char(hc.local_date_bucket, 'Dy')                AS day_name,
        COUNT(*)::INT                                       AS completions
    FROM habit_completions hc
    WHERE hc.user_id = $1
      AND hc.local_date_bucket BETWEEN $2::DATE AND $3::DATE
    GROUP BY hc.local_date_bucket
),
totals AS (
    SELECT
        SUM(completions)::INT                               AS total_completions,
        -- total_possible = sum of (target_per_day * scheduled_days) per habit
        -- simplified: count of active habits * 7 for daily
        (SELECT COUNT(*) FROM habits
         WHERE user_id = $1 AND deleted_at IS NULL)::INT * 7
                                                            AS total_possible
    FROM daily_counts
)
SELECT
    t.total_completions,
    t.total_possible,
    CASE WHEN t.total_possible > 0
         THEN ROUND(t.total_completions::NUMERIC / t.total_possible, 4)
         ELSE 0
    END                                                     AS completion_rate,
    (SELECT day_name FROM daily_counts ORDER BY completions DESC LIMIT 1)
                                                            AS best_day,
    (SELECT day_name FROM daily_counts ORDER BY completions ASC  LIMIT 1)
                                                            AS worst_day,
    $2::DATE                                                AS week_start,
    $3::DATE                                                AS week_end
FROM totals t;


-- ============================================================================
-- 5. HEATMAP: completion density per day for a habit
-- ============================================================================
-- Returns one row per day in the range, with count and target.
-- Zero-fills days with no completions using generate_series.
--
-- BIND: $1 = habit_id (Uuid), $2 = start_date (DATE), $3 = end_date (DATE),
--       $4 = target_per_day (i32)
-- RETURNS: { date: DATE, count: i32, target: i32 }
-- ============================================================================

SELECT
    d::DATE                                                 AS date,
    COALESCE(hc.cnt, 0)::INT                                AS count,
    $4::INT                                                 AS target
FROM generate_series($2::DATE, $3::DATE, '1 day'::INTERVAL) AS d
LEFT JOIN (
    SELECT local_date_bucket, COUNT(*)::INT AS cnt
    FROM habit_completions
    WHERE habit_id = $1
      AND local_date_bucket BETWEEN $2::DATE AND $3::DATE
    GROUP BY local_date_bucket
) hc ON hc.local_date_bucket = d::DATE
ORDER BY d;


-- ============================================================================
-- 6. TOGGLE COMPLETION (idempotent create-or-delete)
-- ============================================================================
-- Step 1: Check if completion exists
-- BIND: $1 = habit_id, $2 = user_id, $3 = local_date_bucket
-- ============================================================================

SELECT id FROM habit_completions
WHERE habit_id = $1 AND user_id = $2 AND local_date_bucket = $3;

-- Step 2a: If exists → DELETE
-- BIND: $1 = completion_id
DELETE FROM habit_completions WHERE id = $1 RETURNING id;

-- Step 2b: If not exists → INSERT (idempotent via ON CONFLICT)
-- BIND: $1 = habit_id, $2 = user_id, $3 = local_date_bucket, $4 = value
INSERT INTO habit_completions (habit_id, user_id, local_date_bucket, value)
VALUES ($1, $2, $3, $4)
ON CONFLICT (habit_id, local_date_bucket) DO UPDATE
    SET value = habit_completions.value  -- no-op update to trigger RETURNING
RETURNING id;


-- ============================================================================
-- 7. MOOD LOG UPSERT (idempotent)
-- ============================================================================
-- BIND: $1 = user_id, $2 = local_date_bucket, $3 = mood, $4 = energy, $5 = stress, $6 = note
-- ============================================================================

INSERT INTO mood_logs (user_id, local_date_bucket, mood, energy, stress, note)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id, local_date_bucket) DO UPDATE SET
    mood   = COALESCE(EXCLUDED.mood,   mood_logs.mood),
    energy = COALESCE(EXCLUDED.energy, mood_logs.energy),
    stress = COALESCE(EXCLUDED.stress, mood_logs.stress),
    note   = COALESCE(EXCLUDED.note,   mood_logs.note)
RETURNING *;


-- ============================================================================
-- 8. DAILY STATS: completion rate per day over a date range
-- ============================================================================
-- BIND: $1 = user_id, $2 = start_date, $3 = end_date
-- RETURNS: { date, total_habits, completed_habits, completion_rate }
-- ============================================================================

WITH active_habit_count AS (
    SELECT COUNT(*)::BIGINT AS total
    FROM habits
    WHERE user_id = $1 AND deleted_at IS NULL
),
daily AS (
    SELECT
        d::DATE AS date,
        (SELECT total FROM active_habit_count) AS total_habits,
        COUNT(DISTINCT hc.habit_id)::BIGINT AS completed_habits
    FROM generate_series($2::DATE, $3::DATE, '1 day'::INTERVAL) AS d
    LEFT JOIN habit_completions hc
        ON hc.user_id = $1
        AND hc.local_date_bucket = d::DATE
    GROUP BY d
)
SELECT
    date,
    total_habits,
    completed_habits,
    CASE WHEN total_habits > 0
         THEN ROUND(completed_habits::NUMERIC / total_habits, 4)
         ELSE 0
    END::FLOAT8 AS completion_rate
FROM daily
ORDER BY date;


-- ============================================================================
-- 9. BRUTE-FORCE DETECTION: count failed logins from an IP
-- ============================================================================
-- BIND: $1 = ip_address (IpAddr), $2 = window (INTERVAL, e.g., '1 hour')
-- RETURNS: { count: i64 }
-- ============================================================================

SELECT COUNT(*) AS failed_count
FROM audit_logs
WHERE ip_address = $1
  AND action = 'login_failed'
  AND created_at > NOW() - $2::INTERVAL;
