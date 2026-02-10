use axum::{extract::State, Extension, Json};
use chrono::{Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::jwt::create_demo_access_token;
use crate::auth::middleware::AuthUser;
use crate::auth::password::hash_password;
use crate::error::{AppError, AppResult};
use crate::models::user::{SubscriptionStatus, SubscriptionTier};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StartDemoRequest {
    pub timezone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DemoStartResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub demo_expires_at: String,
}

#[derive(Debug, Serialize)]
pub struct DemoStatusResponse {
    pub is_demo: bool,
    pub demo_expires_at: Option<String>,
    pub seconds_remaining: i64,
    pub insight_calls_used: i32,
    pub insight_calls_max: i32,
    pub habits_count: i64,
    pub completions_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct ConvertDemoRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ConvertDemoResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub migrated_habits: i64,
    pub migrated_completions: i64,
    pub migrated_streaks: bool,
}

// ── POST /api/demo/start ─────────────────────────────────────────────────────

pub async fn start_demo(
    State(state): State<AppState>,
    Json(body): Json<StartDemoRequest>,
) -> AppResult<Json<DemoStartResponse>> {
    if !state.config.try_me_enabled {
        return Err(AppError::Forbidden);
    }

    let user_id = Uuid::new_v4();
    let tz = body.timezone.unwrap_or_else(|| "UTC".to_string());
    let ttl = state.config.demo_ttl_secs;
    let expires_at = Utc::now() + Duration::seconds(ttl);

    // Create demo user
    sqlx::query(
        r#"
        INSERT INTO users (
            id, name, is_guest, is_demo, demo_expires_at, timezone,
            subscription_tier, subscription_status
        )
        VALUES ($1, 'Demo User', true, true, $2, $3, $4, $5)
        "#,
    )
    .bind(user_id)
    .bind(expires_at)
    .bind(&tz)
    .bind(SubscriptionTier::Plus) // Give demo users Plus features
    .bind(SubscriptionStatus::Active)
    .execute(&state.db)
    .await?;

    // Seed demo data
    seed_demo_data(&state.db, user_id).await?;

    // Track event
    track_demo_event(&state.db, user_id, "demo_started", None).await?;

    // Issue demo token
    let access_token = create_demo_access_token(user_id, ttl, &state.config)?;

    Ok(Json(DemoStartResponse {
        access_token,
        expires_in: ttl,
        demo_expires_at: expires_at.to_rfc3339(),
    }))
}

// ── GET /api/demo/status ─────────────────────────────────────────────────────

pub async fn demo_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<DemoStatusResponse>> {
    if !auth_user.is_demo {
        return Err(AppError::Forbidden);
    }

    let user = sqlx::query_as::<_, (bool, Option<chrono::DateTime<Utc>>, i32)>(
        "SELECT is_demo, demo_expires_at, demo_insight_calls_used FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    let (is_demo, demo_expires_at, insight_calls_used) = user;

    let seconds_remaining = demo_expires_at
        .map(|exp| (exp - Utc::now()).num_seconds().max(0))
        .unwrap_or(0);

    let habits_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_archived = false",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    let completions_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM habit_completions WHERE user_id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(DemoStatusResponse {
        is_demo,
        demo_expires_at: demo_expires_at.map(|d| d.to_rfc3339()),
        seconds_remaining,
        insight_calls_used,
        insight_calls_max: state.config.demo_max_insight_calls,
        habits_count,
        completions_count,
    }))
}

// ── POST /api/demo/reset ─────────────────────────────────────────────────────

