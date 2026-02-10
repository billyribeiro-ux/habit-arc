use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DailyLog {
    pub id: Uuid,
    pub user_id: Uuid,
    pub log_date: NaiveDate,
    pub mood: Option<i32>,
    pub energy: Option<i32>,
    pub stress: Option<i32>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertDailyLogRequest {
    pub log_date: Option<NaiveDate>,
    pub mood: Option<i32>,
    pub energy: Option<i32>,
    pub stress: Option<i32>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DailyLogQuery {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}
