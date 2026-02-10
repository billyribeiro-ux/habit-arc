use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::Utc;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::daily_log::{DailyLog, DailyLogQuery, UpsertDailyLogRequest};
use crate::AppState;

pub async fn upsert_daily_log(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<UpsertDailyLogRequest>,
) -> AppResult<Json<DailyLog>> {
    let log_date = body.log_date.unwrap_or_else(|| Utc::now().date_naive());

    // Validate ranges
    if let Some(mood) = body.mood {
        if !(1..=5).contains(&mood) {
            return Err(AppError::Validation("Mood must be between 1 and 5".into()));
        }
    }
    if let Some(energy) = body.energy {
        if !(1..=5).contains(&energy) {
            return Err(AppError::Validation("Energy must be between 1 and 5".into()));
        }
    }
    if let Some(stress) = body.stress {
        if !(1..=5).contains(&stress) {
            return Err(AppError::Validation("Stress must be between 1 and 5".into()));
        }
    }

    let log = sqlx::query_as::<_, DailyLog>(
        r#"
        INSERT INTO daily_logs (id, user_id, log_date, mood, energy, stress, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, log_date) DO UPDATE SET
            mood = COALESCE($4, daily_logs.mood),
            energy = COALESCE($5, daily_logs.energy),
            stress = COALESCE($6, daily_logs.stress),
            note = COALESCE($7, daily_logs.note),
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(auth_user.id)
    .bind(log_date)
    .bind(body.mood)
    .bind(body.energy)
    .bind(body.stress)
    .bind(&body.note)
    .fetch_one(&state.db)
    .await?;

    // Demo funnel event: first mood log (deduplicated)
    if auth_user.is_demo {
        let already = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM demo_events WHERE demo_user_id = $1 AND event_name = 'demo_first_mood_log'",
        )
        .bind(auth_user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(1);
        if already == 0 {
            let _ = crate::handlers::demo::track_demo_event(
                &state.db,
                auth_user.id,
                "demo_first_mood_log",
                None,
            )
            .await;
        }
    }

    Ok(Json(log))
}

pub async fn list_daily_logs(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<DailyLogQuery>,
) -> AppResult<Json<Vec<DailyLog>>> {
    let start = query
        .start_date
        .unwrap_or_else(|| Utc::now().date_naive() - chrono::Duration::days(30));
    let end = query.end_date.unwrap_or_else(|| Utc::now().date_naive());

    let logs = sqlx::query_as::<_, DailyLog>(
        r#"
        SELECT * FROM daily_logs
        WHERE user_id = $1 AND log_date BETWEEN $2 AND $3
        ORDER BY log_date DESC
        "#,
    )
    .bind(auth_user.id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(logs))
}
