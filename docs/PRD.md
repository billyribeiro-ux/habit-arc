# HabitArc — Product Requirements Document

**Version:** 1.0.0
**Author:** Principal Product + Platform Architect
**Date:** 2026-02-10
**Status:** APPROVED — ready for sprint planning

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Model](#2-business-model)
3. [Architecture Constraints](#3-architecture-constraints)
4. [User Personas](#4-user-personas)
5. [Feature Backlog (P0 / P1 / P2)](#5-feature-backlog)
6. [User Stories with Acceptance Criteria](#6-user-stories-with-acceptance-criteria)
7. [Domain Model & Invariants](#7-domain-model--invariants)
8. [Streak Engine Specification](#8-streak-engine-specification)
9. [Offline Queue & Sync Conflict Handling](#9-offline-queue--sync-conflict-handling)
10. [Freemium Entitlements Matrix](#10-freemium-entitlements-matrix)
11. [Data Privacy & Abuse Prevention](#11-data-privacy--abuse-prevention)
12. [API Contract Summary](#12-api-contract-summary)
13. [Risk Register & Mitigations](#13-risk-register--mitigations)
14. [Launch Plan](#14-launch-plan)
15. [KPI Definitions & Targets](#15-kpi-definitions--targets)
16. [Codebase Gap Analysis](#16-codebase-gap-analysis)

---

## 1. Executive Summary

HabitArc is a freemium habit-tracking PWA that lets users build streaks, log
mood/energy/stress, receive AI-powered weekly insights, and manage subscriptions
through Stripe. The product targets mobile-first individual users who want a
lightweight, fast, offline-capable habit tracker that "just works."

**Ship-first philosophy:** MVP in 1–2 weeks. Validate PMF with real users before
investing in polish. Every feature must justify its existence against the
question: *"Does this help a user complete a habit today?"*

**Domain authority rule:** The Rust Axum backend is the single source of truth
for all business logic — streaks, entitlements, billing state, ownership. The
Next.js frontend is a rendering layer only; it never computes domain state.

---

## 2. Business Model

### Tiers

| Tier | Price | Billing |
|------|-------|---------|
| **Free** | $0 | — |
| **Plus** | $4.99/mo | Stripe recurring |
| **Pro** | $9.99/mo | Stripe recurring |

### Revenue Hypothesis

- Free → Plus conversion target: **5–8%** within 30 days
- Plus → Pro upsell target: **10–15%** within 90 days
- Monthly churn ceiling: **< 8%** for paid tiers
- Break-even at **~2,000 paid subscribers** (blended ARPU ~$7)

### Monetization Levers

1. Habit count limits (Free: 3, Plus: 15, Pro: unlimited)
2. AI insights (Free: none, Plus: 1/week, Pro: unlimited)
3. Advanced analytics depth (Free: 7d, Plus: 30d, Pro: 365d)
4. Calendar heatmap export (Plus+)
5. Custom reminder schedules (Plus+)

---

## 3. Architecture Constraints

```
┌─────────────────────────────────────────────────┐
│                   User (PWA)                     │
│  Next.js 15 · React 19 · TanStack Query · Zustand│
│  Tailwind · shadcn/ui · Framer Motion · Recharts │
│  Service Worker · Offline Queue                  │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS / WSS
┌──────────────────▼──────────────────────────────┐
│              Rust Axum 0.7 API                   │
│  SQLx (compile-time SQL) · JWT rotation          │
│  Streak engine · Entitlement gate · Stripe hooks │
│  Claude API proxy · WebSocket broadcast          │
│  Structured tracing · Sentry                     │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│            PostgreSQL 16 (managed)               │
│  Enum types · JSONB configs · GIN indexes        │
│  Row-level security via application layer        │
└─────────────────────────────────────────────────┘
```

**Hard rules:**

- Frontend NEVER computes streaks, entitlements, or billing state.
- Every mutation flows through the Rust API.
- Offline mutations are queued client-side and replayed on reconnect; the
  server is the final arbiter of conflict resolution.
- All dates stored as UTC; timezone conversion happens at the API boundary
  using the user's declared `timezone` (IANA string).

---

## 4. User Personas

### P1 — "Casual Casey" (Free tier target)

- 22–35, tracks 1–3 habits, uses phone exclusively
- Wants: zero-friction daily check-in, streak motivation
- Converts to Plus when: hits habit limit or wants insights

### P2 — "Structured Sam" (Plus tier target)

- 28–45, tracks 5–12 habits with specific schedules
- Wants: weekly/custom schedules, analytics, reminders
- Converts to Pro when: wants unlimited + AI coaching

### P3 — "Optimizer Olivia" (Pro tier target)

- 30–50, quantified-self enthusiast
- Wants: mood correlation, deep analytics, data export, AI insights

---

## 5. Feature Backlog

### P0 — Must ship in MVP (Week 1–2)

| ID | Feature | Scope |
|----|---------|-------|
| P0-01 | Guest-first onboarding (3 screens) | FE + BE |
| P0-02 | Optional signup / login (email+password) | FE + BE |
| P0-03 | Habit CRUD | FE + BE |
| P0-04 | Schedule types: `daily`, `weekly_days`, `weekly_target` | BE model + FE form |
| P0-05 | One-tap toggle completion with optimistic UI | FE + BE |
| P0-06 | Timezone-safe streak engine | BE only |
| P0-07 | Calendar heatmap (current month + scroll) | FE + BE endpoint |
| P0-08 | Weekly review summary screen | FE + BE endpoint |
| P0-09 | Freemium entitlement enforcement | BE gate + FE paywall |
| P0-10 | Stripe subscription (Plus + Pro) | BE webhooks + FE checkout |
| P0-11 | Offline queue with sync-on-reconnect | FE service worker |
| P0-12 | PWA installability (manifest, icons, SW) | FE |

### P1 — Ship in Week 3–4

| ID | Feature | Scope |
|----|---------|-------|
| P1-01 | Mood / Energy / Stress daily logging | FE + BE |
| P1-02 | AI weekly insights via Claude | BE + FE |
| P1-03 | Deterministic fallback when Claude unavailable | BE |
| P1-04 | Push notification reminders | FE (Web Push) + BE scheduling |
| P1-05 | Habit archive / unarchive | FE + BE |
| P1-06 | Habit reorder (drag-and-drop) | FE + BE |
| P1-07 | Analytics: completion rate chart (7d/30d/90d) | FE + BE |

### P2 — Ship in Week 5+

| ID | Feature | Scope |
|----|---------|-------|
| P2-01 | Data export (CSV/JSON) | BE endpoint + FE trigger |
| P2-02 | Account deletion (GDPR) | BE + FE |
| P2-03 | Social sharing (streak cards) | FE |
| P2-04 | Habit templates gallery | FE + BE seed data |
| P2-05 | Dark/light theme toggle | FE |
| P2-06 | Sentry error tracking integration | FE + BE |
| P2-07 | Rate limiting (per-user, per-IP) | BE middleware |

---

## 6. User Stories with Acceptance Criteria

### P0-01: Guest-First Onboarding

**As a** new visitor,
**I want to** start using the app immediately without creating an account,
**so that** I can evaluate the product before committing.

**Acceptance Criteria:**

1. First launch shows a 3-screen onboarding carousel:
   - Screen 1: Value prop ("Build habits that stick")
   - Screen 2: How it works (tap to complete, streaks grow)
   - Screen 3: "Get Started" CTA → creates anonymous guest session
2. Guest session creates a `guest_token` (UUID) stored in `localStorage`.
3. Backend creates a `users` row with `is_guest = true`, `email = NULL`,
   `password_hash = NULL`.
4. Guest can create up to 3 habits (Free tier limit) and log completions.
5. A persistent banner shows "Sign up to save your progress" with dismiss.
6. Guest data is retained for 30 days; after that, a background job purges
   orphaned guest accounts.
7. "Sign up" from guest state merges the guest user into a full account
   (same `user_id`, adds email + password_hash, sets `is_guest = false`).

---

### P0-02: Optional Signup / Login

**As a** guest or returning user,
**I want to** create an account or sign in with email + password,
**so that** my data persists across devices.

**Acceptance Criteria:**

1. Registration requires: email (valid format), password (≥ 8 chars), name.
2. Password stored as Argon2id hash.
3. On success, server returns JWT access token (15 min TTL) + refresh token
   (7 day TTL).
4. Refresh token rotation: each refresh invalidates the old token and issues
   a new pair.
5. Login with wrong credentials returns 401 with generic message (no email
   enumeration).
6. If a guest token exists in `localStorage`, the signup request includes
   `guest_token` and the backend merges the guest account.
7. Frontend stores tokens in `localStorage` (not cookies — PWA constraint).

---

### P0-03: Habit CRUD

**As a** user,
**I want to** create, read, update, and delete habits,
**so that** I can define what I'm tracking.

**Acceptance Criteria:**

1. Create: name (required, 1–100 chars), description (optional, ≤ 500 chars),
   color (hex, default `#6366f1`), icon (string key, default `target`),
   frequency + config, target_per_day (≥ 1).
2. Read: `GET /api/habits` returns all non-archived habits for the user,
   ordered by `sort_order ASC`, with today's completion status.
3. Update: partial update via `PUT /api/habits/:id`. Only owner can update.
4. Delete: `DELETE /api/habits/:id`. Cascades to completions. Only owner.
5. Entitlement gate: creation fails with 403 + `upgrade_required` error code
   if user has reached their tier's habit limit.
6. Validation errors return 422 with field-level messages.

---

### P0-04: Schedule Types

**As a** user,
**I want to** set different schedule types for my habits,
**so that** not every habit needs to be daily.

**Acceptance Criteria:**

1. `daily` — habit is due every day. `frequency_config: {}`.
2. `weekly_days` — habit is due on specific days of the week.
   `frequency_config: { "days": [1, 3, 5] }` (1=Mon, 7=Sun, ISO 8601).
3. `weekly_target` — habit is due N times per week, any days.
   `frequency_config: { "times_per_week": 3 }`.
4. `GET /api/habits` response includes `is_due_today: bool` computed
   server-side using the user's timezone.
5. Streak engine respects schedule type: a `weekly_days` habit only breaks
   its streak if a *scheduled* day is missed.
6. Frontend schedule picker shows appropriate UI for each type.

---

### P0-05: One-Tap Toggle Completion

**As a** user,
**I want to** tap once to mark a habit complete (or undo it),
**so that** logging is frictionless.

**Acceptance Criteria:**

1. Tap on incomplete habit → `POST /api/completions` with `habit_id` and
   `completed_date` (user's local today, sent as ISO date string).
2. Tap on complete habit → `DELETE /api/completions/:id` (undo).
3. **Optimistic UI:** frontend immediately toggles state, rolls back on
   server error.
4. **Idempotency:** `POST /api/completions` with same `(habit_id, completed_date,
   user_id)` returns the existing completion (200) instead of creating a
   duplicate. Enforced by the DB unique index.
5. Completion triggers streak recalculation server-side.
6. WebSocket broadcasts `completion_changed` event to other open tabs.
7. Haptic feedback on mobile (via `navigator.vibrate`).
8. If offline, mutation is queued and synced on reconnect.

---

### P0-06: Timezone-Safe Streak Engine

**As a** user,
**I want** my streaks to be calculated based on my local timezone,
**so that** completing a habit at 11 PM doesn't count as "tomorrow."

**Acceptance Criteria:**

1. User model stores `timezone TEXT NOT NULL DEFAULT 'UTC'` (IANA string,
   e.g., `America/New_York`).
2. All streak calculations use the user's timezone to determine day boundaries.
3. `completed_date` is always a `DATE` (no time component) representing the
   user's local date.
4. The client sends `completed_date` as the user's local date; the server
   validates it is within ±1 day of server-now in the user's timezone (to
   prevent arbitrary backdating).
5. Streak rules by frequency type:
   - **daily:** streak increments if every calendar day has a completion.
     Missing one day resets to 0.
   - **weekly_days:** streak increments per scheduled day completed. Missing
     a scheduled day resets to 0. Non-scheduled days are ignored.
   - **weekly_target:** streak increments per ISO week where
     `completions_in_week >= times_per_week`. Missing a week resets to 0.
6. `current_streak` and `longest_streak` are denormalized on the `habits`
   table and recalculated on every completion create/delete.
7. Streak recalculation is idempotent — calling it twice produces the same
   result.

---

### P0-07: Calendar Heatmap

**As a** user,
**I want to** see a calendar heatmap of my completions,
**so that** I can visualize my consistency over time.

**Acceptance Criteria:**

1. `GET /api/habits/:id/heatmap?months=3` returns an array of
   `{ date: "2026-01-15", count: 2, target: 3 }` objects.
2. Frontend renders a GitHub-style grid: columns = weeks, rows = days.
3. Cell color intensity scales from 0% (no completions) to 100% (target met).
4. Tapping a cell shows a tooltip with date, count, and any note.
5. Free tier: 1 month of heatmap data. Plus: 6 months. Pro: 12 months.
6. Heatmap scrolls horizontally on mobile.

---

### P0-08: Weekly Review

**As a** user,
**I want to** see a summary of my past week,
**so that** I can reflect on my progress.

**Acceptance Criteria:**

1. `GET /api/stats/weekly-review` returns:
   ```json
   {
     "week_start": "2026-02-03",
     "week_end": "2026-02-09",
     "total_completions": 28,
     "total_possible": 35,
     "completion_rate": 0.80,
     "best_day": "Monday",
     "worst_day": "Saturday",
     "streak_changes": [
       { "habit_id": "...", "habit_name": "Meditate", "delta": +2 }
     ],
     "habits": [
       {
         "id": "...",
         "name": "Meditate",
         "completed": 6,
         "possible": 7,
         "rate": 0.857
       }
     ]
   }
   ```
2. Frontend shows a card-based review screen accessible from the dashboard.
3. "Possible" is calculated per-habit based on schedule type and the user's
   timezone.
4. Available every Monday (or on-demand via button).

---

### P0-09: Freemium Entitlement Enforcement

**As the** system,
**I want to** enforce tier limits server-side,
**so that** free users cannot access paid features.

**Acceptance Criteria:**

1. Entitlement checks happen in the Rust API, never in the frontend.
2. Frontend reads entitlements from `GET /api/me` response and shows/hides
   UI accordingly, but the server is the gate.
3. When a gated action is attempted, server returns:
   ```json
   {
     "error": {
       "code": "ENTITLEMENT_EXCEEDED",
       "message": "Upgrade to Plus to create more habits",
       "limit": 3,
       "current": 3,
       "upgrade_tier": "plus"
     }
   }
   ```
4. Frontend catches this and shows an upgrade modal with tier comparison.
5. Entitlement state is derived from `subscription_tier` on the `users`
   table, which is only mutated by Stripe webhook handlers.
6. See §10 for the full entitlements matrix.

---

### P0-10: Stripe Subscriptions

**As a** user,
**I want to** upgrade to Plus or Pro via Stripe Checkout,
**so that** I can unlock premium features.

**Acceptance Criteria:**

1. `POST /api/billing/checkout` accepts `{ price_id }` and returns
   `{ checkout_url }`. Frontend redirects to Stripe.
2. Stripe webhook `checkout.session.completed` → sets `subscription_tier`
   and `subscription_status` on the user.
3. Webhook `customer.subscription.updated` → updates status (active,
   past_due, etc.).
4. Webhook `customer.subscription.deleted` → downgrades to Free tier.
5. Webhook signature verification using `STRIPE_WEBHOOK_SECRET`.
6. `GET /api/billing/subscription` returns current tier, status, and
   Stripe customer portal URL.
7. Users can manage/cancel via Stripe Customer Portal (link provided in
   settings).
8. Grace period: `past_due` status retains paid features for 7 days.

---

### P0-11: Offline Queue & Sync

**As a** user,
**I want** the app to work offline and sync when I reconnect,
**so that** I never lose a completion.

**Acceptance Criteria:**

1. Service worker caches app shell and recent API responses.
2. When offline, mutations (create completion, delete completion) are
   stored in IndexedDB with timestamps.
3. On reconnect, queued mutations replay in chronological order.
4. **Conflict resolution:** if a `POST /api/completions` returns a unique
   constraint violation (completion already exists), the client treats it
   as success (idempotent).
5. If a `DELETE /api/completions/:id` returns 404 (already deleted), the
   client treats it as success.
6. Offline indicator badge shown in the header.
7. Queue count badge shown when items are pending sync.
8. After sync completes, `invalidateQueries` refreshes all stale data.

---

### P0-12: PWA Installability

**As a** mobile user,
**I want to** install HabitArc to my home screen,
**so that** it feels like a native app.

**Acceptance Criteria:**

1. Valid `manifest.json` with name, icons (192px, 512px), theme color,
   `display: standalone`, `start_url: /dashboard`.
2. Service worker registered on first load.
3. Meets Chrome's installability criteria (HTTPS, SW, manifest).
4. iOS: `apple-mobile-web-app-capable` meta tag.
5. Install prompt shown after 3rd visit (stored in `localStorage`).

---

### P1-01: Mood / Energy / Stress Logging

**As a** user,
**I want to** log my mood, energy, and stress each day,
**so that** I can correlate them with my habits.

**Acceptance Criteria:**

1. New table `daily_logs`:
   ```sql
   CREATE TABLE daily_logs (
     id UUID PRIMARY KEY,
     user_id UUID NOT NULL REFERENCES users(id),
     log_date DATE NOT NULL,
     mood INTEGER CHECK (mood BETWEEN 1 AND 5),
     energy INTEGER CHECK (energy BETWEEN 1 AND 5),
     stress INTEGER CHECK (stress BETWEEN 1 AND 5),
     note TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(user_id, log_date)
   );
   ```
2. `POST /api/daily-logs` — upsert for the given date.
3. `GET /api/daily-logs?start_date=...&end_date=...` — range query.
4. Frontend shows a quick-entry card on the dashboard (3 sliders + optional
   note).
5. Available to all tiers (mood data drives AI insight quality for upsell).

---

### P1-02 + P1-03: AI Weekly Insights with Deterministic Fallback

**As a** Plus/Pro user,
**I want to** receive AI-generated weekly insights about my habits,
**so that** I get personalized coaching.

**Acceptance Criteria:**

1. `GET /api/insights/weekly` triggers insight generation.
2. Backend gathers: 7-day completions, streaks, mood/energy/stress logs,
   schedule adherence rates.
3. Sends structured prompt to Claude API with JSON-mode response.
4. Response schema:
   ```json
   {
     "summary": "string",
     "wins": ["string"],
     "improvements": ["string"],
     "mood_correlation": "string | null",
     "streak_analysis": "string",
     "tip_of_the_week": "string"
   }
   ```
5. **Deterministic fallback** when Claude is unavailable or returns error:
   - Compute: best habit (highest completion rate), worst habit (lowest),
     current longest streak, average mood.
   - Generate template-based insight:
     `"Great week! You completed {best_habit} {rate}% of the time. Consider focusing on {worst_habit} next week."`
   - Return with `"source": "fallback"` flag so frontend can indicate it.
6. Insights are cached in a `weekly_insights` table (one per user per
   ISO week) to avoid redundant Claude calls.
7. Entitlement: Free = none, Plus = 1/week (auto-generated Monday),
   Pro = on-demand regeneration.

---

### P1-04: Push Notification Reminders

**As a** user,
**I want to** receive reminders for my habits,
**so that** I don't forget.

**Acceptance Criteria:**

1. Habits have an optional `reminder_time` (already in schema).
2. Frontend requests Web Push permission on first reminder setup.
3. `POST /api/push/subscribe` stores the push subscription endpoint.
4. Backend cron job (or Tokio interval) checks due reminders every minute,
   sends Web Push notifications.
5. Notification body: "{habit_name} — time to check in!"
6. Tapping notification opens the app to the dashboard.
7. Free tier: 1 reminder. Plus: unlimited. Pro: unlimited + custom schedules.

---

## 7. Domain Model & Invariants

### Entity Relationship

```
User 1──* Habit 1──* Completion
User 1──* DailyLog
User 1──* WeeklyInsight
User 1──* PushSubscription
User 1──* RefreshToken
```

### Invariants (enforced server-side)

| # | Invariant | Enforcement |
|---|-----------|-------------|
| I-1 | A user can only access their own habits, completions, and logs. | Every query includes `WHERE user_id = $auth_user_id`. |
| I-2 | A completion is unique per `(habit_id, user_id, completed_date)`. | DB unique index + application upsert logic. |
| I-3 | `completed_date` must be within ±1 day of server-now in the user's timezone. | Validation in `create_completion` handler. |
| I-4 | Habit count per user ≤ tier limit. | Checked in `create_habit` before INSERT. |
| I-5 | `current_streak` and `longest_streak` are always consistent with completions. | Recalculated on every completion mutation. |
| I-6 | Streak recalculation is idempotent. | Pure function of completion dates + schedule config. |
| I-7 | `subscription_tier` is only mutated by Stripe webhook handlers. | No other code path writes to this column. |
| I-8 | Guest accounts are purged after 30 days of inactivity. | Background job checks `is_guest = true AND updated_at < NOW() - 30 days`. |
| I-9 | Refresh tokens are single-use. | Token rotation: old token revoked on each refresh. |
| I-10 | Deleted habits cascade-delete their completions. | `ON DELETE CASCADE` FK constraint. |
| I-11 | Mood/energy/stress values are 1–5 inclusive. | DB CHECK constraint + API validation. |
| I-12 | AI insights are cached per user per ISO week. | Unique index on `(user_id, iso_year, iso_week)`. |

### Idempotency Rules

| Operation | Idempotency Key | Behavior on Duplicate |
|-----------|----------------|----------------------|
| Create completion | `(habit_id, user_id, completed_date)` | Return existing row (200), no side effects |
| Delete completion | `completion_id` | Return 200 if already deleted (not 404) |
| Toggle completion | Client sends `completed_date` | Server upserts or deletes based on current state |
| Stripe webhook | `event.id` | Store processed event IDs; skip duplicates |
| Offline queue replay | `client_mutation_id` (UUID) | Server checks idempotency key header |

---

## 8. Streak Engine Specification

### Algorithm: `calculate_streak(habit, completions, user_timezone)`

```
INPUT:
  habit.frequency: daily | weekly_days | weekly_target
  habit.frequency_config: {} | { days: [1..7] } | { times_per_week: N }
  completions: Vec<NaiveDate>  (sorted DESC, user's local dates)
  today: NaiveDate  (user's local today)

OUTPUT:
  current_streak: i32
  longest_streak: i32

ALGORITHM (daily):
  current = 0
  check = today
  for each date in completions (DESC):
    if date == check:
      current += 1
      check = check - 1 day
    elif date < check:
      break
  // longest: scan all completions for max consecutive run

ALGORITHM (weekly_days):
  scheduled_days = habit.frequency_config.days  // e.g., [1, 3, 5]
  current = 0
  // Walk backwards from today through scheduled days only
  check = most_recent_scheduled_day(today, scheduled_days)
  for each scheduled_day walking backwards:
    if scheduled_day is in completions:
      current += 1
    else:
      break
  // longest: same scan over all scheduled days

ALGORITHM (weekly_target):
  target = habit.frequency_config.times_per_week
  current = 0
  // Walk backwards through ISO weeks
  current_week = iso_week(today)
  for each week walking backwards:
    count = completions in this ISO week
    if count >= target:
      current += 1
    else:
      break
  // If current week is incomplete (not Sunday yet), don't count it
  // against the streak — only check completed weeks + current partial
```

### Edge Cases

| Case | Behavior |
|------|----------|
| User changes timezone | Streak recalculated on next completion using new TZ. No retroactive adjustment. |
| User changes habit frequency | Streak resets to 0. `longest_streak` preserved. |
| Completion deleted for past date | Full streak recalculation from scratch. |
| Multiple completions same day | Only one counts toward streak (idempotent). `value` field tracks quantity for target_per_day habits. |
| Habit created today, no completions yet | `current_streak = 0`. Not a "miss" — streak starts on first completion. |
| Habit archived | Streak frozen. Unarchive resumes from where it was (recalculated). |

---

## 9. Offline Queue & Sync Conflict Handling

### Queue Structure (IndexedDB)

```typescript
interface QueuedMutation {
  id: string;              // client-generated UUID
  timestamp: number;       // Date.now() at queue time
  endpoint: string;        // e.g., "/api/completions"
  method: "POST" | "DELETE";
  body?: object;
  idempotencyKey: string;  // e.g., "{habit_id}:{completed_date}"
  retryCount: number;
  status: "pending" | "syncing" | "failed";
}
```

### Sync Protocol

1. On `navigator.onLine` → true, drain queue in FIFO order.
2. For each mutation:
   a. Set `status = "syncing"`.
   b. Send request with `X-Idempotency-Key: {idempotencyKey}` header.
   c. On 2xx → remove from queue.
   d. On 409 (conflict) or unique violation → treat as success, remove.
   e. On 404 (for DELETE) → treat as success, remove.
   f. On 4xx (validation) → mark as `failed`, surface to user.
   g. On 5xx or network error → increment `retryCount`, retry with
      exponential backoff (1s, 2s, 4s, max 30s, max 5 retries).
3. After queue is drained, call `queryClient.invalidateQueries()` to
   refresh all cached data.

### Conflict Resolution Matrix

| Scenario | Resolution |
|----------|-----------|
| User completes habit offline; same completion exists on server | Server returns existing row (idempotent). Client accepts. |
| User deletes completion offline; already deleted on server | Server returns 200 (idempotent delete). Client accepts. |
| User creates habit offline; at tier limit | Server returns 403. Client shows upgrade prompt, removes from queue. |
| Two devices complete same habit for same day | First write wins (unique index). Second is idempotent success. |
| Clock skew: client date ≠ server date | Server validates ±1 day tolerance. Rejects if outside window. |

---

## 10. Freemium Entitlements Matrix

| Feature | Free | Plus ($4.99) | Pro ($9.99) |
|---------|------|-------------|-------------|
| Active habits | 3 | 15 | Unlimited |
| Schedule types | daily only | All | All |
| Streak tracking | ✓ | ✓ | ✓ |
| Calendar heatmap | 1 month | 6 months | 12 months |
| Analytics depth | 7 days | 30 days | 365 days |
| Weekly review | Basic (counts only) | Full | Full |
| Mood/Energy/Stress logging | ✓ | ✓ | ✓ |
| AI weekly insights | — | 1/week (auto) | On-demand + auto |
| Reminders | 1 habit | Unlimited | Unlimited + custom |
| Data export | — | — | CSV + JSON |
| Heatmap export (image) | — | ✓ | ✓ |
| Priority support | — | — | ✓ |

### Enforcement Points (all server-side)

```rust
pub fn check_entitlement(tier: &SubscriptionTier, action: EntitlementAction) -> Result<(), AppError> {
    match (tier, action) {
        (Free, CreateHabit { current_count }) if current_count >= 3 => Err(upgrade_required("plus")),
        (Plus, CreateHabit { current_count }) if current_count >= 15 => Err(upgrade_required("pro")),
        (Free, SetSchedule { kind }) if kind != Daily => Err(upgrade_required("plus")),
        (Free, RequestInsight) => Err(upgrade_required("plus")),
        (Plus, RequestInsight { this_week_count }) if this_week_count >= 1 => Err(upgrade_required("pro")),
        (Free, ExportData) => Err(upgrade_required("pro")),
        _ => Ok(()),
    }
}
```

---

## 11. Data Privacy & Abuse Prevention

### Data Privacy

| Policy | Implementation |
|--------|---------------|
| **Minimal data collection** | Only email, name, habit data, mood logs. No tracking pixels, no third-party analytics at MVP. |
| **Encryption at rest** | Managed Postgres with encryption at rest (provider default). |
| **Encryption in transit** | TLS everywhere. HSTS headers. |
| **Password security** | Argon2id with default params. Never logged, never returned in API responses. |
| **Token security** | JWTs in `localStorage` (PWA constraint). Short-lived access (15 min). Refresh rotation. |
| **Right to deletion** | `DELETE /api/account` cascades all user data. Stripe customer deleted via API. |
| **Right to export** | `GET /api/account/export` returns all user data as JSON (Pro tier, or on account deletion for all tiers). |
| **Guest data retention** | 30-day TTL. Purged by background job. |
| **AI data handling** | Habit names + completion counts sent to Claude. No PII (email, name) in prompts. Logged prompts are redacted. |
| **Cookie policy** | No cookies used. All state in `localStorage` + IndexedDB. |

### Abuse Prevention

| Threat | Mitigation |
|--------|-----------|
| **Brute-force login** | Rate limit: 5 attempts per email per 15 min. 429 response with `Retry-After` header. |
| **API abuse** | Per-user rate limit: 100 req/min (Free), 300 req/min (Plus), 1000 req/min (Pro). |
| **Spam registrations** | Email verification required within 24h for full account features. Guest accounts are sandboxed. |
| **Completion stuffing** | ±1 day date validation. Max 1 completion per habit per day (unique index). Max `value` of 100 per completion. |
| **Stripe webhook replay** | Verify signature. Store processed `event.id` in `stripe_events` table. Skip duplicates. |
| **XSS** | React's default escaping. CSP headers. No `dangerouslySetInnerHTML`. |
| **CSRF** | Not applicable (no cookies; Bearer token auth). |
| **SQL injection** | SQLx compile-time verified queries. No string interpolation. |
| **Denial of wallet (AI)** | Claude calls rate-limited per user. Cached per ISO week. Max 1 call per user per hour. |

---

## 12. API Contract Summary

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Create account (or upgrade guest) |
| POST | `/api/auth/login` | — | Email + password login |
| POST | `/api/auth/refresh` | — | Rotate refresh token |
| POST | `/api/auth/guest` | — | Create guest session |
| GET | `/api/me` | JWT | Current user profile + entitlements |

### Habits

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/habits` | JWT | List active habits with today's status |
| POST | `/api/habits` | JWT | Create habit (entitlement-gated) |
| GET | `/api/habits/:id` | JWT | Get single habit |
| PUT | `/api/habits/:id` | JWT | Update habit |
| DELETE | `/api/habits/:id` | JWT | Delete habit + cascade completions |
| GET | `/api/habits/:id/heatmap` | JWT | Calendar heatmap data |

### Completions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/completions` | JWT | Create (idempotent) |
| DELETE | `/api/completions/:id` | JWT | Delete (idempotent) |
| POST | `/api/completions/toggle` | JWT | Toggle for a habit+date |
| GET | `/api/completions` | JWT | List with date range filter |

### Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats/daily` | JWT | Daily completion rates |
| GET | `/api/stats/weekly-review` | JWT | Weekly review summary |
| GET | `/api/habits/:id/streak` | JWT | Streak info for a habit |

### Daily Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/daily-logs` | JWT | Upsert mood/energy/stress |
| GET | `/api/daily-logs` | JWT | List with date range filter |

### Insights

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/insights/weekly` | JWT | AI weekly insight (entitlement-gated) |

### Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/billing/subscription` | JWT | Current subscription info |
| POST | `/api/billing/checkout` | JWT | Create Stripe Checkout session |
| POST | `/api/billing/webhook` | Stripe sig | Stripe webhook receiver |
| GET | `/api/billing/portal` | JWT | Stripe Customer Portal URL |

### Push

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/push/subscribe` | JWT | Register push subscription |
| DELETE | `/api/push/subscribe` | JWT | Unregister |

### Account

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| DELETE | `/api/account` | JWT | Delete account + all data |
| GET | `/api/account/export` | JWT | Export all user data (Pro or on deletion) |

---

## 13. Risk Register & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R-1 | Claude API downtime during insight generation | Medium | Low | Deterministic fallback (P1-03). Cached insights. User sees "AI unavailable" gracefully. |
| R-2 | Stripe webhook delivery failure | Low | High | Webhook retry (Stripe built-in). Idempotent handler. Manual reconciliation endpoint. Alert on missing events. |
| R-3 | Timezone bugs in streak calculation | High | High | Comprehensive unit tests for every schedule type × timezone edge case. Property-based testing with `proptest`. Server-side only calculation. |
| R-4 | Offline queue data loss (browser storage cleared) | Medium | Medium | Warn users that guest data is volatile. Prompt signup after first completion. IndexedDB is more persistent than localStorage. |
| R-5 | PWA install rate too low | Medium | Low | Progressive disclosure: show install prompt after 3rd visit. In-app banner. Not a revenue blocker. |
| R-6 | Free tier too generous → low conversion | Medium | High | Start conservative (3 habits). A/B test limit (3 vs 5). Track conversion funnel per cohort. |
| R-7 | Free tier too restrictive → high churn | Medium | High | Monitor D1/D7 retention for free users. If < 30% D7, relax limits. Mood logging is free (drives engagement). |
| R-8 | Completion stuffing / cheating | Low | Low | ±1 day validation. Rate limiting. No leaderboard in MVP (removes incentive). |
| R-9 | GDPR deletion request backlog | Low | Medium | `DELETE /api/account` is synchronous cascade. Stripe customer deletion async but immediate. Audit log. |
| R-10 | Database performance at scale (>100k users) | Low (MVP) | High (later) | Indexes on all query paths. Connection pooling. Read replicas when needed. Partitioning completions by date if >10M rows. |
| R-11 | JWT stolen from localStorage | Medium | High | Short access TTL (15 min). Refresh rotation (single-use). No sensitive data in JWT payload. Logout revokes all refresh tokens. |
| R-12 | Scope creep delays MVP | High | High | P0 is locked. No P1 features enter sprint until P0 is shipped. PRD is the contract. |

---

## 14. Launch Plan

### Week 1: Core Build

| Day | Deliverable |
|-----|------------|
| Mon | DB migration v2 (guest users, timezone, daily_logs, schedule types). Backend: guest auth, timezone-aware streak engine. |
| Tue | Backend: schedule-aware habit CRUD, toggle completion endpoint, heatmap endpoint. |
| Wed | Backend: weekly review endpoint, entitlement enforcement with new tier limits (3/15/∞). Frontend: onboarding carousel, guest flow. |
| Thu | Frontend: habit list with one-tap toggle + optimistic UI, schedule picker, heatmap component. |
| Fri | Frontend: weekly review screen, billing/upgrade flow. Offline queue with IndexedDB. |

### Week 2: Polish + Ship

| Day | Deliverable |
|-----|------------|
| Mon | Integration testing. Stripe webhook testing with CLI. Streak engine unit tests (all schedule types × timezones). |
| Tue | PWA audit (Lighthouse ≥ 90). Offline testing. Error states. Loading skeletons. |
| Wed | Deploy: backend to Fly.io, frontend to Vercel. Managed Postgres provisioned. DNS + SSL. |
| Thu | Smoke testing on production. Invite 10 beta testers. Fix critical bugs. |
| Fri | **Public launch.** Post on Product Hunt, Twitter/X, relevant subreddits. |

### Week 3–4: P1 Features

| Feature | Target |
|---------|--------|
| Mood/Energy/Stress logging | Week 3 Mon–Tue |
| AI weekly insights + fallback | Week 3 Wed–Thu |
| Push notification reminders | Week 3 Fri – Week 4 Mon |
| Analytics charts (7d/30d/90d) | Week 4 Tue–Wed |
| Habit archive/reorder | Week 4 Thu–Fri |

---

## 15. KPI Definitions & Targets

### Primary Metrics

| KPI | Definition | Week 2 Target | Month 1 Target | Month 3 Target |
|-----|-----------|---------------|----------------|----------------|
| **DAU** | Unique users with ≥ 1 completion in a calendar day | 50 | 500 | 2,000 |
| **D1 Retention** | % of new users who return the next day | 40% | 45% | 50% |
| **D7 Retention** | % of new users who return on day 7 | 20% | 25% | 30% |
| **D30 Retention** | % of new users who return on day 30 | — | 15% | 20% |
| **Free → Plus Conversion** | % of free users who subscribe within 30 days | — | 3% | 5–8% |
| **Monthly Churn (paid)** | % of paid users who cancel in a month | — | < 12% | < 8% |
| **Completions/DAU** | Avg completions per active user per day | 2.0 | 3.0 | 4.0 |
| **Streak Length (median)** | Median current streak across active users | 2 | 5 | 10 |

### Instrumentation

All metrics computed from server-side data (completions table, users table,
Stripe events). No client-side analytics SDK in MVP.

```sql
-- DAU
SELECT COUNT(DISTINCT user_id)
FROM completions
WHERE completed_date = CURRENT_DATE;

-- D7 Retention
SELECT
  COUNT(DISTINCT CASE WHEN c.completed_date = u.created_at::date + 7
    THEN u.id END)::float /
  NULLIF(COUNT(DISTINCT u.id), 0)
FROM users u
LEFT JOIN completions c ON c.user_id = u.id
WHERE u.created_at::date = CURRENT_DATE - 7;
```

### Alerting Thresholds

| Metric | Alert if |
|--------|---------|
| DAU | Drops > 20% day-over-day |
| D1 Retention | Falls below 30% |
| Error rate (5xx) | Exceeds 1% of requests |
| P95 latency | Exceeds 500ms |
| Stripe webhook failures | Any unprocessed event > 1 hour old |

---

## 16. Codebase Gap Analysis

The following gaps exist between this PRD and the current codebase. These
must be addressed before MVP ship.

### Backend Gaps

| # | Gap | PRD Ref | Current State | Action Required |
|---|-----|---------|---------------|-----------------|
| G-1 | No guest user support | P0-01 | `users.email` is `NOT NULL`, no `is_guest` column | Add migration: `is_guest BOOL DEFAULT false`, make `email` nullable, add `guest_token UUID`, add `POST /api/auth/guest` endpoint |
| G-2 | No `timezone` on user | P0-06 | Missing column | Add `timezone TEXT NOT NULL DEFAULT 'UTC'` to users. All streak/date logic must use it. |
| G-3 | Subscription tiers are `Free/Pro/Team` | §2 | Enum: `free, pro, team` | Change to `free, plus, pro`. Requires new migration altering enum. |
| G-4 | Habit limits are 5/50/200 | §10 | Hardcoded in `create_habit` | Change to 3/15/unlimited per new entitlement matrix. |
| G-5 | No `weekly_days` or `weekly_target` schedule support | P0-04 | Enum has `daily, weekly, custom` but no schedule-aware logic | Change enum to `daily, weekly_days, weekly_target`. Update streak engine to be schedule-aware. |
| G-6 | Streak engine is not timezone-aware | P0-06 | Uses `Utc::now().date_naive()` | Must convert to user's timezone before computing "today". |
| G-7 | Streak engine doesn't respect schedule types | P0-06 | Only handles daily consecutive | Implement `weekly_days` and `weekly_target` algorithms per §8. |
| G-8 | No `is_due_today` in habit response | P0-04 | `HabitWithStatus` has `completed_today` and `is_complete` only | Add `is_due_today: bool` computed from schedule + user timezone. |
| G-9 | No heatmap endpoint | P0-07 | Missing | Add `GET /api/habits/:id/heatmap` endpoint. |
| G-10 | No weekly review endpoint | P0-08 | Missing | Add `GET /api/stats/weekly-review` endpoint. |
| G-11 | No toggle completion endpoint | P0-05 | Separate create + delete | Add `POST /api/completions/toggle` that creates or deletes based on current state. |
| G-12 | Completion idempotency not handled | P0-05 | INSERT will fail on unique constraint | Handle `ON CONFLICT` to return existing row. |
| G-13 | Delete completion returns 404 instead of 200 | P0-11 | Returns `AppError::NotFound` | Change to return 200 for idempotent deletes. |
| G-14 | No `daily_logs` table or endpoints | P1-01 | Missing | Add table, model, and CRUD endpoints. |
| G-15 | No `weekly_insights` caching table | P1-02 | Insights computed on every request | Add table + cache logic. |
| G-16 | No deterministic fallback for insights | P1-03 | Returns error if Claude fails | Implement template-based fallback. |
| G-17 | No Stripe webhook signature verification | P0-10 | Parses body directly | Add HMAC verification using `STRIPE_WEBHOOK_SECRET`. |
| G-18 | No Stripe event deduplication | §11 | Missing | Add `stripe_events` table, check before processing. |
| G-19 | No `POST /api/auth/guest` endpoint | P0-01 | Missing | Implement guest session creation. |
| G-20 | No account deletion endpoint | §11 | Missing | Add `DELETE /api/account`. |
| G-21 | No data export endpoint | §12 | Missing | Add `GET /api/account/export`. |
| G-22 | No rate limiting middleware | §11 | Missing | Add per-user + per-IP rate limiting. |
| G-23 | Completion date validation missing | P0-06, I-3 | Accepts any date | Add ±1 day validation against user's timezone. |

### Frontend Gaps

| # | Gap | PRD Ref | Current State | Action Required |
|---|-----|---------|---------------|-----------------|
| F-1 | No onboarding carousel | P0-01 | Direct redirect to login | Build 3-screen onboarding with guest CTA. |
| F-2 | No guest session flow | P0-01 | Requires login | Add guest token management in auth store. |
| F-3 | No schedule type picker | P0-04 | Create dialog has no schedule UI | Add frequency selector with config fields. |
| F-4 | No optimistic UI for completions | P0-05 | Waits for server response | Add optimistic update in TanStack Query mutation. |
| F-5 | No calendar heatmap component | P0-07 | Missing | Build heatmap grid component with Recharts or custom SVG. |
| F-6 | No weekly review screen | P0-08 | Missing | Build review card UI. |
| F-7 | No upgrade/paywall modal | P0-09 | Missing | Build modal triggered by 403 `ENTITLEMENT_EXCEEDED`. |
| F-8 | Offline queue uses `localStorage` | P0-11 | `localStorage` in offline store | Migrate to IndexedDB for reliability. |
| F-9 | No offline indicator with queue count | P0-11 | Shows online/offline icon only | Add pending sync count badge. |
| F-10 | No mood/energy/stress entry UI | P1-01 | Missing | Build slider card component. |
| F-11 | No haptic feedback on completion | P0-05 | Missing | Add `navigator.vibrate(50)` on tap. |

---

*End of PRD. This document is the contract. No P1 feature enters the sprint
until all P0 items are shipped and verified.*
