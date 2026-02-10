//! # HabitArc — Request/Response DTOs
//!
//! All API contract types in one module. Each struct maps 1:1 to the JSON
//! shapes documented in `docs/API_CONTRACTS.md`.
//!
//! Conventions:
//! - `*Request`  → deserialized from client JSON body or query params
//! - `*Response` → serialized to client JSON
//! - All validation is expressed via `validator` derive macros
//! - Serde defaults are used for optional fields with known defaults

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::models::user::{SubscriptionTier, SubscriptionStatus, UserEntitlements};
use crate::models::habit::HabitFrequency;

// ============================================================================
// Common
// ============================================================================

/// Standard success message response
#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message: String,
}

/// Standard delete confirmation
#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub deleted: bool,
    pub id: Uuid,
}

/// Stable error envelope — every error response uses this shape
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ============================================================================
// Auth
// ============================================================================

/// POST /api/auth/signup
#[derive(Debug, Deserialize, Validate)]
pub struct SignupRequest {
    #[validate(email(message = "Invalid email format"))]
    #[validate(length(max = 254, message = "Email too long"))]
    pub email: String,

    #[validate(length(min = 8, max = 128, message = "Password must be 8-128 characters"))]
    pub password: String,

    #[validate(length(min = 1, max = 100, message = "Name must be 1-100 characters"))]
    pub name: String,

    /// IANA timezone identifier (e.g., "America/New_York"). Default: "UTC"
    pub timezone: Option<String>,

    /// If present, merges the guest account into this new registration
    pub guest_token: Option<Uuid>,
}

/// POST /api/auth/login
#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(email)]
    pub email: String,

    #[validate(length(min = 1))]
    pub password: String,
}

/// POST /api/auth/refresh
#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// POST /api/auth/guest
#[derive(Debug, Deserialize)]
pub struct GuestRequest {
    pub timezone: Option<String>,
}

/// Response for signup and login
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub user: UserSummary,
}

/// Response for guest session creation
#[derive(Debug, Serialize)]
pub struct GuestAuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub guest_token: Uuid,
    pub user: UserSummary,
}

/// Minimal user info returned in auth responses
#[derive(Debug, Serialize)]
pub struct UserSummary {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub name: String,
    pub is_guest: bool,
    pub timezone: String,
    pub tier: SubscriptionTier,
    pub created_at: DateTime<Utc>,
}

/// GET /api/auth/me — full profile with entitlements
#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub is_guest: bool,
    pub timezone: String,
    pub tier: SubscriptionTier,
    pub status: SubscriptionStatus,
    pub entitlements: UserEntitlements,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Habits
// ============================================================================

/// Schedule configuration — shape depends on frequency type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScheduleConfig {
    /// For weekly_days: which ISO days (1=Mon..7=Sun)
    WeeklyDays { days: Vec<i16> },
    /// For weekly_target: how many times per week
    WeeklyTarget { times_per_week: i16 },
}

/// POST /api/habits
#[derive(Debug, Deserialize, Validate)]
pub struct CreateHabitRequest {
    #[validate(length(min = 1, max = 200, message = "Name must be 1-200 characters"))]
    pub name: String,

    #[validate(length(max = 2000, message = "Description must be under 2000 characters"))]
    pub description: Option<String>,

    /// Hex color code (e.g., "#6366f1"). Default: "#6366f1"
    pub color: Option<String>,

    /// Icon key (e.g., "target", "brain"). Default: "target"
    pub icon: Option<String>,

    /// Schedule frequency. Default: "daily"
    pub frequency: Option<HabitFrequency>,

    /// Schedule configuration. Required if frequency != "daily"
    pub schedule: Option<ScheduleConfig>,

    /// Completions needed per day to mark as done. Default: 1, range: 1-100
    pub target_per_day: Option<i32>,

    /// Optional reminder time (HH:MM:SS)
    pub reminder_time: Option<NaiveTime>,
}

/// PUT /api/habits/{id} — partial update, all fields optional
#[derive(Debug, Deserialize, Validate)]
pub struct UpdateHabitRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: Option<String>,

    #[validate(length(max = 2000))]
    pub description: Option<String>,

    pub color: Option<String>,
    pub icon: Option<String>,
    pub frequency: Option<HabitFrequency>,
    pub schedule: Option<ScheduleConfig>,
    pub target_per_day: Option<i32>,
    pub reminder_time: Option<NaiveTime>,
    pub sort_order: Option<i32>,
}

