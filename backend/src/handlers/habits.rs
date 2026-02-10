use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{Datelike, Utc};
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::habit::{CreateHabitRequest, Habit, HabitWithStatus, UpdateHabitRequest};
use crate::AppState;

pub async fn list_habits(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<HabitWithStatus>>> {
    // Get user timezone for date calculations
    let _user_tz_str = sqlx::query_scalar::<_, String>(
        "SELECT timezone FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| "UTC".to_string());

    let today = Utc::now().date_naive();

    let habits = sqlx::query_as::<_, Habit>(
        r#"
        SELECT * FROM habits
        WHERE user_id = $1 AND is_archived = false
        ORDER BY sort_order ASC, created_at ASC
        "#,
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    let mut result = Vec::with_capacity(habits.len());
    for habit in habits {
        let completed_today = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COALESCE(SUM(value), 0) FROM habit_completions
            WHERE habit_id = $1 AND local_date_bucket = $2
            "#,
        )
        .bind(habit.id)
        .bind(today)
        .fetch_one(&state.db)
        .await? as i32;

        let is_complete = completed_today >= habit.target_per_day;
        let is_due_today = compute_is_due_today(&habit, today);
        result.push(HabitWithStatus {
            habit,
            completed_today,
            is_complete,
            is_due_today,
        });
    }

    Ok(Json(result))
}

pub async fn get_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
) -> AppResult<Json<Habit>> {
    let habit = sqlx::query_as::<_, Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    Ok(Json(habit))
}

pub async fn create_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateHabitRequest>,
) -> AppResult<Json<Habit>> {
    if body.name.is_empty() {
        return Err(AppError::Validation("Habit name is required".into()));
    }

    // Enforce free-tier limit: max 5 habits
    let habit_count =
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_archived = false",
        )
        .bind(auth_user.id)
        .fetch_one(&state.db)
        .await?;

    let user_tier = sqlx::query_scalar::<_, crate::models::user::SubscriptionTier>(
        "SELECT subscription_tier FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    let max_habits: Option<i64> = match user_tier {
        crate::models::user::SubscriptionTier::Free => Some(3),
        crate::models::user::SubscriptionTier::Plus => Some(15),
        crate::models::user::SubscriptionTier::Pro => None, // unlimited
    };

    if let Some(limit) = max_habits {
        if habit_count >= limit {
            return Err(AppError::Forbidden);
        }
    }

    let id = Uuid::new_v4();
    let next_order = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT MAX(sort_order) FROM habits WHERE user_id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0)
        + 1;

    let habit = sqlx::query_as::<_, Habit>(
        r#"
        INSERT INTO habits (id, user_id, name, description, color, icon, frequency, frequency_config, target_per_day, reminder_time, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(auth_user.id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(body.color.as_deref().unwrap_or("#6366f1"))
    .bind(body.icon.as_deref().unwrap_or("target"))
    .bind(body.frequency.as_ref().unwrap_or(&crate::models::habit::HabitFrequency::Daily))
    .bind(body.frequency_config.as_ref().unwrap_or(&serde_json::json!({})))
    .bind(body.target_per_day.unwrap_or(1))
    .bind(&body.reminder_time)
    .bind(next_order)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(habit))
}

pub async fn update_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
    Json(body): Json<UpdateHabitRequest>,
) -> AppResult<Json<Habit>> {
    // Verify ownership
    let _existing = sqlx::query_as::<_, Habit>(
        "SELECT * FROM habits WHERE id = $1 AND user_id = $2",
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Habit not found".into()))?;

    let habit = sqlx::query_as::<_, Habit>(
        r#"
        UPDATE habits SET
            name = COALESCE($3, name),
            description = COALESCE($4, description),
            color = COALESCE($5, color),
            icon = COALESCE($6, icon),
            frequency = COALESCE($7, frequency),
            frequency_config = COALESCE($8, frequency_config),
            target_per_day = COALESCE($9, target_per_day),
            reminder_time = COALESCE($10, reminder_time),
            is_archived = COALESCE($11, is_archived),
            sort_order = COALESCE($12, sort_order),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING *
        "#,
    )
    .bind(habit_id)
    .bind(auth_user.id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.color)
    .bind(&body.icon)
    .bind(&body.frequency)
    .bind(&body.frequency_config)
    .bind(&body.target_per_day)
    .bind(&body.reminder_time)
    .bind(&body.is_archived)
    .bind(&body.sort_order)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(habit))
}

pub async fn delete_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let result = sqlx::query("DELETE FROM habits WHERE id = $1 AND user_id = $2")
        .bind(habit_id)
        .bind(auth_user.id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Habit not found".into()));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Compute whether a habit is due today based on its schedule type.
fn compute_is_due_today(habit: &Habit, today: chrono::NaiveDate) -> bool {
    match habit.frequency {
        crate::models::habit::HabitFrequency::Daily => true,
        crate::models::habit::HabitFrequency::WeeklyDays => {
            // frequency_config: { "days": [1, 3, 5] } where 1=Mon, 7=Sun (ISO 8601)
            if let Some(days) = habit.frequency_config.get("days").and_then(|d| d.as_array()) {
                let today_iso = today.weekday().number_from_monday() as i64;
                days.iter().any(|d| d.as_i64() == Some(today_iso))
            } else {
                true // malformed config → treat as daily
            }
        }
        crate::models::habit::HabitFrequency::WeeklyTarget => {
            // weekly_target habits are always "due" — user picks which days
            true
        }
    }
}
