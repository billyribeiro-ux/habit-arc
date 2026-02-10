use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Habit {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub icon: String,
    pub frequency: HabitFrequency,
    pub frequency_config: serde_json::Value,
    pub target_per_day: i32,
    pub reminder_time: Option<NaiveTime>,
    pub is_archived: bool,
    pub sort_order: i32,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_completions: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "habit_frequency", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum HabitFrequency {
    Daily,
    #[sqlx(rename = "weekly_days")]
    #[serde(rename = "weekly_days")]
    WeeklyDays,
    #[sqlx(rename = "weekly_target")]
    #[serde(rename = "weekly_target")]
    WeeklyTarget,
}

impl Default for HabitFrequency {
    fn default() -> Self {
        Self::Daily
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateHabitRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub frequency: Option<HabitFrequency>,
    pub frequency_config: Option<serde_json::Value>,
    pub target_per_day: Option<i32>,
    pub reminder_time: Option<NaiveTime>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateHabitRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub frequency: Option<HabitFrequency>,
    pub frequency_config: Option<serde_json::Value>,
    pub target_per_day: Option<i32>,
    pub reminder_time: Option<NaiveTime>,
    pub is_archived: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct HabitWithStatus {
    #[serde(flatten)]
    pub habit: Habit,
    pub completed_today: i32,
    pub is_complete: bool,
    pub is_due_today: bool,
}