/// Full habit response (GET /api/habits, POST /api/habits, PUT /api/habits/{id})
#[derive(Debug, Serialize)]
pub struct HabitResponse {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub color: String,
    pub icon: String,
    pub frequency: HabitFrequency,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduleConfig>,
    pub target_per_day: i32,
    pub sort_order: i32,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_completions: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// GET /api/habits/today — habit with today's completion status
#[derive(Debug, Serialize)]
pub struct HabitTodayResponse {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub color: String,
    pub icon: String,
    pub frequency: HabitFrequency,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduleConfig>,
    pub target_per_day: i32,
    pub sort_order: i32,
    pub current_streak: i32,
    pub completed_today: i32,
    pub is_complete: bool,
    pub is_due_today: bool,
}

/// POST /api/habits/{id}/complete
#[derive(Debug, Deserialize)]
pub struct CompleteRequest {
    /// Date to toggle completion for. Default: today in user's timezone.
    /// Must be within ±1 day of server-now.
    pub date: Option<NaiveDate>,
}

/// Completion record returned inside ToggleResponse
#[derive(Debug, Serialize)]
pub struct CompletionRecord {
    pub id: Uuid,
    pub habit_id: Uuid,
    pub local_date_bucket: NaiveDate,
    pub value: i32,
    pub created_at: DateTime<Utc>,
}

/// Streak summary returned inside ToggleResponse
#[derive(Debug, Serialize)]
pub struct StreakSummary {
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_completions: i64,
}

/// Response for POST /api/habits/{id}/complete
#[derive(Debug, Serialize)]
pub struct ToggleResponse {
    /// "created" or "deleted"
    pub action: String,

    /// The completion record (null when action=deleted)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion: Option<CompletionRecord>,

    /// Updated streak counters after the toggle
    pub habit: StreakSummary,
}

/// GET /api/habits/{id}/calendar query params
#[derive(Debug, Deserialize)]
pub struct CalendarQuery {
    /// Number of months to fetch. Default: 3, max: 12 (clamped to tier limit)
    pub months: Option<i32>,
}

/// Single day in the calendar heatmap
#[derive(Debug, Serialize)]
pub struct CalendarEntry {
    pub date: NaiveDate,
    pub count: i32,
    pub target: i32,
}

/// GET /api/habits/{id}/stats
#[derive(Debug, Serialize)]
pub struct HabitStatsResponse {
    pub habit_id: Uuid,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_completions: i64,
    pub completion_rate_30d: f64,
    pub completions_this_week: i32,
    pub target_this_week: i32,
}

// ============================================================================
// Mood
// ============================================================================

/// POST /api/mood
#[derive(Debug, Deserialize, Validate)]
pub struct MoodRequest {
    /// Date for this mood log. Default: today in user's timezone.
    pub date: Option<NaiveDate>,

    /// Mood score 1-5 (1=very bad, 5=very good)
    #[validate(range(min = 1, max = 5, message = "Mood must be 1-5"))]
    pub mood: Option<i16>,

    /// Energy score 1-5
    #[validate(range(min = 1, max = 5, message = "Energy must be 1-5"))]
    pub energy: Option<i16>,

    /// Stress score 1-5 (1=very low, 5=very high)
    #[validate(range(min = 1, max = 5, message = "Stress must be 1-5"))]
    pub stress: Option<i16>,

    /// Free-text note
    #[validate(length(max = 5000, message = "Note must be under 5000 characters"))]
    pub note: Option<String>,
}

/// GET /api/mood query params
#[derive(Debug, Deserialize)]
pub struct MoodQuery {
    /// Range filter: "7d", "14d", "30d", "90d". Default: "7d"
    pub range: Option<String>,
}

/// Mood log response (used in both POST and GET)
#[derive(Debug, Serialize)]
pub struct MoodLogResponse {
    pub id: Uuid,
    pub local_date_bucket: NaiveDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stress: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Insights & Reviews
// ============================================================================

/// Response for POST /api/insights/generate and GET /api/insights/latest
#[derive(Debug, Serialize, Deserialize)]
pub struct InsightResponse {
    pub id: Uuid,
    pub week_start_date: NaiveDate,

    /// "claude" or "fallback"
    pub source: String,

    pub summary: String,
    pub wins: Vec<String>,
    pub improvements: Vec<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood_correlation: Option<String>,

    pub streak_analysis: String,
    pub tip_of_the_week: String,
    pub generated_at: DateTime<Utc>,
}

/// GET /api/reviews/weekly query params
#[derive(Debug, Deserialize)]
pub struct WeeklyReviewQuery {
    /// ISO week format: "YYYY-WNN" (e.g., "2026-W06"). Default: last complete week.
    pub week: Option<String>,
}

/// Overall stats for the week
#[derive(Debug, Serialize)]
pub struct WeeklyOverall {
    pub total_completions: i64,
    pub total_possible: i64,
    pub completion_rate: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_day: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worst_day: Option<String>,
}

/// Per-habit breakdown in weekly review
#[derive(Debug, Serialize)]
pub struct WeeklyHabitBreakdown {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub completed: i64,
    pub possible: i64,
    pub rate: f64,
}

/// GET /api/reviews/weekly response
#[derive(Debug, Serialize)]
pub struct WeeklyReviewResponse {
    pub week_start: NaiveDate,
    pub week_end: NaiveDate,
    pub overall: WeeklyOverall,
    pub habits: Vec<WeeklyHabitBreakdown>,
}

// ============================================================================
// Billing
// ============================================================================

/// POST /api/subscription/checkout
#[derive(Debug, Deserialize)]
pub struct CheckoutRequest {
    /// Stripe Price ID (e.g., "price_1234567890")
    pub price_id: String,

