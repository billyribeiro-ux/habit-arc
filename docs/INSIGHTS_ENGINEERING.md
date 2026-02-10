# HabitArc — Weekly Insight Generation Engineering

> Principal AI Product Engineer specification.
> Claude API · Async job pipeline · Deterministic fallback · Strict JSON schema
> Safety guardrails · Cost control · Quality rubric

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Input Signal Collection](#2-input-signal-collection)
3. [Output JSON Schema](#3-output-json-schema)
4. [Prompt Templates](#4-prompt-templates)
5. [Safety Policy](#5-safety-policy)
6. [Async Job Pipeline](#6-async-job-pipeline)
7. [Claude API Integration](#7-claude-api-integration)
8. [Validator Implementation](#8-validator-implementation)
9. [Fallback Deterministic Generator](#9-fallback-deterministic-generator)
10. [Storage & Metadata](#10-storage--metadata)
11. [Cost-Control Strategy](#11-cost-control-strategy)
12. [Quality Rubric](#12-quality-rubric)
13. [Entitlement Gating](#13-entitlement-gating)
14. [Gaps in Current Code](#14-gaps-in-current-code)
15. [Implementation: Rust Code](#15-implementation-rust-code)

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     INSIGHT GENERATION PIPELINE                          │
│                                                                          │
│  Trigger: User requests insight (POST /api/insights/generate)            │
│           OR scheduled weekly job (Sunday 23:00 UTC per user TZ)         │
│                                                                          │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────┐                 │
│  │  1. COLLECT  │──►│  2. BUILD    │──►│  3. CALL      │                 │
│  │  Input       │   │  Prompt      │   │  Claude API   │                 │
│  │  Signals     │   │  Template    │   │  (async job)  │                 │
│  └─────────────┘   └──────────────┘   └───────┬───────┘                 │
│                                               │                          │
│                                    ┌──────────┴──────────┐               │
│                                    │                     │               │
│                              Success                  Failure            │
│                                    │                     │               │
│                              ┌─────▼─────┐        ┌─────▼──────┐        │
│                              │ 4. PARSE  │        │ 5. FALLBACK│        │
│                              │ + VALIDATE│        │ Deterministic       │
│                              │ JSON      │        │ Generator  │        │
│                              └─────┬─────┘        └─────┬──────┘        │
│                                    │                     │               │
│                              ┌─────▼─────┐        ┌─────▼──────┐        │
│                              │ Valid?    │        │ source =   │        │
│                              │ Yes → 6  │        │ "fallback" │        │
│                              │ No → 5   │        └─────┬──────┘        │
│                              └───────────┘              │               │
│                                    │                     │               │
│                              ┌─────▼─────────────────────▼──────┐        │
│                              │  6. STORE in insights table      │        │
│                              │  + metadata (model, tokens, etc) │        │
│                              └──────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Evidence-grounded:** Every insight must reference specific data from the user's week. No fabricated patterns.
2. **Supportive, not clinical:** Encouraging tone. Never diagnose, guilt, or shame.
3. **Fail-safe:** If Claude is unavailable, slow, or returns invalid JSON → deterministic fallback. User always gets insights.
4. **Cost-bounded:** Token budget per request, weekly cache, tier-gated generation limits.
5. **Auditable:** Every generation stores model, prompt version, token usage, latency, and source.

---

## 2. Input Signal Collection

### Data Gathered Per Generation

```sql
-- 1. Completions by habit for the last 7 days
SELECT
    h.id, h.name, h.color, h.frequency, h.target_per_day,
    h.current_streak, h.longest_streak,
    COUNT(c.id) AS completions_this_week,
    h.target_per_day * 7 AS possible_this_week
FROM habits h
LEFT JOIN habit_completions c
    ON c.habit_id = h.id
    AND c.local_date_bucket BETWEEN $week_start AND $week_end
WHERE h.user_id = $1 AND h.deleted_at IS NULL AND h.is_archived = false
GROUP BY h.id;

-- 2. Completions by day-of-week (ISO 1=Mon, 7=Sun)
SELECT
    EXTRACT(ISODOW FROM c.local_date_bucket) AS dow,
    COUNT(*) AS completions
FROM habit_completions c
WHERE c.user_id = $1
    AND c.local_date_bucket BETWEEN $week_start AND $week_end
GROUP BY dow
ORDER BY dow;

-- 3. Mood/energy/stress entries for the week
SELECT local_date_bucket, mood, energy, stress, note
FROM mood_logs
WHERE user_id = $1
    AND local_date_bucket BETWEEN $week_start AND $week_end
ORDER BY local_date_bucket;

-- 4. Streak milestones hit this week
SELECT h.name, h.current_streak, h.longest_streak
FROM habits h
WHERE h.user_id = $1
    AND h.current_streak IN (7, 14, 21, 30, 60, 90, 100, 365)
    AND h.deleted_at IS NULL;

-- 5. Previous week's insight (for continuity)
SELECT summary, wins, improvements, tip_of_the_week
FROM insights
WHERE user_id = $1
ORDER BY week_start_date DESC
LIMIT 1;
```

### Rust Input Struct

```rust
#[derive(Debug, Serialize)]
pub struct InsightInput {
    pub week_start: NaiveDate,  // Monday
    pub week_end: NaiveDate,    // Sunday

    pub habits: Vec<HabitWeekData>,
    pub completions_by_dow: [u32; 7],  // index 0=Mon, 6=Sun
    pub mood_entries: Vec<MoodEntry>,
    pub streak_milestones: Vec<StreakMilestone>,
    pub previous_insight: Option<PreviousInsight>,

    // Aggregates
    pub total_completions: u32,
    pub total_possible: u32,
    pub overall_rate: f64,
    pub mood_avg: Option<f64>,
    pub energy_avg: Option<f64>,
    pub stress_avg: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct HabitWeekData {
    pub name: String,
    pub frequency: String,
    pub target_per_day: i32,
    pub completions_this_week: u32,
    pub possible_this_week: u32,
    pub rate: f64,
    pub current_streak: i32,
    pub longest_streak: i32,
}

#[derive(Debug, Serialize)]
pub struct MoodEntry {
    pub date: NaiveDate,
    pub mood: Option<i16>,
    pub energy: Option<i16>,
    pub stress: Option<i16>,
}

#[derive(Debug, Serialize)]
pub struct StreakMilestone {
    pub habit_name: String,
    pub streak_days: i32,
}

#[derive(Debug, Serialize)]
pub struct PreviousInsight {
    pub summary: String,
    pub tip_of_the_week: String,
}
```

---

## 3. Output JSON Schema

### Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "WeeklyInsight",
  "type": "object",
  "required": ["summary", "insights", "recommendation", "metadata"],
  "additionalProperties": false,
  "properties": {
    "summary": {
      "type": "string",
      "minLength": 20,
      "maxLength": 500,
      "description": "2-3 sentence progress overview for the week"
    },
    "insights": {
      "type": "array",
      "minItems": 3,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["type", "title", "body", "confidence", "evidence_window"],
        "additionalProperties": false,
        "properties": {
          "type": {
            "type": "string",
            "enum": ["win", "pattern", "correlation", "opportunity"]
          },
          "title": {
            "type": "string",
            "minLength": 5,
            "maxLength": 80
          },
          "body": {
            "type": "string",
            "minLength": 20,
            "maxLength": 300
          },
          "confidence": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "0.0-1.0 confidence score based on data density"
          },
          "evidence_window": {
            "type": "string",
            "enum": ["this_week", "last_2_weeks", "last_30_days"],
            "description": "Time window the insight draws evidence from"
          },
          "habit_names": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Habits referenced by this insight"
          }
        }
      }
    },
    "recommendation": {
      "type": "object",
      "required": ["title", "body", "action"],
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string",
          "minLength": 5,
          "maxLength": 80
        },
        "body": {
          "type": "string",
          "minLength": 20,
          "maxLength": 300
        },
        "action": {
          "type": "string",
          "minLength": 10,
          "maxLength": 200,
          "description": "Specific, actionable next step"
        }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["tone_check"],
      "additionalProperties": false,
      "properties": {
        "tone_check": {
          "type": "string",
          "enum": ["supportive", "celebratory", "encouraging", "neutral"],
          "description": "Self-assessed tone of the response"
        },
        "data_quality": {
          "type": "string",
          "enum": ["rich", "moderate", "sparse"],
          "description": "How much data was available for analysis"
        }
      }
    }
  }
}
```

### Insight Types

| Type | When Used | Example |
|---|---|---|
| `win` | Habit completed ≥80% or streak milestone hit | "Your 14-day meditation streak shows real commitment" |
| `pattern` | Day-of-week or time pattern detected | "You tend to complete more habits on weekdays than weekends" |
| `correlation` | Mood/energy correlates with completion rate | "On days you logged higher energy, you completed 40% more habits" |
| `opportunity` | Habit below 50% rate or declining trend | "Reading dropped to 2/7 this week — consider a smaller daily target" |

### Confidence Score Guidelines

| Score | Meaning | Data Requirement |
|---|---|---|
| 0.9–1.0 | High confidence | ≥6 data points in window, clear pattern |
| 0.7–0.89 | Moderate confidence | 4-5 data points, likely pattern |
| 0.5–0.69 | Low confidence | 2-3 data points, possible pattern |
| < 0.5 | Not generated | Insufficient data — insight should not be produced |

---

## 4. Prompt Templates

### System Prompt (v1.0)

```
PROMPT_VERSION: "insight-v1.0"
```

```text
You are HabitArc's weekly insight engine. Your role is to analyze a user's habit
tracking data and produce structured, evidence-based insights.

RULES — YOU MUST FOLLOW ALL OF THESE:

1. EVIDENCE ONLY: Every insight must reference specific numbers from the provided
   data. Never invent statistics, trends, or patterns not present in the input.

2. SUPPORTIVE TONE: Use encouraging, warm language. Celebrate progress. Frame
   struggles as opportunities, not failures.

3. SAFETY BOUNDARIES — NEVER DO ANY OF THE FOLLOWING:
   - Diagnose or suggest mental health conditions
   - Use guilt, shame, or negative self-comparison language
   - Claim causation when you can only observe correlation
   - Reference clinical terms (depression, anxiety, disorder, etc.)
   - Suggest the user is "failing" or "falling behind"
   - Make predictions about future behavior with certainty

4. CORRELATION LANGUAGE: When mood/energy data correlates with completions, use
   phrases like "you may have noticed", "the data suggests", "there appears to be
   a connection". Never say "X causes Y" or "because you felt X, you did Y".

5. CONFIDENCE SCORING:
   - 0.9-1.0: Pattern is clear across ≥6 data points
   - 0.7-0.89: Pattern is likely across 4-5 data points
   - 0.5-0.69: Pattern is possible with 2-3 data points
   - Do NOT generate insights with confidence below 0.5

6. RECOMMENDATION: Must be specific, actionable, and achievable within one week.
   Reference a specific habit by name. Never recommend adding more habits.

7. OUTPUT: Respond with ONLY valid JSON matching the schema. No markdown, no
   explanation, no preamble. The JSON must parse cleanly.

8. TONE CHECK: Set metadata.tone_check to the dominant tone of your response.
   If the user had a tough week, use "encouraging". If they crushed it, use
   "celebratory". Default to "supportive".
```

### User Prompt Template (v1.0)

```text
Analyze this user's habit data for the week of {week_start} to {week_end}.

## Habits This Week

{for each habit}
- {habit.name} ({habit.frequency}): {habit.completions_this_week}/{habit.possible_this_week} ({habit.rate:.0%})
  Streak: {habit.current_streak} days (longest ever: {habit.longest_streak})
{end for}

## Overall Stats
- Total completions: {total_completions}/{total_possible} ({overall_rate:.0%})
- Best day: {best_dow_name} ({best_dow_count} completions)
- Weakest day: {worst_dow_name} ({worst_dow_count} completions)

## Completions by Day
Mon: {dow[0]} | Tue: {dow[1]} | Wed: {dow[2]} | Thu: {dow[3]} | Fri: {dow[4]} | Sat: {dow[5]} | Sun: {dow[6]}

## Mood/Energy/Stress Log
{if mood_entries is empty}
No mood data logged this week.
{else}
{for each entry}
- {entry.date}: mood={entry.mood}/5, energy={entry.energy}/5, stress={entry.stress}/5
{end for}
Averages: mood={mood_avg:.1}, energy={energy_avg:.1}, stress={stress_avg:.1}
{end if}

## Streak Milestones
{if milestones is empty}
No milestone streaks this week.
{else}
{for each milestone}
- 🔥 {milestone.habit_name} hit {milestone.streak_days} days!
{end for}
{end if}

## Previous Week's Tip
{if previous_insight}
Last week's recommendation was: "{previous_insight.tip_of_the_week}"
{else}
This is the user's first insight.
{end if}

Respond with ONLY the JSON object. No other text.
```

### Prompt Rendering (Rust)

```rust
pub fn render_insight_prompt(input: &InsightInput) -> (String, String) {
    let system = SYSTEM_PROMPT_V1.to_string();

    let mut user_parts: Vec<String> = Vec::new();

    // Header
    user_parts.push(format!(
        "Analyze this user's habit data for the week of {} to {}.\n",
        input.week_start, input.week_end
    ));

    // Habits
    user_parts.push("## Habits This Week\n".into());
    for h in &input.habits {
        user_parts.push(format!(
            "- {} ({}): {}/{} ({:.0}%)\n  Streak: {} days (longest ever: {})",
            h.name, h.frequency,
            h.completions_this_week, h.possible_this_week,
            h.rate * 100.0,
            h.current_streak, h.longest_streak,
        ));
    }

    // Overall stats
    let dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let best_dow = input.completions_by_dow.iter()
        .enumerate().max_by_key(|(_, c)| *c).map(|(i, c)| (dow_names[i], c));
    let worst_dow = input.completions_by_dow.iter()
        .enumerate().min_by_key(|(_, c)| *c).map(|(i, c)| (dow_names[i], c));

    user_parts.push(format!(
        "\n## Overall Stats\n- Total completions: {}/{} ({:.0}%)",
        input.total_completions, input.total_possible, input.overall_rate * 100.0,
    ));
    if let (Some((best_name, best_count)), Some((worst_name, worst_count))) = (best_dow, worst_dow) {
        user_parts.push(format!("- Best day: {} ({} completions)", best_name, best_count));
        user_parts.push(format!("- Weakest day: {} ({} completions)", worst_name, worst_count));
    }

    // Completions by day
    user_parts.push(format!(
        "\n## Completions by Day\nMon: {} | Tue: {} | Wed: {} | Thu: {} | Fri: {} | Sat: {} | Sun: {}",
        input.completions_by_dow[0], input.completions_by_dow[1],
        input.completions_by_dow[2], input.completions_by_dow[3],
        input.completions_by_dow[4], input.completions_by_dow[5],
        input.completions_by_dow[6],
    ));

    // Mood
    user_parts.push("\n## Mood/Energy/Stress Log".into());
    if input.mood_entries.is_empty() {
        user_parts.push("No mood data logged this week.".into());
    } else {
        for e in &input.mood_entries {
            user_parts.push(format!(
                "- {}: mood={}/5, energy={}/5, stress={}/5",
                e.date,
                e.mood.map(|v| v.to_string()).unwrap_or("-".into()),
                e.energy.map(|v| v.to_string()).unwrap_or("-".into()),
                e.stress.map(|v| v.to_string()).unwrap_or("-".into()),
            ));
        }
        if let (Some(m), Some(e), Some(s)) = (input.mood_avg, input.energy_avg, input.stress_avg) {
            user_parts.push(format!("Averages: mood={:.1}, energy={:.1}, stress={:.1}", m, e, s));
        }
    }

    // Milestones
    user_parts.push("\n## Streak Milestones".into());
    if input.streak_milestones.is_empty() {
        user_parts.push("No milestone streaks this week.".into());
    } else {
        for m in &input.streak_milestones {
            user_parts.push(format!("- 🔥 {} hit {} days!", m.habit_name, m.streak_days));
        }
    }

    // Previous tip
    user_parts.push("\n## Previous Week's Tip".into());
    if let Some(prev) = &input.previous_insight {
        user_parts.push(format!(
            "Last week's recommendation was: \"{}\"",
            prev.tip_of_the_week
        ));
    } else {
        user_parts.push("This is the user's first insight.".into());
    }

    user_parts.push("\nRespond with ONLY the JSON object. No other text.".into());

    (system, user_parts.join("\n"))
}
```

---

## 5. Safety Policy

### Hard Rules (Enforced by Prompt + Validator)

| # | Rule | Enforcement |
|---|---|---|
| S-1 | **No mental health diagnosis claims** | Prompt rule #3. Validator rejects text containing clinical terms. |
| S-2 | **No guilt/shame language** | Prompt rule #3. Validator checks against blocklist. |
| S-3 | **No fabricated causality** | Prompt rule #4. Validator checks for "because you felt", "caused by". |
| S-4 | **Correlation, not causation** | Prompt rule #4. Required phrasing: "suggests", "appears", "may". |
| S-5 | **No future certainty** | Prompt rule #3. Validator rejects "you will", "you're going to". |
| S-6 | **No comparison to other users** | Prompt rule #3. Validator rejects "other users", "most people". |
| S-7 | **Minimum confidence threshold** | Prompt rule #5. Validator rejects insights with confidence < 0.5. |

### Blocked Term List

```rust
const BLOCKED_TERMS: &[&str] = &[
    // Clinical terms
    "depression", "depressed", "anxiety", "anxious", "disorder",
    "diagnosis", "diagnose", "therapy", "therapist", "medication",
    "mental illness", "mental health condition", "clinical",
    "bipolar", "adhd", "ocd", "ptsd",

    // Guilt/shame language
    "failing", "failure", "pathetic", "lazy", "disappointed in you",
    "you should be ashamed", "you're not trying", "giving up",
    "falling behind", "not good enough", "letting yourself down",

    // Fabricated causality
    "this caused", "because you felt", "your mood made you",
    "stress caused you to", "directly led to",

    // Future certainty
    "you will definitely", "you're going to fail",
    "guaranteed to", "there's no way you",

    // Comparison
    "other users", "most people", "compared to others",
    "average user", "normal people", "everyone else",
];

/// Returns true if the text contains any blocked term (case-insensitive).
pub fn contains_blocked_term(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    BLOCKED_TERMS.iter().find(|term| lower.contains(*term)).copied()
}
```

### Safety Validator

```rust
pub fn validate_safety(insight: &WeeklyInsightOutput) -> Vec<SafetyViolation> {
    let mut violations = Vec::new();

    // Check all text fields
    let all_text = [
        &insight.summary,
        &insight.recommendation.title,
        &insight.recommendation.body,
        &insight.recommendation.action,
    ];

    for text in all_text {
        if let Some(term) = contains_blocked_term(text) {
            violations.push(SafetyViolation {
                field: "text".into(),
                term: term.into(),
                severity: SafetySeverity::Block,
            });
        }
    }

    for (i, ins) in insight.insights.iter().enumerate() {
        if let Some(term) = contains_blocked_term(&ins.title) {
            violations.push(SafetyViolation {
                field: format!("insights[{}].title", i),
                term: term.into(),
                severity: SafetySeverity::Block,
            });
        }
        if let Some(term) = contains_blocked_term(&ins.body) {
            violations.push(SafetyViolation {
                field: format!("insights[{}].body", i),
                term: term.into(),
                severity: SafetySeverity::Block,
            });
        }
        if ins.confidence < 0.5 {
            violations.push(SafetyViolation {
                field: format!("insights[{}].confidence", i),
                term: format!("{:.2}", ins.confidence),
                severity: SafetySeverity::Block,
            });
        }
    }

    violations
}

#[derive(Debug)]
pub struct SafetyViolation {
    pub field: String,
    pub term: String,
    pub severity: SafetySeverity,
}

#[derive(Debug)]
pub enum SafetySeverity {
    Block,  // Reject entire output, use fallback
    Warn,   // Log but allow (future: human review queue)
}
```

---

## 6. Async Job Pipeline

### Architecture

```
┌────────────┐     ┌──────────────┐     ┌────────────────┐
│  Trigger    │────►│  Job Queue   │────►│  Worker        │
│  (API call  │     │  (in-memory  │     │  (Tokio task)  │
│   or cron)  │     │   channel)   │     │                │
└────────────┘     └──────────────┘     └───────┬────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼──────┐
                              │  Claude   │          │  Timeout   │
                              │  API Call │          │  (30s)     │
                              └─────┬─────┘          └─────┬──────┘
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼──────┐
                              │  Parse +  │          │  Retry     │
                              │  Validate │          │  (exp      │
                              │  JSON     │          │  backoff)  │
                              └─────┬─────┘          └─────┬──────┘
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼──────┐
                              │  Safety   │          │  Max 3     │
                              │  Check    │          │  retries   │
                              └─────┬─────┘          └─────┬──────┘
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼──────┐
                              │  Store    │          │  Fallback  │
                              │  Result   │          │  Generator │
                              └───────────┘          └────────────┘
```

### Job Lifecycle

```rust
#[derive(Debug, Clone)]
pub enum InsightJobStatus {
    Pending,
    Running,
    Completed { source: InsightSource },
    Failed { error: String, retries: u32 },
}

#[derive(Debug)]
pub struct InsightJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub week_start: NaiveDate,
    pub status: InsightJobStatus,
    pub created_at: Instant,
    pub attempt: u32,
}
```

### Retry Strategy

```
Attempt 1: Immediate
Attempt 2: Wait 2 seconds
Attempt 3: Wait 8 seconds
After 3 failures: Use fallback deterministic generator
```

```rust
const MAX_RETRIES: u32 = 3;
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(30);

fn retry_delay(attempt: u32) -> Duration {
    // Exponential backoff: 0s, 2s, 8s
    match attempt {
        0 => Duration::ZERO,
        1 => Duration::from_secs(2),
        2 => Duration::from_secs(8),
        _ => Duration::from_secs(8),
    }
}
```

### Worker Implementation

```rust
pub async fn run_insight_job(
    db: &PgPool,
    config: &Config,
    http_client: &reqwest::Client,
    user_id: Uuid,
    week_start: NaiveDate,
) -> AppResult<InsightResult> {
    // 1. Collect input signals
    let input = collect_insight_input(db, user_id, week_start).await?;

    // 2. Check if user has enough data
    if input.habits.is_empty() {
        return Ok(generate_no_data_insight(week_start));
    }

    // 3. Render prompt
    let (system_prompt, user_prompt) = render_insight_prompt(&input);

    // 4. Try Claude with retries
    let mut last_error: Option<String> = None;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(retry_delay(attempt)).await;
        }

        let start = Instant::now();

        match tokio::time::timeout(
            CLAUDE_TIMEOUT,
            call_claude(config, http_client, &system_prompt, &user_prompt),
        ).await {
            Ok(Ok(raw_json)) => {
                let latency = start.elapsed();

                // 5. Parse JSON
                match parse_and_validate_insight(&raw_json, &input) {
                    Ok(insight) => {
                        // 6. Safety check
                        let violations = validate_safety(&insight);
                        if violations.iter().any(|v| matches!(v.severity, SafetySeverity::Block)) {
                            tracing::warn!(
                                user_id = %user_id,
                                violations = ?violations,
                                "Claude output failed safety check, using fallback"
                            );
                            let fallback = generate_fallback_insight(&input);
                            return Ok(InsightResult {
                                output: fallback,
                                source: InsightSource::Fallback,
                                model: config.claude_model.clone(),
                                prompt_version: PROMPT_VERSION.into(),
                                input_tokens: 0,
                                output_tokens: 0,
                                latency_ms: latency.as_millis() as u32,
                                fallback_reason: Some("safety_violation".into()),
                            });
                        }

                        return Ok(InsightResult {
                            output: insight,
                            source: InsightSource::Claude,
                            model: config.claude_model.clone(),
                            prompt_version: PROMPT_VERSION.into(),
                            input_tokens: 0, // populated from Claude response
                            output_tokens: 0,
                            latency_ms: latency.as_millis() as u32,
                            fallback_reason: None,
                        });
                    }
                    Err(e) => {
                        tracing::warn!(
                            attempt = attempt,
                            error = %e,
                            "Claude returned invalid JSON, retrying"
                        );
                        last_error = Some(format!("Validation: {}", e));
                    }
                }
            }
            Ok(Err(e)) => {
                tracing::warn!(attempt = attempt, error = %e, "Claude API error");
                last_error = Some(format!("API: {}", e));
            }
            Err(_) => {
                tracing::warn!(attempt = attempt, "Claude API timeout ({}s)", CLAUDE_TIMEOUT.as_secs());
                last_error = Some("Timeout".into());
            }
        }
    }

    // 7. All retries exhausted → fallback
    tracing::warn!(
        user_id = %user_id,
        last_error = ?last_error,
        "All Claude retries exhausted, using fallback"
    );

    let fallback = generate_fallback_insight(&input);
    Ok(InsightResult {
        output: fallback,
        source: InsightSource::Fallback,
        model: String::new(),
        prompt_version: PROMPT_VERSION.into(),
        input_tokens: 0,
        output_tokens: 0,
        latency_ms: 0,
        fallback_reason: last_error,
    })
}
```

---

## 7. Claude API Integration

### Request

```rust
const PROMPT_VERSION: &str = "insight-v1.0";

async fn call_claude(
    config: &Config,
    client: &reqwest::Client,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ClaudeResponse, anyhow::Error> {
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &config.claude_api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": config.claude_model,
            "max_tokens": 1500,
            "temperature": 0.3,
            "system": system_prompt,
            "messages": [{
                "role": "user",
                "content": user_prompt
            }]
        }))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Claude API {} error: {}", status, body);
    }

    let resp: serde_json::Value = response.json().await?;

    let text = resp["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("No text in Claude response"))?;

    let input_tokens = resp["usage"]["input_tokens"].as_u64().unwrap_or(0);
    let output_tokens = resp["usage"]["output_tokens"].as_u64().unwrap_or(0);

    Ok(ClaudeResponse {
        text: text.to_string(),
        input_tokens: input_tokens as u32,
        output_tokens: output_tokens as u32,
    })
}

struct ClaudeResponse {
    text: String,
    input_tokens: u32,
    output_tokens: u32,
}
```

### Key Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `model` | `claude-sonnet-4-20250514` | Best cost/quality balance for structured output |
| `max_tokens` | 1500 | Sufficient for 3-4 insights + recommendation (~800 tokens typical) |
| `temperature` | 0.3 | Low temperature for consistent, factual output. Not 0.0 to allow natural phrasing variation. |
| `system` | Safety-constrained system prompt | Separates instructions from data |

---

## 8. Validator Implementation

### Three-Stage Validation

```
Stage 1: JSON Parse         → Can we parse it at all?
Stage 2: Schema Validation  → Does it match the required structure?
Stage 3: Semantic Validation → Are the values internally consistent?
```

### Rust Implementation

```rust
use serde::{Deserialize, Serialize};

/// The strict output schema from Claude.
#[derive(Debug, Serialize, Deserialize)]
pub struct WeeklyInsightOutput {
    pub summary: String,
    pub insights: Vec<InsightItem>,
    pub recommendation: Recommendation,
    pub metadata: InsightMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InsightItem {
    #[serde(rename = "type")]
    pub insight_type: InsightType,
    pub title: String,
    pub body: String,
    pub confidence: f64,
    pub evidence_window: EvidenceWindow,
    #[serde(default)]
    pub habit_names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InsightType {
    Win,
    Pattern,
    Correlation,
    Opportunity,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceWindow {
    ThisWeek,
    Last2Weeks,
    Last30Days,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Recommendation {
    pub title: String,
    pub body: String,
    pub action: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InsightMetadata {
    pub tone_check: ToneCheck,
    #[serde(default)]
    pub data_quality: Option<DataQuality>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToneCheck {
    Supportive,
    Celebratory,
    Encouraging,
    Neutral,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataQuality {
    Rich,
    Moderate,
    Sparse,
}

/// Parse and validate Claude's JSON output.
pub fn parse_and_validate_insight(
    raw: &str,
    input: &InsightInput,
) -> Result<WeeklyInsightOutput, ValidationError> {
    // Stage 1: JSON parse
    // Strip markdown code fences if Claude wraps in ```json ... ```
    let cleaned = raw.trim()
        .strip_prefix("```json").unwrap_or(raw.trim())
        .strip_prefix("```").unwrap_or(raw.trim())
        .strip_suffix("```").unwrap_or(raw.trim())
        .trim();

    let output: WeeklyInsightOutput = serde_json::from_str(cleaned)
        .map_err(|e| ValidationError::JsonParse(e.to_string()))?;

    // Stage 2: Schema validation (structural)
    validate_schema(&output)?;

    // Stage 3: Semantic validation (data consistency)
    validate_semantics(&output, input)?;

    Ok(output)
}

fn validate_schema(output: &WeeklyInsightOutput) -> Result<(), ValidationError> {
    // Summary length
    if output.summary.len() < 20 {
        return Err(ValidationError::Schema("summary too short (min 20 chars)".into()));
    }
    if output.summary.len() > 500 {
        return Err(ValidationError::Schema("summary too long (max 500 chars)".into()));
    }

    // Insight count
    if output.insights.len() < 3 {
        return Err(ValidationError::Schema("need at least 3 insights".into()));
    }
    if output.insights.len() > 4 {
        return Err(ValidationError::Schema("max 4 insights".into()));
    }

    // Per-insight validation
    for (i, ins) in output.insights.iter().enumerate() {
        if ins.title.len() < 5 || ins.title.len() > 80 {
            return Err(ValidationError::Schema(format!("insights[{}].title length", i)));
        }
        if ins.body.len() < 20 || ins.body.len() > 300 {
            return Err(ValidationError::Schema(format!("insights[{}].body length", i)));
        }
        if ins.confidence < 0.0 || ins.confidence > 1.0 {
            return Err(ValidationError::Schema(format!("insights[{}].confidence range", i)));
        }
        if ins.confidence < 0.5 {
            return Err(ValidationError::Schema(format!(
                "insights[{}].confidence {:.2} below 0.5 threshold", i, ins.confidence
            )));
        }
    }

    // Recommendation
    if output.recommendation.title.len() < 5 || output.recommendation.title.len() > 80 {
        return Err(ValidationError::Schema("recommendation.title length".into()));
    }
    if output.recommendation.body.len() < 20 || output.recommendation.body.len() > 300 {
        return Err(ValidationError::Schema("recommendation.body length".into()));
    }
    if output.recommendation.action.len() < 10 || output.recommendation.action.len() > 200 {
        return Err(ValidationError::Schema("recommendation.action length".into()));
    }

    Ok(())
}

fn validate_semantics(
    output: &WeeklyInsightOutput,
    input: &InsightInput,
) -> Result<(), ValidationError> {
    // Check that referenced habit names actually exist in the input
    let known_habits: std::collections::HashSet<String> = input.habits
        .iter()
        .map(|h| h.name.to_lowercase())
        .collect();

    for (i, ins) in output.insights.iter().enumerate() {
        for name in &ins.habit_names {
            if !known_habits.contains(&name.to_lowercase()) {
                return Err(ValidationError::Semantic(format!(
                    "insights[{}] references unknown habit '{}'", i, name
                )));
            }
        }
    }

    // If no mood data was provided, there should be no "correlation" insights
    if input.mood_entries.is_empty() {
        let has_correlation = output.insights.iter()
            .any(|i| i.insight_type == InsightType::Correlation);
        if has_correlation {
            return Err(ValidationError::Semantic(
                "correlation insight generated without mood data".into()
            ));
        }
    }

    // At least one "win" insight if overall rate > 50%
    if input.overall_rate > 0.5 {
        let has_win = output.insights.iter()
            .any(|i| i.insight_type == InsightType::Win);
        if !has_win {
            return Err(ValidationError::Semantic(
                "no 'win' insight despite >50% completion rate".into()
            ));
        }
    }

    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("JSON parse error: {0}")]
    JsonParse(String),
    #[error("Schema validation: {0}")]
    Schema(String),
    #[error("Semantic validation: {0}")]
    Semantic(String),
}
```

---

## 9. Fallback Deterministic Generator

The fallback produces insights using pure Rust logic — no LLM call. It must produce output matching the same `WeeklyInsightOutput` schema.

```rust
pub fn generate_fallback_insight(input: &InsightInput) -> WeeklyInsightOutput {
    let mut insights: Vec<InsightItem> = Vec::new();

    // ── Win: Best habit ────────────────────────────────────────
    if let Some(best) = input.habits.iter().max_by(|a, b| {
        a.rate.partial_cmp(&b.rate).unwrap_or(std::cmp::Ordering::Equal)
    }) {
        if best.rate >= 0.5 {
            insights.push(InsightItem {
                insight_type: InsightType::Win,
                title: format!("{} is your strongest habit", best.name),
                body: format!(
                    "You completed {} {}/{} times this week ({:.0}% rate). {}",
                    best.name,
                    best.completions_this_week,
                    best.possible_this_week,
                    best.rate * 100.0,
                    if best.current_streak >= 7 {
                        format!("Your {}-day streak shows real consistency.", best.current_streak)
                    } else {
                        "Keep building on this momentum.".into()
                    }
                ),
                confidence: if best.possible_this_week >= 5 { 0.9 } else { 0.7 },
                evidence_window: EvidenceWindow::ThisWeek,
                habit_names: vec![best.name.clone()],
            });
        }
    }

    // ── Win: Streak milestone ──────────────────────────────────
    for milestone in &input.streak_milestones {
        insights.push(InsightItem {
            insight_type: InsightType::Win,
            title: format!("🔥 {}-day streak on {}", milestone.streak_days, milestone.habit_name),
            body: format!(
                "Reaching {} consecutive days on {} is a significant achievement. \
                 This level of consistency suggests the habit is becoming automatic.",
                milestone.streak_days, milestone.habit_name,
            ),
            confidence: 0.95,
            evidence_window: EvidenceWindow::Last30Days,
            habit_names: vec![milestone.habit_name.clone()],
        });
        if insights.len() >= 4 { break; }
    }

    // ── Pattern: Day-of-week ───────────────────────────────────
    let max_dow = input.completions_by_dow.iter().enumerate()
        .max_by_key(|(_, c)| *c).map(|(i, c)| (i, *c));
    let min_dow = input.completions_by_dow.iter().enumerate()
        .filter(|(_, c)| **c > 0 || input.total_completions > 0)
        .min_by_key(|(_, c)| *c).map(|(i, c)| (i, *c));

    let dow_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    if let (Some((max_i, max_c)), Some((min_i, min_c))) = (max_dow, min_dow) {
        if max_c > min_c && max_i != min_i && insights.len() < 4 {
            insights.push(InsightItem {
                insight_type: InsightType::Pattern,
                title: format!("{} is your most productive day", dow_names[max_i]),
                body: format!(
                    "You completed {} habits on {} vs {} on {}. \
                     Consider scheduling your most important habits on your stronger days.",
                    max_c, dow_names[max_i], min_c, dow_names[min_i],
                ),
                confidence: 0.7,
                evidence_window: EvidenceWindow::ThisWeek,
                habit_names: vec![],
            });
        }
    }

    // ── Correlation: Mood ──────────────────────────────────────
    if !input.mood_entries.is_empty() && input.mood_entries.len() >= 3 && insights.len() < 4 {
        if let Some(mood_avg) = input.mood_avg {
            let mood_label = if mood_avg >= 4.0 { "positive" }
                else if mood_avg >= 3.0 { "moderate" }
                else { "lower" };

            insights.push(InsightItem {
                insight_type: InsightType::Correlation,
                title: format!("Your mood averaged {:.1}/5 this week", mood_avg),
                body: format!(
                    "With a {} average mood of {:.1}/5 across {} logged days, \
                     the data suggests your well-being may be connected to your habit consistency. \
                     Tracking both helps you notice patterns over time.",
                    mood_label, mood_avg, input.mood_entries.len(),
                ),
                confidence: if input.mood_entries.len() >= 5 { 0.7 } else { 0.55 },
                evidence_window: EvidenceWindow::ThisWeek,
                habit_names: vec![],
            });
        }
    }

    // ── Opportunity: Weakest habit ─────────────────────────────
    if let Some(worst) = input.habits.iter().min_by(|a, b| {
        a.rate.partial_cmp(&b.rate).unwrap_or(std::cmp::Ordering::Equal)
    }) {
        if worst.rate < 0.5 && insights.len() < 4 {
            insights.push(InsightItem {
                insight_type: InsightType::Opportunity,
                title: format!("{} has room to grow", worst.name),
                body: format!(
                    "You completed {} {}/{} times this week ({:.0}%). \
                     Consider reducing the daily target or pairing it with a habit you already do consistently.",
                    worst.name,
                    worst.completions_this_week,
                    worst.possible_this_week,
                    worst.rate * 100.0,
                ),
                confidence: if worst.possible_this_week >= 5 { 0.85 } else { 0.65 },
                evidence_window: EvidenceWindow::ThisWeek,
                habit_names: vec![worst.name.clone()],
            });
        }
    }

    // Ensure minimum 3 insights
    while insights.len() < 3 {
        insights.push(InsightItem {
            insight_type: InsightType::Pattern,
            title: "Building your data picture".into(),
            body: format!(
                "With {} total completions this week across {} habits, \
                 you're building a data foundation. The more consistently you track, \
                 the richer your insights will become.",
                input.total_completions, input.habits.len(),
            ),
            confidence: 0.6,
            evidence_window: EvidenceWindow::ThisWeek,
            habit_names: vec![],
        });
    }

    // Truncate to max 4
    insights.truncate(4);

    // ── Recommendation ─────────────────────────────────────────
    let recommendation = if let Some(worst) = input.habits.iter()
        .filter(|h| h.rate < 0.5)
        .min_by(|a, b| a.rate.partial_cmp(&b.rate).unwrap_or(std::cmp::Ordering::Equal))
    {
        Recommendation {
            title: format!("Focus on {} this week", worst.name),
            body: format!(
                "Your {} rate was {:.0}% last week. Small improvements compound — \
                 even one extra completion per week builds momentum.",
                worst.name, worst.rate * 100.0,
            ),
            action: format!(
                "Set a daily reminder for {} at a specific time, \
                 and pair it with something you already do every day.",
                worst.name,
            ),
        }
    } else {
        Recommendation {
            title: "Maintain your strong consistency".into(),
            body: format!(
                "Your overall rate of {:.0}% is excellent. \
                 The key now is protecting your streaks through the weekend.",
                input.overall_rate * 100.0,
            ),
            action: "Pick your longest streak and commit to not breaking it this week. \
                     Write down one specific time and place you'll do it each day.".into(),
        }
    };

    // ── Summary ────────────────────────────────────────────────
    let summary = format!(
        "This week you completed {}/{} habit check-ins ({:.0}% overall). {}{}",
        input.total_completions,
        input.total_possible,
        input.overall_rate * 100.0,
        if input.overall_rate >= 0.8 {
            "That's a strong week — your consistency is paying off. "
        } else if input.overall_rate >= 0.5 {
            "A solid foundation to build on. "
        } else {
            "Every check-in counts, and showing up matters more than perfection. "
        },
        if !input.streak_milestones.is_empty() {
            format!("Highlight: {} hit a {}-day streak!",
                input.streak_milestones[0].habit_name,
                input.streak_milestones[0].streak_days)
        } else if let Some(best) = input.habits.iter().max_by(|a, b|
            a.current_streak.cmp(&b.current_streak))
        {
            if best.current_streak > 0 {
                format!("Your best active streak is {} days on {}.",
                    best.current_streak, best.name)
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    );

    // ── Tone ───────────────────────────────────────────────────
    let tone = if input.overall_rate >= 0.8 { ToneCheck::Celebratory }
        else if input.overall_rate >= 0.5 { ToneCheck::Supportive }
        else { ToneCheck::Encouraging };

    let data_quality = if input.mood_entries.len() >= 5 && input.total_possible >= 14 {
        DataQuality::Rich
    } else if input.total_possible >= 7 {
        DataQuality::Moderate
    } else {
        DataQuality::Sparse
    };

    WeeklyInsightOutput {
        summary,
        insights,
        recommendation,
        metadata: InsightMetadata {
            tone_check: tone,
            data_quality: Some(data_quality),
        },
    }
}
```

---

## 10. Storage & Metadata

### Updated `insights` Table Schema

```sql
-- New migration: extend insights table with metadata columns
ALTER TABLE insights ADD COLUMN insights_json JSONB;
ALTER TABLE insights ADD COLUMN recommendation_json JSONB;
ALTER TABLE insights ADD COLUMN metadata_json JSONB;

-- Generation metadata
ALTER TABLE insights ADD COLUMN model TEXT;
ALTER TABLE insights ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'insight-v1.0';
ALTER TABLE insights ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE insights ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE insights ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE insights ADD COLUMN fallback_reason TEXT;
ALTER TABLE insights ADD COLUMN generation_cost_usd NUMERIC(8,6);
```

### Rust Storage

```rust
#[derive(Debug)]
pub struct InsightResult {
    pub output: WeeklyInsightOutput,
    pub source: InsightSource,
    pub model: String,
    pub prompt_version: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u32,
    pub fallback_reason: Option<String>,
}

pub async fn store_insight(
    db: &PgPool,
    user_id: Uuid,
    week_start: NaiveDate,
    result: &InsightResult,
) -> AppResult<Uuid> {
    let cost = estimate_cost(result.input_tokens, result.output_tokens, &result.model);

    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO insights (
            user_id, week_start_date, source,
            summary, wins, improvements, mood_correlation,
            streak_analysis, tip_of_the_week,
            insights_json, recommendation_json, metadata_json,
            model, prompt_version, input_tokens, output_tokens,
            latency_ms, fallback_reason, generation_cost_usd
        ) VALUES (
            $1, $2, $3::insight_source,
            $4, $5, $6, $7,
            $8, $9,
            $10, $11, $12,
            $13, $14, $15, $16,
            $17, $18, $19
        )
        ON CONFLICT (user_id, week_start_date)
        DO UPDATE SET
            source = EXCLUDED.source,
            summary = EXCLUDED.summary,
            wins = EXCLUDED.wins,
            improvements = EXCLUDED.improvements,
            mood_correlation = EXCLUDED.mood_correlation,
            streak_analysis = EXCLUDED.streak_analysis,
            tip_of_the_week = EXCLUDED.tip_of_the_week,
            insights_json = EXCLUDED.insights_json,
            recommendation_json = EXCLUDED.recommendation_json,
            metadata_json = EXCLUDED.metadata_json,
            model = EXCLUDED.model,
            prompt_version = EXCLUDED.prompt_version,
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens,
            latency_ms = EXCLUDED.latency_ms,
            fallback_reason = EXCLUDED.fallback_reason,
            generation_cost_usd = EXCLUDED.generation_cost_usd
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(week_start)
    .bind(match result.source {
        InsightSource::Claude => "claude",
        InsightSource::Fallback => "fallback",
    })
    // Legacy flat fields (backward compat)
    .bind(&result.output.summary)
    .bind(serde_json::to_value(
        result.output.insights.iter()
            .filter(|i| i.insight_type == InsightType::Win)
            .map(|i| &i.body)
            .collect::<Vec<_>>()
    ).unwrap_or_default())
    .bind(serde_json::to_value(
        result.output.insights.iter()
            .filter(|i| i.insight_type == InsightType::Opportunity)
            .map(|i| &i.body)
            .collect::<Vec<_>>()
    ).unwrap_or_default())
    .bind(result.output.insights.iter()
        .find(|i| i.insight_type == InsightType::Correlation)
        .map(|i| &i.body))
    .bind(&result.output.insights.iter()
        .find(|i| i.insight_type == InsightType::Pattern)
        .map(|i| i.body.as_str())
        .unwrap_or("No patterns detected this week."))
    .bind(&result.output.recommendation.action)
    // New structured fields
    .bind(serde_json::to_value(&result.output.insights).unwrap_or_default())
    .bind(serde_json::to_value(&result.output.recommendation).unwrap_or_default())
    .bind(serde_json::to_value(&result.output.metadata).unwrap_or_default())
    // Generation metadata
    .bind(&result.model)
    .bind(&result.prompt_version)
    .bind(result.input_tokens as i32)
    .bind(result.output_tokens as i32)
    .bind(result.latency_ms as i32)
    .bind(&result.fallback_reason)
    .bind(cost)
    .fetch_one(db)
    .await?;

    Ok(id)
}
```

---

## 11. Cost-Control Strategy

### Token Budget

| Component | Budget | Typical |
|---|---|---|
| System prompt | ~400 tokens | Fixed per version |
| User prompt (data) | ~300-600 tokens | Varies by habit count |
| Output | ~600-1000 tokens | 3-4 insights + recommendation |
| **Total per request** | **~1300-2000 tokens** | **~1500 typical** |

### Cost Estimation

```rust
/// Estimate cost in USD based on Claude Sonnet pricing.
/// Prices as of 2026-02: input=$3/MTok, output=$15/MTok
fn estimate_cost(input_tokens: u32, output_tokens: u32, model: &str) -> f64 {
    let (input_rate, output_rate) = match model {
        m if m.contains("haiku") => (0.25 / 1_000_000.0, 1.25 / 1_000_000.0),
        m if m.contains("sonnet") => (3.0 / 1_000_000.0, 15.0 / 1_000_000.0),
        m if m.contains("opus") => (15.0 / 1_000_000.0, 75.0 / 1_000_000.0),
        _ => (3.0 / 1_000_000.0, 15.0 / 1_000_000.0), // default to Sonnet
    };

    (input_tokens as f64 * input_rate) + (output_tokens as f64 * output_rate)
}
```

### Per-Request Cost Estimate

```
Sonnet: ~500 input × $3/MTok + ~800 output × $15/MTok = $0.0135/request
```

### Monthly Cost Projections

| Users | Tier | Generations/Week | Monthly Cost |
|---|---|---|---|
| 100 Plus | 1/week | 400/month | ~$5.40 |
| 50 Pro | unlimited | ~200/month | ~$2.70 |
| 1,000 Plus | 1/week | 4,000/month | ~$54.00 |
| 500 Pro | ~2/week | ~4,000/month | ~$54.00 |
| **10,000 total** | mixed | **~30,000/month** | **~$405** |

### Cost Controls

| Control | Implementation |
|---|---|
| **Weekly cache** | One insight per user per week. Regeneration overwrites, doesn't add. |
| **Tier gating** | Free: 0 AI insights. Plus: 1/week. Pro: unlimited (but still cached per week). |
| **Token cap** | `max_tokens: 1500` hard limit on Claude response. |
| **Prompt efficiency** | Data is pre-aggregated server-side. Raw completions are NOT sent — only aggregates. |
| **Fallback is free** | Deterministic fallback costs $0. Used when Claude fails or user is on Free tier. |
| **Model selection** | Sonnet for production. Haiku for development/testing (~10x cheaper). |
| **Monthly budget alert** | If `SUM(generation_cost_usd)` exceeds threshold → Sentry alert. |

### Budget Alert Query

```sql
-- Monthly cost monitoring
SELECT
    DATE_TRUNC('month', created_at) AS month,
    source,
    COUNT(*) AS generations,
    SUM(input_tokens) AS total_input_tokens,
    SUM(output_tokens) AS total_output_tokens,
    SUM(generation_cost_usd) AS total_cost_usd,
    AVG(latency_ms) AS avg_latency_ms
FROM insights
WHERE created_at > DATE_TRUNC('month', NOW())
GROUP BY month, source;
```

---

## 12. Quality Rubric

### Automated Quality Checks (Run on Every Generation)

| Check | Pass Criteria | Action on Fail |
|---|---|---|
| **JSON valid** | Parses without error | Retry (up to 3x) |
| **Schema match** | All required fields, correct types, length bounds | Retry |
| **Insight count** | 3-4 insights | Retry |
| **Confidence range** | All ≥ 0.5 and ≤ 1.0 | Retry |
| **Safety check** | No blocked terms | Fallback |
| **Semantic: habit names** | All referenced habits exist in input | Retry |
| **Semantic: correlation without mood** | No correlation insight if no mood data | Retry |
| **Semantic: win with good rate** | At least one "win" if overall rate > 50% | Retry |
| **Tone appropriate** | tone_check is set | Accept (log warning if missing) |

### Human Quality Rubric (Periodic Review)

For manual review of a sample of generated insights (e.g., 50/week):

| Dimension | Score 1 (Poor) | Score 3 (Acceptable) | Score 5 (Excellent) |
|---|---|---|---|
| **Accuracy** | References wrong numbers or nonexistent habits | Numbers correct but generic | Numbers correct, specific to user's data |
| **Actionability** | Vague ("try harder") | Somewhat specific ("set a reminder") | Highly specific ("set a 7am reminder for Meditation, right after your morning coffee") |
| **Tone** | Clinical, guilt-inducing, or robotic | Neutral, inoffensive | Warm, encouraging, feels like a supportive coach |
| **Insight depth** | Restates obvious facts ("you did 5/7") | Identifies a pattern | Connects multiple signals (mood + completion + day-of-week) |
| **Safety** | Contains blocked terms or diagnosis language | Safe but borderline phrasing | Clearly within all safety guidelines |
| **Relevance** | Insights don't match user's actual situation | Mostly relevant | Every insight directly addresses user's specific data |

### Quality Monitoring Dashboard Query

```sql
SELECT
    prompt_version,
    source,
    COUNT(*) AS total,
    AVG(latency_ms) AS avg_latency,
    AVG(input_tokens) AS avg_input_tokens,
    AVG(output_tokens) AS avg_output_tokens,
    AVG(generation_cost_usd) AS avg_cost,
    COUNT(*) FILTER (WHERE source = 'fallback') AS fallback_count,
    COUNT(*) FILTER (WHERE fallback_reason IS NOT NULL) AS failure_count
FROM insights
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY prompt_version, source;
```

---

## 13. Entitlement Gating

### Per-Tier Access

| Tier | AI Insights | Fallback Insights | Regeneration |
|---|---|---|---|
| **Free** | Blocked | Yes (always available) | N/A |
| **Plus** | 1 per week | Yes (on failure) | No (cached for the week) |
| **Pro** | Unlimited | Yes (on failure) | Yes (can regenerate same week) |

### Enforcement

```rust
pub async fn generate_insight(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<InsightApiResponse>> {
    // 1. Check entitlement
    let entitlements = state.entitlement_cache
        .get_or_compute(&state.db, auth_user.id).await?;

    let ai_allowed = entitlements.ai_insights_per_week
        .map(|limit| limit > 0)
        .unwrap_or(true); // None = unlimited (Pro)

    if !ai_allowed {
        // Free tier: return fallback only
        let input = collect_insight_input(&state.db, auth_user.id, current_week_start()).await?;
        let fallback = generate_fallback_insight(&input);
        let result = InsightResult {
            output: fallback,
            source: InsightSource::Fallback,
            model: String::new(),
            prompt_version: PROMPT_VERSION.into(),
            input_tokens: 0,
            output_tokens: 0,
            latency_ms: 0,
            fallback_reason: Some("free_tier".into()),
        };
        store_insight(&state.db, auth_user.id, current_week_start(), &result).await?;
        return Ok(Json(result.into()));
    }

    // 2. Check weekly limit (Plus: 1/week)
    if let Some(limit) = entitlements.ai_insights_per_week {
        let this_week_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) FROM insights
            WHERE user_id = $1
              AND week_start_date = $2
              AND source = 'claude'
            "#,
        )
        .bind(auth_user.id)
        .bind(current_week_start())
        .fetch_one(&state.db)
        .await?;

        if this_week_count >= limit as i64 {
            // Already generated this week — return cached
            return get_cached_insight(&state.db, auth_user.id, current_week_start()).await;
        }
    }

    // 3. Run generation pipeline
    let result = run_insight_job(
        &state.db, &state.config, &state.http_client,
        auth_user.id, current_week_start(),
    ).await?;

    store_insight(&state.db, auth_user.id, current_week_start(), &result).await?;

    Ok(Json(result.into()))
}
```

---

## 14. Gaps in Current Code

| # | File | Gap | Severity | Fix |
|---|---|---|---|---|
| 1 | `handlers/insights.rs` | No structured JSON schema — flat `InsightResponse` without confidence scores or evidence windows | **High** | Implement `WeeklyInsightOutput` schema |
| 2 | `handlers/insights.rs` | No system prompt — instructions mixed into user prompt | **High** | Separate system and user prompts |
| 3 | `handlers/insights.rs` | No safety validation — blocked terms not checked | **Critical** | Add `validate_safety()` |
| 4 | `handlers/insights.rs` | No JSON validation — raw `serde_json::from_str` with no schema checks | **High** | Add 3-stage validator |
| 5 | `handlers/insights.rs` | No retry logic — single attempt, immediate fallback | **Medium** | Add 3-retry with exponential backoff |
| 6 | `handlers/insights.rs` | No timeout — Claude call can hang indefinitely | **High** | Add `tokio::time::timeout(30s)` |
| 7 | `handlers/insights.rs` | No token usage tracking — cost not monitored | **Medium** | Parse `usage` from Claude response |
| 8 | `handlers/insights.rs` | No prompt versioning — can't track which prompt produced which insight | **Medium** | Add `prompt_version` column |
| 9 | `handlers/insights.rs` | `reqwest::Client::new()` per request — no connection pooling | **Low** | Use shared client from `AppState` |
| 10 | `handlers/insights.rs` | 30-day window instead of 7-day — too much data, higher token cost | **Medium** | Scope to current ISO week |
| 11 | `handlers/insights.rs` | No mood data in prompt — mood_correlation always None | **High** | Query `mood_logs` and include in prompt |
| 12 | `handlers/insights.rs` | No day-of-week analysis in prompt | **Medium** | Add completions-by-DOW query |
| 13 | `handlers/insights.rs` | No entitlement check — any user can generate | **High** | Add tier gating |
| 14 | `handlers/insights.rs` | No weekly caching — generates fresh every request | **High** | Check `insights` table before generating |
| 15 | `handlers/insights.rs` | Fallback doesn't match new schema (no confidence, no types) | **High** | Rewrite fallback to produce `WeeklyInsightOutput` |
| 16 | `handlers/insights.rs` | `temperature` not set — defaults to 1.0 (too creative for structured output) | **Medium** | Set `temperature: 0.3` |

---

## 15. Implementation: Rust Code

### API Endpoints

```rust
// In main.rs route setup:
.route("/api/insights/generate", post(insights::generate_insight))
.route("/api/insights/latest",   get(insights::get_latest_insight))
```

### `GET /api/insights/latest`

```rust
pub async fn get_latest_insight(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<InsightApiResponse>> {
    let row = sqlx::query_as::<_, InsightRow>(
        r#"
        SELECT * FROM insights
        WHERE user_id = $1
        ORDER BY week_start_date DESC
        LIMIT 1
        "#,
    )
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("No insights generated yet".into()))?;

    Ok(Json(row.into()))
}
```

### API Response Shape

```rust
#[derive(Debug, Serialize)]
pub struct InsightApiResponse {
    pub id: Uuid,
    pub week_start_date: NaiveDate,
    pub source: String,

    // Structured output
    pub summary: String,
    pub insights: Vec<InsightItem>,
    pub recommendation: Recommendation,
    pub metadata: InsightMetadata,

    // Legacy flat fields (backward compat with frontend)
    pub wins: Vec<String>,
    pub improvements: Vec<String>,
    pub mood_correlation: Option<String>,
    pub streak_analysis: String,
    pub tip_of_the_week: String,

    pub generated_at: DateTime<Utc>,
}
```

### Weekly Cron Job

```rust
/// Scheduled to run Sunday 23:00 UTC.
/// Generates insights for all eligible users who haven't generated one this week.
pub async fn weekly_insight_cron(
    db: &PgPool,
    config: &Config,
    http_client: &reqwest::Client,
    entitlement_cache: &EntitlementCache,
) {
    let week_start = current_week_start();

    // Find users eligible for AI insights who don't have one this week
    let eligible_users = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT s.user_id
        FROM subscriptions s
        WHERE s.status IN ('active', 'trialing')
          AND s.tier IN ('plus', 'pro')
          AND s.user_id NOT IN (
              SELECT user_id FROM insights
              WHERE week_start_date = $1 AND source = 'claude'
          )
        "#,
    )
    .bind(week_start)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    tracing::info!(
        count = eligible_users.len(),
        "Starting weekly insight generation"
    );

    // Process with concurrency limit (avoid overwhelming Claude API)
    let semaphore = Arc::new(tokio::sync::Semaphore::new(5)); // max 5 concurrent

    let mut handles = Vec::new();
    for user_id in eligible_users {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let db = db.clone();
        let config = config.clone();
        let client = http_client.clone();

        handles.push(tokio::spawn(async move {
            let result = run_insight_job(&db, &config, &client, user_id, week_start).await;
            match result {
                Ok(r) => {
                    if let Err(e) = store_insight(&db, user_id, week_start, &r).await {
                        tracing::error!(user_id = %user_id, error = %e, "Failed to store insight");
                    }
                }
                Err(e) => {
                    tracing::error!(user_id = %user_id, error = %e, "Insight generation failed");
                }
            }
            drop(permit);
        }));
    }

    // Wait for all to complete
    for handle in handles {
        let _ = handle.await;
    }

    tracing::info!("Weekly insight generation complete");
}
```

### Helper: Current Week Start

```rust
/// Returns the Monday of the current ISO week.
pub fn current_week_start() -> NaiveDate {
    let today = chrono::Utc::now().date_naive();
    let weekday = today.weekday().num_days_from_monday();
    today - chrono::Duration::days(weekday as i64)
}
```

### Updated AppState

```rust
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub ws_tx: Option<broadcast::Sender<String>>,
    pub auth_rate_limiter: Arc<RateLimiter>,
    pub api_rate_limiter: Arc<RateLimiter>,
    pub stripe: Arc<StripeClient>,
    pub entitlement_cache: Arc<EntitlementCache>,
    pub http_client: reqwest::Client,  // shared HTTP client for Claude + Stripe
}
```

---

*Document version: 1.0.0 — Generated for HabitArc backend*
*Last updated: 2026-02-10*
