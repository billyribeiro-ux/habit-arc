use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{Datelike, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::completion::{
    Completion, CompletionQuery, CreateCompletionRequest, DailyStats, StreakInfo,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ToggleRequest {
    pub habit_id: Uuid,
    pub completed_date: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct HeatmapQuery {
    pub months: Option<i32>,
}

#[derive(Debug, serde::Serialize)]
pub struct HeatmapEntry {
    pub date: chrono::NaiveDate,
    pub count: i64,
    pub target: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct WeeklyReview {
    pub week_start: chrono::NaiveDate,
    pub week_end: chrono::NaiveDate,
    pub total_completions: i64,
    pub total_possible: i64,
    pub completion_rate: f64,
    pub best_day: Option<String>,
    pub worst_day: Option<String>,
    pub habits: Vec<WeeklyHabitReview>,
}

#[derive(Debug, serde::Serialize)]
pub struct WeeklyHabitReview {
    pub id: Uuid,
    pub name: String,
    pub completed: i64,
    pub possible: i64,
    pub rate: f64,
}

pub async fn create_completion(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateCompletionRequest>,
) -> AppResult<Json<Completion>> {
    // Verify habit ownership
    let _habit = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(body.habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    let completed_date = body.completed_date.unwrap_or_else(|| Utc::now().date_naive());

    // G-23: Validate ±1 day from server-now
    let today = Utc::now().date_naive();
    let diff = (completed_date - today).num_days().abs();
    if diff > 1 {
        return Err(AppError::Validation(
            "completed_date must be within ±1 day of today".into(),
        ));
    }

    let value = body.value.unwrap_or(1);

    // G-12: Idempotent — ON CONFLICT returns existing row
    let completion = sqlx::query_as::<_, Completion>(
        r#"
        INSERT INTO habit_completions (id, habit_id, user_id, local_date_bucket, value, note)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (habit_id, local_date_bucket) DO UPDATE
            SET value = habit_completions.value  -- no-op update to trigger RETURNING
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(body.habit_id)
    .bind(auth_user.id)
    .bind(completed_date)
    .bind(value)
    .bind(&body.note)
    .fetch_one(&state.db)
    .await?;

    // Update streak
    update_streak(&state, body.habit_id).await?;

    // Broadcast via WebSocket
    if let Some(tx) = state.ws_tx.as_ref() {
        let msg = serde_json::json!({
            "type": "completion_changed",
            "user_id": auth_user.id,
            "habit_id": body.habit_id,
            "completion_id": completion.id,
        });
        let _ = tx.send(msg.to_string());
    }

    Ok(Json(completion))
}

pub async fn list_completions(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<CompletionQuery>,
) -> AppResult<Json<Vec<Completion>>> {
    let start = query
        .start_date
        .unwrap_or_else(|| Utc::now().date_naive() - chrono::Duration::days(30));
    let end = query.end_date.unwrap_or_else(|| Utc::now().date_naive());

    let completions = if let Some(habit_id) = query.habit_id {
        sqlx::query_as::<_, Completion>(
            r#"
            SELECT * FROM habit_completions
            WHERE user_id = $1 AND habit_id = $2 AND local_date_bucket BETWEEN $3 AND $4
            ORDER BY local_date_bucket DESC
            "#,
        )
        .bind(auth_user.id)
        .bind(habit_id)
        .bind(start)
        .bind(end)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Completion>(
            r#"
            SELECT * FROM habit_completions
            WHERE user_id = $1 AND local_date_bucket BETWEEN $2 AND $3
            ORDER BY local_date_bucket DESC
            "#,
        )
        .bind(auth_user.id)
        .bind(start)
        .bind(end)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(completions))
}

pub async fn delete_completion(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(completion_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    // G-13: Idempotent delete — return 200 even if already gone
    let completion = sqlx::query_as::<_, Completion>(
        "SELECT * FROM habit_completions WHERE id = $1 AND user_id = $2",
    )
    .bind(completion_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(completion) = completion {
        sqlx::query("DELETE FROM habit_completions WHERE id = $1")
            .bind(completion_id)
            .execute(&state.db)
            .await?;

        update_streak(&state, completion.habit_id).await?;

        if let Some(tx) = state.ws_tx.as_ref() {
            let msg = serde_json::json!({
                "type": "completion_changed",
                "user_id": auth_user.id,
                "habit_id": completion.habit_id,
            });
            let _ = tx.send(msg.to_string());
        }
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// G-11: Toggle completion — creates if missing, deletes if exists
pub async fn toggle_completion(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<ToggleRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify ownership
    let _habit = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(body.habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    let completed_date = body.completed_date.unwrap_or_else(|| Utc::now().date_naive());

    // Check if completion exists
    let existing = sqlx::query_as::<_, Completion>(
        "SELECT * FROM habit_completions WHERE habit_id = $1 AND user_id = $2 AND local_date_bucket = $3",
    )
    .bind(body.habit_id)
    .bind(auth_user.id)
    .bind(completed_date)
    .fetch_optional(&state.db)
    .await?;

    let result = if let Some(existing) = existing {
        // Delete
        sqlx::query("DELETE FROM habit_completions WHERE id = $1")
            .bind(existing.id)
            .execute(&state.db)
            .await?;
        serde_json::json!({ "action": "deleted", "completion_id": existing.id })
    } else {
        // Create
        let completion = sqlx::query_as::<_, Completion>(
            r#"
            INSERT INTO habit_completions (id, habit_id, user_id, local_date_bucket, value)
            VALUES ($1, $2, $3, $4, 1)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(body.habit_id)
        .bind(auth_user.id)
        .bind(completed_date)
        .fetch_one(&state.db)
        .await?;
        serde_json::json!({ "action": "created", "completion_id": completion.id })
    };

    update_streak(&state, body.habit_id).await?;

    // Demo funnel event: first habit toggle (deduplicated)
    if auth_user.is_demo {
        let already = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM demo_events WHERE demo_user_id = $1 AND event_name = 'demo_first_habit_toggle'",
        )
        .bind(auth_user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(1);
        if already == 0 {
            let _ = crate::handlers::demo::track_demo_event(
                &state.db,
                auth_user.id,
                "demo_first_habit_toggle",
                None,
            )
            .await;
        }
    }

    if let Some(tx) = state.ws_tx.as_ref() {
        let msg = serde_json::json!({
            "type": "completion_changed",
            "user_id": auth_user.id,
            "habit_id": body.habit_id,
        });
        let _ = tx.send(msg.to_string());
    }

    Ok(Json(result))
}

/// G-9: Calendar heatmap data
pub async fn get_heatmap(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
    Query(query): Query<HeatmapQuery>,
) -> AppResult<Json<Vec<HeatmapEntry>>> {
    let habit = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    let months = query.months.unwrap_or(3).min(12);
    let start_date = Utc::now().date_naive() - chrono::Duration::days(months as i64 * 30);
    let end_date = Utc::now().date_naive();

    let rows = sqlx::query_as::<_, (chrono::NaiveDate, i64)>(
        r#"
        SELECT local_date_bucket, COALESCE(SUM(value), 0) as count
        FROM habit_completions
        WHERE habit_id = $1 AND user_id = $2 AND local_date_bucket BETWEEN $3 AND $4
        GROUP BY local_date_bucket
        ORDER BY local_date_bucket ASC
        "#,
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<HeatmapEntry> = rows
        .into_iter()
        .map(|(date, count)| HeatmapEntry {
            date,
            count,
            target: habit.target_per_day,
        })
        .collect();

    Ok(Json(entries))
}

/// G-10: Weekly review summary
pub async fn get_weekly_review(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<WeeklyReview>> {
    let today = Utc::now().date_naive();
    // ISO week: Monday to Sunday
    let days_since_monday = today.weekday().num_days_from_monday();
    let week_start = today - chrono::Duration::days(days_since_monday as i64 + 7); // last Monday
    let week_end = week_start + chrono::Duration::days(6); // last Sunday

    let habits = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE user_id = $1 AND is_archived = false",
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    let completions = sqlx::query_as::<_, Completion>(
        r#"
        SELECT * FROM habit_completions
        WHERE user_id = $1 AND local_date_bucket BETWEEN $2 AND $3
        "#,
    )
    .bind(auth_user.id)
    .bind(week_start)
    .bind(week_end)
    .fetch_all(&state.db)
    .await?;

    let mut habit_reviews = Vec::new();
    let mut total_completions: i64 = 0;
    let mut total_possible: i64 = 0;

    for habit in &habits {
        let completed = completions
            .iter()
            .filter(|c| c.habit_id == habit.id)
            .count() as i64;
        // For daily habits, possible = 7. For weekly_days, possible = scheduled days count.
        let possible: i64 = match habit.frequency {
            crate::models::habit::HabitFrequency::Daily => 7,
            crate::models::habit::HabitFrequency::WeeklyDays => {
                habit.frequency_config
                    .get("days")
                    .and_then(|d| d.as_array())
                    .map(|a| a.len() as i64)
                    .unwrap_or(7)
            }
            crate::models::habit::HabitFrequency::WeeklyTarget => {
                habit.frequency_config
                    .get("times_per_week")
                    .and_then(|t| t.as_i64())
                    .unwrap_or(1)
            }
        };
        let rate = if possible > 0 {
            completed as f64 / possible as f64
        } else {
            0.0
        };
        total_completions += completed;
        total_possible += possible;
        habit_reviews.push(WeeklyHabitReview {
            id: habit.id,
            name: habit.name.clone(),
            completed,
            possible,
            rate,
        });
    }

    // Best/worst day by completion count
    let day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    let mut day_counts = [0i64; 7];
    for c in &completions {
        let dow = c.completed_date.weekday().num_days_from_monday() as usize;
        if dow < 7 {
            day_counts[dow] += 1;
        }
    }

    let best_day = day_counts
        .iter()
        .enumerate()
        .max_by_key(|(_, &count)| count)
        .map(|(i, _)| day_names[i].to_string());
    let worst_day = day_counts
        .iter()
        .enumerate()
        .min_by_key(|(_, &count)| count)
        .map(|(i, _)| day_names[i].to_string());

    let completion_rate = if total_possible > 0 {
        total_completions as f64 / total_possible as f64
    } else {
        0.0
    };

    Ok(Json(WeeklyReview {
        week_start,
        week_end,
        total_completions,
        total_possible,
        completion_rate,
        best_day,
        worst_day,
        habits: habit_reviews,
    }))
}

pub async fn get_streak(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
) -> AppResult<Json<StreakInfo>> {
    // Verify ownership
    let habit = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    let thirty_days_ago = Utc::now().date_naive() - chrono::Duration::days(30);
    let days_with_completions = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(DISTINCT local_date_bucket) FROM habit_completions
        WHERE habit_id = $1 AND local_date_bucket >= $2
        "#,
    )
    .bind(habit_id)
    .bind(thirty_days_ago)
    .fetch_one(&state.db)
    .await?;

    let completion_rate = days_with_completions as f64 / 30.0;

    Ok(Json(StreakInfo {
        habit_id,
        current_streak: habit.current_streak,
        longest_streak: habit.longest_streak,
        total_completions: habit.total_completions,
        completion_rate_30d: completion_rate,
    }))
}

pub async fn get_daily_stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<CompletionQuery>,
) -> AppResult<Json<Vec<DailyStats>>> {
    let start = query
        .start_date
        .unwrap_or_else(|| Utc::now().date_naive() - chrono::Duration::days(30));
    let end = query.end_date.unwrap_or_else(|| Utc::now().date_naive());

    let stats = sqlx::query_as::<_, DailyStats>(
        r#"
        WITH dates AS (
            SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS date
        ),
        active_habits AS (
            SELECT COUNT(*) AS total FROM habits
            WHERE user_id = $1 AND is_archived = false
        ),
        daily_completions AS (
            SELECT local_date_bucket, COUNT(DISTINCT habit_id) AS completed
            FROM habit_completions
            WHERE user_id = $1 AND local_date_bucket BETWEEN $2 AND $3
            GROUP BY local_date_bucket
        )
        SELECT
            d.date,
            ah.total AS total_habits,
            COALESCE(dc.completed, 0) AS completed_habits,
            CASE WHEN ah.total > 0
                THEN COALESCE(dc.completed, 0)::float / ah.total::float
                ELSE 0.0
            END AS completion_rate
        FROM dates d
        CROSS JOIN active_habits ah
        LEFT JOIN daily_completions dc ON dc.local_date_bucket = d.date
        ORDER BY d.date ASC
        "#,
    )
    .bind(auth_user.id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(stats))
}

async fn update_streak(state: &AppState, habit_id: Uuid) -> AppResult<()> {
    // Calculate current streak by finding consecutive days with completions ending today
    let today = Utc::now().date_naive();

    let dates = sqlx::query_scalar::<_, chrono::NaiveDate>(
        r#"
        SELECT DISTINCT local_date_bucket FROM habit_completions
        WHERE habit_id = $1
        ORDER BY local_date_bucket DESC
        "#,
    )
    .bind(habit_id)
    .fetch_all(&state.db)
    .await?;

    let mut current_streak = 0i32;
    let mut check_date = today;

    for date in &dates {
        if *date == check_date {
            current_streak += 1;
            check_date -= chrono::Duration::days(1);
        } else if *date < check_date {
            break;
        }
    }

    // Calculate longest streak
    let mut longest_streak = 0i32;
    let mut streak = 0i32;
    let mut prev_date: Option<chrono::NaiveDate> = None;

    for date in dates.iter().rev() {
        if let Some(prev) = prev_date {
            if *date == prev + chrono::Duration::days(1) {
                streak += 1;
            } else {
                longest_streak = longest_streak.max(streak);
                streak = 1;
            }
        } else {
            streak = 1;
        }
        prev_date = Some(*date);
    }
    longest_streak = longest_streak.max(streak);

    let total_completions = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(value), 0) FROM habit_completions WHERE habit_id = $1",
    )
    .bind(habit_id)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        r#"
        UPDATE habits SET
            current_streak = $2,
            longest_streak = GREATEST(longest_streak, $3),
            total_completions = $4,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(habit_id)
    .bind(current_streak)
    .bind(longest_streak)
    .bind(total_completions)
    .execute(&state.db)
    .await?;

    Ok(())
}