    /// Target tier: "plus" or "pro"
    pub tier: String,
}

/// Response for POST /api/subscription/checkout
#[derive(Debug, Serialize)]
pub struct CheckoutResponse {
    pub checkout_url: String,
}

/// Response for POST /api/subscription/portal
#[derive(Debug, Serialize)]
pub struct PortalResponse {
    pub portal_url: String,
}

/// GET /api/subscription/status
#[derive(Debug, Serialize)]
pub struct SubscriptionStatusResponse {
    pub tier: SubscriptionTier,
    pub status: SubscriptionStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_period_end: Option<DateTime<Utc>>,

    pub cancel_at_period_end: bool,
    pub entitlements: UserEntitlements,
}

/// POST /api/webhook/stripe acknowledgment
#[derive(Debug, Serialize)]
pub struct WebhookAckResponse {
    pub received: bool,
    pub duplicate: bool,
}

// ============================================================================
// System
// ============================================================================

/// GET /health
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
}

/// GET /readyz
#[derive(Debug, Serialize)]
pub struct ReadyzResponse {
    pub status: String,
    pub checks: ReadyzChecks,
}

#[derive(Debug, Serialize)]
pub struct ReadyzChecks {
    pub database: bool,
    pub migrations: bool,
}

// ============================================================================
// Middleware context types
// ============================================================================

/// Injected by require_auth middleware into request extensions
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub is_guest: bool,
    pub tier: SubscriptionTier,
}

/// Injected by require_entitlement middleware into request extensions
#[derive(Debug, Clone)]
pub struct EntitlementContext {
    pub feature_key: String,
    /// None = unlimited
    pub limit: Option<i64>,
    pub allowed: bool,
}

// ============================================================================
// Validation helpers
// ============================================================================

impl MoodRequest {
    /// At least one of mood/energy/stress must be provided
    pub fn validate_at_least_one(&self) -> Result<(), String> {
        if self.mood.is_none() && self.energy.is_none() && self.stress.is_none() {
            return Err("At least one of mood, energy, or stress must be provided".into());
        }
        Ok(())
    }
}

impl MoodQuery {
    /// Parse range string into number of days
    pub fn range_days(&self) -> i64 {
        match self.range.as_deref() {
            Some("7d") | None => 7,
            Some("14d") => 14,
            Some("30d") => 30,
            Some("90d") => 90,
            _ => 7, // default fallback
        }
    }
}

impl CreateHabitRequest {
    /// Validate schedule config matches frequency
    pub fn validate_schedule(&self) -> Result<(), String> {
        let freq = self.frequency.as_ref().unwrap_or(&HabitFrequency::Daily);
        match freq {
            HabitFrequency::Daily => {
                // schedule should be None for daily
                if self.schedule.is_some() {
                    return Err("Daily habits should not have a schedule config".into());
                }
            }
            HabitFrequency::WeeklyDays => match &self.schedule {
                Some(ScheduleConfig::WeeklyDays { days }) => {
                    if days.is_empty() || days.len() > 7 {
                        return Err("weekly_days requires 1-7 days".into());
                    }
                    for d in days {
                        if !(1..=7).contains(d) {
                            return Err(format!("Day {} is invalid; must be 1-7 (Mon-Sun)", d));
                        }
                    }
                }
                _ => return Err("weekly_days frequency requires schedule.days".into()),
            },
            HabitFrequency::WeeklyTarget => match &self.schedule {
                Some(ScheduleConfig::WeeklyTarget { times_per_week }) => {
                    if !(1..=7).contains(times_per_week) {
                        return Err("times_per_week must be 1-7".into());
                    }
                }
                _ => {
                    return Err("weekly_target frequency requires schedule.times_per_week".into())
                }
            },
        }
        Ok(())
    }
}

impl CompleteRequest {
    /// Validate date is within ±1 day of server-now
    pub fn validate_date(&self, server_today: NaiveDate) -> Result<NaiveDate, String> {
        let date = self.date.unwrap_or(server_today);
        let diff = (date - server_today).num_days().abs();
        if diff > 1 {
            return Err("Date must be within ±1 day of today".into());
        }
        Ok(date)
    }
}

impl WeeklyReviewQuery {
    /// Parse "YYYY-WNN" into (year, week_number) or return None for "last week"
    pub fn parse_week(&self) -> Option<(i32, u32)> {
        let w = self.week.as_ref()?;
        let parts: Vec<&str> = w.split("-W").collect();
        if parts.len() != 2 {
            return None;
        }
        let year: i32 = parts[0].parse().ok()?;
        let week: u32 = parts[1].parse().ok()?;
        if !(1..=53).contains(&week) {
            return None;
        }
        Some((year, week))
    }
}
