# HabitArc — Complete API Contracts

> Principal Backend Engineer specification.
> Axum 0.7 · Serde DTOs · Stable error codes · Idempotency · Auth + Entitlement middleware
> All handler signatures map 1:1 to Rust code in `backend/src/`

---

## Table of Contents

1. [Endpoint Table](#1-endpoint-table)
2. [Error Model](#2-error-model)
3. [Auth Middleware](#3-auth-middleware)
4. [Entitlement Middleware](#4-entitlement-middleware)
5. [Idempotency Model](#5-idempotency-model)
6. [Auth Endpoints](#6-auth-endpoints)
7. [Habit Endpoints](#7-habit-endpoints)
8. [Mood Endpoints](#8-mood-endpoints)
9. [Insight & Review Endpoints](#9-insight--review-endpoints)
10. [Billing Endpoints](#10-billing-endpoints)
11. [System Endpoints](#11-system-endpoints)
12. [Rust DTO Reference](#12-rust-dto-reference)

---

## 1. Endpoint Table

| # | Method | Path | Auth | Entitlement Gate | Idempotency | Handler |
|---|--------|------|------|-----------------|-------------|---------|
| **Auth** | | | | | | |
| 1 | `POST` | `/api/auth/signup` | — | — | Email uniqueness (409 on dup) | `auth::signup` |
| 2 | `POST` | `/api/auth/login` | — | — | Stateless (JWT issued) | `auth::login` |
| 3 | `POST` | `/api/auth/refresh` | — | — | Token rotation (old revoked) | `auth::refresh` |
| 4 | `POST` | `/api/auth/logout` | Bearer | — | Revoke all tokens (idempotent) | `auth::logout` |
| 5 | `POST` | `/api/auth/guest` | — | — | New guest per call | `auth::guest` |
| 6 | `GET` | `/api/auth/me` | Bearer | — | Read-only | `auth::me` |
| **Habits** | | | | | | |
| 7 | `GET` | `/api/habits` | Bearer | — | Read-only | `habits::list_habits` |
| 8 | `GET` | `/api/habits/today` | Bearer | — | Read-only | `habits::today_list` |
| 9 | `POST` | `/api/habits` | Bearer | `max_habits`, `schedule_types` | `UNIQUE(user_id, lower(name))` | `habits::create_habit` |
| 10 | `PUT` | `/api/habits/{id}` | Bearer | `schedule_types` | Last-write-wins | `habits::update_habit` |
| 11 | `DELETE` | `/api/habits/{id}` | Bearer | — | Soft-delete idempotent (200 if already deleted) | `habits::delete_habit` |
| 12 | `POST` | `/api/habits/{id}/complete` | Bearer | — | `UNIQUE(habit_id, local_date_bucket)` toggle | `completions::toggle` |
| 13 | `GET` | `/api/habits/{id}/calendar` | Bearer | `heatmap_months` | Read-only | `completions::calendar` |
| 14 | `GET` | `/api/habits/{id}/stats` | Bearer | `analytics_days` | Read-only | `completions::stats` |
| **Mood** | | | | | | |
| 15 | `POST` | `/api/mood` | Bearer | — | `UNIQUE(user_id, local_date_bucket)` upsert | `mood::upsert` |
| 16 | `GET` | `/api/mood` | Bearer | — | Read-only | `mood::list` |
| **Insights & Review** | | | | | | |
| 17 | `POST` | `/api/insights/generate` | Bearer | `ai_insights` (Plus/Pro) | Cache per ISO week (dedup) | `insights::generate` |
| 18 | `GET` | `/api/insights/latest` | Bearer | `ai_insights` (Plus/Pro) | Read-only (cache hit) | `insights::latest` |
| 19 | `GET` | `/api/reviews/weekly` | Bearer | — | Read-only | `reviews::weekly` |
| **Billing** | | | | | | |
| 20 | `GET` | `/api/subscription/status` | Bearer | — | Read-only | `billing::status` |
| 21 | `POST` | `/api/subscription/checkout` | Bearer | — | New session per call | `billing::checkout` |
| 22 | `POST` | `/api/subscription/portal` | Bearer | — | New session per call | `billing::portal` |
| 23 | `POST` | `/api/webhook/stripe` | Stripe-Sig | — | `stripe_events.event_id` dedup | `billing::webhook` |
| **System** | | | | | | |
| 24 | `GET` | `/health` | — | — | Read-only | `system::health` |
| 25 | `GET` | `/readyz` | — | — | Read-only | `system::readyz` |

---

## 2. Error Model

Every error response uses a **stable envelope** with a machine-readable `code` string:

```json
{
  "error": {
    "code": "HABIT_LIMIT_EXCEEDED",
    "message": "Free plan allows up to 3 habits. Upgrade to Plus for 15.",
    "status": 403,
    "details": null
  }
}
```

### Stable Error Codes

```
AUTH_REQUIRED            401   Missing or invalid Authorization header
AUTH_TOKEN_EXPIRED       401   Access token has expired
AUTH_TOKEN_INVALID       401   Token signature verification failed
AUTH_REFRESH_REVOKED     401   Refresh token was revoked (possible theft)
AUTH_FORBIDDEN           403   Authenticated but not authorized for this resource

VALIDATION_FAILED        422   Request body failed validation
VALIDATION_DATE_RANGE    422   Date outside ±1 day window
VALIDATION_ENUM          422   Invalid enum value

RESOURCE_NOT_FOUND       404   Entity does not exist or is not owned by caller
RESOURCE_CONFLICT        409   Unique constraint violation (email, habit name)
RESOURCE_GONE            410   Soft-deleted resource

ENTITLEMENT_HABIT_LIMIT  403   Habit count exceeds tier limit
ENTITLEMENT_SCHEDULE     403   Schedule type not available on current tier
ENTITLEMENT_HEATMAP      403   Heatmap months exceed tier allowance
ENTITLEMENT_ANALYTICS    403   Analytics days exceed tier allowance
ENTITLEMENT_INSIGHTS     403   AI insights not available on current tier

RATE_LIMITED             429   Too many requests
STRIPE_ERROR             502   Stripe API call failed
INSIGHT_GENERATION_FAIL  502   Claude API call failed (fallback returned)
INTERNAL_ERROR           500   Unhandled server error (details redacted)
```

### Rust Error Enum

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    // Auth
    #[error("Authentication required")]
    AuthRequired,
    #[error("Token expired")]
    TokenExpired,
    #[error("Invalid token")]
    TokenInvalid,
    #[error("Refresh token revoked")]
    RefreshRevoked,
    #[error("Forbidden: {0}")]
    Forbidden(String),

    // Validation
    #[error("Validation: {0}")]
    Validation(String),
    #[error("Date out of range")]
    DateRange,

    // Resources
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Gone: {0}")]
    Gone(String),

    // Entitlements
    #[error("Entitlement: {0}")]
    Entitlement(EntitlementCode),

    // Rate limiting
    #[error("Rate limited")]
    RateLimited,

    // External services
    #[error("Stripe error: {0}")]
    Stripe(String),
    #[error("Insight generation failed")]
    InsightFailed,

    // Internal
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Internal: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntitlementCode {
    HabitLimit,
    Schedule,
    Heatmap,
    Analytics,
    Insights,
}

impl AppError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::AuthRequired       => "AUTH_REQUIRED",
            Self::TokenExpired       => "AUTH_TOKEN_EXPIRED",
            Self::TokenInvalid       => "AUTH_TOKEN_INVALID",
            Self::RefreshRevoked     => "AUTH_REFRESH_REVOKED",
            Self::Forbidden(_)       => "AUTH_FORBIDDEN",
            Self::Validation(_)      => "VALIDATION_FAILED",
            Self::DateRange          => "VALIDATION_DATE_RANGE",
            Self::NotFound(_)        => "RESOURCE_NOT_FOUND",
            Self::Conflict(_)        => "RESOURCE_CONFLICT",
            Self::Gone(_)            => "RESOURCE_GONE",
            Self::Entitlement(c)     => match c {
                EntitlementCode::HabitLimit => "ENTITLEMENT_HABIT_LIMIT",
                EntitlementCode::Schedule   => "ENTITLEMENT_SCHEDULE",
                EntitlementCode::Heatmap    => "ENTITLEMENT_HEATMAP",
                EntitlementCode::Analytics  => "ENTITLEMENT_ANALYTICS",
                EntitlementCode::Insights   => "ENTITLEMENT_INSIGHTS",
            },
            Self::RateLimited        => "RATE_LIMITED",
            Self::Stripe(_)          => "STRIPE_ERROR",
            Self::InsightFailed      => "INSIGHT_GENERATION_FAIL",
            Self::Database(_)        => "INTERNAL_ERROR",
            Self::Internal(_)        => "INTERNAL_ERROR",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::AuthRequired | Self::TokenExpired
            | Self::TokenInvalid | Self::RefreshRevoked => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) | Self::Entitlement(_)   => StatusCode::FORBIDDEN,
            Self::Validation(_) | Self::DateRange        => StatusCode::UNPROCESSABLE_ENTITY,
            Self::NotFound(_)                            => StatusCode::NOT_FOUND,
            Self::Conflict(_)                            => StatusCode::CONFLICT,
            Self::Gone(_)                                => StatusCode::GONE,
            Self::RateLimited                            => StatusCode::TOO_MANY_REQUESTS,
            Self::Stripe(_) | Self::InsightFailed        => StatusCode::BAD_GATEWAY,
            Self::Database(_) | Self::Internal(_)        => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = json!({
            "error": {
                "code": self.error_code(),
                "message": self.to_string(),
                "status": status.as_u16(),
                "details": null,
            }
        });

        (status, Json(body)).into_response()
    }
}
```

---

## 3. Auth Middleware

### `require_auth` — JWT access token validation

```rust
/// Extracts and validates JWT from Authorization: Bearer <token>.
/// Injects AuthUser into request extensions.
///
/// Rejects with:
///   AUTH_REQUIRED    — header missing or malformed
///   AUTH_TOKEN_INVALID — signature check failed
///   AUTH_TOKEN_EXPIRED — exp claim in the past
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError>;

/// Extracted by handlers via Extension<AuthUser>
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub is_guest: bool,
    pub tier: SubscriptionTier,
}
```

**Key change from current code:** `AuthUser` now carries `is_guest` and `tier` so that
downstream handlers and the entitlement middleware don't need a separate DB lookup.
The middleware does one query:

```sql
SELECT id, email, is_guest, subscription_tier
FROM users WHERE id = $1 AND deleted_at IS NULL
```

### `require_registered` — Rejects guest users

```rust
/// Layer applied to routes that require a full account (e.g., billing, export).
/// Must be applied AFTER require_auth.
///
/// Rejects with:
///   AUTH_FORBIDDEN — "Guest accounts cannot access this resource"
pub async fn require_registered(
    Extension(auth_user): Extension<AuthUser>,
    req: Request,
    next: Next,
) -> Result<Response, AppError>;
```

---

## 4. Entitlement Middleware

### `require_entitlement` — Tier-gated feature access

```rust
/// Generic entitlement check. Applied per-route via layer.
///
/// Usage:
///   .route("/api/habits", post(create_habit))
///   .layer(from_fn(|req, next| require_entitlement(req, next, "max_habits")))
///
/// The middleware reads AuthUser.tier, looks up the entitlement value from
/// feature_entitlements table (cached in AppState), and injects
/// EntitlementContext into extensions for the handler to use.
pub async fn require_entitlement(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    req: Request,
    next: Next,
    feature_key: &'static str,
) -> Result<Response, AppError>;

/// Injected into request extensions by require_entitlement
#[derive(Debug, Clone)]
pub struct EntitlementContext {
    pub feature_key: String,
    pub limit: Option<i64>,     // None = unlimited
    pub allowed: bool,
}
```

**Enforcement pattern:** The middleware checks the entitlement and injects context.
The handler reads the context and applies business logic (e.g., counting habits
against the limit). This keeps the middleware generic and the handler specific.

---

## 5. Idempotency Model

| Endpoint | Mechanism | Client Behavior |
|---|---|---|
| `POST /api/auth/signup` | `UNIQUE(lower(email))` → 409 on dup | Retry safe; same email returns conflict |
| `POST /api/auth/login` | Stateless JWT issuance | Always safe to retry |
| `POST /api/auth/refresh` | Old token revoked, new issued. If revoked token reused → revoke ALL | Client must store new token; never retry with old |
| `POST /api/auth/logout` | `UPDATE SET revoked=true WHERE user_id AND revoked=false` | Idempotent; multiple calls are no-ops |
| `POST /api/auth/guest` | Creates new guest each call | NOT idempotent; client should call once and store token |
| `POST /api/habits` | `UNIQUE(user_id, lower(name)) WHERE deleted_at IS NULL` → 409 | Retry safe; duplicate name returns conflict |
| `PUT /api/habits/{id}` | Last-write-wins with `updated_at` trigger | Retry safe; same payload = same result |
| `DELETE /api/habits/{id}` | `SET deleted_at = NOW() WHERE deleted_at IS NULL` → 200 even if already deleted | Fully idempotent |
| `POST /api/habits/{id}/complete` | Toggle: check→create or check→delete. `UNIQUE(habit_id, local_date_bucket)` | Toggle is state-relative; two calls cancel out (intentional) |
| `POST /api/mood` | `ON CONFLICT (user_id, local_date_bucket) DO UPDATE SET ... COALESCE` | Fully idempotent upsert |
| `POST /api/insights/generate` | `UNIQUE(user_id, week_start_date)` cache. Returns cached if exists | Idempotent within same ISO week |
| `POST /api/subscription/checkout` | New Stripe session per call | NOT idempotent; each call creates a new checkout |
| `POST /api/subscription/portal` | New Stripe portal session per call | NOT idempotent |
| `POST /api/webhook/stripe` | `stripe_events.event_id` PK dedup | Fully idempotent; Stripe retries are safe |

### Offline Replay Header

```
Idempotency-Key: <client-generated-uuid>
```

For offline queue replay, the client sends an `Idempotency-Key` header. The server
logs it for tracing but relies on DB constraints (not the header) for actual dedup.
This is a **tracing aid**, not a server-side idempotency store.

---

## 6. Auth Endpoints

### 6.1 `POST /api/auth/signup`

**Route module:** `routes::auth`
**Auth:** None
**Rate limit:** 10/min per IP

```rust
pub async fn signup(
    State(state): State<AppState>,
    Json(body): Json<SignupRequest>,
) -> AppResult<Json<AuthResponse>>
```

**Request:**
```json
{
  "email": "alice@example.com",
  "password": "securepassword123",
  "name": "Alice",
  "timezone": "America/New_York",
  "guest_token": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | `String` | yes | RFC 5322, max 254 chars |
| `password` | `String` | yes | 8–128 chars |
| `name` | `String` | yes | 1–100 chars |
| `timezone` | `String` | no | IANA format, default `UTC` |
| `guest_token` | `Uuid` | no | If present, merges guest account |

**Response `201`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiJ9...",
  "expires_in": 900,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "alice@example.com",
    "name": "Alice",
    "is_guest": false,
    "timezone": "America/New_York",
    "tier": "free",
    "created_at": "2026-02-10T12:00:00Z"
  }
}
```

**Errors:**
| Code | When |
|---|---|
| `VALIDATION_FAILED` | Missing/invalid fields |
| `RESOURCE_CONFLICT` | Email already registered |

**Guest merge flow:**
1. If `guest_token` is provided, look up `users WHERE guest_token = $1 AND is_guest = true`.
2. If found: `UPDATE` the guest row with email/password/name, set `is_guest = false`, clear `guest_token`. Return tokens for the **same user_id** (habits preserved).
3. If not found: fall through to normal registration (new user_id).

---

### 6.2 `POST /api/auth/login`

**Auth:** None
**Rate limit:** 10/min per IP

```rust
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>>
```

**Request:**
```json
{
  "email": "alice@example.com",
  "password": "securepassword123"
}
```

**Response `200`:** Same shape as signup `AuthResponse`.

**Errors:**
| Code | When |
|---|---|
| `AUTH_REQUIRED` | Wrong email or password (intentionally vague) |
| `RATE_LIMITED` | Brute-force protection triggered |

**Side effect:** Inserts `audit_logs` row with `action = 'login'` or `'login_failed'`.

---

### 6.3 `POST /api/auth/refresh`

**Auth:** None (refresh token in body)
**Rate limit:** 30/min per IP

```rust
pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> AppResult<Json<AuthResponse>>
```

**Request:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Response `200`:** New `AuthResponse` with rotated tokens.

**Token rotation protocol:**
1. Decode JWT, verify `token_type == "refresh"`.
2. SHA-256 hash the raw token.
3. Look up `refresh_tokens WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()`.
4. If not found → `401 AUTH_REFRESH_REVOKED`.
5. **If found but already revoked** → **revoke ALL tokens for this user** (theft detection) → `401`.
6. Mark old token `revoked = true, revoked_at = NOW()`.
7. Insert new refresh token row with `parent_token_id` pointing to old.
8. Return new token pair.

---

### 6.4 `POST /api/auth/logout`

**Auth:** Bearer (access token)

```rust
pub async fn logout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<MessageResponse>>
```

**Request:** Empty body. Auth via header.

**Response `200`:**
```json
{
  "message": "Logged out successfully"
}
```

**Side effect:**
```sql
UPDATE refresh_tokens
SET revoked = true, revoked_at = NOW()
WHERE user_id = $1 AND revoked = false;
```

Idempotent — calling logout when already logged out returns 200.

---

### 6.5 `POST /api/auth/guest`

**Auth:** None

```rust
pub async fn guest(
    State(state): State<AppState>,
    Json(body): Json<GuestRequest>,
) -> AppResult<Json<GuestAuthResponse>>
```

**Request:**
```json
{
  "timezone": "America/New_York"
}
```

**Response `201`:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 900,
  "guest_token": "550e8400-e29b-41d4-a716-446655440000",
  "user": {
    "id": "...",
    "name": "Guest",
    "is_guest": true,
    "timezone": "America/New_York",
    "tier": "free"
  }
}
```

---

### 6.6 `GET /api/auth/me`

**Auth:** Bearer

```rust
pub async fn me(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<UserProfileResponse>>
```

**Response `200`:**
```json
{
  "id": "550e8400-...",
  "email": "alice@example.com",
  "name": "Alice",
  "avatar_url": null,
  "is_guest": false,
  "timezone": "America/New_York",
  "tier": "plus",
  "status": "active",
  "entitlements": {
    "max_habits": 15,
    "schedule_types": ["daily", "weekly_days", "weekly_target"],
    "analytics_days": 30,
    "heatmap_months": 6,
    "ai_insights_per_week": 1,
    "reminders": "unlimited",
    "data_export": false
  },
  "created_at": "2026-01-15T10:30:00Z"
}
```

---

## 7. Habit Endpoints

### 7.1 `GET /api/habits`

**Auth:** Bearer
**Returns all active (non-deleted) habits for the user, without today-status annotations.**

```rust
pub async fn list_habits(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<HabitResponse>>>
```

**Response `200`:**
```json
[
  {
    "id": "...",
    "name": "Morning Meditation",
    "description": "10 minutes of mindfulness",
    "color": "#6366f1",
    "icon": "brain",
    "frequency": "daily",
    "schedule": null,
    "target_per_day": 1,
    "sort_order": 0,
    "current_streak": 13,
    "longest_streak": 13,
    "total_completions": 42,
    "created_at": "2026-01-15T10:30:00Z",
    "updated_at": "2026-02-10T08:00:00Z"
  },
  {
    "id": "...",
    "name": "Exercise",
    "frequency": "weekly_days",
    "schedule": { "days": [1, 3, 5] },
    "..."
  }
]
```

---

### 7.2 `GET /api/habits/today`

**Auth:** Bearer
**Returns habits annotated with today's completion status and due-today flag.**
**This is the primary dashboard query.**

```rust
pub async fn today_list(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<HabitTodayResponse>>>
```

**Response `200`:**
```json
[
  {
    "id": "...",
    "name": "Morning Meditation",
    "color": "#6366f1",
    "icon": "brain",
    "frequency": "daily",
    "target_per_day": 1,
    "current_streak": 13,
    "completed_today": 1,
    "is_complete": true,
    "is_due_today": true,
    "sort_order": 0
  },
  {
    "id": "...",
    "name": "Exercise",
    "frequency": "weekly_days",
    "schedule": { "days": [1, 3, 5] },
    "target_per_day": 1,
    "current_streak": 4,
    "completed_today": 0,
    "is_complete": false,
    "is_due_today": true,
    "sort_order": 1
  }
]
```

**`is_due_today` computation:**
- `daily` → always `true`
- `weekly_days` → `EXTRACT(ISODOW FROM local_today) IN schedule.days`
- `weekly_target` → `week_completions < schedule.times_per_week`

All date computations use `users.timezone` to determine "today".

---

### 7.3 `POST /api/habits`

**Auth:** Bearer
**Entitlement:** `max_habits` (Free=3, Plus=15, Pro=unlimited), `schedule_types`

```rust
pub async fn create_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(entitlements): Extension<EntitlementContext>,
    Json(body): Json<CreateHabitRequest>,
) -> AppResult<Json<HabitResponse>>
```

**Request:**
```json
{
  "name": "Exercise",
  "description": "30 min workout",
  "color": "#ef4444",
  "icon": "dumbbell",
  "frequency": "weekly_days",
  "schedule": { "days": [1, 3, 5] },
  "target_per_day": 1
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | `String` | yes | 1–200 chars |
| `description` | `String` | no | max 2000 chars |
| `color` | `String` | no | hex color, default `#6366f1` |
| `icon` | `String` | no | icon key, default `target` |
| `frequency` | `HabitFrequency` | no | `daily`\|`weekly_days`\|`weekly_target`, default `daily` |
| `schedule` | `ScheduleConfig` | conditional | Required if frequency ≠ `daily` |
| `target_per_day` | `i32` | no | 1–100, default 1 |

**`schedule` shapes by frequency:**
```json
// weekly_days: which ISO days (1=Mon..7=Sun)
{ "days": [1, 3, 5] }

// weekly_target: how many times per week
{ "times_per_week": 4 }

// daily: null or omitted
null
```

**Response `201`:** Full `HabitResponse`.

**Errors:**
| Code | When |
|---|---|
| `VALIDATION_FAILED` | Invalid name, bad schedule config |
| `RESOURCE_CONFLICT` | Duplicate active habit name for this user |
| `ENTITLEMENT_HABIT_LIMIT` | Habit count ≥ tier limit |
| `ENTITLEMENT_SCHEDULE` | `weekly_days`/`weekly_target` on Free tier |

---

### 7.4 `PUT /api/habits/{id}`

**Auth:** Bearer
**Entitlement:** `schedule_types` (if changing frequency)

```rust
pub async fn update_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
    Json(body): Json<UpdateHabitRequest>,
) -> AppResult<Json<HabitResponse>>
```

**Request:** Partial update — only provided fields are changed.
```json
{
  "name": "Morning Run",
  "color": "#22c55e"
}
```

| Field | Type | Required |
|---|---|---|
| `name` | `String` | no |
| `description` | `String` | no |
| `color` | `String` | no |
| `icon` | `String` | no |
| `frequency` | `HabitFrequency` | no |
| `schedule` | `ScheduleConfig` | no |
| `target_per_day` | `i32` | no |
| `sort_order` | `i32` | no |

**Response `200`:** Full updated `HabitResponse`.

---

### 7.5 `DELETE /api/habits/{id}`

**Auth:** Bearer

```rust
pub async fn delete_habit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>>
```

**Response `200`:**
```json
{
  "deleted": true,
  "id": "550e8400-..."
}
```

**Behavior:** Soft delete (`SET deleted_at = NOW()`). Returns 200 even if already
soft-deleted (idempotent). Returns `RESOURCE_NOT_FOUND` only if the habit_id
doesn't exist at all or belongs to another user.

---

### 7.6 `POST /api/habits/{id}/complete`

**Auth:** Bearer
**This is the toggle endpoint — the primary completion interaction.**

```rust
pub async fn toggle(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
    Json(body): Json<CompleteRequest>,
) -> AppResult<Json<ToggleResponse>>
```

**Request:**
```json
{
  "date": "2026-02-10"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `date` | `NaiveDate` | no | ±1 day from server-now in user TZ. Default: today in user TZ |

**Response `200`:**
```json
{
  "action": "created",
  "completion": {
    "id": "...",
    "habit_id": "...",
    "local_date_bucket": "2026-02-10",
    "value": 1,
    "created_at": "2026-02-10T13:45:00Z"
  },
  "habit": {
    "current_streak": 14,
    "longest_streak": 14,
    "total_completions": 43
  }
}
```

Or when toggling off:
```json
{
  "action": "deleted",
  "completion": null,
  "habit": {
    "current_streak": 12,
    "longest_streak": 14,
    "total_completions": 42
  }
}
```

**Side effects:**
1. Streak recalculated.
2. WebSocket broadcast: `{ "type": "completion_changed", "habit_id": "..." }`.

---

### 7.7 `GET /api/habits/{id}/calendar`

**Auth:** Bearer
**Entitlement:** `heatmap_months` (Free=1, Plus=6, Pro=12)

```rust
pub async fn calendar(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
    Query(params): Query<CalendarQuery>,
) -> AppResult<Json<Vec<CalendarEntry>>>
```

**Query params:**
| Param | Type | Default | Validation |
|---|---|---|---|
| `months` | `i32` | 3 | 1–12, clamped to tier limit |

**Response `200`:**
```json
[
  { "date": "2026-02-10", "count": 1, "target": 1 },
  { "date": "2026-02-09", "count": 1, "target": 1 },
  { "date": "2026-02-08", "count": 0, "target": 1 },
  "..."
]
```

Zero-filled via `generate_series`. Every day in the range has an entry.

---

### 7.8 `GET /api/habits/{id}/stats`

**Auth:** Bearer
**Entitlement:** `analytics_days` (Free=7, Plus=30, Pro=365)

```rust
pub async fn stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(habit_id): Path<Uuid>,
) -> AppResult<Json<HabitStatsResponse>>
```

**Response `200`:**
```json
{
  "habit_id": "...",
  "current_streak": 14,
  "longest_streak": 14,
  "total_completions": 43,
  "completion_rate_30d": 0.87,
  "completions_this_week": 5,
  "target_this_week": 7
}
```

---

## 8. Mood Endpoints

### 8.1 `POST /api/mood`

**Auth:** Bearer

```rust
pub async fn upsert(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<MoodRequest>,
) -> AppResult<Json<MoodLogResponse>>
```

**Request:**
```json
{
  "date": "2026-02-10",
  "mood": 4,
  "energy": 3,
  "stress": 2,
  "note": "Good morning workout"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `date` | `NaiveDate` | no | Default: today in user TZ |
| `mood` | `i16` | no* | 1–5 |
| `energy` | `i16` | no* | 1–5 |
| `stress` | `i16` | no* | 1–5 |
| `note` | `String` | no | max 5000 chars |

*At least one of mood/energy/stress must be provided.

**Response `200`:**
```json
{
  "id": "...",
  "user_id": "...",
  "local_date_bucket": "2026-02-10",
  "mood": 4,
  "energy": 3,
  "stress": 2,
  "note": "Good morning workout",
  "created_at": "2026-02-10T13:00:00Z",
  "updated_at": "2026-02-10T13:00:00Z"
}
```

**Idempotency:** `ON CONFLICT (user_id, local_date_bucket) DO UPDATE SET ... COALESCE`.
Only provided fields overwrite; others retain previous values.

---

### 8.2 `GET /api/mood`

**Auth:** Bearer

```rust
pub async fn list(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<MoodQuery>,
) -> AppResult<Json<Vec<MoodLogResponse>>>
```

**Query params:**
| Param | Type | Default |
|---|---|---|
| `range` | `String` | `7d` |

Accepted values: `7d`, `14d`, `30d`, `90d`.

**Response `200`:** Array of `MoodLogResponse` ordered by date descending.

---

## 9. Insight & Review Endpoints

### 9.1 `POST /api/insights/generate`

**Auth:** Bearer
**Entitlement:** `ai_insights` (Free=blocked, Plus=1/week, Pro=unlimited)

```rust
pub async fn generate(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<InsightResponse>>
```

**Request:** Empty body.

**Response `200`:**
```json
{
  "id": "...",
  "week_start_date": "2026-02-03",
  "source": "claude",
  "summary": "Great week! Your meditation streak hit 14 days...",
  "wins": [
    "14-day meditation streak — your longest yet!",
    "Exercise consistency improved to 85%"
  ],
  "improvements": [
    "Reading habit dropped to 60% — try pairing it with morning coffee",
    "Consider adding a wind-down routine before bed"
  ],
  "mood_correlation": "Your mood scores are 0.3 points higher on days you exercise",
  "streak_analysis": "Your longest active streak is 14 days on Meditation...",
  "tip_of_the_week": "Try habit stacking: do your reading right after meditation",
  "generated_at": "2026-02-10T03:00:00Z"
}
```

**Behavior:**
1. Check `insights` cache for current ISO week → return if exists.
2. Gather habits, completions (30d), mood_logs (7d).
3. Call Claude API (timeout 30s, 2 retries with 2s/8s backoff).
4. On Claude failure → generate deterministic fallback, `source: "fallback"`.
5. Cache in `insights` table.

**Errors:**
| Code | When |
|---|---|
| `ENTITLEMENT_INSIGHTS` | Free tier user |
| `INSIGHT_GENERATION_FAIL` | Claude failed AND fallback returned (status 200 with `source: "fallback"`) |

Note: Claude failure is **not** a user-facing error. The fallback is returned with `200`.
`INSIGHT_GENERATION_FAIL` is only returned if both Claude AND fallback fail (shouldn't happen).

---

### 9.2 `GET /api/insights/latest`

**Auth:** Bearer
**Entitlement:** `ai_insights`

```rust
pub async fn latest(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<InsightResponse>>
```

Returns the most recent cached insight. Does NOT trigger generation.

**Response `200`:** Same `InsightResponse` shape.
**Response `404`:** `RESOURCE_NOT_FOUND` if no insight has been generated yet.

---

### 9.3 `GET /api/reviews/weekly`

**Auth:** Bearer

```rust
pub async fn weekly(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<WeeklyReviewQuery>,
) -> AppResult<Json<WeeklyReviewResponse>>
```

**Query params:**
| Param | Type | Default | Format |
|---|---|---|---|
| `week` | `String` | last complete week | `YYYY-WNN` (e.g., `2026-W06`) |

**Response `200`:**
```json
{
  "week_start": "2026-02-03",
  "week_end": "2026-02-09",
  "overall": {
    "total_completions": 28,
    "total_possible": 35,
    "completion_rate": 0.80,
    "best_day": "Monday",
    "worst_day": "Saturday"
  },
  "habits": [
    {
      "id": "...",
      "name": "Morning Meditation",
      "color": "#6366f1",
      "completed": 7,
      "possible": 7,
      "rate": 1.0
    },
    {
      "id": "...",
      "name": "Exercise",
      "color": "#ef4444",
      "completed": 2,
      "possible": 3,
      "rate": 0.67
    }
  ]
}
```

---

## 10. Billing Endpoints

### 10.1 `GET /api/subscription/status`

**Auth:** Bearer

```rust
pub async fn status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<SubscriptionStatusResponse>>
```

**Response `200`:**
```json
{
  "tier": "plus",
  "status": "active",
  "current_period_end": "2026-03-10T00:00:00Z",
  "cancel_at_period_end": false,
  "entitlements": {
    "max_habits": 15,
    "schedule_types": ["daily", "weekly_days", "weekly_target"],
    "analytics_days": 30,
    "heatmap_months": 6,
    "ai_insights_per_week": 1,
    "data_export": false
  }
}
```

---

### 10.2 `POST /api/subscription/checkout`

**Auth:** Bearer (registered users only — `require_registered` middleware)

```rust
pub async fn checkout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CheckoutRequest>,
) -> AppResult<Json<CheckoutResponse>>
```

**Request:**
```json
{
  "price_id": "price_1234567890",
  "tier": "plus"
}
```

**Response `200`:**
```json
{
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

**Errors:**
| Code | When |
|---|---|
| `AUTH_FORBIDDEN` | Guest user |
| `STRIPE_ERROR` | Stripe API failure |

---

### 10.3 `POST /api/subscription/portal`

**Auth:** Bearer (registered users only)

```rust
pub async fn portal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<PortalResponse>>
```

**Response `200`:**
```json
{
  "portal_url": "https://billing.stripe.com/p/session/..."
}
```

---

### 10.4 `POST /api/webhook/stripe`

**Auth:** Stripe-Signature header (HMAC-SHA256)
**Rate limit:** 100/min per IP

```rust
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<WebhookAckResponse>>
```

**Handled events:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Set tier from `metadata.tier`, status=`active` |
| `customer.subscription.updated` | Update `subscription_status` |
| `customer.subscription.deleted` | Set tier=`free`, status=`canceled` |
| `invoice.payment_failed` | Set status=`past_due` |

**Response `200`:**
```json
{
  "received": true,
  "duplicate": false
}
```

**Dedup:** `INSERT INTO stripe_events (event_id, event_type) ON CONFLICT DO NOTHING`.

---

## 11. System Endpoints

### 11.1 `GET /health`

**Auth:** None

```rust
pub async fn health(
    State(state): State<AppState>,
) -> impl IntoResponse
```

**Response `200`:**
```json
{
  "status": "healthy",
  "service": "habitarc-api",
  "version": "0.1.0"
}
```

Always returns 200 if the process is running. Does NOT check DB.

---

### 11.2 `GET /readyz`

**Auth:** None

```rust
pub async fn readyz(
    State(state): State<AppState>,
) -> impl IntoResponse
```

**Response `200`:**
```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "migrations": true
  }
}
```

**Response `503`:**
```json
{
  "status": "not_ready",
  "checks": {
    "database": false,
    "migrations": true
  }
}
```

Checks DB connectivity via `SELECT 1`. Used by load balancer health checks.
`/health` is for liveness; `/readyz` is for readiness.

---

## 12. Rust DTO Reference

All DTOs live in `backend/src/dto.rs` (or split into `dto/` module).
See the companion file `backend/src/dto.rs` for the complete Rust source.

### Summary of Types

**Auth DTOs:**
- `SignupRequest` — email, password, name, timezone, guest_token
- `LoginRequest` — email, password
- `RefreshRequest` — refresh_token
- `GuestRequest` — timezone
- `AuthResponse` — access_token, refresh_token, expires_in, user
- `GuestAuthResponse` — extends AuthResponse with guest_token
- `UserProfileResponse` — full user profile with entitlements

**Habit DTOs:**
- `CreateHabitRequest` — name, description, color, icon, frequency, schedule, target_per_day
- `UpdateHabitRequest` — all fields optional (partial update)
- `HabitResponse` — full habit with schedule
- `HabitTodayResponse` — habit + completed_today, is_complete, is_due_today
- `CompleteRequest` — date (optional)
- `ToggleResponse` — action, completion, habit streak summary
- `CalendarQuery` — months
- `CalendarEntry` — date, count, target
- `HabitStatsResponse` — streaks, rates

**Mood DTOs:**
- `MoodRequest` — date, mood, energy, stress, note
- `MoodQuery` — range
- `MoodLogResponse` — full mood log

**Insight DTOs:**
- `InsightResponse` — summary, wins, improvements, mood_correlation, streak_analysis, tip, source
- `WeeklyReviewQuery` — week
- `WeeklyReviewResponse` — overall stats + per-habit breakdown

**Billing DTOs:**
- `CheckoutRequest` — price_id, tier
- `CheckoutResponse` — checkout_url
- `PortalResponse` — portal_url
- `SubscriptionStatusResponse` — tier, status, period, entitlements
- `WebhookAckResponse` — received, duplicate

**Common DTOs:**
- `MessageResponse` — message
- `DeleteResponse` — deleted, id
- `ErrorResponse` — error.code, error.message, error.status, error.details

---

### Route Module Structure

```
src/
├── main.rs                 AppState, router assembly
├── config.rs               Config from env
├── error.rs                AppError, error codes, IntoResponse
├── dto.rs                  All request/response DTOs
├── auth/
│   ├── mod.rs
│   ├── jwt.rs              Claims, token creation/verification
│   ├── password.rs         argon2 hash/verify
│   └── middleware.rs       require_auth, require_registered, AuthUser
├── middleware/
│   ├── mod.rs
│   ├── entitlement.rs      require_entitlement, EntitlementContext
│   └── rate_limit.rs       per-IP and per-user rate limiting
├── routes/
│   ├── mod.rs              pub fn router(state) -> Router
│   ├── auth.rs             signup, login, refresh, logout, guest, me
│   ├── habits.rs           list, today, create, update, delete, toggle, calendar, stats
│   ├── mood.rs             upsert, list
│   ├── insights.rs         generate, latest
│   ├── reviews.rs          weekly
│   ├── billing.rs          status, checkout, portal, webhook
│   └── system.rs           health, readyz
├── services/
│   ├── mod.rs
│   ├── streak.rs           update_streak()
│   ├── insight.rs          call_claude(), generate_fallback()
│   └── billing.rs          Stripe customer/session helpers
├── models/
│   ├── mod.rs
│   ├── user.rs             User, SubscriptionTier, SubscriptionStatus
│   ├── habit.rs            Habit, HabitFrequency, HabitSchedule
│   ├── completion.rs       Completion
│   ├── mood_log.rs         MoodLog
│   ├── insight.rs          Insight
│   └── subscription.rs     Subscription, FeatureEntitlement
└── db/
    └── mod.rs              create_pool()
```

### Router Assembly

```rust
pub fn router(state: AppState) -> Router {
    let public = Router::new()
        .route("/health",              get(system::health))
        .route("/readyz",              get(system::readyz))
        .route("/api/auth/signup",     post(auth::signup))
        .route("/api/auth/login",      post(auth::login))
        .route("/api/auth/refresh",    post(auth::refresh))
        .route("/api/auth/guest",      post(auth::guest))
        .route("/api/webhook/stripe",  post(billing::webhook));

    let protected = Router::new()
        // Auth
        .route("/api/auth/me",         get(auth::me))
        .route("/api/auth/logout",     post(auth::logout))
        // Habits
        .route("/api/habits",          get(habits::list_habits))
        .route("/api/habits/today",    get(habits::today_list))
        .route("/api/habits",          post(habits::create_habit))
        .route("/api/habits/:id",      put(habits::update_habit))
        .route("/api/habits/:id",      delete(habits::delete_habit))
        .route("/api/habits/:id/complete",  post(completions::toggle))
        .route("/api/habits/:id/calendar",  get(completions::calendar))
        .route("/api/habits/:id/stats",     get(completions::stats))
        // Mood
        .route("/api/mood",            post(mood::upsert))
        .route("/api/mood",            get(mood::list))
        // Insights
        .route("/api/insights/generate", post(insights::generate))
        .route("/api/insights/latest",   get(insights::latest))
        // Reviews
        .route("/api/reviews/weekly",  get(reviews::weekly))
        // Billing
        .route("/api/subscription/status",   get(billing::status))
        .route("/api/subscription/checkout", post(billing::checkout))
        .route("/api/subscription/portal",   post(billing::portal))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::middleware::require_auth,
        ));

    Router::new()
        .merge(public)
        .merge(protected)
        .layer(cors_layer(&state.config))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
```

---

*Document version: 1.0.0 — Generated for HabitArc backend*
*Last updated: 2026-02-10*
