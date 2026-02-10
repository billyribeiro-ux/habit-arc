use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub name: String,
    pub avatar_url: Option<String>,
    pub is_guest: bool,
    pub guest_token: Option<Uuid>,
    pub is_demo: bool,
    pub demo_expires_at: Option<DateTime<Utc>>,
    pub demo_insight_calls_used: i32,
    pub timezone: String,
    pub stripe_customer_id: Option<String>,
    pub subscription_tier: SubscriptionTier,
    pub subscription_status: SubscriptionStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "subscription_tier", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionTier {
    Free,
    Plus,
    Pro,
}

impl Default for SubscriptionTier {
    fn default() -> Self {
        Self::Free
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "subscription_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionStatus {
    Active,
    Trialing,
    PastDue,
    Canceled,
    Inactive,
}

impl Default for SubscriptionStatus {
    fn default() -> Self {
        Self::Inactive
    }
}

#[derive(Debug, Serialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: Option<String>,
    pub name: String,
    pub avatar_url: Option<String>,
    pub is_guest: bool,
    pub is_demo: bool,
    pub demo_expires_at: Option<DateTime<Utc>>,
    pub timezone: String,
    pub subscription_tier: SubscriptionTier,
    pub subscription_status: SubscriptionStatus,
    pub entitlements: UserEntitlements,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserEntitlements {
    pub max_habits: Option<i64>,
    pub schedule_types: Vec<String>,
    pub analytics_days: i32,
    pub heatmap_months: i32,
    pub ai_insights_per_week: Option<i32>,
    pub reminders: RemindersEntitlement,
    pub data_export: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum RemindersEntitlement {
    None,
    Limited(i32),
    Unlimited,
}

impl UserEntitlements {
    pub fn for_tier(tier: &SubscriptionTier) -> Self {
        match tier {
            SubscriptionTier::Free => Self {
                max_habits: Some(3),
                schedule_types: vec!["daily".into()],
                analytics_days: 7,
                heatmap_months: 1,
                ai_insights_per_week: None,
                reminders: RemindersEntitlement::Limited(1),
                data_export: false,
            },
            SubscriptionTier::Plus => Self {
                max_habits: Some(15),
                schedule_types: vec!["daily".into(), "weekly_days".into(), "weekly_target".into()],
                analytics_days: 30,
                heatmap_months: 6,
                ai_insights_per_week: Some(1),
                reminders: RemindersEntitlement::Unlimited,
                data_export: false,
            },
            SubscriptionTier::Pro => Self {
                max_habits: None,
                schedule_types: vec!["daily".into(), "weekly_days".into(), "weekly_target".into()],
                analytics_days: 365,
                heatmap_months: 12,
                ai_insights_per_week: None, // unlimited
                reminders: RemindersEntitlement::Unlimited,
                data_export: true,
            },
        }
    }
}

impl From<User> for UserProfile {
    fn from(u: User) -> Self {
        let entitlements = UserEntitlements::for_tier(&u.subscription_tier);
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            avatar_url: u.avatar_url,
            is_guest: u.is_guest,
            is_demo: u.is_demo,
            demo_expires_at: u.demo_expires_at,
            timezone: u.timezone,
            subscription_tier: u.subscription_tier,
            subscription_status: u.subscription_status,
            entitlements,
            created_at: u.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[allow(dead_code)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
}