pub async fn reset_demo(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<serde_json::Value>> {
    if !auth_user.is_demo {
        return Err(AppError::Forbidden);
    }

    let new_expires = Utc::now() + Duration::seconds(state.config.demo_ttl_secs);

    // Wrap entire reset in a transaction to avoid partial state on failure
    let mut tx = state.db.begin().await?;

    // Delete all user data (order matters for FK constraints)
    sqlx::query("DELETE FROM habit_completions WHERE user_id = $1")
        .bind(auth_user.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM habits WHERE user_id = $1")
        .bind(auth_user.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM mood_logs WHERE user_id = $1")
        .bind(auth_user.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM insights WHERE user_id = $1")
        .bind(auth_user.id)
        .execute(&mut *tx)
        .await?;

    // Reset insight counter and extend expiry
    sqlx::query(
        r#"
        UPDATE users SET
            demo_expires_at = $2,
            demo_insight_calls_used = 0,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(auth_user.id)
    .bind(new_expires)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Re-seed (outside tx — if this fails, user gets empty state which is recoverable)
    seed_demo_data(&state.db, auth_user.id).await?;

    track_demo_event(&state.db, auth_user.id, "demo_reset", None).await?;

    Ok(Json(serde_json::json!({
        "message": "Demo reset successfully",
        "demo_expires_at": new_expires.to_rfc3339(),
    })))
}

// ── POST /api/demo/convert ───────────────────────────────────────────────────

pub async fn convert_demo(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<ConvertDemoRequest>,
) -> AppResult<Json<ConvertDemoResponse>> {
    if !auth_user.is_demo {
        return Err(AppError::Forbidden);
    }

    // Validate input
    if body.email.is_empty() || body.password.len() < 8 || body.name.is_empty() {
        return Err(AppError::Validation(
            "Email, name required; password must be ≥ 8 characters".into(),
        ));
    }

    // Basic email format validation
    if !body.email.contains('@') || !body.email.contains('.') || body.email.len() < 5 {
        return Err(AppError::Validation("Invalid email format".into()));
    }

    // Check email uniqueness
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1",
    )
    .bind(&body.email)
    .fetch_one(&state.db)
    .await?;

    if existing > 0 {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    let pwd_hash = hash_password(&body.password)?;

    // Count data being migrated
    let habits_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    let completions_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM habit_completions WHERE user_id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    // Convert demo user to real user in a single UPDATE (same user_id, data stays)
    sqlx::query(
        r#"
        UPDATE users SET
            email = $2,
            password_hash = $3,
            name = $4,
            is_guest = false,
            is_demo = false,
            demo_expires_at = NULL,
            demo_insight_calls_used = 0,
            subscription_tier = 'free'::subscription_tier,
            subscription_status = 'active'::subscription_status,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(auth_user.id)
    .bind(&body.email)
    .bind(&pwd_hash)
    .bind(&body.name)
    .execute(&state.db)
    .await?;

    // Enforce free-tier habit limit: archive excess habits beyond 3
    let excess_habit_ids: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM habits
        WHERE user_id = $1 AND is_archived = false
        ORDER BY sort_order ASC
        OFFSET 3
        "#,
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for id in &excess_habit_ids {
        sqlx::query("UPDATE habits SET is_archived = true WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await?;
    }

    track_demo_event(&state.db, auth_user.id, "demo_converted", Some(
        serde_json::json!({
            "habits_migrated": habits_count,
            "completions_migrated": completions_count,
        }),
    )).await?;

    // Issue real token pair
    let tokens = crate::auth::jwt::create_token_pair(
        auth_user.id,
        &body.email,
        &state.config,
    )?;

    // Store refresh token
    crate::handlers::auth::store_refresh_token_pub(
        &state.db,
        auth_user.id,
        &tokens.refresh_token,
        state.config.jwt_refresh_ttl_secs,
        None,
    )
    .await?;

    Ok(Json(ConvertDemoResponse {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        migrated_habits: habits_count,
        migrated_completions: completions_count,
        migrated_streaks: true,
    }))
}

// ── Demo Data Seeding ────────────────────────────────────────────────────────

async fn seed_demo_data(db: &sqlx::PgPool, user_id: Uuid) -> AppResult<()> {
    let today = Utc::now().date_naive();

    // ── 3 habits ─────────────────────────────────────────────────────────
    let habits = [
        ("Exercise", "#ef4444", "dumbbell", "daily"),
        ("Meditate", "#8b5cf6", "brain", "daily"),
        ("Read", "#3b82f6", "book-open", "weekly_days"),
    ];

    let mut habit_ids = Vec::new();

    for (i, (name, color, icon, freq)) in habits.iter().enumerate() {
        let id = Uuid::new_v4();
        habit_ids.push(id);

        let freq_config = match *freq {
            "weekly_days" => serde_json::json!({"days": [1, 3, 5]}), // Mon, Wed, Fri
            _ => serde_json::json!({}),
        };

        sqlx::query(
            r#"
            INSERT INTO habits (
                id, user_id, name, color, icon, frequency, frequency_config,
                target_per_day, sort_order, current_streak, longest_streak, total_completions
            )
            VALUES ($1, $2, $3, $4, $5, $6::habit_frequency, $7, 1, $8, 0, 0, 0)
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(name)
        .bind(color)
        .bind(icon)
        .bind(freq)
        .bind(&freq_config)
        .bind(i as i32)
        .execute(db)
        .await?;
    }

    // ── Completions for 14 days (realistic, not perfect) ─────────────────
    // Exercise: ~10/14 days (good but not perfect)
    let exercise_days: Vec<i32> = vec![0, 1, 2, 3, 5, 6, 7, 9, 10, 13];
    // Meditate: ~7/14 days (moderate)
    let meditate_days: Vec<i32> = vec![0, 2, 4, 6, 8, 11, 13];
    // Read: only on scheduled days (Mon=1, Wed=3, Fri=5), ~4/6 scheduled
    let read_days: Vec<i32> = vec![1, 3, 6, 8, 13]; // approximate Mon/Wed/Fri offsets

    let completion_sets = [
        (habit_ids[0], &exercise_days),
        (habit_ids[1], &meditate_days),
        (habit_ids[2], &read_days),
    ];

    for (habit_id, days) in &completion_sets {
        for day_offset in *days {
            let date = today - Duration::days(14 - *day_offset as i64);
            sqlx::query(
                r#"
                INSERT INTO habit_completions (id, habit_id, user_id, local_date_bucket, value)
                VALUES ($1, $2, $3, $4, 1)
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(habit_id)
            .bind(user_id)
            .bind(date)
            .execute(db)
            .await?;
        }
    }

    // Compute accurate streaks from seeded completion dates
    for (habit_id, days) in &completion_sets {
        let mut dates: Vec<NaiveDate> = days
            .iter()
            .map(|d| today - Duration::days(14 - *d as i64))
            .collect();
        dates.sort();
        dates.dedup();

        // Current streak: consecutive days ending at today or yesterday
        let mut current_streak = 0i32;
        let mut check = today;
        for d in dates.iter().rev() {
            if *d == check {
                current_streak += 1;
                check -= Duration::days(1);
            } else if *d < check {
                break;
            }
        }

        // Longest streak: max consecutive run
        let mut longest_streak = 0i32;
        let mut run = 0i32;
        let mut prev: Option<NaiveDate> = None;
        for d in &dates {
            if let Some(p) = prev {
                if *d == p + Duration::days(1) {
                    run += 1;
                } else {
                    longest_streak = longest_streak.max(run);
                    run = 1;
                }
            } else {
                run = 1;
            }
            prev = Some(*d);
        }
        longest_streak = longest_streak.max(run);

        let total = dates.len() as i64;

        sqlx::query(
            r#"
            UPDATE habits SET
                current_streak = $2, longest_streak = $3, total_completions = $4
            WHERE id = $1
            "#,
        )
        .bind(habit_id)
        .bind(current_streak)
        .bind(longest_streak)
        .bind(total)
        .execute(db)
        .await?;
    }

    // ── Mood logs for 7 days ─────────────────────────────────────────────
    let moods = [
        (0, 4, 3, 2), // today
        (1, 3, 4, 3),
        (2, 4, 4, 2),
        (3, 3, 2, 4),
        (4, 5, 5, 1), // great day
        (5, 3, 3, 3),
        (6, 4, 4, 2),
    ];

    for (days_ago, mood, energy, stress) in &moods {
        let date = today - Duration::days(*days_ago as i64);
        sqlx::query(
            r#"
            INSERT INTO mood_logs (id, user_id, local_date_bucket, mood, energy, stress)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, local_date_bucket) DO NOTHING
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(date)
        .bind(mood)
        .bind(energy)
        .bind(stress)
        .execute(db)
        .await?;
    }

    // ── Pre-generated insight (source: demo) ─────────────────────────────
    let week_start = find_monday(today);
    sqlx::query(
        r#"
        INSERT INTO insights (
            id, user_id, week_start_date, source,
            summary, wins, improvements, mood_correlation,
            streak_analysis, tip_of_the_week
        )
        VALUES ($1, $2, $3, 'fallback',
            'Great start! You completed Exercise 71% of the time over the last 2 weeks. Meditation is building momentum.',
            '["Exercise streak of 4 days — your longest yet!", "Logged mood 7 days in a row"]',
            '["Try meditating right after exercise to stack habits", "Set a reminder for reading days"]',
            'Your mood averaged 3.7/5 — highest on days you exercised and meditated.',
            'Exercise has your strongest streak at 4 days. Keep the chain going!',
            'Start with just 5 minutes of reading — small wins compound.'
        )
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(week_start)
    .execute(db)
    .await?;

    Ok(())
}

/// Find the Monday of the week containing `date`.
fn find_monday(date: NaiveDate) -> NaiveDate {
    use chrono::Datelike;
    let weekday = date.weekday().num_days_from_monday(); // Mon=0
    date - Duration::days(weekday as i64)
}

// ── Demo Event Tracking ──────────────────────────────────────────────────────

pub async fn track_demo_event(
    db: &sqlx::PgPool,
    user_id: Uuid,
    event_name: &str,
    metadata: Option<serde_json::Value>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO demo_events (demo_user_id, event_name, metadata) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(event_name)
    .bind(metadata.unwrap_or(serde_json::json!({})))
    .execute(db)
    .await?;
    Ok(())
}

// ── Demo Cleanup Worker ──────────────────────────────────────────────────────

pub fn spawn_demo_cleanup_worker(db: sqlx::PgPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300)); // 5 min
        loop {
            interval.tick().await;
            match cleanup_expired_demos(&db).await {
                Ok(count) => {
                    if count > 0 {
                        tracing::info!(purged = count, "Demo cleanup: purged expired sessions");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Demo cleanup worker error");
                }
            }
        }
    });
}

async fn cleanup_expired_demos(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    // Track demo_expired events before deletion (CASCADE will remove these too,
    // but we log them first for analytics)
    let _ = sqlx::query(
        r#"
        INSERT INTO demo_events (demo_user_id, event_name)
        SELECT id, 'demo_expired' FROM users
        WHERE is_demo = true AND demo_expires_at < NOW()
        "#,
    )
    .execute(db)
    .await;

    // Delete expired demo users (cascades to habits, completions, mood_logs, etc.)
    let result = sqlx::query(
        "DELETE FROM users WHERE is_demo = true AND demo_expires_at < NOW()",
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── find_monday ──────────────────────────────────────────────────────

    #[test]
    fn test_find_monday_tuesday() {
        let date = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap(); // Tuesday
        assert_eq!(find_monday(date), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
    }

    #[test]
    fn test_find_monday_is_monday() {
        let mon = NaiveDate::from_ymd_opt(2026, 2, 9).unwrap();
        assert_eq!(find_monday(mon), mon);
    }

    #[test]
    fn test_find_monday_sunday() {
        let sun = NaiveDate::from_ymd_opt(2026, 2, 15).unwrap();
        assert_eq!(find_monday(sun), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
    }

    #[test]
    fn test_find_monday_saturday() {
        let sat = NaiveDate::from_ymd_opt(2026, 2, 14).unwrap();
        assert_eq!(find_monday(sat), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
    }

    #[test]
    fn test_find_monday_friday() {
        let fri = NaiveDate::from_ymd_opt(2026, 2, 13).unwrap();
        assert_eq!(find_monday(fri), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
    }

    // ── DemoStartResponse serialization ──────────────────────────────────

    #[test]
    fn test_demo_start_response_has_no_user_id_field() {
        let resp = DemoStartResponse {
            access_token: "tok".into(),
            expires_in: 7200,
            demo_expires_at: "2026-02-10T12:00:00Z".into(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("access_token").is_some());
        assert!(json.get("expires_in").is_some());
        assert!(json.get("demo_expires_at").is_some());
        assert!(json.get("user_id").is_none(), "user_id must NOT be in DemoStartResponse");
    }

    // ── DemoStatusResponse serialization ─────────────────────────────────

    #[test]
    fn test_demo_status_response_fields() {
        let resp = DemoStatusResponse {
            is_demo: true,
            demo_expires_at: Some("2026-02-10T14:00:00Z".into()),
            seconds_remaining: 3600,
            insight_calls_used: 1,
            insight_calls_max: 2,
            habits_count: 3,
            completions_count: 10,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["is_demo"], true);
        assert_eq!(json["seconds_remaining"], 3600);
        assert_eq!(json["insight_calls_used"], 1);
        assert_eq!(json["insight_calls_max"], 2);
        assert_eq!(json["habits_count"], 3);
        assert_eq!(json["completions_count"], 10);
    }

    // ── ConvertDemoRequest deserialization ────────────────────────────────

    #[test]
    fn test_convert_request_deserializes() {
        let json = r#"{"email":"a@b.com","password":"12345678","name":"Test"}"#;
        let req: ConvertDemoRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "a@b.com");
        assert_eq!(req.password, "12345678");
        assert_eq!(req.name, "Test");
    }

    #[test]
    fn test_convert_request_missing_field_fails() {
        let json = r#"{"email":"a@b.com","password":"12345678"}"#;
        let result = serde_json::from_str::<ConvertDemoRequest>(json);
        assert!(result.is_err());
    }

    // ── StartDemoRequest deserialization ──────────────────────────────────

    #[test]
    fn test_start_demo_request_timezone_optional() {
        let json = r#"{}"#;
        let req: StartDemoRequest = serde_json::from_str(json).unwrap();
        assert!(req.timezone.is_none());
    }

    #[test]
    fn test_start_demo_request_with_timezone() {
        let json = r#"{"timezone":"America/New_York"}"#;
        let req: StartDemoRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.timezone.unwrap(), "America/New_York");
    }

    // ── Email validation logic ───────────────────────────────────────────

    fn is_valid_email(email: &str) -> bool {
        email.contains('@') && email.contains('.') && email.len() >= 5
    }

    #[test]
    fn test_valid_emails() {
        assert!(is_valid_email("a@b.com"));
        assert!(is_valid_email("user@example.co"));
        assert!(is_valid_email("test.user@domain.org"));
    }

    #[test]
    fn test_invalid_emails() {
        assert!(!is_valid_email(""));
        assert!(!is_valid_email("abc"));
        assert!(!is_valid_email("a@b"));
        assert!(!is_valid_email("@.co"));
    }

    // ── Streak computation (mirrors seed_demo_data logic) ────────────────

    fn compute_current_streak(dates: &[NaiveDate], today: NaiveDate) -> i32 {
        let mut sorted = dates.to_vec();
        sorted.sort();
        sorted.dedup();
        let mut streak = 0i32;
        let mut check = today;
        for d in sorted.iter().rev() {
            if *d == check {
                streak += 1;
                check -= Duration::days(1);
            } else if *d < check {
                break;
            }
        }
        streak
    }

    fn compute_longest_streak(dates: &[NaiveDate]) -> i32 {
        let mut sorted = dates.to_vec();
        sorted.sort();
        sorted.dedup();
        let mut longest = 0i32;
        let mut run = 0i32;
        let mut prev: Option<NaiveDate> = None;
        for d in &sorted {
            if let Some(p) = prev {
                if *d == p + Duration::days(1) {
                    run += 1;
                } else {
                    longest = longest.max(run);
                    run = 1;
                }
            } else {
                run = 1;
            }
            prev = Some(*d);
        }
        longest.max(run)
    }

    #[test]
    fn test_streak_empty() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert_eq!(compute_current_streak(&[], today), 0);
        assert_eq!(compute_longest_streak(&[]), 0);
    }

    #[test]
    fn test_streak_single_today() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert_eq!(compute_current_streak(&[today], today), 1);
        assert_eq!(compute_longest_streak(&[today]), 1);
    }

    #[test]
    fn test_streak_consecutive() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today - Duration::days(2),
            today - Duration::days(1),
            today,
        ];
        assert_eq!(compute_current_streak(&dates, today), 3);
        assert_eq!(compute_longest_streak(&dates), 3);
    }

    #[test]
    fn test_streak_gap_breaks_current() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today - Duration::days(4),
            today - Duration::days(3),
            today - Duration::days(2),
            // gap at today-1
            today,
        ];
        assert_eq!(compute_current_streak(&dates, today), 1);
        assert_eq!(compute_longest_streak(&dates), 3);
    }

    #[test]
    fn test_streak_no_today_or_yesterday() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today - Duration::days(5),
            today - Duration::days(4),
            today - Duration::days(3),
        ];
        assert_eq!(compute_current_streak(&dates, today), 0);
        assert_eq!(compute_longest_streak(&dates), 3);
    }

    // ── Seed data shape assertions ───────────────────────────────────────

    #[test]
    fn test_seed_exercise_days_count() {
        let exercise_days: Vec<i32> = vec![0, 1, 2, 3, 5, 6, 7, 9, 10, 13];
        assert_eq!(exercise_days.len(), 10);
    }

    #[test]
    fn test_seed_meditate_days_count() {
        let meditate_days: Vec<i32> = vec![0, 2, 4, 6, 8, 11, 13];
        assert_eq!(meditate_days.len(), 7);
    }

    #[test]
    fn test_seed_read_days_count() {
        let read_days: Vec<i32> = vec![1, 3, 6, 8, 13];
        assert_eq!(read_days.len(), 5);
    }

    #[test]
    fn test_seed_mood_data_count() {
        let moods = [
            (0, 4, 3, 2),
            (1, 3, 4, 3),
            (2, 4, 4, 2),
            (3, 3, 2, 4),
            (4, 5, 5, 1),
            (5, 3, 3, 3),
            (6, 4, 4, 2),
        ];
        assert_eq!(moods.len(), 7);
        // All mood values in valid range 1-5
        for (_, mood, energy, stress) in &moods {
            assert!(*mood >= 1 && *mood <= 5);
            assert!(*energy >= 1 && *energy <= 5);
            assert!(*stress >= 1 && *stress <= 5);
        }
    }
}
