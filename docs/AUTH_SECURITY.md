# HabitArc — Auth Security Specification

> Principal Security Engineer specification.
> Axum 0.7 · argon2id · JWT access + refresh rotation · DB-backed token families
> Token family revocation · Rate limiting · Account lockout · Audit logging

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Password Security](#2-password-security)
3. [JWT Architecture](#3-jwt-architecture)
4. [Refresh Token Rotation & DB Storage](#4-refresh-token-rotation--db-storage)
5. [Token Family Revocation](#5-token-family-revocation)
6. [Refresh Flow Sequence](#6-refresh-flow-sequence)
7. [Middleware Design](#7-middleware-design)
8. [Rate Limiting](#8-rate-limiting)
9. [Account Lockout Policy](#9-account-lockout-policy)
10. [Audit Logging](#10-audit-logging)
11. [Cookie / Session / XSS Policy](#11-cookie--session--xss-policy)
12. [Abuse Controls & Alerting](#12-abuse-controls--alerting)
13. [Security Gaps in Current Code](#13-security-gaps-in-current-code)
14. [Implementation: Rust Code](#14-implementation-rust-code)

---

## 1. Threat Model

### Assets

| Asset | Sensitivity | Storage |
|---|---|---|
| User passwords | Critical | Postgres — argon2id hash only |
| Refresh tokens | Critical | Postgres — SHA-256 hash only; raw token in client memory/localStorage |
| Access tokens (JWT) | High | Client memory/localStorage; never persisted server-side |
| User email addresses | Medium | Postgres plaintext (encrypted at rest via managed Postgres) |
| Habit data | Low-Medium | Postgres |
| Stripe customer IDs | Medium | Postgres |

### Threat Actors

| Actor | Capability | Motivation |
|---|---|---|
| **Script kiddie** | Automated credential stuffing, brute force | Account takeover for resale |
| **Opportunistic attacker** | XSS injection via habit names/notes, CSRF | Data theft, session hijacking |
| **Insider (compromised DB)** | Read access to Postgres | Credential extraction, token replay |
| **Network attacker (MITM)** | Intercept unencrypted traffic | Token theft, session hijacking |
| **Stolen device** | Physical access to user's browser | localStorage token extraction |

### Attack Surface & Mitigations

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ATTACK                         │ MITIGATION                            │
├────────────────────────────────┼───────────────────────────────────────┤
│ Credential stuffing            │ Rate limiting (10/min/IP on login)    │
│                                │ Account lockout (progressive backoff) │
│                                │ Audit log alerting                    │
├────────────────────────────────┼───────────────────────────────────────┤
│ Brute force password           │ argon2id (19 MiB, 2 iterations)      │
│                                │ Rate limiting + lockout               │
│                                │ Min 8-char password requirement       │
├────────────────────────────────┼───────────────────────────────────────┤
│ Refresh token theft            │ SHA-256 hash in DB (no plaintext)     │
│                                │ Single-use rotation                   │
│                                │ Family revocation on reuse            │
│                                │ 7-day expiry                          │
├────────────────────────────────┼───────────────────────────────────────┤
│ Access token theft             │ 15-min TTL (short window)             │
│                                │ No server-side revocation (by design) │
│                                │ Stateless verification only           │
├────────────────────────────────┼───────────────────────────────────────┤
│ XSS → token extraction         │ CSP headers                           │
│                                │ Input sanitization (server-side)      │
│                                │ HttpOnly cookie option (see §11)      │
│                                │ No inline scripts                     │
├────────────────────────────────┼───────────────────────────────────────┤
│ CSRF                           │ SameSite=Strict cookies               │
│                                │ Bearer token auth (immune to CSRF)    │
│                                │ CORS single-origin                    │
├────────────────────────────────┼───────────────────────────────────────┤
│ DB compromise → password leak  │ argon2id hashes (not reversible)      │
│                                │ No plaintext refresh tokens in DB     │
├────────────────────────────────┼───────────────────────────────────────┤
│ DB compromise → token replay   │ Tokens are SHA-256 hashed             │
│                                │ Attacker cannot reconstruct raw token │
├────────────────────────────────┼───────────────────────────────────────┤
│ Stolen device                  │ Logout revokes all refresh tokens     │
│                                │ Access token expires in 15 min        │
│                                │ User can revoke from another device   │
├────────────────────────────────┼───────────────────────────────────────┤
│ Enumeration (email exists?)    │ Login returns same error for wrong    │
│                                │ email and wrong password              │
│                                │ Signup returns 409 (acceptable trade) │
├────────────────────────────────┼───────────────────────────────────────┤
│ MITM                           │ TLS required (enforced at LB/proxy)   │
│                                │ HSTS header                           │
│                                │ Secure cookie flag                    │
└────────────────────────────────┴───────────────────────────────────────┘
```

---

## 2. Password Security

### argon2id Configuration

```rust
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};

/// Production argon2id parameters.
/// OWASP minimum: m=19456 (19 MiB), t=2, p=1
/// These parameters take ~200ms on a modern server CPU.
fn argon2_instance() -> Argon2<'static> {
    let params = Params::new(
        19_456,  // m_cost: 19 MiB memory
        2,       // t_cost: 2 iterations
        1,       // p_cost: 1 degree of parallelism
        None,    // output length: default 32 bytes
    ).expect("valid argon2 params");

    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2_instance();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Hash failed: {}", e)))
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Invalid hash: {}", e)))?;

    // verify_password uses the params embedded in the hash string,
    // so even if we change params later, old hashes still verify.
    Ok(argon2_instance().verify_password(password.as_bytes(), &parsed).is_ok())
}
```

### Password Policy

| Rule | Value | Enforcement |
|---|---|---|
| Minimum length | 8 characters | Server-side validation |
| Maximum length | 128 characters | Server-side validation (prevents DoS via huge argon2 input) |
| Complexity | None required | NIST 800-63B: length > complexity rules |
| Breach check | Future: HaveIBeenPwned k-anonymity API | Not in v1 |

### Current Gap

The existing `password.rs` uses `Argon2::default()` which uses safe defaults, but we should pin explicit params for reproducibility. The implementation above makes the params explicit.

---

## 3. JWT Architecture

### Token Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    ACCESS TOKEN (JWT)                            │
│                                                                 │
│  Algorithm:  HS256 (HMAC-SHA256)                                │
│  TTL:        15 minutes (900 seconds)                           │
│  Storage:    Client memory / localStorage                       │
│  Revocable:  NO (stateless — expires naturally)                 │
│  Claims:     sub (user_id), email, iat, exp, token_type, jti   │
│  Verified:   On every protected request (middleware)            │
│                                                                 │
│  WHY short TTL: Limits damage window if token is stolen.        │
│  WHY not revocable: Avoids DB lookup on every request.          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   REFRESH TOKEN (JWT)                            │
│                                                                 │
│  Algorithm:  HS256 (HMAC-SHA256)                                │
│  TTL:        7 days (604800 seconds)                            │
│  Storage:    Client localStorage; SHA-256 hash in Postgres      │
│  Revocable:  YES (DB-backed, single-use rotation)               │
│  Claims:     sub (user_id), email, iat, exp, token_type, jti   │
│  Verified:   On refresh request only                            │
│                                                                 │
│  WHY DB-backed: Enables revocation, theft detection, audit.     │
│  WHY single-use: Stolen token can only be used once before      │
│                   the legitimate user's next refresh fails,     │
│                   triggering family revocation.                  │
└─────────────────────────────────────────────────────────────────┘
```

### Claims Structure

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// User ID
    pub sub: Uuid,
    /// User email (empty string for guests)
    pub email: String,
    /// Issued at (Unix timestamp)
    pub iat: i64,
    /// Expires at (Unix timestamp)
    pub exp: i64,
    /// Token type discriminator
    pub token_type: TokenType,
    /// Unique token identifier — used to correlate with DB row for refresh tokens
    pub jti: Uuid,
}
```

**Key change from current code:** Added `jti` (JWT ID) claim. This is a UUID that uniquely identifies each token. For refresh tokens, `jti` maps to `refresh_tokens.id` in the database. This enables precise revocation without parsing the token body.

### JWT Secret Requirements

```
JWT_SECRET must be:
- At least 256 bits (32 bytes) of entropy
- Generated via: openssl rand -base64 32
- Stored in environment variable, NEVER in code
- Rotated periodically (requires token migration strategy)
```

---

## 4. Refresh Token Rotation & DB Storage

### Schema (from migrations_v2/008)

```sql
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,           -- SHA-256 hex, 64 chars
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,
    parent_token_id UUID REFERENCES refresh_tokens(id),  -- rotation chain
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_token_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT chk_expires_future CHECK (expires_at > created_at),
    CONSTRAINT chk_revoked_consistency CHECK (
        (revoked = true AND revoked_at IS NOT NULL)
        OR (revoked = false AND revoked_at IS NULL)
    )
);
```

### Token Lifecycle

```
1. LOGIN / SIGNUP / GUEST
   ├── Generate access JWT (jti = random UUID)
   ├── Generate refresh JWT (jti = random UUID)
   ├── SHA-256 hash the raw refresh JWT
   ├── INSERT INTO refresh_tokens (id = jti, user_id, token_hash, expires_at)
   └── Return both tokens to client

2. REFRESH (token rotation)
   ├── Decode refresh JWT → extract jti
   ├── SHA-256 hash the raw refresh JWT
   ├── SELECT FROM refresh_tokens WHERE id = jti
   │   ├── NOT FOUND → reject (token unknown)
   │   ├── FOUND + revoked = true → FAMILY REVOCATION (theft detected!)
   │   └── FOUND + revoked = false + not expired → proceed
   ├── Mark old token: UPDATE SET revoked = true, revoked_at = NOW()
   ├── Generate new access JWT (new jti)
   ├── Generate new refresh JWT (new jti)
   ├── INSERT new refresh_tokens row (parent_token_id = old jti)
   └── Return new token pair

3. LOGOUT
   ├── Revoke ALL active refresh tokens for user
   └── UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = false

4. FAMILY REVOCATION (theft detected)
   ├── Walk parent_token_id chain to find the root token (family_id)
   ├── Revoke ALL tokens in the family:
   │   WITH RECURSIVE family AS (
   │       SELECT id FROM refresh_tokens WHERE id = $root
   │       UNION ALL
   │       SELECT rt.id FROM refresh_tokens rt
   │       JOIN family f ON rt.parent_token_id = f.id
   │   )
   │   UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
   │   WHERE id IN (SELECT id FROM family) AND revoked = false
   ├── Log audit event: token_revoked with metadata { reason: "reuse_detected" }
   └── Return 401 to the caller
```

### Why Single-Use Rotation Detects Theft

```
Timeline: Attacker steals refresh token T1

LEGITIMATE USER                    ATTACKER
     │                                │
     │  T1 (valid)                    │  T1 (stolen copy)
     │                                │
     ├─ Refresh with T1 ────────────► │
     │  Server: T1 revoked, T2 issued │
     │  ◄── T2 (new token)            │
     │                                │
     │                                ├─ Refresh with T1 ──────────►
     │                                │  Server: T1 is REVOKED!
     │                                │  ⚠️ REUSE DETECTED
     │                                │  → Revoke ENTIRE family
     │                                │  → 401 to attacker
     │                                │
     ├─ Refresh with T2 ────────────► │
     │  Server: T2 is REVOKED (family)│
     │  → 401 to legitimate user      │
     │  → User must re-login          │
     │                                │
     │  This is the correct behavior: │
     │  force re-authentication when  │
     │  theft is detected.            │
```

---

## 5. Token Family Revocation

### Family Definition

A **token family** is a chain of refresh tokens linked by `parent_token_id`. The root token (created at login) has `parent_token_id = NULL`. Each rotation creates a child token pointing to its parent.

```
Login → T1 (parent=NULL)
         └── Refresh → T2 (parent=T1)
                        └── Refresh → T3 (parent=T2)
                                       └── Refresh → T4 (parent=T3)
```

### Revocation SQL

```sql
-- Find the root of a token's family
WITH RECURSIVE ancestors AS (
    SELECT id, parent_token_id, user_id
    FROM refresh_tokens WHERE id = $1  -- start from the reused token
    UNION ALL
    SELECT rt.id, rt.parent_token_id, rt.user_id
    FROM refresh_tokens rt
    JOIN ancestors a ON a.parent_token_id = rt.id
)
SELECT id FROM ancestors WHERE parent_token_id IS NULL;
-- This gives us the family root.

-- Then revoke all descendants of that root:
WITH RECURSIVE family AS (
    SELECT id FROM refresh_tokens WHERE id = $root_id
    UNION ALL
    SELECT rt.id FROM refresh_tokens rt
    JOIN family f ON rt.parent_token_id = f.id
)
UPDATE refresh_tokens
SET revoked = true, revoked_at = NOW()
WHERE id IN (SELECT id FROM family)
  AND revoked = false;
```

### When Family Revocation Triggers

| Condition | Action |
|---|---|
| Refresh with a **revoked** token | Revoke entire family + audit log |
| Refresh with an **expired** token | Reject (401), no family revocation |
| Refresh with an **unknown** token hash | Reject (401), no family revocation |
| Logout | Revoke all user's active tokens (not just one family) |
| Password change | Revoke all user's active tokens |
| Account deletion | CASCADE delete via FK |

---

## 6. Refresh Flow Sequence

```
Client                          Server                          Database
  │                               │                               │
  │  POST /api/auth/refresh       │                               │
  │  { refresh_token: "eyJ..." }  │                               │
  │──────────────────────────────►│                               │
  │                               │                               │
  │                               │  1. Decode JWT                │
  │                               │     → extract jti, sub, exp   │
  │                               │     → verify signature        │
  │                               │     → verify token_type=refresh│
  │                               │     → verify exp > now        │
  │                               │                               │
  │                               │  2. SHA-256(raw_token) → hash │
  │                               │                               │
  │                               │  3. SELECT * FROM             │
  │                               │     refresh_tokens            │
  │                               │     WHERE id = $jti           │
  │                               │──────────────────────────────►│
  │                               │                               │
  │                               │  ◄── Row found                │
  │                               │                               │
  │                               │  4. Verify:                   │
  │                               │     a. row.token_hash == hash │
  │                               │     b. row.revoked == false   │
  │                               │     c. row.expires_at > now   │
  │                               │     d. row.user_id == sub     │
  │                               │                               │
  │                               │  IF row.revoked == true:      │
  │                               │  ┌─────────────────────────┐  │
  │                               │  │ THEFT DETECTED!         │  │
  │                               │  │ → Find family root      │  │
  │                               │  │ → Revoke entire family  │──►│
  │                               │  │ → Audit log             │──►│
  │                               │  │ → Return 401            │  │
  │                               │  └─────────────────────────┘  │
  │  ◄── 401 AUTH_REFRESH_REVOKED │                               │
  │                               │                               │
  │                               │  IF all checks pass:          │
  │                               │                               │
  │                               │  5. Revoke old token          │
  │                               │     UPDATE SET revoked=true   │
  │                               │──────────────────────────────►│
  │                               │                               │
  │                               │  6. Generate new pair         │
  │                               │     new_access  (jti=UUID)    │
  │                               │     new_refresh (jti=UUID)    │
  │                               │                               │
  │                               │  7. Store new refresh hash    │
  │                               │     INSERT refresh_tokens     │
  │                               │     (parent_token_id = old.id)│
  │                               │──────────────────────────────►│
  │                               │                               │
  │                               │  8. Audit log                 │
  │                               │     action=token_refreshed    │
  │                               │──────────────────────────────►│
  │                               │                               │
  │  ◄── 200 { access_token,     │                               │
  │            refresh_token,     │                               │
  │            expires_in }       │                               │
  │                               │                               │
```

---

## 7. Middleware Design

### Middleware Stack (applied in order)

```
Request
  │
  ▼
┌─────────────────────────────────┐
│  1. TraceLayer                  │  Structured logging for every request
├─────────────────────────────────┤
│  2. CorsLayer                   │  Single-origin, credentials allowed
├─────────────────────────────────┤
│  3. SecurityHeadersLayer        │  X-Content-Type-Options, X-Frame-Options, HSTS
├─────────────────────────────────┤
│  4. RequestBodyLimitLayer       │  256 KB max body size
├─────────────────────────────────┤
│  5. TimeoutLayer                │  30s request timeout
├─────────────────────────────────┤
│  6. RateLimitLayer (global)     │  Per-IP sliding window
├─────────────────────────────────┤
│  7. Route-specific middleware:  │
│     ├── require_auth            │  JWT validation (protected routes)
│     ├── require_registered      │  Reject guests (billing routes)
│     └── rate_limit_auth         │  Stricter limits on auth endpoints
└─────────────────────────────────┘
  │
  ▼
Handler
```

### `require_auth` Middleware

```rust
/// Validates JWT access token from Authorization: Bearer <token>.
/// Injects AuthUser into request extensions.
///
/// Security properties:
/// - Verifies HS256 signature against JWT_SECRET
/// - Verifies exp > now (rejects expired tokens)
/// - Verifies token_type == Access (rejects refresh tokens)
/// - Does NOT hit the database (stateless)
/// - Extracts IP from X-Forwarded-For or peer addr for logging
pub async fn require_auth(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // 1. Extract Bearer token
    let auth_header = req.headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::AuthRequired)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::AuthRequired)?;

    // 2. Verify JWT signature + expiry
    let token_data = verify_token(token, &state.config)
        .map_err(|_| AppError::TokenInvalid)?;

    // 3. Reject non-access tokens
    if token_data.claims.token_type != TokenType::Access {
        return Err(AppError::TokenInvalid);
    }

    // 4. Build AuthUser (no DB hit)
    let auth_user = AuthUser {
        id: token_data.claims.sub,
        email: if token_data.claims.email.is_empty() {
            None
        } else {
            Some(token_data.claims.email)
        },
        jti: token_data.claims.jti,
    };

    // 5. Extract client IP for downstream handlers
    let client_ip = extract_client_ip(&req, addr);
    req.extensions_mut().insert(auth_user);
    req.extensions_mut().insert(ClientIp(client_ip));

    Ok(next.run(req).await)
}

/// Extract real client IP from X-Forwarded-For (trusted proxy) or peer address.
fn extract_client_ip(req: &Request, peer: SocketAddr) -> IpAddr {
    req.headers()
        .get("X-Forwarded-For")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<IpAddr>().ok())
        .unwrap_or(peer.ip())
}

#[derive(Debug, Clone)]
pub struct ClientIp(pub IpAddr);
```

### `require_registered` Middleware

```rust
/// Rejects guest users. Applied to billing and export routes.
/// Must be layered AFTER require_auth.
pub async fn require_registered(
    Extension(auth_user): Extension<AuthUser>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // Check if user is guest by querying DB
    // (AuthUser doesn't carry is_guest to keep middleware stateless)
    // Alternative: add is_guest to JWT claims
    if auth_user.email.is_none() {
        return Err(AppError::Forbidden(
            "Guest accounts cannot access this resource. Please sign up.".into()
        ));
    }
    Ok(next.run(req).await)
}
```

---

## 8. Rate Limiting

### Strategy: In-Memory Sliding Window

```rust
use dashmap::DashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// Per-IP rate limiter using a sliding window counter.
/// Stored in AppState, shared across all Tokio tasks.
pub struct RateLimiter {
    /// Map of IP → (window_start, request_count)
    windows: DashMap<IpAddr, (Instant, u32)>,
    /// Window duration
    window: Duration,
    /// Max requests per window
    max_requests: u32,
}

impl RateLimiter {
    pub fn new(window: Duration, max_requests: u32) -> Self {
        Self {
            windows: DashMap::new(),
            window,
            max_requests,
        }
    }

    /// Returns Ok(remaining) or Err(retry_after_secs)
    pub fn check(&self, ip: IpAddr) -> Result<u32, u64> {
        let now = Instant::now();
        let mut entry = self.windows.entry(ip).or_insert((now, 0));
        let (window_start, count) = entry.value_mut();

        if now.duration_since(*window_start) > self.window {
            // Window expired, reset
            *window_start = now;
            *count = 1;
            return Ok(self.max_requests - 1);
        }

        if *count >= self.max_requests {
            let retry_after = self.window
                .checked_sub(now.duration_since(*window_start))
                .unwrap_or(Duration::ZERO)
                .as_secs();
            return Err(retry_after);
        }

        *count += 1;
        Ok(self.max_requests - *count)
    }

    /// Periodic cleanup of expired entries (call from background task)
    pub fn cleanup(&self) {
        let now = Instant::now();
        self.windows.retain(|_, (start, _)| {
            now.duration_since(*start) <= self.window * 2
        });
    }
}
```

### Rate Limit Configuration

| Endpoint Group | Window | Max Requests | Key |
|---|---|---|---|
| `POST /api/auth/login` | 1 min | 10 | IP |
| `POST /api/auth/signup` | 1 min | 5 | IP |
| `POST /api/auth/refresh` | 1 min | 30 | IP |
| `POST /api/auth/guest` | 1 min | 10 | IP |
| Protected mutations | 1 min | 60 | User ID |
| Protected reads | 1 min | 120 | User ID |
| Stripe webhook | 1 min | 100 | IP |

### Rate Limit Middleware

```rust
pub async fn rate_limit_auth(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = extract_client_ip(&req, addr);

    match state.auth_rate_limiter.check(ip) {
        Ok(remaining) => {
            let mut response = next.run(req).await;
            // Add rate limit headers
            response.headers_mut().insert(
                "X-RateLimit-Remaining",
                remaining.to_string().parse().unwrap(),
            );
            Ok(response)
        }
        Err(retry_after) => {
            tracing::warn!(ip = %ip, "Auth rate limit exceeded");
            let mut response = AppError::RateLimited.into_response();
            response.headers_mut().insert(
                "Retry-After",
                retry_after.to_string().parse().unwrap(),
            );
            Ok(response)
        }
    }
}
```

### AppState Extension

```rust
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub ws_tx: Option<broadcast::Sender<String>>,
    // Rate limiters
    pub auth_rate_limiter: Arc<RateLimiter>,     // 10/min for auth endpoints
    pub api_rate_limiter: Arc<RateLimiter>,       // 60/min for mutations
}
```

---

## 9. Account Lockout Policy

### Progressive Backoff

Account lockout is **IP-based + account-based** to prevent both targeted attacks and distributed attacks.

```
Failed attempts    │  Lockout duration  │  Action
───────────────────┼────────────────────┼──────────────────────
1-3                │  None              │  Normal auth flow
4-5                │  30 seconds        │  Return 429 + Retry-After
6-10               │  5 minutes         │  Return 429 + Retry-After
11-15              │  30 minutes        │  Return 429 + audit alert
16+                │  1 hour            │  Return 429 + audit alert
                   │                    │  + email notification to user
```

### Implementation

```rust
/// Check if login should be blocked due to too many failures.
/// Uses audit_logs table as the source of truth (no additional state needed).
pub async fn check_lockout(
    db: &PgPool,
    ip: IpAddr,
    email: &str,
) -> AppResult<Option<Duration>> {
    // Count recent failures for this IP
    let ip_failures = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM audit_logs
        WHERE ip_address = $1
          AND action = 'login_failed'
          AND created_at > NOW() - INTERVAL '1 hour'
        "#,
    )
    .bind(ip.to_string())
    .fetch_one(db)
    .await?;

    // Count recent failures for this email (across all IPs)
    let email_failures = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM audit_logs
        WHERE action = 'login_failed'
          AND metadata->>'email' = $1
          AND created_at > NOW() - INTERVAL '1 hour'
        "#,
    )
    .bind(email)
    .fetch_one(db)
    .await?;

    let failures = ip_failures.max(email_failures);

    let lockout = match failures {
        0..=3   => None,
        4..=5   => Some(Duration::from_secs(30)),
        6..=10  => Some(Duration::from_secs(300)),
        11..=15 => Some(Duration::from_secs(1800)),
        _       => Some(Duration::from_secs(3600)),
    };

    // If locked out, check if the lockout period has elapsed
    if let Some(duration) = lockout {
        let last_failure_at = sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            r#"
            SELECT MAX(created_at) FROM audit_logs
            WHERE (ip_address = $1 OR metadata->>'email' = $2)
              AND action = 'login_failed'
            "#,
        )
        .bind(ip.to_string())
        .bind(email)
        .fetch_one(db)
        .await?;

        if let Some(last) = last_failure_at {
            let elapsed = chrono::Utc::now() - last;
            if elapsed < chrono::Duration::from_std(duration).unwrap_or_default() {
                let remaining = duration.as_secs() - elapsed.num_seconds() as u64;
                return Ok(Some(Duration::from_secs(remaining)));
            }
        }
    }

    Ok(None)
}
```

### Login Handler with Lockout

```rust
pub async fn login(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let ip = client_ip.0;
    let user_agent = headers.get("User-Agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    // 1. Check lockout BEFORE any DB work
    if let Some(remaining) = check_lockout(&state.db, ip, &body.email).await? {
        audit_log(&state.db, None, AuditAction::LoginFailed, ip, &user_agent,
            json!({ "email": body.email, "reason": "locked_out" })).await;
        return Err(AppError::RateLimited);
    }

    // 2. Find user
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE lower(email) = lower($1) AND is_guest = false",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await?;

    let user = match user {
        Some(u) => u,
        None => {
            // Audit: failed login (unknown email)
            // IMPORTANT: same error as wrong password to prevent enumeration
            audit_log(&state.db, None, AuditAction::LoginFailed, ip, &user_agent,
                json!({ "email": body.email, "reason": "unknown_email" })).await;
            return Err(AppError::AuthRequired);
        }
    };

    // 3. Verify password
    let password_hash = user.password_hash.as_deref().ok_or(AppError::AuthRequired)?;
    if !verify_password(&body.password, password_hash)? {
        audit_log(&state.db, Some(user.id), AuditAction::LoginFailed, ip, &user_agent,
            json!({ "email": body.email, "reason": "wrong_password" })).await;
        return Err(AppError::AuthRequired);
    }

    // 4. Generate tokens + store refresh hash
    let email = user.email.as_deref().unwrap_or("");
    let (token_pair, refresh_jti) = create_token_pair_with_db(
        &state.db, user.id, email, &state.config
    ).await?;

    // 5. Audit: successful login
    audit_log(&state.db, Some(user.id), AuditAction::Login, ip, &user_agent,
        json!({ "refresh_token_id": refresh_jti })).await;

    Ok(Json(token_pair))
}
```

---

## 10. Audit Logging

### Audit Actions (from migration 001 enum)

```sql
CREATE TYPE audit_action AS ENUM (
    'login',
    'login_failed',
    'register',
    'guest_created',
    'guest_merged',
    'password_changed',
    'token_refreshed',
    'token_revoked',
    'subscription_changed',
    'account_deleted',
    'data_exported'
);
```

### Audit Log Helper

```rust
/// Insert an immutable audit log entry.
/// This function NEVER fails the parent operation — errors are logged and swallowed.
pub async fn audit_log(
    db: &PgPool,
    user_id: Option<Uuid>,
    action: AuditAction,
    ip: IpAddr,
    user_agent: &str,
    metadata: serde_json::Value,
) {
    let result = sqlx::query(
        r#"
        INSERT INTO audit_logs (user_id, action, ip_address, user_agent, metadata)
        VALUES ($1, $2, $3::INET, $4, $5)
        "#,
    )
    .bind(user_id)
    .bind(action)
    .bind(ip.to_string())
    .bind(user_agent)
    .bind(metadata)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::error!(error = %e, "Failed to write audit log");
    }
}
```

### What Gets Logged

| Event | user_id | metadata |
|---|---|---|
| `login` | Yes | `{ refresh_token_id }` |
| `login_failed` | Optional | `{ email, reason: "wrong_password"\|"unknown_email"\|"locked_out" }` |
| `register` | Yes | `{ guest_merged: bool }` |
| `guest_created` | Yes | `{ timezone }` |
| `guest_merged` | Yes | `{ guest_user_id, email }` |
| `token_refreshed` | Yes | `{ old_token_id, new_token_id }` |
| `token_revoked` | Yes | `{ reason: "logout"\|"reuse_detected"\|"password_changed", count }` |
| `password_changed` | Yes | `{ tokens_revoked: count }` |
| `subscription_changed` | Yes | `{ old_tier, new_tier, stripe_event_id }` |
| `account_deleted` | Yes | `{}` |

### IP + Device Metadata

Every audit log entry captures:
- **`ip_address`** — Real client IP from `X-Forwarded-For` (trusted proxy) or peer address. Stored as Postgres `INET`.
- **`user_agent`** — Raw `User-Agent` header string. Used for device fingerprinting in security reviews.
- **`metadata`** — JSONB with event-specific context.

---

## 11. Cookie / Session / XSS Policy

### Decision: Bearer Tokens in localStorage (with mitigations)

HabitArc uses a **SPA architecture** (Next.js client-side) communicating with a **separate Rust API**. Two options exist:

| Approach | Pros | Cons |
|---|---|---|
| **Bearer in localStorage** | Simple, works cross-origin, no CSRF risk | Vulnerable to XSS token extraction |
| **HttpOnly cookie** | Immune to XSS extraction | Requires same-site or proxy, CSRF risk, complex CORS |

**Decision:** Bearer tokens in localStorage with defense-in-depth XSS mitigations.

**Rationale:**
1. The API is on a different origin than the frontend (Fly.io vs Vercel). HttpOnly cookies would require a BFF proxy or same-domain deployment.
2. Bearer tokens are immune to CSRF by design.
3. XSS risk is mitigated by multiple layers (see below).
4. The 15-minute access token TTL limits the damage window even if a token is extracted.

### XSS Mitigation Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: Content Security Policy (CSP)                          │
│                                                                 │
│ Content-Security-Policy:                                        │
│   default-src 'self';                                           │
│   script-src 'self' 'nonce-{random}';                           │
│   style-src 'self' 'unsafe-inline';                             │
│   img-src 'self' data: https:;                                  │
│   connect-src 'self' https://api.habitarc.com wss://api...;     │
│   frame-ancestors 'none';                                       │
│   base-uri 'self';                                              │
│   form-action 'self';                                           │
│                                                                 │
│ Prevents inline script injection. Only scripts from 'self'      │
│ with a valid nonce can execute.                                 │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 2: Server-Side Input Sanitization                         │
│                                                                 │
│ All user input stored in DB is validated:                        │
│ - Habit names: 1-200 chars, no HTML tags                        │
│ - Descriptions: max 2000 chars, no HTML tags                    │
│ - Notes: max 5000 chars, no HTML tags                           │
│                                                                 │
│ React's JSX auto-escapes by default. No dangerouslySetInnerHTML │
│ is used anywhere in the codebase.                               │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 3: Security Headers (set by Axum + Next.js)               │
│                                                                 │
│ X-Content-Type-Options: nosniff                                 │
│ X-Frame-Options: DENY                                           │
│ X-XSS-Protection: 0  (deprecated, CSP is better)               │
│ Referrer-Policy: strict-origin-when-cross-origin                │
│ Strict-Transport-Security: max-age=31536000; includeSubDomains  │
│ Permissions-Policy: camera=(), microphone=(), geolocation=()    │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 4: Short Token TTL                                        │
│                                                                 │
│ Even if XSS extracts the access token, it expires in 15 min.    │
│ The refresh token can be stolen too, but:                        │
│ - Single-use rotation means the attacker's use is detected      │
│   on the legitimate user's next refresh.                        │
│ - Family revocation kicks in.                                   │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 5: Subresource Integrity (SRI)                            │
│                                                                 │
│ Next.js static assets use content-hashed filenames.              │
│ CDN-served scripts include integrity attributes.                 │
└─────────────────────────────────────────────────────────────────┘
```

### CORS Configuration

```rust
let cors = CorsLayer::new()
    // SINGLE origin — never use wildcard with credentials
    .allow_origin(
        config.frontend_url
            .parse::<HeaderValue>()
            .expect("valid frontend URL"),
    )
    // Only allow methods we actually use
    .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
    // Explicit allowed headers
    .allow_headers([
        header::AUTHORIZATION,
        header::CONTENT_TYPE,
        header::ACCEPT,
        HeaderName::from_static("idempotency-key"),
    ])
    // Allow credentials (cookies, auth headers)
    .allow_credentials(true)
    // Cache preflight for 1 hour
    .max_age(Duration::from_secs(3600));
```

### Future: HttpOnly Cookie Migration Path

If HabitArc moves to same-domain deployment (e.g., `app.habitarc.com` + `api.habitarc.com`):

```
Set-Cookie: access_token=eyJ...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
Set-Cookie: refresh_token=eyJ...; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=604800
```

Key changes needed:
1. API sets cookies on login/refresh responses.
2. Frontend stops reading/storing tokens in localStorage.
3. CSRF protection via `SameSite=Strict` (sufficient for same-site).
4. Refresh token cookie scoped to `/api/auth/refresh` path only.

---

## 12. Abuse Controls & Alerting

### Alert Triggers

| Trigger | Threshold | Action |
|---|---|---|
| Failed logins from single IP | >15 in 1 hour | Log `WARN`, block IP for 1 hour |
| Failed logins for single email | >10 in 1 hour | Log `WARN`, notify user via email (future) |
| Token family revocation | Any occurrence | Log `ERROR` — indicates active token theft |
| Refresh from new IP | First time for this user+IP | Log `INFO` with metadata (not blocked) |
| Signup burst from single IP | >5 in 1 minute | Rate limit (already covered) |
| Password change | Any occurrence | Revoke all tokens, audit log |

### Structured Log Format

All security events are emitted as structured JSON logs via `tracing`:

```rust
tracing::warn!(
    event = "auth.login_failed",
    ip = %ip,
    email = %email,
    reason = "wrong_password",
    failure_count = failures,
    "Login failed"
);

tracing::error!(
    event = "auth.token_reuse_detected",
    user_id = %user_id,
    token_id = %token_id,
    ip = %ip,
    family_size = revoked_count,
    "Refresh token reuse detected — family revoked"
);
```

### Sentry Integration

```rust
if failures > 15 {
    sentry::capture_message(
        &format!("Brute force detected: {} failures from IP {} in 1h", failures, ip),
        sentry::Level::Warning,
    );
}

// Token reuse is always a Sentry event
if reuse_detected {
    sentry::capture_message(
        &format!("Token reuse detected for user {}", user_id),
        sentry::Level::Error,
    );
}
```

### Periodic Cleanup Tasks

```rust
/// Run as a Tokio interval task every hour
async fn cleanup_auth_state(db: &PgPool, rate_limiter: &RateLimiter) {
    // 1. Purge expired + revoked refresh tokens older than 30 days
    sqlx::query(
        "DELETE FROM refresh_tokens WHERE (revoked = true OR expires_at < NOW()) AND created_at < NOW() - INTERVAL '30 days'"
    )
    .execute(db)
    .await
    .ok();

    // 2. Purge stale guest accounts (no activity in 30 days)
    sqlx::query(
        "DELETE FROM users WHERE is_guest = true AND updated_at < NOW() - INTERVAL '30 days'"
    )
    .execute(db)
    .await
    .ok();

    // 3. Clean rate limiter expired entries
    rate_limiter.cleanup();

    // 4. Purge old stripe events (>90 days)
    sqlx::query(
        "DELETE FROM stripe_events WHERE processed_at < NOW() - INTERVAL '90 days'"
    )
    .execute(db)
    .await
    .ok();

    tracing::info!("Auth cleanup completed");
}
```

---

## 13. Security Gaps in Current Code

| # | File | Gap | Severity | Fix |
|---|---|---|---|---|
| 1 | `auth/jwt.rs` | No `jti` claim — cannot correlate JWT with DB row | **High** | Add `jti: Uuid` to Claims |
| 2 | `handlers/auth.rs` `refresh()` | Refresh token NOT stored in DB — no revocation possible | **Critical** | Store SHA-256 hash in `refresh_tokens` table |
| 3 | `handlers/auth.rs` `refresh()` | No single-use rotation — same token can be reused indefinitely | **Critical** | Implement rotation + family revocation |
| 4 | `handlers/auth.rs` | No logout endpoint — tokens live until expiry | **High** | Add `POST /api/auth/logout` that revokes all refresh tokens |
| 5 | `handlers/auth.rs` `login()` | No audit logging — failed logins not tracked | **High** | Add audit_log calls on success and failure |
| 6 | `handlers/auth.rs` `login()` | No account lockout — unlimited brute force possible | **High** | Add `check_lockout()` before password verification |
| 7 | `auth/middleware.rs` | No IP extraction — can't log client IP | **Medium** | Add `ConnectInfo` + `X-Forwarded-For` parsing |
| 8 | `main.rs` | No rate limiting on auth routes | **High** | Add `rate_limit_auth` middleware layer |
| 9 | `auth/password.rs` | Uses `Argon2::default()` — params not pinned | **Low** | Pin explicit params for reproducibility |
| 10 | `main.rs` CORS | Uses `allow_methods(Any)` + `allow_headers(Any)` | **Medium** | Restrict to specific methods and headers |
| 11 | `handlers/auth.rs` `login()` | Returns different errors for "user not found" vs "wrong password" | **Low** | Already returns same `Unauthorized` — good. But error message could leak via timing. |
| 12 | `handlers/billing.rs` | Stripe webhook signature NOT verified | **High** | Implement HMAC-SHA256 verification |
| 13 | `handlers/auth.rs` `register()` | No password max length check — argon2 DoS possible | **Medium** | Add 128-char max |

### Priority Order

1. **Critical:** Refresh token DB storage + rotation (#2, #3)
2. **High:** Logout endpoint (#4), audit logging (#5), lockout (#6), rate limiting (#8), Stripe webhook verification (#12)
3. **Medium:** IP extraction (#7), CORS tightening (#10), password max length (#13)
4. **Low:** Argon2 param pinning (#9)

---

## 14. Implementation: Rust Code

### Complete Refresh Token Service

```rust
// services/auth.rs

use sha2::{Sha256, Digest};
use uuid::Uuid;
use chrono::{Duration, Utc};
use sqlx::PgPool;

use crate::auth::jwt::{Claims, TokenType, create_access_token, create_refresh_token};
use crate::config::Config;
use crate::error::{AppError, AppResult};

/// SHA-256 hash a raw token string → 64-char hex
pub fn hash_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Create a token pair AND store the refresh token hash in the DB.
/// Returns (TokenPair, refresh_jti).
pub async fn create_token_pair_with_db(
    db: &PgPool,
    user_id: Uuid,
    email: &str,
    config: &Config,
    parent_token_id: Option<Uuid>,
) -> AppResult<(TokenPair, Uuid)> {
    let access_jti = Uuid::new_v4();
    let refresh_jti = Uuid::new_v4();

    let access_token = create_access_token(user_id, email, config, access_jti)?;
    let refresh_token = create_refresh_token(user_id, email, config, refresh_jti)?;

    let token_hash = hash_token(&refresh_token);
    let expires_at = Utc::now() + Duration::seconds(config.jwt_refresh_ttl_secs);

    // Store refresh token hash in DB
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, parent_token_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(refresh_jti)
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(parent_token_id)
    .execute(db)
    .await?;

    Ok((
        TokenPair {
            access_token,
            refresh_token,
            expires_in: config.jwt_access_ttl_secs,
        },
        refresh_jti,
    ))
}

/// Perform refresh token rotation.
/// Returns new token pair or triggers family revocation.
pub async fn rotate_refresh_token(
    db: &PgPool,
    raw_refresh_token: &str,
    config: &Config,
) -> AppResult<(TokenPair, Uuid)> {
    // 1. Decode JWT
    let token_data = crate::auth::jwt::verify_token(raw_refresh_token, config)?;
    let claims = &token_data.claims;

    if claims.token_type != TokenType::Refresh {
        return Err(AppError::TokenInvalid);
    }

    let jti = claims.jti;
    let user_id = claims.sub;
    let email = &claims.email;

    // 2. Hash the raw token
    let token_hash = hash_token(raw_refresh_token);

    // 3. Look up the token in DB
    let row = sqlx::query_as::<_, RefreshTokenRow>(
        r#"
        SELECT id, user_id, token_hash, expires_at, revoked, parent_token_id
        FROM refresh_tokens
        WHERE id = $1
        "#,
    )
    .bind(jti)
    .fetch_optional(db)
    .await?
    .ok_or(AppError::TokenInvalid)?;

    // 4. Verify hash matches
    if row.token_hash != token_hash {
        return Err(AppError::TokenInvalid);
    }

    // 5. Verify user_id matches
    if row.user_id != user_id {
        return Err(AppError::TokenInvalid);
    }

    // 6. Check if token is revoked → THEFT DETECTED
    if row.revoked {
        tracing::error!(
            event = "auth.token_reuse_detected",
            user_id = %user_id,
            token_id = %jti,
            "Refresh token reuse detected — revoking family"
        );

        // Revoke entire token family
        revoke_token_family(db, jti).await?;

        return Err(AppError::RefreshRevoked);
    }

    // 7. Check expiry (belt-and-suspenders with JWT exp)
    if row.expires_at < Utc::now() {
        return Err(AppError::TokenExpired);
    }

    // 8. Revoke the old token (single-use)
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(jti)
    .execute(db)
    .await?;

    // 9. Issue new token pair with parent chain
    let (pair, new_jti) = create_token_pair_with_db(
        db, user_id, email, config, Some(jti),
    ).await?;

    Ok((pair, new_jti))
}

/// Revoke all tokens in a family (recursive walk via parent_token_id).
pub async fn revoke_token_family(db: &PgPool, token_id: Uuid) -> AppResult<u64> {
    // Find the root of the family
    let root_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_token_id
            FROM refresh_tokens WHERE id = $1
            UNION ALL
            SELECT rt.id, rt.parent_token_id
            FROM refresh_tokens rt
            JOIN ancestors a ON a.parent_token_id = rt.id
        )
        SELECT id FROM ancestors WHERE parent_token_id IS NULL
        "#,
    )
    .bind(token_id)
    .fetch_one(db)
    .await?;

    // Revoke all descendants of the root
    let result = sqlx::query(
        r#"
        WITH RECURSIVE family AS (
            SELECT id FROM refresh_tokens WHERE id = $1
            UNION ALL
            SELECT rt.id FROM refresh_tokens rt
            JOIN family f ON rt.parent_token_id = f.id
        )
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE id IN (SELECT id FROM family)
          AND revoked = false
        "#,
    )
    .bind(root_id)
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

/// Revoke ALL active refresh tokens for a user (used by logout + password change).
pub async fn revoke_all_user_tokens(db: &PgPool, user_id: Uuid) -> AppResult<u64> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE user_id = $1 AND revoked = false
        "#,
    )
    .bind(user_id)
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

#[derive(Debug, sqlx::FromRow)]
struct RefreshTokenRow {
    id: Uuid,
    user_id: Uuid,
    token_hash: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    revoked: bool,
    parent_token_id: Option<Uuid>,
}
```

### Complete Logout Handler

```rust
pub async fn logout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(client_ip): Extension<ClientIp>,
    headers: HeaderMap,
) -> AppResult<Json<MessageResponse>> {
    let user_agent = headers.get("User-Agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    // Revoke ALL active refresh tokens for this user
    let revoked_count = revoke_all_user_tokens(&state.db, auth_user.id).await?;

    // Audit log
    audit_log(
        &state.db,
        Some(auth_user.id),
        AuditAction::TokenRevoked,
        client_ip.0,
        user_agent,
        json!({ "reason": "logout", "count": revoked_count }),
    ).await;

    Ok(Json(MessageResponse {
        message: "Logged out successfully".into(),
    }))
}
```

### Updated JWT Claims with `jti`

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub email: String,
    pub iat: i64,
    pub exp: i64,
    pub token_type: TokenType,
    pub jti: Uuid,  // NEW: unique token identifier
}

pub fn create_access_token(
    user_id: Uuid,
    email: &str,
    config: &Config,
    jti: Uuid,
) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        exp: (now + Duration::seconds(config.jwt_access_ttl_secs)).timestamp(),
        iat: now.timestamp(),
        token_type: TokenType::Access,
        jti,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("JWT encode failed: {}", e)))
}

pub fn create_refresh_token(
    user_id: Uuid,
    email: &str,
    config: &Config,
    jti: Uuid,
) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        exp: (now + Duration::seconds(config.jwt_refresh_ttl_secs)).timestamp(),
        iat: now.timestamp(),
        token_type: TokenType::Refresh,
        jti,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("JWT encode failed: {}", e)))
}
```

### Security Headers Middleware

```rust
use axum::http::header::{HeaderName, HeaderValue};

pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
    );
    // X-XSS-Protection intentionally omitted (deprecated, CSP is better)

    response
}
```

### Updated Router Assembly

```rust
// In main.rs

let auth_limiter = Arc::new(RateLimiter::new(Duration::from_secs(60), 10));
let api_limiter = Arc::new(RateLimiter::new(Duration::from_secs(60), 60));

let state = AppState {
    db,
    config: config.clone(),
    ws_tx: Some(ws_tx),
    auth_rate_limiter: auth_limiter.clone(),
    api_rate_limiter: api_limiter.clone(),
};

// Cleanup task
let cleanup_db = state.db.clone();
let cleanup_limiter = auth_limiter.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(3600));
    loop {
        interval.tick().await;
        cleanup_auth_state(&cleanup_db, &cleanup_limiter).await;
    }
});

let public_routes = Router::new()
    .route("/health", get(system::health))
    .route("/readyz", get(system::readyz))
    .route("/api/auth/signup",  post(auth::signup))
    .route("/api/auth/login",   post(auth::login))
    .route("/api/auth/refresh", post(auth::refresh))
    .route("/api/auth/guest",   post(auth::guest))
    .route("/api/webhook/stripe", post(billing::webhook))
    // Rate limit auth endpoints
    .layer(middleware::from_fn_with_state(state.clone(), rate_limit_auth));

let protected_routes = Router::new()
    .route("/api/auth/me",     get(auth::me))
    .route("/api/auth/logout", post(auth::logout))
    // ... all other protected routes ...
    .layer(middleware::from_fn_with_state(state.clone(), require_auth));

let app = Router::new()
    .merge(public_routes)
    .merge(protected_routes)
    .layer(cors)
    .layer(middleware::from_fn(security_headers))
    .layer(DefaultBodyLimit::max(256 * 1024))  // 256 KB
    .layer(TimeoutLayer::new(Duration::from_secs(30)))
    .layer(TraceLayer::new_for_http())
    .with_state(state);
```

---

*Document version: 1.0.0 — Generated for HabitArc backend*
*Last updated: 2026-02-10*
