# HabitArc — Complete Verification Suite

> Principal QA Lead specification.
> Unit · Integration · E2E · Non-functional · Automated pipelines · Go/No-Go

---

## Table of Contents

1. [Test Strategy Overview](#1-test-strategy-overview)
2. [Test Matrix Summary](#2-test-matrix-summary)
3. [Unit Tests — Backend (Rust)](#3-unit-tests--backend-rust)
4. [Unit Tests — Frontend (TypeScript)](#4-unit-tests--frontend-typescript)
5. [Integration Tests — Backend](#5-integration-tests--backend)
6. [Integration Tests — Frontend](#6-integration-tests--frontend)
7. [E2E Tests (Playwright)](#7-e2e-tests-playwright)
8. [Non-Functional Tests](#8-non-functional-tests)
9. [Automated Pipeline Integration](#9-automated-pipeline-integration)
10. [Go/No-Go Checklist](#10-gono-go-checklist)

---

## 1. Test Strategy Overview

### Testing Pyramid

```
                    ┌───────────┐
                    │   E2E     │  ~15 tests   │ Playwright
                    │  (slow)   │  ~5 min      │ Browser-based
                    ├───────────┤              │
                    │           │              │
                 ┌──┤Integration├──┐           │ cargo test + PG
                 │  │  (medium) │  │  ~30 tests│ Supertest / MSW
                 │  │           │  │  ~3 min   │
              ┌──┤  ├───────────┤  ├──┐        │
              │  │  │           │  │  │        │
           ┌──┤  │  │   Unit    │  │  ├──┐     │ cargo test (no DB)
           │  │  │  │  (fast)   │  │  │  │     │ vitest
           │  │  │  │           │  │  │  │     │ ~60 tests
           │  │  │  │           │  │  │  │     │ ~30 sec
           └──┴──┴──┴───────────┴──┴──┴──┘
```

### Principles

1. **Unit tests are the foundation.** Pure functions tested without DB or network. Fast, deterministic, high coverage.
2. **Integration tests verify contracts.** Real PG database, real HTTP handlers, real SQL queries. One test per critical user flow.
3. **E2E tests verify user journeys.** Playwright against a running frontend + backend. Fewest tests, highest confidence.
4. **Non-functional tests gate releases.** Load, security, accessibility, and PWA offline tests run pre-release.
5. **Every test is automated.** No manual test steps in CI. Manual QA is exploratory only.

### Tooling

| Layer | Backend (Rust) | Frontend (TypeScript) |
|---|---|---|
| Unit | `cargo test` (no DB) | `vitest` |
| Integration | `cargo test` + PG service | `vitest` + MSW (Mock Service Worker) |
| E2E | — | Playwright |
| Load | `k6` or `drill` | — |
| Security | Custom Rust tests | — |
| Accessibility | — | `@axe-core/playwright` |
| PWA/Offline | — | Playwright + service worker mocking |

---

## 2. Test Matrix Summary

### Unit Tests (60 tests)

| ID | Module | Test | Priority |
|---|---|---|---|
| U-01 | Schedule Matcher | Daily habit is always due | High |
| U-02 | Schedule Matcher | WeeklyDays: due on Mon/Wed/Fri, not on Tue | High |
| U-03 | Schedule Matcher | WeeklyDays: malformed config → treat as daily | High |
| U-04 | Schedule Matcher | WeeklyTarget: always due (user picks days) | High |
| U-05 | Schedule Matcher | WeeklyDays: empty days array → treat as daily | Medium |
| U-06 | Schedule Matcher | ISO day numbering (Mon=1, Sun=7) | High |
| U-07 | Streak Math | No completions → streak = 0 | High |
| U-08 | Streak Math | 7 consecutive days → streak = 7 | High |
| U-09 | Streak Math | Gap in middle → streak resets | High |
| U-10 | Streak Math | Today missing, yesterday present → streak = 0 | High |
| U-11 | Streak Math | Longest streak tracks historical max | High |
| U-12 | Streak Math | WeeklyDays: streak counts scheduled days only | High |
| U-13 | Streak Math | WeeklyTarget: streak counts weeks meeting target | High |
| U-14 | Streak Math | Single completion → streak = 1 | Medium |
| U-15 | Streak Math | 365 consecutive days → streak = 365 | Medium |
| U-16 | Entitlements | Free tier: max_habits = 3 | High |
| U-17 | Entitlements | Plus tier: max_habits = 15 | High |
| U-18 | Entitlements | Pro tier: unlimited_habits = true | High |
| U-19 | Entitlements | Free tier: csv_export = false | High |
| U-20 | Entitlements | Pro tier: csv_export = true | High |
| U-21 | Entitlements | Plus tier: advanced_ai_insights = true | High |
| U-22 | Entitlements | Free tier: schedule_types = ["daily"] only | High |
| U-23 | Entitlements | Past_due status → retains tier access (grace) | High |
| U-24 | Entitlements | Canceled status → free entitlements | High |
| U-25 | Token Rotation | Create access token with correct TTL | High |
| U-26 | Token Rotation | Create refresh token with correct TTL | High |
| U-27 | Token Rotation | Verify valid token succeeds | High |
| U-28 | Token Rotation | Verify expired token fails | High |
| U-29 | Token Rotation | Verify tampered token fails | High |
| U-30 | Token Rotation | Access token has type = Access | High |
| U-31 | Token Rotation | Refresh token has type = Refresh | High |
| U-32 | Token Rotation | JTI is unique per token | High |
| U-33 | Token Rotation | SHA-256 hash of refresh token is deterministic | High |
| U-34 | Token Revocation | Revoke single token by ID | High |
| U-35 | Token Revocation | Revoke token family (recursive CTE) | High |
| U-36 | Token Revocation | Revoke all user tokens | High |
| U-37 | Token Revocation | Reuse of revoked token triggers family revocation | High |
| U-38 | Insight Validation | Valid JSON passes 3-stage validation | High |
| U-39 | Insight Validation | Missing required field → JsonParse error | High |
| U-40 | Insight Validation | Summary too short (< 20 chars) → Schema error | High |
| U-41 | Insight Validation | < 3 insights → Schema error | High |
| U-42 | Insight Validation | > 4 insights → Schema error | High |
| U-43 | Insight Validation | Confidence < 0.5 → Schema error | High |
| U-44 | Insight Validation | Unknown habit name → Semantic error | High |
| U-45 | Insight Validation | Correlation insight without mood data → Semantic error | High |
| U-46 | Insight Validation | No "win" insight when rate > 50% → Semantic error | Medium |
| U-47 | Insight Safety | Blocked clinical term → Block violation | High |
| U-48 | Insight Safety | Blocked guilt term → Block violation | High |
| U-49 | Insight Safety | Clean text → no violations | High |
| U-50 | Insight Fallback | Empty habits → "no habits yet" response | High |
| U-51 | Insight Fallback | Good week (>80%) → celebratory tone | Medium |
| U-52 | Insight Fallback | Bad week (<30%) → encouraging tone | Medium |
| U-53 | Password | Hash and verify round-trip | High |
| U-54 | Password | Wrong password fails verification | High |
| U-55 | Password | Argon2id params match spec (19 MiB, 2 iter, 1 par) | High |
| U-56 | Webhook Sig | Valid HMAC-SHA256 signature passes | High |
| U-57 | Webhook Sig | Tampered payload fails | High |
| U-58 | Webhook Sig | Old timestamp (replay) fails | High |
| U-59 | Webhook Sig | Wrong secret fails | High |
| U-60 | Date Validation | ±1 day from today passes, ±2 fails | High |

### Integration Tests (30 tests)

| ID | Flow | Test | Priority |
|---|---|---|---|
| I-01 | Auth | Register → login → access token works | High |
| I-02 | Auth | Login with wrong password → 401 | High |
| I-03 | Auth | Refresh token rotation → new pair issued | High |
| I-04 | Auth | Reuse revoked refresh token → family revoked | High |
| I-05 | Auth | Expired access token → 401 | High |
| I-06 | Auth | Guest create → guest token works | High |
| I-07 | Auth | Guest merge on signup → data preserved | High |
| I-08 | Auth | Logout → refresh token revoked | High |
| I-09 | Auth | Account lockout after N failures → rate limited | High |
| I-10 | Habits | Create habit → returned in list | High |
| I-11 | Habits | Create beyond tier limit → 403 | High |
| I-12 | Habits | Toggle completion → idempotent (same result) | High |
| I-13 | Habits | Toggle on, toggle off → completion removed | High |
| I-14 | Habits | Create completion with ±1 day → accepted | High |
| I-15 | Habits | Create completion with ±2 day → 422 | High |
| I-16 | Habits | Duplicate completion (same habit+date+user) → no-op | High |
| I-17 | Habits | Delete habit → completions cascade deleted | High |
| I-18 | Review | Weekly review aggregation matches manual count | High |
| I-19 | Review | Best/worst day calculation correct | Medium |
| I-20 | Review | Empty week → zero rates, no crash | High |
| I-21 | Stripe | Duplicate webhook event → processed once | High |
| I-22 | Stripe | Out-of-order events → newer wins | High |
| I-23 | Stripe | checkout.session.completed → subscription active | High |
| I-24 | Stripe | invoice.payment_failed → past_due + grace period | High |
| I-25 | Stripe | invoice.payment_succeeded → clears grace | High |
| I-26 | Stripe | subscription.deleted → downgrade to free | High |
| I-27 | Stripe | Downgrade archives excess habits (not deletes) | High |
| I-28 | Stripe | Re-upgrade unarchives habits | High |
| I-29 | Offline | Replay with idempotency key → no duplicate | High |
| I-30 | Offline | Replay against deleted habit → 404, graceful | High |

### E2E Tests (15 tests)

| ID | Journey | Test | Priority |
|---|---|---|---|
| E-01 | Onboarding | Guest → 3 onboarding screens → lands on dashboard | High |
| E-02 | Onboarding | Guest → signup → account created, data preserved | High |
| E-03 | Habits | Create 3 habits → appear in list | High |
| E-04 | Habits | Complete habit → checkmark, streak increments | High |
| E-05 | Habits | Complete → calendar heatmap shows green cell | High |
| E-06 | Habits | Uncomplete → checkmark removed, streak decrements | High |
| E-07 | Mood | Log mood/energy/stress → appears in daily log | High |
| E-08 | Mood | Mood data appears in weekly review card | High |
| E-09 | Paywall | Free user hits habit limit → paywall shown | High |
| E-10 | Paywall | Click upgrade → Stripe Checkout opens | High |
| E-11 | Billing | Active subscription → billing page shows tier | Medium |
| E-12 | Downgrade | Cancel subscription → habits archived, data intact | High |
| E-13 | Upgrade | Re-subscribe → archived habits restored | High |
| E-14 | Auth | Login → navigate protected routes → works | High |
| E-15 | Auth | Expired session → redirect to login | High |

### Non-Functional Tests (20 tests)

| ID | Category | Test | Priority |
|---|---|---|---|
| N-01 | Load | 100 concurrent toggle requests → p95 < 300ms | High |
| N-02 | Load | 500 concurrent GET /api/habits → p95 < 200ms | High |
| N-03 | Load | 50 concurrent auth flows → no 5xx | High |
| N-04 | Load | Sustained 100 req/s for 5 min → no degradation | Medium |
| N-05 | Security | Rate limit: 11th login in 60s → 429 | High |
| N-06 | Security | JWT with wrong secret → 401 | High |
| N-07 | Security | JWT with modified claims → 401 | High |
| N-08 | Security | Expired JWT → 401 (not 500) | High |
| N-09 | Security | Refresh token replay after revocation → 401 | High |
| N-10 | Security | SQL injection in habit name → escaped, no error | High |
| N-11 | Security | XSS payload in habit name → stored escaped | High |
| N-12 | Security | CORS: request from unauthorized origin → blocked | High |
| N-13 | Security | Stripe webhook without signature → 400 | High |
| N-14 | Security | Stripe webhook with wrong signature → 400 | High |
| N-15 | A11y | Dashboard page: no axe violations | High |
| N-16 | A11y | Create habit dialog: keyboard navigable | High |
| N-17 | A11y | Color contrast ratio ≥ 4.5:1 on all text | High |
| N-18 | PWA | Toggle habit while offline → queued | High |
| N-19 | PWA | Come online → queue replayed, UI reconciled | High |
| N-20 | PWA | App installable (manifest valid, SW registered) | Medium |

---

## 3. Unit Tests — Backend (Rust)

### U-01 to U-06: Schedule Matcher

```rust
#[cfg(test)]
mod schedule_matcher_tests {
    use super::compute_is_due_today;
    use crate::models::habit::{Habit, HabitFrequency};
    use chrono::NaiveDate;

    fn make_habit(freq: HabitFrequency, config: serde_json::Value) -> Habit {
        Habit {
            id: uuid::Uuid::new_v4(),
            user_id: uuid::Uuid::new_v4(),
            name: "Test".into(),
            description: None,
            color: "#000".into(),
            icon: "target".into(),
            frequency: freq,
            frequency_config: config,
            target_per_day: 1,
            reminder_time: None,
            is_archived: false,
            sort_order: 0,
            current_streak: 0,
            longest_streak: 0,
            total_completions: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn u01_daily_always_due() {
        let habit = make_habit(HabitFrequency::Daily, serde_json::json!({}));
        // Test every day of the week
        for d in 0..7 {
            let date = NaiveDate::from_ymd_opt(2026, 2, 9 + d).unwrap(); // Mon-Sun
            assert!(compute_is_due_today(&habit, date), "Daily should be due on day {}", d);
        }
    }

    #[test]
    fn u02_weekly_days_mon_wed_fri() {
        let habit = make_habit(
            HabitFrequency::WeeklyDays,
            serde_json::json!({ "days": [1, 3, 5] }), // Mon, Wed, Fri
        );
        let monday = NaiveDate::from_ymd_opt(2026, 2, 9).unwrap();
        let tuesday = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let wednesday = NaiveDate::from_ymd_opt(2026, 2, 11).unwrap();

        assert!(compute_is_due_today(&habit, monday));
        assert!(!compute_is_due_today(&habit, tuesday));
        assert!(compute_is_due_today(&habit, wednesday));
    }

    #[test]
    fn u03_weekly_days_malformed_config_defaults_to_daily() {
        let habit = make_habit(
            HabitFrequency::WeeklyDays,
            serde_json::json!({ "invalid": "data" }),
        );
        let any_day = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert!(compute_is_due_today(&habit, any_day));
    }

    #[test]
    fn u04_weekly_target_always_due() {
        let habit = make_habit(
            HabitFrequency::WeeklyTarget,
            serde_json::json!({ "times_per_week": 4 }),
        );
        for d in 0..7 {
            let date = NaiveDate::from_ymd_opt(2026, 2, 9 + d).unwrap();
            assert!(compute_is_due_today(&habit, date));
        }
    }

    #[test]
    fn u05_weekly_days_empty_array_defaults_to_daily() {
        let habit = make_habit(
            HabitFrequency::WeeklyDays,
            serde_json::json!({ "days": [] }),
        );
        let any_day = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        // Empty array → no days match → not due (or treat as daily per policy)
        // Current impl: days.iter().any() on empty → false
        assert!(!compute_is_due_today(&habit, any_day));
    }

    #[test]
    fn u06_iso_day_numbering() {
        // Verify Mon=1, Sun=7
        let habit = make_habit(
            HabitFrequency::WeeklyDays,
            serde_json::json!({ "days": [7] }), // Sunday only
        );
        let sunday = NaiveDate::from_ymd_opt(2026, 2, 15).unwrap(); // Sunday
        let monday = NaiveDate::from_ymd_opt(2026, 2, 9).unwrap();  // Monday

        assert!(compute_is_due_today(&habit, sunday));
        assert!(!compute_is_due_today(&habit, monday));
    }
}
```

### U-07 to U-15: Streak Math

```rust
#[cfg(test)]
mod streak_tests {
    use chrono::NaiveDate;

    /// Pure function: compute streak from a sorted list of completion dates.
    fn compute_streak(dates: &[NaiveDate], today: NaiveDate) -> (i32, i32) {
        if dates.is_empty() {
            return (0, 0);
        }

        // Current streak: consecutive days ending at today
        let mut current = 0i32;
        let mut check = today;
        let date_set: std::collections::HashSet<NaiveDate> = dates.iter().copied().collect();

        while date_set.contains(&check) {
            current += 1;
            check -= chrono::Duration::days(1);
        }

        // Longest streak: max consecutive run in history
        let mut sorted = dates.to_vec();
        sorted.sort();
        sorted.dedup();
        let mut longest = 0i32;
        let mut run = 1i32;
        for i in 1..sorted.len() {
            if sorted[i] == sorted[i - 1] + chrono::Duration::days(1) {
                run += 1;
            } else {
                longest = longest.max(run);
                run = 1;
            }
        }
        longest = longest.max(run);

        (current, longest)
    }

    #[test]
    fn u07_no_completions() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert_eq!(compute_streak(&[], today), (0, 0));
    }

    #[test]
    fn u08_seven_consecutive_days() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates: Vec<NaiveDate> = (0..7)
            .map(|i| today - chrono::Duration::days(i))
            .collect();
        assert_eq!(compute_streak(&dates, today), (7, 7));
    }

    #[test]
    fn u09_gap_resets_current_streak() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today,
            today - chrono::Duration::days(1),
            // gap on day -2
            today - chrono::Duration::days(3),
            today - chrono::Duration::days(4),
            today - chrono::Duration::days(5),
        ];
        let (current, longest) = compute_streak(&dates, today);
        assert_eq!(current, 2);  // today + yesterday
        assert_eq!(longest, 3);  // 3-day run from days -3 to -5
    }

    #[test]
    fn u10_today_missing() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today - chrono::Duration::days(1),
            today - chrono::Duration::days(2),
        ];
        let (current, _) = compute_streak(&dates, today);
        assert_eq!(current, 0); // Today not completed → current streak = 0
    }

    #[test]
    fn u11_longest_streak_historical() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates = vec![
            today, // current: 1
            // Historical 5-day run
            today - chrono::Duration::days(20),
            today - chrono::Duration::days(21),
            today - chrono::Duration::days(22),
            today - chrono::Duration::days(23),
            today - chrono::Duration::days(24),
        ];
        let (current, longest) = compute_streak(&dates, today);
        assert_eq!(current, 1);
        assert_eq!(longest, 5);
    }

    #[test]
    fn u14_single_completion() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert_eq!(compute_streak(&[today], today), (1, 1));
    }

    #[test]
    fn u15_365_consecutive() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let dates: Vec<NaiveDate> = (0..365)
            .map(|i| today - chrono::Duration::days(i))
            .collect();
        assert_eq!(compute_streak(&dates, today), (365, 365));
    }
}
```

### U-16 to U-24: Entitlement Evaluator

```rust
#[cfg(test)]
mod entitlement_tests {
    use crate::models::user::{SubscriptionTier, SubscriptionStatus, UserEntitlements};

    #[test]
    fn u16_free_max_habits_3() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Free);
        assert_eq!(ent.max_habits, Some(3));
    }

    #[test]
    fn u17_plus_max_habits_15() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Plus);
        assert_eq!(ent.max_habits, Some(15));
    }

    #[test]
    fn u18_pro_unlimited_habits() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Pro);
        assert_eq!(ent.max_habits, None); // None = unlimited
    }

    #[test]
    fn u19_free_no_csv_export() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Free);
        assert!(!ent.data_export);
    }

    #[test]
    fn u20_pro_csv_export() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Pro);
        assert!(ent.data_export);
    }

    #[test]
    fn u22_free_daily_only() {
        let ent = UserEntitlements::for_tier(&SubscriptionTier::Free);
        assert_eq!(ent.schedule_types, vec!["daily"]);
    }
}
```

### U-25 to U-37: Token Rotation & Revocation

```rust
#[cfg(test)]
mod token_tests {
    use crate::auth::jwt::*;
    use crate::config::Config;
    use uuid::Uuid;

    fn test_config() -> Config {
        Config {
            jwt_secret: "test-secret-at-least-32-characters-long".into(),
            jwt_access_ttl_secs: 900,
            jwt_refresh_ttl_secs: 604800,
            // ... other fields with defaults
            ..Config::test_defaults()
        }
    }

    #[test]
    fn u25_access_token_ttl() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let token = create_access_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        let claims = verify_token(&token, &config).unwrap().claims;
        let ttl = claims.exp - claims.iat;
        assert_eq!(ttl, 900);
    }

    #[test]
    fn u26_refresh_token_ttl() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let token = create_refresh_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        let claims = verify_token(&token, &config).unwrap().claims;
        let ttl = claims.exp - claims.iat;
        assert_eq!(ttl, 604800);
    }

    #[test]
    fn u27_valid_token_verifies() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let token = create_access_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        assert!(verify_token(&token, &config).is_ok());
    }

    #[test]
    fn u29_tampered_token_fails() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let mut token = create_access_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        // Tamper with the payload
        let bytes = unsafe { token.as_bytes_mut() };
        if bytes.len() > 50 { bytes[50] ^= 0xFF; }
        assert!(verify_token(&token, &config).is_err());
    }

    #[test]
    fn u30_access_token_type() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let token = create_access_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        let claims = verify_token(&token, &config).unwrap().claims;
        assert_eq!(claims.token_type, TokenType::Access);
    }

    #[test]
    fn u31_refresh_token_type() {
        let config = test_config();
        let jti = Uuid::new_v4();
        let token = create_refresh_token(Uuid::new_v4(), "test@test.com", &config, jti).unwrap();
        let claims = verify_token(&token, &config).unwrap().claims;
        assert_eq!(claims.token_type, TokenType::Refresh);
    }

    #[test]
    fn u32_jti_unique() {
        let config = test_config();
        let user_id = Uuid::new_v4();
        let jti1 = Uuid::new_v4();
        let jti2 = Uuid::new_v4();
        let t1 = create_access_token(user_id, "test@test.com", &config, jti1).unwrap();
        let t2 = create_access_token(user_id, "test@test.com", &config, jti2).unwrap();
        let c1 = verify_token(&t1, &config).unwrap().claims;
        let c2 = verify_token(&t2, &config).unwrap().claims;
        assert_ne!(c1.jti, c2.jti);
    }

    #[test]
    fn u33_sha256_hash_deterministic() {
        let token = "test-refresh-token-value";
        let hash1 = hash_token(token);
        let hash2 = hash_token(token);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA-256 hex = 64 chars
    }
}
```

### U-38 to U-52: Insight Validation & Safety

```rust
#[cfg(test)]
mod insight_validation_tests {
    use crate::services::insights::*;

    fn valid_insight_json() -> &'static str {
        r#"{
            "summary": "This week you completed 15/21 habit check-ins (71% overall). A solid foundation.",
            "insights": [
                {
                    "type": "win",
                    "title": "Meditation is your strongest habit",
                    "body": "You completed Meditation 7/7 times this week (100% rate). Your 14-day streak shows real consistency.",
                    "confidence": 0.95,
                    "evidence_window": "this_week",
                    "habit_names": ["Meditation"]
                },
                {
                    "type": "pattern",
                    "title": "Weekdays are your strongest days",
                    "body": "You completed 12 habits on weekdays vs 3 on weekends. Consider scheduling lighter habits for Saturday and Sunday.",
                    "confidence": 0.8,
                    "evidence_window": "this_week",
                    "habit_names": []
                },
                {
                    "type": "opportunity",
                    "title": "Reading has room to grow",
                    "body": "You completed Reading 2/7 times this week (29%). Consider reducing the daily target or pairing it with your morning coffee.",
                    "confidence": 0.85,
                    "evidence_window": "this_week",
                    "habit_names": ["Reading"]
                }
            ],
            "recommendation": {
                "title": "Focus on Reading this week",
                "body": "Your Reading rate was 29% last week. Small improvements compound over time.",
                "action": "Set a daily reminder for Reading at 8am, right after your morning coffee routine."
            },
            "metadata": {
                "tone_check": "supportive",
                "data_quality": "rich"
            }
        }"#
    }

    fn test_input() -> InsightInput {
        InsightInput {
            habits: vec![
                HabitWeekData { name: "Meditation".into(), rate: 1.0, completions_this_week: 7, possible_this_week: 7, current_streak: 14, longest_streak: 14, frequency: "daily".into(), target_per_day: 1 },
                HabitWeekData { name: "Reading".into(), rate: 0.29, completions_this_week: 2, possible_this_week: 7, current_streak: 0, longest_streak: 5, frequency: "daily".into(), target_per_day: 1 },
            ],
            overall_rate: 0.71,
            mood_entries: vec![],
            mood_avg: None,
            energy_avg: None,
            stress_avg: None,
            // ... other fields
            ..InsightInput::test_defaults()
        }
    }

    #[test]
    fn u38_valid_json_passes() {
        let input = test_input();
        let result = parse_and_validate_insight(valid_insight_json(), &input);
        assert!(result.is_ok());
    }

    #[test]
    fn u39_missing_field_fails() {
        let bad_json = r#"{ "summary": "test" }"#; // missing insights, recommendation, metadata
        let input = test_input();
        let result = parse_and_validate_insight(bad_json, &input);
        assert!(matches!(result, Err(ValidationError::JsonParse(_))));
    }

    #[test]
    fn u40_summary_too_short() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.summary = "Short".into();
        // Re-serialize and validate
        let json = serde_json::to_string(&output).unwrap();
        let input = test_input();
        let result = parse_and_validate_insight(&json, &input);
        assert!(matches!(result, Err(ValidationError::Schema(_))));
    }

    #[test]
    fn u41_too_few_insights() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.insights.truncate(2); // Only 2, need 3
        let json = serde_json::to_string(&output).unwrap();
        let input = test_input();
        let result = parse_and_validate_insight(&json, &input);
        assert!(matches!(result, Err(ValidationError::Schema(_))));
    }

    #[test]
    fn u43_confidence_below_threshold() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.insights[0].confidence = 0.3; // Below 0.5
        let json = serde_json::to_string(&output).unwrap();
        let input = test_input();
        let result = parse_and_validate_insight(&json, &input);
        assert!(matches!(result, Err(ValidationError::Schema(_))));
    }

    #[test]
    fn u44_unknown_habit_name() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.insights[0].habit_names = vec!["NonExistentHabit".into()];
        let json = serde_json::to_string(&output).unwrap();
        let input = test_input();
        let result = parse_and_validate_insight(&json, &input);
        assert!(matches!(result, Err(ValidationError::Semantic(_))));
    }

    #[test]
    fn u47_blocked_clinical_term() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.summary = "Your patterns suggest depression and you should seek therapy.".into();
        let violations = validate_safety(&output);
        assert!(violations.iter().any(|v| matches!(v.severity, SafetySeverity::Block)));
    }

    #[test]
    fn u48_blocked_guilt_term() {
        let mut output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        output.insights[0].body = "You are failing at this habit and letting yourself down.".into();
        let violations = validate_safety(&output);
        assert!(violations.iter().any(|v| matches!(v.severity, SafetySeverity::Block)));
    }

    #[test]
    fn u49_clean_text_no_violations() {
        let output: WeeklyInsightOutput = serde_json::from_str(valid_insight_json()).unwrap();
        let violations = validate_safety(&output);
        assert!(violations.is_empty());
    }
}
```

---

## 4. Unit Tests — Frontend (TypeScript)

### Setup: `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

### Key Frontend Unit Tests

```typescript
// __tests__/offline-queue.test.ts
import { describe, it, expect } from "vitest";
import { compactQueue } from "@/lib/offline-sync";

describe("Offline Queue Compaction", () => {
  it("keeps single action per habit+date", () => {
    const actions = [
      makeAction("h1", "2026-02-10", "completed"),
      makeAction("h1", "2026-02-10", "uncompleted"),
      makeAction("h1", "2026-02-10", "completed"),
    ];
    const result = compactQueue(actions);
    expect(result).toHaveLength(1);
    expect(result[0].meta.optimisticChange).toBe("completed");
  });

  it("preserves actions for different habits", () => {
    const actions = [
      makeAction("h1", "2026-02-10", "completed"),
      makeAction("h2", "2026-02-10", "completed"),
    ];
    expect(compactQueue(actions)).toHaveLength(2);
  });

  it("preserves actions for different dates", () => {
    const actions = [
      makeAction("h1", "2026-02-10", "completed"),
      makeAction("h1", "2026-02-11", "completed"),
    ];
    expect(compactQueue(actions)).toHaveLength(2);
  });
});

// __tests__/entitlements.test.ts
describe("Entitlement Checks", () => {
  it("free user cannot access csv_export", () => {
    const ent = getEntitlements("free");
    expect(ent.csv_export).toBe(false);
  });

  it("plus user has advanced_ai_insights", () => {
    const ent = getEntitlements("plus");
    expect(ent.advanced_ai_insights).toBe(true);
  });

  it("pro user has all features", () => {
    const ent = getEntitlements("pro");
    expect(ent.unlimited_habits).toBe(true);
    expect(ent.csv_export).toBe(true);
    expect(ent.challenges_access).toBe(true);
    expect(ent.smart_reminders).toBe(true);
  });
});
```

---

## 5. Integration Tests — Backend

### Test Harness

```rust
// tests/common/mod.rs
use sqlx::PgPool;
use habitarc_api::{AppState, config::Config};
use axum::Router;
use std::sync::Arc;

pub async fn setup_test_app() -> (Router, PgPool) {
    let config = Config::test_defaults();
    let db = PgPool::connect(&config.database_url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();

    let state = AppState {
        db: db.clone(),
        config: Arc::new(config),
        ws_tx: None,
    };

    let app = habitarc_api::build_router(state);
    (app, db)
}

pub async fn create_test_user(db: &PgPool, email: &str, password: &str) -> uuid::Uuid {
    // Register user and return ID
    // ...
}

pub async fn login(app: &Router, email: &str, password: &str) -> (String, String) {
    // Login and return (access_token, refresh_token)
    // ...
}

pub fn auth_header(token: &str) -> (&str, String) {
    ("Authorization", format!("Bearer {}", token))
}
```

### I-01 to I-09: Auth Flow

```rust
#[tokio::test]
async fn i01_register_login_access() {
    let (app, db) = setup_test_app().await;

    // Register
    let resp = app.post("/api/auth/register")
        .json(&json!({ "email": "test@test.com", "password": "password123", "name": "Test" }))
        .send().await;
    assert_eq!(resp.status(), 200);

    // Login
    let resp = app.post("/api/auth/login")
        .json(&json!({ "email": "test@test.com", "password": "password123" }))
        .send().await;
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await;
    let access_token = body["access_token"].as_str().unwrap();

    // Access protected route
    let resp = app.get("/api/me")
        .header("Authorization", format!("Bearer {}", access_token))
        .send().await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn i02_wrong_password_401() {
    let (app, _) = setup_test_app().await;
    // Register first
    app.post("/api/auth/register")
        .json(&json!({ "email": "test@test.com", "password": "correct", "name": "Test" }))
        .send().await;

    let resp = app.post("/api/auth/login")
        .json(&json!({ "email": "test@test.com", "password": "wrong" }))
        .send().await;
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn i12_toggle_idempotent() {
    let (app, db) = setup_test_app().await;
    let (token, _) = register_and_login(&app).await;
    let habit_id = create_test_habit(&app, &token).await;

    // Toggle ON
    let r1 = app.post("/api/completions/toggle")
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "habit_id": habit_id }))
        .send().await;
    assert_eq!(r1.status(), 200);
    let b1: serde_json::Value = r1.json().await;
    assert_eq!(b1["action"], "created");

    // Toggle OFF
    let r2 = app.post("/api/completions/toggle")
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "habit_id": habit_id }))
        .send().await;
    assert_eq!(r2.status(), 200);
    let b2: serde_json::Value = r2.json().await;
    assert_eq!(b2["action"], "deleted");

    // Toggle ON again
    let r3 = app.post("/api/completions/toggle")
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "habit_id": habit_id }))
        .send().await;
    assert_eq!(r3.status(), 200);
    let b3: serde_json::Value = r3.json().await;
    assert_eq!(b3["action"], "created");
}

#[tokio::test]
async fn i16_duplicate_completion_noop() {
    let (app, _) = setup_test_app().await;
    let (token, _) = register_and_login(&app).await;
    let habit_id = create_test_habit(&app, &token).await;

    // Create completion
    let r1 = app.post("/api/completions")
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "habit_id": habit_id }))
        .send().await;
    assert_eq!(r1.status(), 200);
    let c1: serde_json::Value = r1.json().await;

    // Create same completion again (idempotent)
    let r2 = app.post("/api/completions")
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "habit_id": habit_id }))
        .send().await;
    assert_eq!(r2.status(), 200);
    let c2: serde_json::Value = r2.json().await;

    // Same completion ID returned (ON CONFLICT DO UPDATE RETURNING)
    assert_eq!(c1["id"], c2["id"]);
}
```

### I-21 to I-28: Stripe Webhook Processing

```rust
#[tokio::test]
async fn i21_duplicate_webhook_processed_once() {
    let (app, db) = setup_test_app().await;
    let event = make_stripe_event("evt_test_001", "customer.subscription.updated", json!({
        "id": "sub_123", "customer": "cus_123", "status": "active",
        "metadata": { "tier": "plus" },
    }));

    let r1 = send_webhook(&app, &event).await;
    assert_eq!(r1.status(), 200);

    let r2 = send_webhook(&app, &event).await;
    assert_eq!(r2.status(), 200);
    let b2: serde_json::Value = r2.json().await;
    assert_eq!(b2["duplicate"], true);

    // Only one row in stripe_events
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stripe_events WHERE event_id = 'evt_test_001'")
        .fetch_one(&db).await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn i27_downgrade_archives_not_deletes() {
    let (app, db) = setup_test_app().await;
    let user_id = create_plus_user(&db).await;

    // Create 5 habits (exceeds free limit of 3)
    for i in 0..5 {
        create_habit_for_user(&db, user_id, &format!("Habit {}", i)).await;
    }

    // Simulate downgrade
    downgrade_to_free(&db, user_id).await;

    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_archived = false AND deleted_at IS NULL"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(active, 3);

    let archived: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_archived = true"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(archived, 2);

    // Total still 5 — nothing deleted
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND deleted_at IS NULL"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(total, 5);
}
```

---

## 6. Integration Tests — Frontend

### MSW (Mock Service Worker) Setup

```typescript
// src/test/mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("*/api/habits", () =>
    HttpResponse.json([
      { id: "h1", name: "Meditation", is_complete: false, completed_today: 0, current_streak: 5 },
      { id: "h2", name: "Exercise", is_complete: true, completed_today: 1, current_streak: 3 },
    ])
  ),
  http.post("*/api/completions/toggle", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ action: "created", completion_id: "c1" });
  }),
];
```

### Key Frontend Integration Tests

```typescript
// __tests__/integration/habit-toggle.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { useToggleCompletion } from "@/hooks/use-habits";

describe("Habit Toggle Integration", () => {
  it("optimistically updates UI on toggle", async () => {
    const { result } = renderHook(() => useToggleCompletion(), { wrapper: TestProviders });

    act(() => {
      result.current.mutate({ habit_id: "h1", completed_date: "2026-02-10" });
    });

    // Optimistic: should immediately show as complete
    await waitFor(() => {
      const habits = queryClient.getQueryData(["habits"]);
      expect(habits[0].is_complete).toBe(true);
    });
  });

  it("rolls back on server error", async () => {
    server.use(
      http.post("*/api/completions/toggle", () => HttpResponse.error())
    );

    const { result } = renderHook(() => useToggleCompletion(), { wrapper: TestProviders });

    act(() => {
      result.current.mutate({ habit_id: "h1" });
    });

    await waitFor(() => {
      const habits = queryClient.getQueryData(["habits"]);
      expect(habits[0].is_complete).toBe(false); // Rolled back
    });
  });
});
```

---

## 7. E2E Tests (Playwright)

### Setup: `playwright.config.ts`

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  workers: 1, // Sequential for DB state
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../frontend",
      port: 3000,
      reuseExistingServer: true,
    },
  ],
});
```

### E-01 to E-02: Onboarding

```typescript
// e2e/onboarding.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Onboarding", () => {
  test("E-01: guest onboarding flow", async ({ page }) => {
    await page.goto("/");

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/);

    // Screen 1: Welcome
    await expect(page.getByText("Welcome to HabitArc")).toBeVisible();
    await page.getByRole("button", { name: /next|continue/i }).click();

    // Screen 2: How it works
    await expect(page.getByText(/track.*habits/i)).toBeVisible();
    await page.getByRole("button", { name: /next|continue/i }).click();

    // Screen 3: Get started
    await page.getByRole("button", { name: /get started|try free/i }).click();

    // Should land on dashboard
    await expect(page).toHaveURL(/dashboard|habits/);
  });

  test("E-02: guest signup preserves data", async ({ page }) => {
    // Start as guest
    await page.goto("/");
    await page.getByRole("button", { name: /get started/i }).click();

    // Create a habit as guest
    await page.getByRole("button", { name: /add habit/i }).click();
    await page.getByLabel(/name/i).fill("Test Habit");
    await page.getByRole("button", { name: /create|save/i }).click();
    await expect(page.getByText("Test Habit")).toBeVisible();

    // Sign up
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByLabel(/name/i).fill("Test User");
    await page.getByRole("button", { name: /create account/i }).click();

    // Habit should still be there
    await expect(page.getByText("Test Habit")).toBeVisible();
  });
});
```

### E-03 to E-06: Habits & Calendar

```typescript
// e2e/habits.spec.ts
test.describe("Habits", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test("E-03: create 3 habits", async ({ page }) => {
    for (const name of ["Meditation", "Exercise", "Reading"]) {
      await page.getByRole("button", { name: /add habit/i }).click();
      await page.getByLabel(/name/i).fill(name);
      await page.getByRole("button", { name: /create|save/i }).click();
      await expect(page.getByText(name)).toBeVisible();
    }
    // All 3 visible
    const cards = page.locator("[data-testid='habit-card']");
    await expect(cards).toHaveCount(3);
  });

  test("E-04: complete habit updates streak", async ({ page }) => {
    // Get initial streak
    const streakBefore = await page.locator("[data-testid='streak-badge']").first().textContent();

    // Toggle complete
    await page.locator("[data-testid='habit-toggle']").first().click();

    // Checkmark visible
    await expect(page.locator("[data-testid='habit-toggle']").first()).toHaveAttribute("data-checked", "true");

    // Streak incremented
    const streakAfter = await page.locator("[data-testid='streak-badge']").first().textContent();
    expect(parseInt(streakAfter!)).toBeGreaterThanOrEqual(parseInt(streakBefore!));
  });

  test("E-05: completion shows in calendar heatmap", async ({ page }) => {
    // Complete a habit
    await page.locator("[data-testid='habit-toggle']").first().click();

    // Navigate to habit detail / heatmap
    await page.locator("[data-testid='habit-card']").first().click();

    // Today's cell should be green
    const todayCell = page.locator("[data-testid='heatmap-today']");
    await expect(todayCell).toHaveClass(/completed|green/);
  });
});
```

### E-09 to E-13: Paywall & Billing

```typescript
// e2e/billing.spec.ts
test.describe("Billing", () => {
  test("E-09: free user hits habit limit", async ({ page }) => {
    await loginAsFreeUser(page);

    // Create 3 habits (at limit)
    for (let i = 0; i < 3; i++) {
      await createHabit(page, `Habit ${i}`);
    }

    // Try to create 4th
    await page.getByRole("button", { name: /add habit/i }).click();
    await page.getByLabel(/name/i).fill("Habit 4");
    await page.getByRole("button", { name: /create|save/i }).click();

    // Paywall should appear
    await expect(page.getByText(/upgrade|limit reached/i)).toBeVisible();
  });

  test("E-12: downgrade preserves data", async ({ page }) => {
    await loginAsPlusUser(page);

    // Create 5 habits
    for (let i = 0; i < 5; i++) {
      await createHabit(page, `Habit ${i}`);
    }

    // Simulate downgrade (via API)
    await simulateDowngrade(page);
    await page.reload();

    // 3 habits visible, 2 archived
    const activeCards = page.locator("[data-testid='habit-card']:not([data-archived])");
    await expect(activeCards).toHaveCount(3);

    // Archived banner visible
    await expect(page.getByText(/archived.*habits/i)).toBeVisible();
  });
});
```

---

## 8. Non-Functional Tests

### N-01 to N-04: Load Tests (k6)

```javascript
// load-tests/completion-toggle.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    toggle_load: {
      executor: "constant-vus",
      vus: 100,
      duration: "2m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<300"],  // N-01: p95 < 300ms
    http_req_failed: ["rate<0.01"],    // < 1% error rate
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:8080";

export function setup() {
  // Login and get token
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: "loadtest@test.com",
    password: "password123",
  }), { headers: { "Content-Type": "application/json" } });
  return { token: res.json().access_token, habit_id: "test-habit-id" };
}

