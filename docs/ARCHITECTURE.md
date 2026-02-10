# HabitArc — System Architecture

> Principal Rust Architect specification for the Smart Habit Tracker backend.
> Axum 0.7 · Tokio · SQLx (compile-time) · Postgres 16 · JWT + refresh rotation
> Stripe webhook-driven billing · Claude async insights · WebSocket live updates

---

## Table of Contents

1. [High-Level Topology](#1-high-level-topology)
2. [Bounded Contexts](#2-bounded-contexts)
3. [Sequence Diagrams](#3-sequence-diagrams)
4. [Consistency Model](#4-consistency-model)
5. [Reliability Model](#5-reliability-model)
6. [Security Model](#6-security-model)
7. [Data Model Summary](#7-data-model-summary)
8. [Appendix: Edge Cases](#8-appendix-edge-cases)

---

## 1. High-Level Topology

```
                          ┌─────────────────────────────────┐
                          │        Next.js Frontend          │
                          │  (Vercel / static + SSR)         │
                          │  IndexedDB offline queue         │
                          └──────────┬──────────┬───────────┘
                                     │ HTTPS    │ WSS
                                     ▼          ▼
                          ┌──────────────────────────────────┐
                          │         Fly.io / Railway          │
                          │  ┌────────────────────────────┐  │
                          │  │     Axum API Process        │  │
                          │  │                            │  │
                          │  │  ┌──────────┐ ┌─────────┐ │  │
                          │  │  │ HTTP     │ │ WS      │ │  │
                          │  │  │ Router   │ │ Router  │ │  │
                          │  │  └────┬─────┘ └────┬────┘ │  │
                          │  │       │            │      │  │
                          │  │  ┌────▼────────────▼────┐ │  │
                          │  │  │   Middleware Stack    │ │  │
                          │  │  │  (auth, rate-limit,  │ │  │
                          │  │  │   tracing, CORS)     │ │  │
                          │  │  └────┬─────────────────┘ │  │
                          │  │       │                   │  │
                          │  │  ┌────▼─────────────────┐ │  │
                          │  │  │   Service Layer       │ │  │
                          │  │  │  (domain logic)       │ │  │
                          │  │  └────┬─────────────────┘ │  │
                          │  │       │                   │  │
                          │  │  ┌────▼─────────────────┐ │  │
                          │  │  │   Repository Layer    │ │  │
                          │  │  │  (SQLx compile-time)  │ │  │
                          │  │  └────┬─────────────────┘ │  │
                          │  └───────┼───────────────────┘  │
                          └──────────┼──────────────────────┘
                                     │
                          ┌──────────▼──────────────────────┐
                          │     Postgres 16 (Managed)       │
                          │  ┌──────────────────────────┐   │
                          │  │ users, habits, completions│   │
                          │  │ daily_logs, weekly_insights│  │
                          │  │ refresh_tokens, stripe_evts│  │
                          │  └──────────────────────────┘   │
                          └─────────────────────────────────┘

  External:
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │  Stripe API  │   │  Claude API  │   │   Sentry     │
  │  (billing)   │   │  (insights)  │   │  (errors)    │
  └──────────────┘   └──────────────┘   └──────────────┘
```

### Process Model

Single Axum process per Fly.io machine. Tokio multi-threaded runtime.
No separate worker process — background jobs (insight generation, guest cleanup,
streak recalculation) run as `tokio::spawn` tasks within the same process.

**Rationale:** At MVP scale (<10k DAU), a single process with Tokio tasks is
simpler to deploy, monitor, and reason about than a separate job queue. When
scale demands it, extract to a dedicated worker binary reading from a Postgres
`job_queue` table.

---

## 2. Bounded Contexts

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HabitArc Backend                             │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  Identity    │  │  Habits     │  │  Streak     │  │  Review   │ │
│  │  & Auth      │  │  & Schedule │  │  Engine     │  │  & Stats  │ │
│  │             │  │  & Complete │  │             │  │           │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │
│         │                │                │                │       │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌─────┴─────┐ │
│  │  Mood       │  │  Notif-     │  │  Billing    │  │  Insights │ │
│  │  Tracking   │  │  ications   │  │  & Entitle  │  │  Engine   │ │
│  │             │  │             │  │             │  │           │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Identity & Auth

**Owns:** `users`, `refresh_tokens`
**Exposes:** `AuthUser` (extracted via middleware), `UserProfile`, `UserEntitlements`

| Responsibility | Implementation |
|---|---|
| Guest creation | `POST /api/auth/guest` → insert `is_guest=true`, return JWT + `guest_token` |
| Registration | `POST /api/auth/register` → argon2 hash, optional `guest_token` merge |
| Login | `POST /api/auth/login` → verify argon2, issue JWT pair |
| Token refresh | `POST /api/auth/refresh` → rotate refresh token, revoke old |
| Profile | `GET /api/me` → `User` → `UserProfile` (includes computed entitlements) |

**Invariants:**
- `email` is `Option<String>` — NULL for guests, UNIQUE NOT NULL for registered users.
- `guest_token` is a UUID stored in client `localStorage`; used as merge key on register.
- Refresh tokens are stored as SHA-256 hashes; raw token never persists server-side.
- On rotation, the old refresh token row is marked `revoked=true`.
- Guest accounts with no activity for 30 days are purged by a background task.

**Module map:**
```
auth/
├── jwt.rs          Claims, create_token_pair, verify_token
├── middleware.rs    require_auth extractor → Extension<AuthUser>
├── password.rs     hash_password, verify_password (argon2)
└── mod.rs
handlers/
└── auth.rs         register, login, refresh, guest, me
models/
└── user.rs         User, UserProfile, UserEntitlements, SubscriptionTier
```

### 2.2 Habits, Schedules & Completions

**Owns:** `habits`, `completions`
**Depends on:** Identity (ownership check), Billing (entitlement enforcement)

| Responsibility | Implementation |
|---|---|
| CRUD habits | Standard REST; `create_habit` enforces tier habit limit |
| Schedule types | `HabitFrequency` enum: `daily`, `weekly_days`, `weekly_target` |
| `frequency_config` | JSONB: `{}` for daily, `{"days":[1,3,5]}` for weekly_days, `{"times_per_week":3}` for weekly_target |
| Toggle completion | `POST /api/completions/toggle` — idempotent create-or-delete |
| Create completion | `POST /api/completions` — `ON CONFLICT` idempotent |
| Delete completion | `DELETE /api/completions/:id` — returns 200 even if already gone |
| `is_due_today` | Computed at query time from `frequency`, `frequency_config`, user `timezone` |

**Invariants:**
- `UNIQUE(habit_id, completed_date, user_id)` — one completion per habit per local date.
- `completed_date` must be within ±1 calendar day of server-now (prevents backdating abuse).
- Habit limit enforced server-side: Free=3, Plus=15, Pro=unlimited.
- Schedule type gating: Free can only use `daily`; Plus/Pro can use all three.
- All mutations broadcast `completion_changed` via WebSocket channel.

**Module map:**
```
handlers/
├── habits.rs        list_habits (with is_due_today), create/get/update/delete
└── completions.rs   create, toggle, delete, list, get_streak, get_heatmap
models/
├── habit.rs         Habit, HabitFrequency, HabitWithStatus, CreateHabitRequest
└── completion.rs    Completion, StreakInfo, DailyStats
```

### 2.3 Streak Engine

**Owns:** `habits.current_streak`, `habits.longest_streak`, `habits.total_completions`
**Triggered by:** Completion create/delete/toggle

```
                    ┌──────────────────┐
                    │  toggle/create/  │
                    │  delete handler  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  update_streak() │
                    │  (async fn)      │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ SELECT DISTINCT  │
                    │ completed_date   │
                    │ ORDER BY DESC    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Walk backwards   │
                    │ from today:      │
                    │ consecutive?     │
                    │ → current_streak │
                    │                  │
                    │ Walk forwards    │
                    │ from earliest:   │
                    │ max consecutive  │
                    │ → longest_streak │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ UPDATE habits    │
                    │ SET current_     │
                    │ streak, longest_ │
                    │ streak, total_   │
                    │ completions      │
                    └──────────────────┘
```

**Streak rules:**
- `current_streak`: count of consecutive scheduled days ending at today (or yesterday if today has no completion yet) where a completion exists.
- For `daily`: every calendar day counts.
- For `weekly_days`: only the configured days count. Skipped non-scheduled days don't break the streak.
- For `weekly_target`: streak increments if the week's completion count ≥ `times_per_week`.
- `longest_streak`: `GREATEST(longest_streak, current_streak)` — monotonically non-decreasing.
- All dates evaluated in user's IANA timezone (e.g., `America/New_York`).

**Edge cases:**
- Timezone change mid-streak: re-evaluate from completion dates. May cause a ±1 day shift.
- Backdated completion (yesterday): recalculates streak including that date.
- Completion deleted: streak recalculated; may decrease `current_streak` but `longest_streak` is NOT decreased (historical record).

### 2.4 Review & Analytics

**Owns:** `DailyStats` (computed), `WeeklyReview` (computed)
**Depends on:** Habits, Completions

| Endpoint | Description |
|---|---|
| `GET /api/stats/daily` | Completion rate per day over a date range |
| `GET /api/stats/weekly-review` | Last ISO week: per-habit breakdown, best/worst day, overall rate |
| `GET /api/habits/:id/heatmap` | Per-habit completion density, configurable months (tier-gated) |
| `GET /api/habits/:id/streak` | Current/longest streak, 30-day completion rate |

**Tier gating:**
- Free: 7-day analytics, 1-month heatmap
- Plus: 30-day analytics, 6-month heatmap
- Pro: 365-day analytics, 12-month heatmap

All analytics queries use `generate_series` for zero-fill and are scoped to `user_id` with index-backed date range filters.

### 2.5 Mood Tracking

**Owns:** `daily_logs`
**Depends on:** Identity

| Endpoint | Description |
|---|---|
| `POST /api/daily-logs` | Upsert mood/energy/stress for a date (`ON CONFLICT` idempotent) |
| `GET /api/daily-logs` | List logs for a date range |

**Invariants:**
- `UNIQUE(user_id, log_date)` — one log per user per day.
- Values constrained: `CHECK (mood BETWEEN 1 AND 5)`, same for energy, stress.
- `COALESCE` on upsert: only provided fields overwrite; others retain previous values.
- Mood data feeds into Claude insight prompts for correlation analysis.

### 2.6 Notifications

**Status:** Stub — future implementation.

**Planned architecture:**
```
notifications/
├── service.rs       schedule_reminder, send_push
├── models.rs        NotificationPreference, PushSubscription
└── worker.rs        Tokio interval task: poll due reminders, send via Web Push API
```

**Tier gating:**
- Free: 1 reminder
- Plus/Pro: unlimited reminders

Reminders stored as `reminder_time TIME` on `habits` table. A Tokio interval task
(every 60s) queries habits where `reminder_time` falls within the current minute
in the user's timezone, then sends a Web Push notification.

### 2.7 Billing & Entitlements

**Owns:** `users.subscription_tier`, `users.subscription_status`, `users.stripe_customer_id`, `stripe_events`
**Depends on:** Identity

```
  Client                    Axum                     Stripe
    │                        │                         │
    │  POST /billing/checkout│                         │
    │───────────────────────>│                         │
    │                        │  Create Customer (if    │
    │                        │  no stripe_customer_id) │
    │                        │────────────────────────>│
    │                        │<────────────────────────│
    │                        │  Create Checkout Session│
    │                        │────────────────────────>│
    │                        │<────────────────────────│
    │  { checkout_url }      │                         │
    │<───────────────────────│                         │
    │                        │                         │
    │  (redirect to Stripe)  │                         │
    │───────────────────────────────────────────────>  │
    │                        │                         │
    │                        │  POST /billing/webhook  │
    │                        │<────────────────────────│
    │                        │  (verify sig, dedup,    │
    │                        │   update tier/status)   │
    │                        │────────────────────────>│
    │                        │  { received: true }     │
    │                        │                         │
```

**Webhook events handled:**
| Event | Action |
|---|---|
| `checkout.session.completed` | Set tier from metadata (`plus` or `pro`), status=`active` |
| `customer.subscription.updated` | Update `subscription_status` |
| `customer.subscription.deleted` | Set tier=`free`, status=`canceled` |

**Event deduplication (G-18):**
```sql
-- stripe_events table
INSERT INTO stripe_events (event_id, event_type)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;
```
Before processing, check if `event_id` already exists. If so, return `200 { received: true, duplicate: true }`.

**Entitlement recompute:**
Entitlements are NOT stored — they are computed from `subscription_tier` via `UserEntitlements::for_tier()`. This means tier changes take effect immediately on the next API call. No cache invalidation needed.

### 2.8 Insights Engine

**Owns:** `weekly_insights`
**Depends on:** Habits, Completions, Mood Tracking, Billing (tier check)

```
  ┌───────────────────────────────────────────────────────┐
  │                 Insight Generation Flow                │
  │                                                       │
  │  GET /api/insights                                    │
  │       │                                               │
  │       ▼                                               │
  │  ┌──────────────┐    ┌──────────────┐                │
  │  │ Check cache:  │───>│ Cache hit?   │──yes──> return │
  │  │ weekly_insights│   │ this week?   │                │
  │  └──────────────┘    └──────┬───────┘                │
  │                             │ no                      │
  │                             ▼                         │
  │                    ┌──────────────┐                   │
  │                    │ Gather data: │                   │
  │                    │ habits,      │                   │
  │                    │ completions, │                   │
  │                    │ daily_logs   │                   │
  │                    └──────┬───────┘                   │
  │                           │                           │
  │                           ▼                           │
  │                    ┌──────────────┐                   │
  │                    │ Claude API   │                   │
  │                    │ available?   │                   │
  │                    └──┬───────┬───┘                   │
  │                  yes  │       │  no                   │
  │                       ▼       ▼                       │
  │              ┌──────────┐ ┌──────────────┐           │
  │              │ call_     │ │ generate_    │           │
  │              │ claude()  │ │ fallback_    │           │
  │              │           │ │ insight()    │           │
  │              └─────┬─────┘ └──────┬───────┘          │
  │                    │              │                   │
  │                    ▼              ▼                   │
  │              ┌─────────────────────────┐             │
  │              │ Cache in weekly_insights │             │
  │              │ Return InsightResponse   │             │
  │              │ { source: "claude" |     │             │
  │              │   "fallback" }           │             │
  │              └─────────────────────────┘             │
  └───────────────────────────────────────────────────────┘
```

**Fallback strategy (G-16):**
When Claude API is unavailable (timeout, 5xx, empty key), the system generates
a deterministic insight from habit/completion statistics:
- Best/worst habit by 30-day completion rate
- Active streak highlights
- Generic improvement suggestions
- `source: "fallback"` so the frontend can show a disclaimer

**Tier gating:**
- Free: no AI insights
- Plus: 1 per week (cached)
- Pro: on-demand (still cached per week to avoid abuse)

---

## 3. Sequence Diagrams

### 3.1 Guest Onboarding → Signup Link

```
  Browser                     Axum                      Postgres
    │                          │                           │
    │  1. GET /onboarding      │                           │
    │  (static page)           │                           │
    │                          │                           │
    │  2. POST /api/auth/guest │                           │
    │  { timezone: "America/   │                           │
    │    New_York" }           │                           │
    │─────────────────────────>│                           │
    │                          │  INSERT users             │
    │                          │  (is_guest=true,          │
    │                          │   guest_token=uuid,       │
    │                          │   timezone=$tz)           │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  create_token_pair(       │
    │                          │    user_id, "", config)   │
    │                          │                           │
    │  { access_token,         │                           │
    │    refresh_token,        │                           │
    │    guest_token: uuid }   │                           │
    │<─────────────────────────│                           │
    │                          │                           │
    │  localStorage.set(       │                           │
    │    "guest_token", uuid)  │                           │
    │  localStorage.set(       │                           │
    │    "access_token", jwt)  │                           │
    │                          │                           │
    │  ── user creates habits, │                           │
    │     tracks completions ──│                           │
    │                          │                           │
    │  3. POST /api/auth/      │                           │
    │     register             │                           │
    │  { email, password,      │                           │
    │    name,                 │                           │
    │    guest_token: uuid }   │                           │
    │─────────────────────────>│                           │
    │                          │  SELECT * FROM users      │
    │                          │  WHERE guest_token=$1     │
    │                          │  AND is_guest=true        │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  UPDATE users SET         │
    │                          │    email=$2,              │
    │                          │    password_hash=$3,      │
    │                          │    name=$4,               │
    │                          │    is_guest=false,        │
    │                          │    guest_token=NULL       │
    │                          │  WHERE id=$guest_id       │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │  { access_token,         │  (same user_id — all     │
    │    refresh_token }       │   habits preserved)      │
    │<─────────────────────────│                           │
    │                          │                           │
    │  localStorage.remove(    │                           │
    │    "guest_token")        │                           │
```

**Edge cases:**
- Guest token not found → fall through to normal registration (new user_id).
- Guest token found but `is_guest=false` → ignore, create new user.
- Email already exists → return `409 Conflict` (no merge with different user).

### 3.2 Toggle Completion — Online

```
  Browser                     Axum                      Postgres
    │                          │                           │
    │  POST /api/completions/  │                           │
    │  toggle                  │                           │
    │  { habit_id, completed_  │                           │
    │    date: null }          │                           │
    │─────────────────────────>│                           │
    │                          │                           │
    │  ┌─ Optimistic UI ─┐    │  1. Verify ownership      │
    │  │ Toggle circle    │    │  SELECT * FROM habits     │
    │  │ immediately      │    │  WHERE id=$1 AND          │
    │  │ (onMutate)       │    │  user_id=$auth_user       │
    │  └──────────────────┘    │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  2. Check existing        │
    │                          │  SELECT * FROM completions│
    │                          │  WHERE habit_id=$1        │
    │                          │  AND user_id=$2           │
    │                          │  AND completed_date=$3    │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  3a. EXISTS → DELETE      │
    │                          │  OR                       │
    │                          │  3b. NOT EXISTS → INSERT  │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  4. update_streak()       │
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  5. Broadcast WS          │
    │                          │  { type: "completion_     │
    │                          │    changed",              │
    │                          │    user_id, habit_id }    │
    │                          │                           │
    │  { action: "created" |   │                           │
    │    "deleted",            │                           │
    │    completion_id }       │                           │
    │<─────────────────────────│                           │
    │                          │                           │
    │  ┌─ onSettled ──────┐    │                           │
    │  │ invalidateQueries│    │                           │
    │  │ (habits, stats,  │    │                           │
    │  │  completions,    │    │                           │
    │  │  heatmap)        │    │                           │
    │  └──────────────────┘    │                           │
    │                          │                           │
    │  ┌─ onError ────────┐    │                           │
    │  │ Rollback to      │    │                           │
    │  │ previous cache   │    │                           │
    │  └──────────────────┘    │                           │
```

**Haptic feedback:** `navigator.vibrate(50)` fires synchronously before the mutation.

### 3.3 Toggle Completion — Offline Replay

```
  Browser (offline)           Browser (online)          Axum
    │                          │                          │
    │  User taps toggle        │                          │
    │  ┌──────────────────┐    │                          │
    │  │ 1. Optimistic UI │    │                          │
    │  │ 2. Queue in      │    │                          │
    │  │    IndexedDB:     │    │                          │
    │  │    { url, method, │    │                          │
    │  │      body,        │    │                          │
    │  │      timestamp,   │    │                          │
    │  │      idempotency_ │    │                          │
    │  │      key }        │    │                          │
    │  └──────────────────┘    │                          │
    │                          │                          │
    │  ... time passes ...     │                          │
    │                          │                          │
    │  ┌─ online event ───┐    │                          │
    │  │ navigator.onLine │    │                          │
    │  └──────────┬───────┘    │                          │
    │             │            │                          │
    │             ▼            │                          │
    │  ┌──────────────────┐    │                          │
    │  │ Service Worker   │    │                          │
    │  │ drains queue     │    │                          │
    │  │ FIFO order       │    │                          │
    │  └──────┬───────────┘    │                          │
    │         │                │                          │
    │         │  For each queued mutation:                │
    │         │  POST /api/completions/toggle             │
    │         │  Header: Idempotency-Key: <uuid>         │
    │         │────────────────────────────────────────>  │
    │         │                                          │
    │         │  Server checks:                          │
    │         │  1. Is this a duplicate toggle for       │
    │         │     same (habit_id, date, user_id)?      │
    │         │  2. ON CONFLICT → return existing        │
    │         │                                          │
    │         │  200 { action: "created"|"deleted" }     │
    │         │<────────────────────────────────────────  │
    │         │                                          │
    │         │  Next queued item...                     │
    │         │                                          │
    │  ┌──────────────────┐                              │
    │  │ After all drained│                              │
    │  │ → invalidate all │                              │
    │  │   TanStack Query │                              │
    │  │   caches         │                              │
    │  └──────────────────┘                              │
```

**Conflict resolution for offline replay:**
- Toggle is inherently idempotent: the server checks current state and flips it.
- If two offline toggles for the same habit+date are queued, the second toggle
  reverses the first — this is correct behavior (user toggled twice).
- If the server state has diverged (e.g., another device toggled), the replay
  still produces a consistent result because toggle checks current DB state.
- Stale `completed_date` values (>±1 day) are rejected with `422`.

### 3.4 Weekly Insight Job Lifecycle

```
  Tokio Interval Task          Axum                     Claude API
  (every Sunday 03:00 UTC)     │                           │
    │                          │                           │
    │  1. SELECT users WHERE   │                           │
    │     subscription_tier    │                           │
    │     IN ('plus','pro')    │                           │
    │     AND NOT EXISTS (     │                           │
    │       weekly_insights    │                           │
    │       for this week)     │                           │
    │─────────────────────────>│                           │
    │<─────────────────────────│                           │
    │                          │                           │
    │  For each user:          │                           │
    │  2. Gather habits,       │                           │
    │     completions (30d),   │                           │
    │     daily_logs (7d)      │                           │
    │─────────────────────────>│                           │
    │<─────────────────────────│                           │
    │                          │                           │
    │  3. Build prompt         │                           │
    │                          │                           │
    │  4. POST /v1/messages    │                           │
    │     (timeout: 30s,       │                           │
    │      retries: 2,         │                           │
    │      backoff: 2s, 8s)    │                           │
    │─────────────────────────────────────────────────────>│
    │                          │                           │
    │  ┌─ Success ────────┐    │                           │
    │  │ Parse JSON        │<──────────────────────────────│
    │  │ INSERT INTO       │                               │
    │  │ weekly_insights   │                               │
    │  │ (source='claude') │                               │
    │  └──────────────────┘                                │
    │                                                      │
    │  ┌─ Failure (after retries) ─┐                       │
    │  │ generate_fallback_insight()│                       │
    │  │ INSERT INTO weekly_insights│                       │
    │  │ (source='fallback')        │                       │
    │  │ Log warning to tracing     │                       │
    │  └────────────────────────────┘                       │
    │                                                      │
    │  5. Sleep 200ms (rate limit courtesy)                │
    │  6. Next user...                                     │
```

**On-demand path (`GET /api/insights`):**
1. Check `weekly_insights` cache for current ISO week.
2. Cache hit → return immediately.
3. Cache miss → generate synchronously (same flow as above, but inline).
4. Pro users bypass the 1/week limit (but still cache).

### 3.5 Stripe Checkout → Webhook → Entitlement Recompute

```
  Browser              Axum                  Stripe               Postgres
    │                   │                      │                     │
    │ POST /billing/    │                      │                     │
    │ checkout          │                      │                     │
    │ { price_id }      │                      │                     │
    │──────────────────>│                      │                     │
    │                   │                      │                     │
    │                   │ user.stripe_customer  │                     │
    │                   │ _id is NULL?         │                     │
    │                   │──yes──>              │                     │
    │                   │ POST /v1/customers   │                     │
    │                   │─────────────────────>│                     │
    │                   │<─────────────────────│                     │
    │                   │ UPDATE users SET     │                     │
    │                   │ stripe_customer_id   │                     │
    │                   │─────────────────────────────────────────>  │
    │                   │                      │                     │
    │                   │ POST /v1/checkout/   │                     │
    │                   │ sessions             │                     │
    │                   │ { customer, price,   │                     │
    │                   │   metadata.tier }    │                     │
    │                   │─────────────────────>│                     │
    │                   │<─────────────────────│                     │
    │                   │                      │                     │
    │ { checkout_url }  │                      │                     │
    │<──────────────────│                      │                     │
    │                   │                      │                     │
    │ redirect ────────────────────────────>   │                     │
    │ (user pays)       │                      │                     │
    │                   │                      │                     │
    │                   │  POST /billing/      │                     │
    │                   │  webhook             │                     │
    │                   │<─────────────────────│                     │
    │                   │                      │                     │
    │                   │  1. Verify signature  │                     │
    │                   │     (HMAC-SHA256)     │                     │
    │                   │                      │                     │
    │                   │  2. Dedup: INSERT     │                     │
    │                   │  stripe_events       │                     │
    │                   │  ON CONFLICT → skip  │                     │
    │                   │─────────────────────────────────────────>  │
    │                   │                      │                     │
    │                   │  3. Match event_type: │                     │
    │                   │  checkout.session.    │                     │
    │                   │  completed →          │                     │
    │                   │  UPDATE users SET     │                     │
    │                   │  subscription_tier=   │                     │
    │                   │  metadata.tier,       │                     │
    │                   │  subscription_status= │                     │
    │                   │  'active'             │                     │
    │                   │─────────────────────────────────────────>  │
    │                   │                      │                     │
    │                   │  200 { received }    │                     │
    │                   │─────────────────────>│                     │
    │                   │                      │                     │
    │                   │  ── Entitlements ──   │                     │
    │                   │  NOT stored. Computed │                     │
    │                   │  from tier on every   │                     │
    │                   │  GET /api/me call.    │                     │
    │                   │  Takes effect         │                     │
    │                   │  immediately.         │                     │
```

**Edge cases:**
- Webhook arrives before checkout redirect returns → fine, tier is already updated.
- Duplicate webhook → `stripe_events` dedup returns early.
- Stripe is down when creating checkout → return `500`, frontend shows retry.
- User downgrades (subscription deleted) → tier set to `free`. Existing habits above limit are NOT deleted — they become read-only (archived on next edit attempt).

---

## 4. Consistency Model

### 4.1 Idempotency Keys

| Operation | Idempotency Mechanism |
|---|---|
| Create completion | `UNIQUE(habit_id, completed_date, user_id)` + `ON CONFLICT DO UPDATE SET value = completions.value` (no-op update to trigger `RETURNING`) |
| Toggle completion | Check-then-act within a single request. Toggle is inherently idempotent: same input always produces same final state relative to current DB state. |
| Delete completion | Returns `200 { deleted: true }` even if row doesn't exist. |
| Upsert daily log | `UNIQUE(user_id, log_date)` + `ON CONFLICT DO UPDATE SET mood = COALESCE($4, daily_logs.mood), ...` |
| Stripe webhook | `stripe_events.event_id` PRIMARY KEY + `ON CONFLICT DO NOTHING` |
| Offline replay | Service worker sends `Idempotency-Key` header (UUID generated at queue time). Server-side, the `UNIQUE` constraint on completions handles dedup. The header is logged for tracing but not stored — the DB constraint is the source of truth. |

### 4.2 Local Date Bucket Strategy

**Problem:** A user in `America/Los_Angeles` (UTC-8) completes a habit at 11pm local time.
The server (UTC) sees this as the next calendar day.

**Solution:**

```
  User's device                    Axum
    │                               │
    │  completed_date: null         │
    │  (omitted = "today")         │
    │──────────────────────────────>│
    │                               │
    │                  1. Fetch user.timezone
    │                     ("America/Los_Angeles")
    │                               │
    │                  2. Compute local_today:
    │                     Utc::now()
    │                       .with_timezone(&tz)
    │                       .date_naive()
    │                               │
    │                  3. Use local_today as
    │                     completed_date
    │                               │
    │                  4. Validate: |completed_date
    │                     - server_utc_date| <= 1
    │                     (±1 day tolerance for
    │                      timezone edge cases)
```

**When client sends explicit `completed_date`:**
- Server validates it's within ±1 calendar day of server-now (UTC).
- This prevents backdating abuse while allowing timezone edge cases.

**Streak evaluation:**
- All streak calculations use the user's timezone to determine "today".
- `is_due_today` is computed using the user's timezone, not UTC.

### 4.3 Conflict Resolution Policy

| Scenario | Resolution |
|---|---|
| Two devices toggle same habit+date simultaneously | Last-write-wins at DB level. Both toggles check current state independently. If both see "not completed" and both INSERT, the `UNIQUE` constraint causes one to `ON CONFLICT` — effectively a no-op. Net result: one completion exists. |
| Offline device replays stale toggle | Toggle checks current DB state. If the habit was already toggled by another device, the replay toggle will reverse it. This is correct: the user intended to toggle, and the toggle is relative to current state. |
| Offline device replays stale create | `ON CONFLICT` returns existing row. No duplicate created. |
| Guest merges into existing email | `409 Conflict` — user must log in to existing account instead. Guest data is NOT merged into a different user's account. |
| Habit limit exceeded after downgrade | Existing habits are preserved but become read-only. User must archive habits to get below the new limit before creating new ones. |
| Timezone change | Streaks are recalculated on next completion event. Historical completions retain their original `completed_date` (which was correct at the time). |

---

## 5. Reliability Model

### 5.1 Retries & Backoff

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    Retry Policy Matrix                       │
  ├──────────────────┬──────────┬───────────┬──────────────────┤
  │  External Call   │ Retries  │ Backoff   │ Timeout          │
  ├──────────────────┼──────────┼───────────┼──────────────────┤
  │  Claude API      │ 2        │ 2s, 8s   │ 30s per attempt  │
  │  Stripe API      │ 0*       │ N/A      │ 15s              │
  │  Stripe Webhook  │ N/A**    │ N/A      │ 5s processing    │
  │  DB queries      │ 0***     │ N/A      │ 5s (SQLx pool)   │
  │  WebSocket send  │ 0        │ N/A      │ fire-and-forget  │
  └──────────────────┴──────────┴───────────┴──────────────────┘

  *   Stripe: no retry on checkout creation. Return error to client
      who can retry manually. Webhook processing is idempotent so
      Stripe's own retry mechanism handles delivery.
  **  Stripe retries webhook delivery automatically (up to 72h).
      Our handler is idempotent via stripe_events dedup.
  *** DB: connection pool handles reconnection. Query failures
      surface as 500 to client. No application-level retry to
      avoid thundering herd on DB recovery.
```

### 5.2 Dead-Letter Tracking

For the insight generation background job:

```sql
-- Future migration: job tracking table
CREATE TABLE IF NOT EXISTS job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,          -- 'weekly_insight', 'guest_cleanup'
    user_id UUID REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Current implementation (MVP):** Failed insight generations are logged via `tracing::warn!`
and fall back to deterministic insights. No persistent dead-letter queue yet.

**Post-MVP:** The `job_runs` table enables:
- Dashboard visibility into failed jobs
- Manual retry of failed insight generations
- Alerting when failure rate exceeds threshold

### 5.3 Graceful Degradation

```
  ┌─────────────────────────────────────────────────────────────┐
  │              Degradation Cascade                             │
  │                                                             │
  │  Claude unavailable                                         │
  │  ├─ Insight endpoint: return deterministic fallback         │
  │  │  { source: "fallback" }                                  │
  │  │  Frontend shows: "AI unavailable — template insights"    │
  │  ├─ Background job: generate fallback, log warning          │
  │  └─ No user-facing error. Feature degrades, doesn't break. │
  │                                                             │
  │  Stripe unavailable                                         │
  │  ├─ Checkout creation: return 500, frontend shows retry     │
  │  ├─ Webhook delivery: Stripe retries automatically          │
  │  ├─ Subscription reads: return cached tier from DB          │
  │  └─ Entitlements: always computed from DB tier, never       │
  │     from Stripe directly. DB is source of truth.            │
  │                                                             │
  │  Postgres unavailable                                       │
  │  ├─ All endpoints: return 500                               │
  │  ├─ Health check: return 503                                │
  │  ├─ Fly.io health check fails → restart instance            │
  │  └─ SQLx pool: automatic reconnection on recovery           │
  │                                                             │
  │  WebSocket broadcast fails                                  │
  │  ├─ fire-and-forget: `let _ = tx.send(msg)`                │
  │  ├─ Client reconnects on disconnect (exponential backoff)   │
  │  └─ TanStack Query refetch on reconnect provides            │
  │     eventual consistency without WS                         │
  │                                                             │
  │  Client offline                                             │
  │  ├─ Service worker serves cached shell (PWA)                │
  │  ├─ Mutations queued in IndexedDB                           │
  │  ├─ Optimistic UI shows pending state                       │
  │  └─ Queue drained FIFO on reconnect                         │
  └─────────────────────────────────────────────────────────────┘
```

### 5.4 Health Check

```rust
// GET /health
pub async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    // 1. Check DB connectivity
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();

    if db_ok {
        (StatusCode::OK, Json(json!({ "status": "healthy" })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "status": "degraded", "db": false })))
    }
}
```

Fly.io polls `/health` every 10s. Two consecutive failures trigger instance restart.

---

## 6. Security Model

### 6.1 JWT Validation Middleware

```
  Request
    │
    ▼
  ┌──────────────────────────────────────────────┐
  │  require_auth middleware                       │
  │                                                │
  │  1. Extract Authorization header               │
  │     "Bearer <token>"                           │
  │     Missing → 401 Unauthorized                 │
  │                                                │
  │  2. Decode JWT with HMAC-SHA256                │
  │     Invalid signature → 401                    │
  │     Expired (exp claim) → 401                  │
  │                                                │
  │  3. Verify token_type == "access"              │
  │     Refresh token used as access → 401         │
  │                                                │
  │  4. Extract claims:                            │
  │     { sub: Uuid, email: String, exp, iat,      │
  │       token_type: Access }                     │
  │                                                │
  │  5. Build AuthUser:                            │
  │     { id: claims.sub,                          │
  │       email: Some(claims.email) or None }      │
  │                                                │
  │  6. Insert into request extensions:            │
  │     req.extensions_mut().insert(auth_user)     │
  │                                                │
  │  7. Call next handler                          │
  └──────────────────────────────────────────────┘
```

**JWT claims structure:**
```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "exp": 1700000000,
  "iat": 1699999100,
  "token_type": "access"
}
```

**Token lifetimes:**
- Access token: 15 minutes (`JWT_ACCESS_TTL_SECS=900`)
- Refresh token: 7 days (`JWT_REFRESH_TTL_SECS=604800`)

### 6.2 Refresh Token Storage, Rotation & Revocation

```
  Client                      Axum                      Postgres
    │                          │                           │
    │  POST /api/auth/refresh  │                           │
    │  { refresh_token: "..." }│                           │
    │─────────────────────────>│                           │
    │                          │                           │
    │                          │  1. Decode JWT            │
    │                          │     Verify token_type     │
    │                          │     == "refresh"          │
    │                          │                           │
    │                          │  2. SHA-256 hash the      │
    │                          │     raw refresh token     │
    │                          │                           │
    │                          │  3. SELECT FROM           │
    │                          │     refresh_tokens        │
    │                          │     WHERE token_hash=$1   │
    │                          │     AND revoked=false     │
    │                          │     AND expires_at > NOW()│
    │                          │──────────────────────────>│
    │                          │<──────────────────────────│
    │                          │                           │
    │                          │  Not found → 401          │
    │                          │                           │
    │                          │  4. REVOKE old token:     │
    │                          │  UPDATE refresh_tokens    │
    │                          │  SET revoked=true         │
    │                          │  WHERE id=$old_id         │
    │                          │──────────────────────────>│
    │                          │                           │
    │                          │  5. Create new pair:      │
    │                          │  INSERT refresh_tokens    │
    │                          │  (new token_hash,         │
    │                          │   new expires_at)         │
    │                          │──────────────────────────>│
    │                          │                           │
    │  { access_token (new),   │                           │
    │    refresh_token (new) } │                           │
    │<─────────────────────────│                           │
```

**Rotation invariants:**
- Each refresh token can only be used ONCE. After use, it's revoked.
- If a revoked token is presented, ALL tokens for that user are revoked
  (potential token theft detected).
- Raw refresh tokens are NEVER stored. Only SHA-256 hashes persist.
- Expired tokens are cleaned up by a background task (weekly).

**Revocation on logout:**
```sql
UPDATE refresh_tokens SET revoked = true
WHERE user_id = $1 AND revoked = false;
```

### 6.3 CORS Configuration

```rust
let cors = CorsLayer::new()
    .allow_origin(
        config.frontend_url
            .parse::<HeaderValue>()
            .unwrap(),
    )                                    // Single origin, not wildcard
    .allow_methods(Any)                  // GET, POST, PUT, DELETE, OPTIONS
    .allow_headers(Any)                  // Authorization, Content-Type, etc.
    .allow_credentials(true);            // Required for cookie-based refresh
```

**Production rules:**
- `allow_origin`: exact match to `FRONTEND_URL` env var. Never `*`.
- `allow_credentials(true)`: enables `Authorization` header.
- Preflight `OPTIONS` requests are handled automatically by `tower-http`.

### 6.4 Rate Limiting

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    Rate Limit Policy                         │
  ├──────────────────────┬──────────────┬───────────────────────┤
  │  Endpoint Category   │  Limit       │  Window               │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  Auth (login/register│  10 req      │  per minute per IP    │
  │  /guest/refresh)     │              │                       │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  Mutations (POST/PUT/│  60 req      │  per minute per user  │
  │  DELETE)             │              │                       │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  Reads (GET)         │  120 req     │  per minute per user  │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  Insights generation │  5 req       │  per hour per user    │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  Webhook (Stripe)    │  100 req     │  per minute per IP    │
  ├──────────────────────┼──────────────┼───────────────────────┤
  │  WebSocket connect   │  5 conn      │  per minute per IP    │
  └──────────────────────┴──────────────┴───────────────────────┘
```

**Implementation:** `tower::ServiceBuilder` with `governor` crate middleware.
Rate limit state stored in-memory (`DashMap`). Acceptable for single-process
deployment. For multi-instance, migrate to Redis-backed rate limiting.

**Response on limit exceeded:** `429 Too Many Requests` with `Retry-After` header.

### 6.5 Request Limits & Timeouts

```
  ┌─────────────────────────────────────────────────────────────┐
  │  Request Body Limits                                        │
  │  ├─ Default: 256 KB                                        │
  │  ├─ Webhook: 1 MB (Stripe payloads can be large)           │
  │  └─ File upload: N/A (no file uploads in MVP)              │
  │                                                             │
  │  Timeouts                                                   │
  │  ├─ Request timeout: 30s (tower::timeout)                  │
  │  ├─ DB query timeout: 5s (SQLx pool config)                │
  │  ├─ DB pool size: 10 connections (SQLx)                    │
  │  ├─ DB pool acquire timeout: 3s                            │
  │  ├─ Claude API call: 30s                                   │
  │  ├─ Stripe API call: 15s                                   │
  │  ├─ WebSocket idle: 60s (ping/pong)                        │
  │  └─ Graceful shutdown: 10s (Tokio signal handler)          │
  │                                                             │
  │  Input Validation                                           │
  │  ├─ Habit name: 1-200 chars                                │
  │  ├─ Description: 0-2000 chars                              │
  │  ├─ Note fields: 0-5000 chars                              │
  │  ├─ Email: RFC 5322 validation                             │
  │  ├─ Password: 8-128 chars                                  │
  │  ├─ Mood/energy/stress: 1-5 integer                        │
  │  ├─ target_per_day: 1-100                                  │
  │  ├─ frequency_config.days: array of 1-7 integers           │
  │  ├─ frequency_config.times_per_week: 1-7 integer           │
  │  └─ completed_date: ±1 day from server-now                 │
  └─────────────────────────────────────────────────────────────┘
```

### 6.6 Additional Security Measures

| Measure | Implementation |
|---|---|
| Password hashing | Argon2id (default params via `argon2` crate) |
| SQL injection | Impossible — SQLx compile-time checked queries with bind parameters |
| XSS | N/A server-side — API returns JSON only. Frontend handles escaping. |
| CSRF | Not applicable — JWT in `Authorization` header, not cookies |
| Stripe webhook verification | HMAC-SHA256 signature check against `STRIPE_WEBHOOK_SECRET` |
| Secrets management | Environment variables only. Never in code or config files. |
| Structured logging | `tracing` with JSON output. Sensitive fields (`password_hash`, `token`) excluded via `#[serde(skip_serializing)]`. |
| Guest abuse prevention | Guest accounts limited to Free tier entitlements. Purged after 30 days of inactivity. |

---

## 7. Data Model Summary

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                         Entity Relationships                      │
  │                                                                    │
  │  users ─────────┬──────────────┬──────────────┬────────────────── │
  │    │             │              │              │                   │
  │    │ 1:N         │ 1:N          │ 1:N          │ 1:N              │
  │    ▼             ▼              ▼              ▼                  │
  │  habits      refresh_tokens  daily_logs   weekly_insights        │
  │    │                                                              │
  │    │ 1:N                                                          │
  │    ▼                                                              │
  │  completions                                                      │
  │                                                                    │
  │  stripe_events (standalone — keyed by Stripe event_id)            │
  └──────────────────────────────────────────────────────────────────┘

  Table Sizes (estimated at 10k DAU, 6 months):
  ┌──────────────────┬──────────────┬──────────────────────────────┐
  │  Table            │  Est. Rows   │  Key Indexes                 │
  ├──────────────────┼──────────────┼──────────────────────────────┤
  │  users            │  50k         │  email, stripe_customer_id   │
  │  habits           │  200k        │  user_id, (user_id, !arch)   │
  │  completions      │  5M          │  (habit_id, date, user_id)   │
  │                   │              │  (user_id, date)             │
  │  daily_logs       │  500k        │  (user_id, log_date)         │
  │  weekly_insights  │  100k        │  (user_id, year, week)       │
  │  refresh_tokens   │  100k        │  token_hash, user_id         │
  │  stripe_events    │  10k         │  event_id (PK)               │
  └──────────────────┴──────────────┴──────────────────────────────┘
```

---

## 8. Appendix: Edge Cases

### 8.1 Clock Skew

**Problem:** Client clock is wrong; sends `completed_date` that's off by days.
**Solution:** Server ignores client date if not provided (uses server-now in user TZ).
When client sends explicit date, server validates ±1 day from server-now.

### 8.2 Timezone Change

**Problem:** User changes timezone from `America/New_York` to `Asia/Tokyo`.
**Solution:** Historical `completed_date` values are NaiveDate (no timezone info).
They were correct at the time of recording. Streaks are recalculated using the
NEW timezone on the next completion event. This may cause a one-time streak
discontinuity, which is acceptable.

### 8.3 Subscription Downgrade with Over-Limit Habits

**Problem:** Pro user (unlimited habits) downgrades to Free (3 habits) but has 20 habits.
**Solution:** Existing habits are NOT deleted or archived automatically. The user
can still view and complete all 20 habits. However, `POST /api/habits` will reject
new habit creation until the user archives enough habits to be under the limit.
The frontend shows an "over limit" warning with a prompt to archive.

### 8.4 Concurrent Guest Merge

**Problem:** Two browser tabs both try to register with the same `guest_token`.
**Solution:** The first request succeeds and sets `is_guest=false, guest_token=NULL`.
The second request's `SELECT WHERE guest_token=$1 AND is_guest=true` returns no rows,
so it falls through to normal registration (creates a new user). The second tab
gets a different `user_id` with no habits. This is acceptable — the user should
only register once.

### 8.5 WebSocket Reconnection Storm

**Problem:** Server restart causes all WS clients to reconnect simultaneously.
**Solution:** Client-side exponential backoff with jitter:
```
delay = min(30s, 1s * 2^attempt + random(0, 1s))
```
Server-side: `broadcast::channel(256)` buffer absorbs burst. Lagging receivers
are dropped (they'll refetch via HTTP).

### 8.6 Stripe Webhook Replay

**Problem:** Stripe retries a webhook that was already processed.
**Solution:** `stripe_events` table with `event_id` PRIMARY KEY. `INSERT ON CONFLICT DO NOTHING`.
If the event was already processed, return `200 { received: true, duplicate: true }`.
Stripe sees 200 and stops retrying.

### 8.7 Claude API Returns Malformed JSON

**Problem:** Claude returns text that doesn't parse as `InsightResponse`.
**Solution:** `serde_json::from_str(text)` fails → caught by `match call_claude()` →
falls back to `generate_fallback_insight()`. Logged as warning with the raw response
for debugging.

### 8.8 Offline Queue Ordering

**Problem:** User toggles habit A, then habit B offline. On reconnect, order matters
if there are side effects.
**Solution:** Service worker drains queue in FIFO order (insertion order). Each
mutation is independent (no cross-habit dependencies), so ordering only matters
for same-habit toggles. Two toggles of the same habit cancel out, which is correct.

---

*Document version: 1.0.0 — Generated for HabitArc backend, aligned with PRD v1.0.0*
*Last updated: 2026-02-10*
