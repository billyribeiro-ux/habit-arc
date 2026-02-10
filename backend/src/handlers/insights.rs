use axum::{extract::State, Extension, Json};
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::error::AppResult;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct InsightResponse {
    pub summary: String,
    pub wins: Vec<String>,
    pub improvements: Vec<String>,
    pub mood_correlation: Option<String>,
    pub streak_analysis: String,
    pub tip_of_the_week: String,
    pub source: String, // "claude" or "fallback"
}

pub async fn get_insights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<InsightResponse>> {
    // Gather user's habit data for the last 30 days
    let today = chrono::Utc::now().date_naive();
    let thirty_days_ago = today - chrono::Duration::days(30);

    let habits = sqlx::query_as::<_, crate::models::habit::Habit>(
        "SELECT * FROM habits WHERE user_id = $1 AND is_archived = false",
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    let completions = sqlx::query_as::<_, crate::models::completion::Completion>(
        r#"
        SELECT * FROM habit_completions
        WHERE user_id = $1 AND local_date_bucket BETWEEN $2 AND $3
        ORDER BY local_date_bucket DESC
        "#,
    )
    .bind(auth_user.id)
    .bind(thirty_days_ago)
    .bind(today)
    .fetch_all(&state.db)
    .await?;

    // Build context for Claude
    let habit_summary: Vec<String> = habits
        .iter()
        .map(|h| {
            let completions_for_habit = completions
                .iter()
                .filter(|c| c.habit_id == h.id)
                .count();
            format!(
                "- {} (streak: {}, completions last 30d: {}, target/day: {})",
                h.name, h.current_streak, completions_for_habit, h.target_per_day
            )
        })
        .collect();

    let prompt = format!(
        r#"You are a habit coaching AI. Analyze this user's habit data from the last 30 days and provide actionable insights.

Habits:
{}

Total completions in period: {}

Provide a JSON response with this exact schema:
{{
  "summary": "2-3 sentence progress summary",
  "wins": ["specific win 1", "specific win 2"],
  "improvements": ["actionable suggestion 1", "actionable suggestion 2", "actionable suggestion 3"],
  "mood_correlation": "correlation insight or null",
  "streak_analysis": "pattern analysis",
  "tip_of_the_week": "one specific tip"
}}"#,
        habit_summary.join("\n"),
        completions.len()
    );

    // Demo mode: enforce AI call cap (atomic check-and-increment)
    if auth_user.is_demo {
        let updated = sqlx::query_scalar::<_, i32>(
            r#"
            UPDATE users SET demo_insight_calls_used = demo_insight_calls_used + 1
            WHERE id = $1 AND demo_insight_calls_used < $2
            RETURNING demo_insight_calls_used
            "#,
        )
        .bind(auth_user.id)
        .bind(state.config.demo_max_insight_calls)
        .fetch_optional(&state.db)
        .await?;

        if updated.is_none() {
            tracing::info!(user_id = %auth_user.id, "Demo insight cap reached, using fallback");
            let insight = generate_fallback_insight(&habits, &completions);
            return Ok(Json(insight));
        }

        // Track demo event
        let _ = crate::handlers::demo::track_demo_event(
            &state.db,
            auth_user.id,
            "demo_insight_generated",
            None,
        )
        .await;
    }

    // Try Claude API, fall back to deterministic if unavailable
    let insight = match call_claude(&state, &prompt).await {
        Ok(mut insight) => {
            insight.source = "claude".to_string();
            insight
        }
        Err(e) => {
            tracing::warn!(error = %e, "Claude API unavailable, using deterministic fallback");
            generate_fallback_insight(&habits, &completions)
        }
    };

    Ok(Json(insight))
}

async fn call_claude(state: &AppState, prompt: &str) -> Result<InsightResponse, anyhow::Error> {
    // B-14: Add 30-second timeout to prevent indefinite hangs
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &state.config.claude_api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": state.config.claude_model,
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        }))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Claude API error {}: {}", status, body);
    }

    let claude_response: serde_json::Value = response.json().await?;
    let text = claude_response["content"][0]["text"]
        .as_str()
        .unwrap_or("{}");

    let mut insight: InsightResponse = serde_json::from_str(text)?;
    insight.source = "claude".to_string();
    Ok(insight)
}

fn generate_fallback_insight(
    habits: &[crate::models::habit::Habit],
    completions: &[crate::models::completion::Completion],
) -> InsightResponse {
    if habits.is_empty() {
        return InsightResponse {
            summary: "You haven't created any habits yet. Start by adding a habit to track!".into(),
            wins: vec![],
            improvements: vec!["Create your first habit to get started".into()],
            mood_correlation: None,
            streak_analysis: "No data available yet.".into(),
            tip_of_the_week: "Start small — one habit, done consistently, beats five habits done sporadically.".into(),
            source: "fallback".into(),
        };
    }

    // Find best and worst habits by completion rate
    let mut habit_rates: Vec<(&crate::models::habit::Habit, f64)> = habits
        .iter()
        .map(|h| {
            let count = completions.iter().filter(|c| c.habit_id == h.id).count() as f64;
            let rate = count / 30.0;
            (h, rate)
        })
        .collect();
    habit_rates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let best = habit_rates.first();
    let worst = habit_rates.last();

    let total_rate = if !habit_rates.is_empty() {
        habit_rates.iter().map(|(_, r)| r).sum::<f64>() / habit_rates.len() as f64
    } else {
        0.0
    };

    let summary = if let (Some((best_h, best_r)), Some((worst_h, _))) = (best, worst) {
        format!(
            "Over the last 30 days, your overall completion rate is {:.0}%. {} is your strongest habit at {:.0}% completion. Consider focusing more on {}.",
            total_rate * 100.0,
            best_h.name,
            best_r * 100.0,
            worst_h.name,
        )
    } else {
        "Keep tracking your habits consistently!".into()
    };

    let mut wins = Vec::new();
    if let Some((h, r)) = best {
        if *r > 0.5 {
            wins.push(format!("{} completed {:.0}% of the time — great consistency!", h.name, r * 100.0));
        }
    }
    let max_streak = habits.iter().map(|h| h.current_streak).max().unwrap_or(0);
    if max_streak > 0 {
        let streak_habit = habits.iter().max_by_key(|h| h.current_streak).unwrap();
        wins.push(format!("{}-day streak on {} — keep it going!", max_streak, streak_habit.name));
    }

    let mut improvements = Vec::new();
    if let Some((h, r)) = worst {
        if *r < 0.5 {
            improvements.push(format!("Try setting a reminder for {} to improve your {:.0}% rate.", h.name, r * 100.0));
        }
    }
    improvements.push("Consider pairing a difficult habit with one you enjoy.".into());
    improvements.push("Track at the same time each day to build automaticity.".into());

    let streak_analysis = if max_streak > 7 {
        format!("Your longest active streak is {} days. Streaks above 7 days indicate strong habit formation.", max_streak)
    } else if max_streak > 0 {
        format!("Your longest active streak is {} days. Focus on not breaking the chain.", max_streak)
    } else {
        "No active streaks. Complete a habit today to start building momentum.".into()
    };

    InsightResponse {
        summary,
        wins,
        improvements,
        mood_correlation: None,
        streak_analysis,
        tip_of_the_week: "The best time to build a habit is right after an existing routine — this is called habit stacking.".into(),
        source: "fallback".into(),
    }
}