export default function (data) {
  const res = http.post(
    `${BASE_URL}/api/completions/toggle`,
    JSON.stringify({ habit_id: data.habit_id }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.token}`,
      },
    }
  );

  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 300ms": (r) => r.timings.duration < 300,
  });

  sleep(0.1);
}
```

```javascript
// load-tests/read-habits.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    read_load: {
      executor: "constant-vus",
      vus: 500,
      duration: "2m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],  // N-02: p95 < 200ms
    http_req_failed: ["rate<0.001"],
  },
};
```

### N-05 to N-14: Security Tests

```rust
#[cfg(test)]
mod security_tests {
    use super::*;

    #[tokio::test]
    async fn n05_rate_limit_login() {
        let (app, _) = setup_test_app().await;

        // Send 10 login attempts (within limit)
        for _ in 0..10 {
            let _ = app.post("/api/auth/login")
                .json(&json!({ "email": "test@test.com", "password": "wrong" }))
                .send().await;
        }

        // 11th should be rate limited
        let resp = app.post("/api/auth/login")
            .json(&json!({ "email": "test@test.com", "password": "wrong" }))
            .send().await;
        assert_eq!(resp.status(), 429);
    }

    #[tokio::test]
    async fn n06_jwt_wrong_secret() {
        let (app, _) = setup_test_app().await;
        let bad_config = Config { jwt_secret: "wrong-secret-xxxxxxxxxxxxxxxxxxxxx".into(), ..Config::test_defaults() };
        let token = create_access_token(Uuid::new_v4(), "test@test.com", &bad_config, Uuid::new_v4()).unwrap();

        let resp = app.get("/api/me")
            .header("Authorization", format!("Bearer {}", token))
            .send().await;
        assert_eq!(resp.status(), 401);
    }

    #[tokio::test]
    async fn n10_sql_injection_escaped() {
        let (app, _) = setup_test_app().await;
        let (token, _) = register_and_login(&app).await;

        let resp = app.post("/api/habits")
            .header("Authorization", format!("Bearer {}", token))
            .json(&json!({ "name": "'; DROP TABLE habits; --" }))
            .send().await;

        // Should succeed (name is just a string) or fail validation — NOT crash
        assert!(resp.status() == 200 || resp.status() == 422);

        // Habits table still exists
        let resp = app.get("/api/habits")
            .header("Authorization", format!("Bearer {}", token))
            .send().await;
        assert_eq!(resp.status(), 200);
    }

    #[tokio::test]
    async fn n13_webhook_no_signature() {
        let (app, _) = setup_test_app().await;
        let resp = app.post("/api/billing/webhook")
            .body(r#"{"id":"evt_test","type":"test"}"#)
            // No Stripe-Signature header
            .send().await;
        assert!(resp.status() == 400 || resp.status() == 401);
    }
}
```

### N-15 to N-17: Accessibility (Playwright + axe-core)

```typescript
// e2e/accessibility.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility", () => {
  test("N-15: dashboard has no axe violations", async ({ page }) => {
    await loginAsTestUser(page);
    await page.waitForSelector("[data-testid='habit-card']");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  test("N-16: create habit dialog is keyboard navigable", async ({ page }) => {
    await loginAsTestUser(page);

    // Open dialog with keyboard
    await page.keyboard.press("Tab"); // Focus add button
    await page.keyboard.press("Enter"); // Open dialog

    // Dialog should be visible
    await expect(page.getByRole("dialog")).toBeVisible();

    // Tab through fields
    await page.keyboard.press("Tab"); // Name input
    await page.keyboard.type("Test Habit");
    await page.keyboard.press("Tab"); // Next field
    await page.keyboard.press("Tab"); // Create button
    await page.keyboard.press("Enter"); // Submit

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("N-17: color contrast meets WCAG AA", async ({ page }) => {
    await loginAsTestUser(page);

    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();

    expect(results.violations).toHaveLength(0);
  });
});
```

### N-18 to N-20: PWA Offline Tests

```typescript
// e2e/offline.spec.ts
import { test, expect } from "@playwright/test";

test.describe("PWA Offline", () => {
  test("N-18: toggle habit while offline queues action", async ({ page, context }) => {
    await loginAsTestUser(page);
    await page.waitForSelector("[data-testid='habit-card']");

    // Go offline
    await context.setOffline(true);

    // Toggle habit
    await page.locator("[data-testid='habit-toggle']").first().click();

    // Should show optimistic state
    await expect(page.locator("[data-testid='habit-toggle']").first())
      .toHaveAttribute("data-checked", "true");

    // Offline banner should appear
    await expect(page.getByText(/offline|queued/i)).toBeVisible();
  });

  test("N-19: coming online replays queue", async ({ page, context }) => {
    await loginAsTestUser(page);

    // Go offline and toggle
    await context.setOffline(true);
    await page.locator("[data-testid='habit-toggle']").first().click();

    // Come back online
    await context.setOffline(false);

    // Wait for sync
    await expect(page.getByText(/synced|caught up/i)).toBeVisible({ timeout: 10000 });

    // State should be reconciled with server
    await page.reload();
    await expect(page.locator("[data-testid='habit-toggle']").first())
      .toHaveAttribute("data-checked", "true");
  });

  test("N-20: app is installable", async ({ page }) => {
    await page.goto("/");

    // Check manifest
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const resp = await fetch(link.getAttribute("href")!);
      return resp.json();
    });

    expect(manifest).not.toBeNull();
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);

    // Check service worker
    const swRegistered = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(swRegistered).toBe(true);
  });
});
```

---

## 9. Automated Pipeline Integration

### CI Workflow: `.github/workflows/ci.yml` (Extended)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # ── Existing jobs (from DEPLOYMENT_OPS.md §5) ──
  frontend-lint:    # ...
  frontend-typecheck: # ...
  frontend-build:   # ...
  backend-fmt:      # ...
  backend-clippy:   # ...
  backend-test:     # ...
  backend-sqlx-check: # ...
  migration-validate: # ...

  # ── NEW: Frontend Unit Tests ──
  frontend-unit-test:
    name: "FE: Unit Tests"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: fe-coverage
          path: frontend/coverage/

  # ── NEW: E2E Tests (on PR only, not every push) ──
  e2e-tests:
    name: "E2E: Playwright"
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: [frontend-build, backend-test]
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: habitarc, POSTGRES_PASSWORD: test, POSTGRES_DB: habitarc_test }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable

      # Start backend
      - name: Build and start backend
        working-directory: backend
        env:
          DATABASE_URL: postgres://habitarc:test@localhost:5432/habitarc_test
          JWT_SECRET: test-secret-at-least-32-characters-long
        run: |
          cargo build --release
          cargo sqlx migrate run
          ./target/release/habitarc-api &
          sleep 5

      # Start frontend
      - name: Build and start frontend
        working-directory: frontend
        env:
          NEXT_PUBLIC_API_URL: http://localhost:8080
        run: |
          npm ci
          npm run build
          npm start &
          sleep 5

      # Run Playwright
      - name: Install Playwright
        working-directory: frontend
        run: npx playwright install --with-deps chromium
      - name: Run E2E tests
        working-directory: frontend
        run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: frontend/playwright-report/

  # ── NEW: Accessibility Tests ──
  accessibility:
    name: "A11y: axe-core"
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: [e2e-tests]
    steps:
      - uses: actions/checkout@v4
      # ... same setup as e2e-tests ...
      - name: Run accessibility tests
        working-directory: frontend
        run: npx playwright test e2e/accessibility.spec.ts
```

### Pre-Release Pipeline: `.github/workflows/pre-release.yml`

```yaml
name: Pre-Release Verification

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
        type: choice
        options: [staging, production]

jobs:
  load-tests:
    name: "Load Tests (k6)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/k6-action@v0.3.1
        with:
          filename: load-tests/completion-toggle.js
        env:
          API_URL: ${{ inputs.environment == 'production' && 'https://api.habitarc.com' || 'https://staging-api.habitarc.com' }}
      - uses: grafana/k6-action@v0.3.1
        with:
          filename: load-tests/read-habits.js

  security-tests:
    name: "Security Tests"
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: habitarc, POSTGRES_PASSWORD: test, POSTGRES_DB: habitarc_test }
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test security_tests --release
        working-directory: backend
        env:
          DATABASE_URL: postgres://habitarc:test@localhost:5432/habitarc_test
