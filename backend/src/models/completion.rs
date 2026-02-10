use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Completion {
    pub id: Uuid,
    pub habit_id: Uuid,
    pub user_id: Uuid,
    #[sqlx(rename = "local_date_bucket")]
    pub completed_date: NaiveDate,
    pub value: i32,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCompletionRequest {
    pub habit_id: Uuid,
    pub completed_date: Option<NaiveDate>,
    pub value: Option<i32>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CompletionQuery {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub habit_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct StreakInfo {
    pub habit_id: Uuid,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_completions: i64,
    pub completion_rate_30d: f64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct DailyStats {
    pub date: NaiveDate,
    pub total_habits: i64,
    pub completed_habits: i64,
    pub completion_rate: f64,
}