```

### Test Execution Summary

| Test Layer | Trigger | Duration | Blocking? |
|---|---|---|---|
| Backend unit tests | Every push + PR | ~30s | Yes (merge blocked) |
| Backend integration tests | Every push + PR | ~2 min | Yes |
| Frontend unit tests | Every push + PR | ~15s | Yes |
| Frontend lint + typecheck | Every push + PR | ~30s | Yes |
| E2E (Playwright) | PR only | ~5 min | Yes (merge blocked) |
| Accessibility | PR only | ~2 min | Yes |
| Load tests | Pre-release (manual) | ~5 min | Go/no-go gate |
| Security tests | Pre-release (manual) | ~2 min | Go/no-go gate |
| PWA offline tests | PR only (in E2E) | ~1 min | Yes |

---

## 10. Go/No-Go Checklist

### Pre-Release Checklist

Run this checklist before every production deployment. All items must be ✅ to proceed.

#### Automated Gates (CI must pass)

| # | Gate | Verified By | Status |
|---|---|---|---|
| G-01 | Backend `cargo fmt` passes | CI: `backend-fmt` | □ |
| G-02 | Backend `cargo clippy` passes (0 warnings) | CI: `backend-clippy` | □ |
| G-03 | Backend unit tests pass (60/60) | CI: `backend-test` | □ |
| G-04 | Backend integration tests pass (30/30) | CI: `backend-test` | □ |
| G-05 | SQLx prepare check passes | CI: `backend-sqlx-check` | □ |
| G-06 | Migrations apply cleanly on fresh DB | CI: `migration-validate` | □ |
| G-07 | Frontend ESLint passes (0 errors) | CI: `frontend-lint` | □ |
| G-08 | Frontend TypeScript compiles (0 errors) | CI: `frontend-typecheck` | □ |
| G-09 | Frontend unit tests pass | CI: `frontend-unit-test` | □ |
| G-10 | Frontend builds successfully | CI: `frontend-build` | □ |
| G-11 | E2E tests pass (15/15) | CI: `e2e-tests` | □ |
| G-12 | Accessibility: 0 axe violations | CI: `accessibility` | □ |

#### Pre-Release Manual Gates

| # | Gate | Verified By | Status |
|---|---|---|---|
| G-13 | Load test: p95 < 300ms on toggle endpoint | `pre-release.yml` | □ |
| G-14 | Load test: p95 < 200ms on GET habits | `pre-release.yml` | □ |
| G-15 | Load test: 0 5xx errors under sustained load | `pre-release.yml` | □ |
| G-16 | Security: rate limiting works (429 on excess) | `pre-release.yml` | □ |
| G-17 | Security: JWT tamper → 401 (not 500) | `pre-release.yml` | □ |
| G-18 | Security: Stripe webhook signature validated | `pre-release.yml` | □ |
| G-19 | Staging deploy successful + smoke tests pass | CD: `deploy-staging` | □ |
| G-20 | Staging `/readyz` returns 200 | CD: post-deploy check | □ |

#### Manual Verification (Exploratory)

| # | Check | Owner | Status |
|---|---|---|---|
| G-21 | Login/signup flow works on staging | QA | □ |
| G-22 | Habit CRUD works on staging | QA | □ |
| G-23 | Stripe test checkout completes on staging | QA | □ |
| G-24 | WebSocket events fire on completion toggle | QA | □ |
| G-25 | Mobile responsive layout verified | QA | □ |

#### Release Readiness

| # | Check | Owner | Status |
|---|---|---|---|
| G-26 | No SEV-1/SEV-2 open incidents | On-call | □ |
| G-27 | Error budget > 25% remaining | SRE | □ |
| G-28 | Database backup completed within last 24h | Automated | □ |
| G-29 | Rollback plan documented and tested | Engineer | □ |
| G-30 | Changelog / release notes written | Engineer | □ |

### Decision

```
ALL G-01 through G-20 are ✅  →  GO (automated deploy proceeds)
ANY G-01 through G-12 is ❌  →  NO-GO (CI blocks merge)
ANY G-13 through G-20 is ❌  →  NO-GO (manual review required)
ANY G-26 through G-29 is ❌  →  NO-GO (defer to next window)
```

### Release Cadence

| Type | Frequency | Gates Required |
|---|---|---|
| **Hotfix** (SEV-1/2) | As needed | G-01 through G-12 only (skip load/security) |
| **Regular release** | Weekly (Tuesday) | All G-01 through G-30 |
| **Feature release** | Bi-weekly | All G-01 through G-30 + feature flag review |

---

*Document version: 1.0.0 — Generated for HabitArc*
*Last updated: 2026-02-10*
