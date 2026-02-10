# HabitArc — Deployment & Operations Plan

> Principal Platform Engineer specification.
> Vercel + Fly.io + Managed Postgres · Docker multi-stage · CI/CD pipelines
> Observability · SLO/SLI · Runbooks · Backup & restore

---

## Table of Contents

1. [Infrastructure Topology](#1-infrastructure-topology)
2. [Environment Variable Matrix](#2-environment-variable-matrix)
3. [Docker Multi-Stage Build](#3-docker-multi-stage-build)
4. [Health & Readiness Probes](#4-health--readiness-probes)
5. [CI Pipeline](#5-ci-pipeline)
6. [CD Pipeline & Staged Rollout](#6-cd-pipeline--staged-rollout)
7. [Fly.io Configuration](#7-flyio-configuration)
8. [Vercel Configuration](#8-vercel-configuration)
9. [Database Operations](#9-database-operations)
10. [Backup & Restore Drills](#10-backup--restore-drills)
11. [Secrets Management](#11-secrets-management)
12. [Observability](#12-observability)
13. [SLO/SLI Definitions](#13-slosli-definitions)
14. [Alert Policies](#14-alert-policies)
15. [Runbook: Incident Response](#15-runbook-incident-response)
16. [Runbook: Rollback](#16-runbook-rollback)
17. [Runbook: Stripe Webhook Outage](#17-runbook-stripe-webhook-outage)
18. [Runbook: Database Failover](#18-runbook-database-failover)
19. [Gaps in Current Setup](#19-gaps-in-current-setup)

---

## 1. Infrastructure Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRODUCTION                                     │
│                                                                         │
│  ┌──────────────┐        ┌──────────────────┐        ┌──────────────┐  │
│  │   Vercel      │        │   Fly.io (iad)    │        │  Managed     │  │
│  │   (Edge)      │───────►│   habitarc-api    │───────►│  Postgres    │  │
│  │               │  HTTPS │                    │  TCP   │  (Fly PG /  │  │
│  │  Next.js 15   │        │  Rust Axum 0.7    │  5432  │  Neon / RDS)│  │
│  │  App Router   │        │  2× shared-1x     │        │              │  │
│  │               │        │  512 MB each       │        │  PG 16       │  │
│  └──────┬───────┘        └────────┬─────────┘        │  HA replica  │  │
│         │                         │                    └──────────────┘  │
│         │                         │                                      │
│         │  ┌──────────────────────┴──────────────────────┐              │
│         │  │                 External Services            │              │
│         │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │              │
│         │  │  │  Stripe   │  │  Claude   │  │  Sentry  │  │              │
│         │  │  │  API +    │  │  API      │  │  FE + BE │  │              │
│         │  │  │  Webhooks │  │  (Sonnet) │  │          │  │              │
│         │  │  └──────────┘  └──────────┘  └──────────┘  │              │
│         │  └─────────────────────────────────────────────┘              │
│         │                                                                │
│  ┌──────▼───────┐                                                       │
│  │   Vercel      │                                                       │
│  │   Analytics   │                                                       │
│  │   + Speed     │                                                       │
│  │   Insights    │                                                       │
│  └──────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          STAGING                                        │
│  Same topology, smaller VMs, separate DB, separate Stripe test keys     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          LOCAL DEV                                       │
│  docker-compose: PG 16 · cargo watch · next dev · .env.local            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Platform | Region | Purpose |
|---|---|---|---|
| Frontend | Vercel | Edge (global) | SSR/SSG, static assets, CDN |
| API | Fly.io | `iad` (US-East) | REST API, WebSocket, background jobs |
| Database | Fly Postgres / Neon | `iad` | Primary + read replica |
| Stripe | External | — | Billing, webhooks |
| Claude API | External | — | AI insight generation |
| Sentry | External | — | Error tracking, performance monitoring |

---

## 2. Environment Variable Matrix

### Backend (Rust API)

| Variable | Local | Staging | Production | Secret? | Source |
|---|---|---|---|---|---|
| `DATABASE_URL` | `postgres://habitarc:habitarc_dev@localhost:5432/habitarc` | `postgres://...@staging-db.internal:5432/habitarc` | `postgres://...@prod-db.internal:5432/habitarc` | **Yes** | Platform secrets |
| `HOST` | `0.0.0.0` | `0.0.0.0` | `0.0.0.0` | No | fly.toml `[env]` |
| `PORT` | `8080` | `8080` | `8080` | No | fly.toml `[env]` |
| `FRONTEND_URL` | `http://localhost:3000` | `https://staging.habitarc.com` | `https://habitarc.com` | No | fly.toml `[env]` |
| `JWT_SECRET` | `dev-secret-min-32-chars-long-xxxxx` | (generated) | (generated, ≥256-bit) | **Yes** | Platform secrets |
| `JWT_ACCESS_TTL_SECS` | `900` | `900` | `900` | No | fly.toml `[env]` |
| `JWT_REFRESH_TTL_SECS` | `604800` | `604800` | `604800` | No | fly.toml `[env]` |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_test_...` | `sk_live_...` | **Yes** | Platform secrets |
| `STRIPE_WEBHOOK_SECRET` | `whsec_test_...` | `whsec_test_...` | `whsec_live_...` | **Yes** | Platform secrets |
| `STRIPE_PRICE_PLUS_MONTHLY` | `price_test_plus` | `price_test_plus` | `price_live_plus` | No | fly.toml `[env]` |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_test_pro` | `price_test_pro` | `price_live_pro` | No | fly.toml `[env]` |
| `CLAUDE_API_KEY` | `sk-ant-test-...` | `sk-ant-test-...` | `sk-ant-live-...` | **Yes** | Platform secrets |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514` | No | fly.toml `[env]` |
| `SENTRY_DSN` | (empty) | `https://...@sentry.io/staging` | `https://...@sentry.io/prod` | No | fly.toml `[env]` |
| `RUST_LOG` | `habitarc_api=debug,tower_http=debug` | `habitarc_api=info,tower_http=info` | `habitarc_api=info,tower_http=info` | No | fly.toml `[env]` |
| `ENVIRONMENT` | `development` | `staging` | `production` | No | fly.toml `[env]` |

### Frontend (Next.js)

| Variable | Local | Staging | Production | Secret? | Source |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | `https://staging-api.habitarc.com` | `https://api.habitarc.com` | No | Vercel env vars |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080/ws` | `wss://staging-api.habitarc.com/ws` | `wss://api.habitarc.com/ws` | No | Vercel env vars |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | `pk_test_...` | `pk_live_...` | No | Vercel env vars |
| `NEXT_PUBLIC_SENTRY_DSN` | (empty) | `https://...@sentry.io/staging-fe` | `https://...@sentry.io/prod-fe` | No | Vercel env vars |
| `SENTRY_AUTH_TOKEN` | — | (token) | (token) | **Yes** | Vercel env vars (secret) |
| `NEXT_PUBLIC_ENVIRONMENT` | `development` | `staging` | `production` | No | Vercel env vars |

### Secret Rotation Schedule

| Secret | Rotation Frequency | Procedure |
|---|---|---|
| `JWT_SECRET` | Every 90 days | Generate new secret, deploy, old tokens expire naturally (15 min access, 7 day refresh) |
| `STRIPE_SECRET_KEY` | On compromise only | Roll in Stripe Dashboard, update Fly secret, deploy |
| `STRIPE_WEBHOOK_SECRET` | On endpoint change | Regenerate in Stripe Dashboard, update Fly secret |
| `CLAUDE_API_KEY` | Every 90 days | Generate new key in Anthropic Console, update Fly secret |
| `DATABASE_URL` | On password rotation | Update in managed PG provider, update Fly secret, rolling restart |

---

## 3. Docker Multi-Stage Build

### Optimized Dockerfile

```dockerfile
# ============================================================================
# Stage 1: Build dependencies (cached layer)
# ============================================================================
FROM rust:1.75-slim-bookworm AS deps

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy only dependency manifests for caching
COPY Cargo.toml Cargo.lock ./

# Create dummy main to build dependencies only
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# ============================================================================
# Stage 2: Build application
# ============================================================================
FROM deps AS builder

# Copy source code
COPY src ./src
COPY migrations ./migrations
COPY migrations_v2 ./migrations_v2

# Force rebuild of application (not deps)
RUN touch src/main.rs && cargo build --release

# ============================================================================
# Stage 3: Runtime (minimal image)
# ============================================================================
FROM debian:bookworm-slim AS runtime

# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r habitarc && useradd -r -g habitarc habitarc

WORKDIR /app

# Copy binary and migrations
COPY --from=builder /app/target/release/habitarc-api .
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/migrations_v2 ./migrations_v2

# Set ownership
RUN chown -R habitarc:habitarc /app

USER habitarc

ENV RUST_LOG=habitarc_api=info,tower_http=info

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["./habitarc-api"]
```

### Build Optimizations

| Optimization | Impact |
|---|---|
| **Dependency caching** (Stage 1) | Dependencies only rebuild when `Cargo.toml`/`Cargo.lock` change. Saves ~3-5 min. |
| **Separate builder stage** (Stage 2) | Source changes only rebuild the app binary, not deps. |
| **Minimal runtime** (Stage 3) | `debian:bookworm-slim` is ~80 MB vs ~1.2 GB for the build image. |
| **Non-root user** | Security: container runs as `habitarc` user, not root. |
| **curl for healthcheck** | Docker-level health check independent of the app. |
| **No dev tools in runtime** | No compiler, no pkg-config, no build headers. |

### Image Size Targets

| Stage | Approximate Size |
|---|---|
| Build image (deps + builder) | ~2.5 GB (not shipped) |
| Runtime image | ~120 MB |
| Binary (`habitarc-api`) | ~15-25 MB |

---

## 4. Health & Readiness Probes

### Endpoints

| Endpoint | Purpose | Auth | DB Check | Response |
|---|---|---|---|---|
| `GET /health` | **Liveness probe.** Is the process alive? | None | No | `200 { status, service, version }` |
| `GET /readyz` | **Readiness probe.** Can it serve traffic? | None | Yes (SELECT 1) | `200 { status, checks }` or `503` |

### Implementation

```rust
// handlers/health.rs

use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::AppState;

/// Liveness probe — is the process alive?
/// No DB check. Returns 200 if the HTTP server is running.
pub async fn health_check() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "habitarc-api",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

/// Readiness probe — can the service handle requests?
/// Checks DB connectivity and migration status.
pub async fn readiness_check(
    State(state): State<AppState>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Check database connectivity
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();

    // Check that migrations table exists (proxy for "migrations ran")
    let migrations_ok = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM _sqlx_migrations",
    )
    .fetch_one(&state.db)
    .await
    .map(|count| count > 0)
    .unwrap_or(false);

    let all_ok = db_ok && migrations_ok;

    let body = json!({
        "status": if all_ok { "ready" } else { "not_ready" },
        "checks": {
            "database": db_ok,
            "migrations": migrations_ok,
        },
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    if all_ok {
        Ok(Json(body))
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(body)))
    }
}
```

### Fly.io Probe Configuration

```toml
# fly.toml
[checks]
  [checks.health]
    port = 8080
    type = "http"
    interval = "15s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"

  [checks.ready]
    port = 8080
    type = "http"
    interval = "15s"
    timeout = "5s"
    grace_period = "30s"
    method = "GET"
    path = "/readyz"
```

### Probe Behavior

| Probe | Failure Action | Grace Period |
|---|---|---|
| `/health` fails 3× | Fly kills and restarts the machine | 10s after boot |
| `/readyz` fails | Fly removes machine from load balancer (no traffic routed) | 30s after boot (time for migrations) |
| `/readyz` recovers | Fly adds machine back to load balancer | Immediate |

---

## 5. CI Pipeline

### GitHub Actions: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  CARGO_TERM_COLOR: always
  SQLX_OFFLINE: true

jobs:
  # ========================================================================
  # Frontend
  # ========================================================================
  frontend-lint:
    name: "FE: Lint"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint

  frontend-typecheck:
    name: "FE: Type Check"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx tsc --noEmit

  frontend-build:
    name: "FE: Build"
    runs-on: ubuntu-latest
    needs: [frontend-lint, frontend-typecheck]
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run build
        env:
          NEXT_PUBLIC_API_URL: https://api.habitarc.com
          NEXT_PUBLIC_WS_URL: wss://api.habitarc.com/ws

  # ========================================================================
  # Backend
  # ========================================================================
  backend-fmt:
    name: "BE: Format"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt
      - run: cargo fmt --all -- --check

  backend-clippy:
    name: "BE: Clippy"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: backend
      - run: cargo clippy --all-targets --all-features -- -D warnings

  backend-test:
    name: "BE: Test"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: habitarc
          POSTGRES_PASSWORD: habitarc_test
          POSTGRES_DB: habitarc_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://habitarc:habitarc_test@localhost:5432/habitarc_test
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: backend
      - name: Run migrations
        run: cargo sqlx migrate run
      - name: Run tests
        run: cargo test --all-features

  backend-sqlx-check:
    name: "BE: SQLx Prepare Check"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: backend
      - run: cargo sqlx prepare --check
        env:
          SQLX_OFFLINE: true

  migration-validate:
    name: "BE: Migration Validation"
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: habitarc
          POSTGRES_PASSWORD: habitarc_test
          POSTGRES_DB: habitarc_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://habitarc:habitarc_test@localhost:5432/habitarc_test
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: backend
      - name: Run all migrations (forward)
        run: cargo sqlx migrate run
      - name: Verify schema is consistent
        run: |
          # Check that all tables exist
          PGPASSWORD=habitarc_test psql -h localhost -U habitarc -d habitarc_test -c "\dt" | grep -q "users"
          PGPASSWORD=habitarc_test psql -h localhost -U habitarc -d habitarc_test -c "\dt" | grep -q "habits"
          PGPASSWORD=habitarc_test psql -h localhost -U habitarc -d habitarc_test -c "\dt" | grep -q "subscriptions"
          echo "Migration validation passed"
```

### CI Job Dependency Graph

```
frontend-lint ──┐
                ├──► frontend-build
frontend-typecheck ┘

backend-fmt ────────► (independent)
backend-clippy ─────► (independent)
backend-test ───────► (independent, needs PG service)
backend-sqlx-check ─► (independent)
migration-validate ─► (independent, needs PG service)
```

### CI Timing Targets

| Job | Target | Typical |
|---|---|---|
| FE Lint | < 30s | ~15s |
| FE Type Check | < 60s | ~30s |
| FE Build | < 120s | ~60s |
| BE Format | < 15s | ~5s |
| BE Clippy | < 180s | ~90s (cached) |
| BE Test | < 300s | ~120s |
| BE SQLx Check | < 30s | ~10s |
| Migration Validate | < 60s | ~20s |
| **Total (parallel)** | **< 5 min** | **~3 min** |

---

## 6. CD Pipeline & Staged Rollout

### Deployment Flow

```
PR merged to main
  │
  ├── CI passes (all jobs green)
  │
  ├── Detect changed paths:
  │   ├── frontend/** → Deploy to Vercel (automatic)
  │   └── backend/**  → Deploy to Fly.io (GitHub Action)
  │
  └── Backend deployment:
      │
      ├── 1. Build Docker image
      │
      ├── 2. Deploy to STAGING
      │     ├── fly deploy --app habitarc-api-staging
      │     ├── Wait for /readyz to return 200
      │     └── Run smoke tests against staging
      │
      ├── 3. Manual approval gate (for production)
      │     └── GitHub Environment: "production" (requires approval)
      │
      └── 4. Deploy to PRODUCTION (staged rollout)
            ├── fly deploy --app habitarc-api --strategy rolling
            ├── Canary: 1 machine updated first
            ├── Wait 2 minutes, check error rate
            ├── If error rate < 1% → roll out to remaining machines
            └── If error rate > 1% → auto-rollback
```

### GitHub Actions: `.github/workflows/deploy-backend.yml`

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - "backend/**"
      - ".github/workflows/deploy-backend.yml"

jobs:
  deploy-staging:
    name: "Deploy to Staging"
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app habitarc-api-staging --remote-only
        working-directory: backend
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_STAGING }}
      - name: Wait for readiness
        run: |
          for i in $(seq 1 30); do
            if curl -sf https://staging-api.habitarc.com/readyz; then
              echo "Staging is ready"
              exit 0
            fi
            sleep 5
          done
          echo "Staging failed readiness check"
          exit 1
      - name: Smoke tests
        run: |
          # Health check
          curl -sf https://staging-api.habitarc.com/health | jq .
          # Auth endpoint responds
          curl -sf -o /dev/null -w "%{http_code}" \
            -X POST https://staging-api.habitarc.com/api/auth/login \
            -H "Content-Type: application/json" \
            -d '{"email":"test","password":"test"}' | grep -q "401\|400"
          echo "Smoke tests passed"

  deploy-production:
    name: "Deploy to Production"
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment: production  # Requires manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app habitarc-api --strategy rolling --remote-only
        working-directory: backend
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_PRODUCTION }}
      - name: Wait for readiness
        run: |
          for i in $(seq 1 30); do
            if curl -sf https://api.habitarc.com/readyz; then
              echo "Production is ready"
              exit 0
            fi
            sleep 5
          done
          echo "Production failed readiness check"
          exit 1
      - name: Post-deploy verification
        run: |
          curl -sf https://api.habitarc.com/health | jq .
          echo "Production deploy verified"
```

### Vercel Deployment (Frontend)

Vercel deploys automatically on push to `main` for `frontend/**` changes:

- **Preview deployments:** Every PR gets a unique preview URL
- **Production deployment:** Merge to `main` triggers production deploy
- **Rollback:** Instant via Vercel Dashboard (previous deployment)
- **No manual CD config needed** — Vercel handles this natively

---

## 7. Fly.io Configuration

### Production `fly.toml`

```toml
app = "habitarc-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  HOST = "0.0.0.0"
  PORT = "8080"
  RUST_LOG = "habitarc_api=info,tower_http=info"
  ENVIRONMENT = "production"
  FRONTEND_URL = "https://habitarc.com"
  JWT_ACCESS_TTL_SECS = "900"
  JWT_REFRESH_TTL_SECS = "604800"
  CLAUDE_MODEL = "claude-sonnet-4-20250514"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false   # Keep machines running for WebSocket
  auto_start_machines = true
  min_machines_running = 2     # HA: always 2 machines

  [http_service.concurrency]
    type = "connections"
    hard_limit = 250
    soft_limit = 200

[checks]
  [checks.health]
    port = 8080
    type = "http"
    interval = "15s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"

  [checks.ready]
    port = 8080
    type = "http"
    interval = "15s"
    timeout = "5s"
    grace_period = "30s"
    method = "GET"
    path = "/readyz"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512

[deploy]
  strategy = "rolling"
```

### Staging `fly.staging.toml`

```toml
app = "habitarc-api-staging"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  HOST = "0.0.0.0"
  PORT = "8080"
  RUST_LOG = "habitarc_api=debug,tower_http=info"
  ENVIRONMENT = "staging"
  FRONTEND_URL = "https://staging.habitarc.com"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

  [http_service.concurrency]
    type = "connections"
    hard_limit = 100
    soft_limit = 80

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

### Setting Secrets on Fly.io

```bash
# Production
fly secrets set \
  DATABASE_URL="postgres://..." \
  JWT_SECRET="$(openssl rand -base64 48)" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_live_..." \
  CLAUDE_API_KEY="sk-ant-..." \
  SENTRY_DSN="https://...@sentry.io/..." \
  --app habitarc-api

# Staging (same pattern, test keys)
fly secrets set \
  DATABASE_URL="postgres://..." \
  JWT_SECRET="$(openssl rand -base64 48)" \
  STRIPE_SECRET_KEY="sk_test_..." \
  STRIPE_WEBHOOK_SECRET="whsec_test_..." \
  CLAUDE_API_KEY="sk-ant-..." \
  SENTRY_DSN="https://...@sentry.io/..." \
  --app habitarc-api-staging
```

---

## 8. Vercel Configuration

### `vercel.json` (Frontend Root)

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm ci",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

### Environment Variables in Vercel

Set via Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://staging-api.habitarc.com` | `https://api.habitarc.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://staging-api.habitarc.com/ws` | `wss://api.habitarc.com/ws` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | `pk_live_...` |
| `NEXT_PUBLIC_SENTRY_DSN` | (staging DSN) | (production DSN) |
| `SENTRY_AUTH_TOKEN` | (token) | (token) |

---

## 9. Database Operations

### Migration Strategy

```
1. Migrations run ON BOOT inside the Rust binary:
   sqlx::migrate!("./migrations").run(&db).await

2. For rolling deploys, migrations MUST be backward-compatible:
   - Add columns as nullable or with defaults
   - Never rename or drop columns in the same deploy
   - Use a two-phase approach for breaking changes:
     Phase 1: Add new column, deploy code that writes to both
     Phase 2: Migrate data, deploy code that reads from new column
     Phase 3: Drop old column

3. Migration files are included in the Docker image.
```

### Connection Pool Settings

```rust
// db.rs
pub async fn create_pool(database_url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(20)          // Per machine (2 machines × 20 = 40 total)
        .min_connections(2)           // Keep 2 warm connections
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(database_url)
        .await
        .expect("Failed to create database pool")
}
```

### Connection Budget

| Component | Connections | Notes |
|---|---|---|
| Production machine 1 | 20 max | Shared-1x VM |
| Production machine 2 | 20 max | Shared-1x VM |
| Staging machine | 10 max | Smaller pool |
| **Total production** | **40 max** | Managed PG typically allows 100-300 |
| Headroom for admin/migrations | 10 reserved | `psql`, `pg_dump`, etc. |

---

## 10. Backup & Restore Drills

### Backup Strategy

| Layer | Method | Frequency | Retention |
|---|---|---|---|
| **Managed PG automated** | Provider snapshots | Continuous (WAL) | 7 days PITR |
| **Logical backup** | `pg_dump` via cron | Daily at 03:00 UTC | 30 days |
| **Pre-migration snapshot** | Manual snapshot | Before each deploy | 48 hours |

### Logical Backup Script

```bash
#!/bin/bash
# scripts/backup-db.sh
# Run via cron or GitHub Actions schedule

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="habitarc_${TIMESTAMP}.sql.gz"
S3_BUCKET="habitarc-backups"

echo "Starting backup: ${BACKUP_FILE}"

# Dump (exclude stripe_events and idempotency_keys — ephemeral data)
pg_dump "${DATABASE_URL}" \
  --no-owner \
  --no-privileges \
  --exclude-table-data=stripe_events \
  --exclude-table-data=idempotency_keys \
  | gzip > "/tmp/${BACKUP_FILE}"

# Upload to S3/R2
aws s3 cp "/tmp/${BACKUP_FILE}" "s3://${S3_BUCKET}/daily/${BACKUP_FILE}"

# Cleanup local
rm "/tmp/${BACKUP_FILE}"

# Prune backups older than 30 days
aws s3 ls "s3://${S3_BUCKET}/daily/" \
  | awk '{print $4}' \
  | sort \
  | head -n -30 \
  | xargs -I {} aws s3 rm "s3://${S3_BUCKET}/daily/{}"

echo "Backup complete: ${BACKUP_FILE}"
```

### Restore Drill Procedure (Quarterly)

```
RESTORE DRILL — Run quarterly, document results

1. PREPARE
   □ Schedule 30-minute maintenance window (or use staging)
   □ Notify team in #engineering Slack channel
   □ Identify backup to restore (latest daily or specific PITR timestamp)

2. RESTORE TO STAGING
   □ Create fresh PG database: habitarc_restore_drill
   □ Download backup:
     aws s3 cp s3://habitarc-backups/daily/habitarc_YYYYMMDD_030000.sql.gz /tmp/
   □ Restore:
     gunzip -c /tmp/habitarc_*.sql.gz | psql $STAGING_DATABASE_URL
   □ Verify row counts:
     SELECT 'users' AS t, COUNT(*) FROM users
     UNION ALL SELECT 'habits', COUNT(*) FROM habits
     UNION ALL SELECT 'completions', COUNT(*) FROM habit_completions;
   □ Verify application can connect:
     Point staging API at restored DB, hit /readyz

3. VALIDATE
   □ Login as test user
   □ Verify habits, completions, streaks are intact
   □ Verify subscription state matches
   □ Run: SELECT MAX(created_at) FROM audit_logs; (check data freshness)

4. DOCUMENT
   □ Record: backup timestamp, restore duration, row counts, any issues
   □ File in: docs/drill-logs/restore-YYYY-MM-DD.md

5. CLEANUP
   □ Drop habitarc_restore_drill database
   □ Delete local backup file
```

### Recovery Time Objectives

| Scenario | RTO Target | Method |
|---|---|---|
| Managed PG failover | < 30 seconds | Automatic (provider HA) |
| PITR restore | < 15 minutes | Provider console |
| Logical restore from backup | < 30 minutes | `pg_dump` restore |
| Full environment rebuild | < 2 hours | Fly deploy + DB restore |

---

## 11. Secrets Management

### Platform Secret Managers

| Platform | Secret Store | Access |
|---|---|---|
| Fly.io | `fly secrets` | Injected as env vars at runtime |
| Vercel | Project Environment Variables | Injected at build + runtime |
| GitHub Actions | Repository Secrets | Available in CI/CD workflows |

### Secret Inventory

| Secret | Stored In | Used By |
|---|---|---|
| `FLY_API_TOKEN_STAGING` | GitHub Secrets | CD pipeline (staging deploy) |
| `FLY_API_TOKEN_PRODUCTION` | GitHub Secrets | CD pipeline (production deploy) |
| `DATABASE_URL` | Fly Secrets | Backend runtime |
| `JWT_SECRET` | Fly Secrets | Backend runtime |
| `STRIPE_SECRET_KEY` | Fly Secrets | Backend runtime |
| `STRIPE_WEBHOOK_SECRET` | Fly Secrets | Backend runtime |
| `CLAUDE_API_KEY` | Fly Secrets | Backend runtime |
| `SENTRY_AUTH_TOKEN` | Vercel Secrets | Frontend build (source maps) |

### Rules

1. **Never commit secrets to git.** Use `.env.local` (gitignored) for local dev.
2. **Never log secrets.** The `Config::from_env()` function must not log secret values.
3. **Rotate on compromise.** If any secret is exposed, rotate immediately and audit logs.
4. **Least privilege.** Each Fly API token is scoped to a single app.

---

## 12. Observability

### Sentry Integration

#### Backend (Rust)

```rust
// In main.rs, before server start:
if let Some(dsn) = &config.sentry_dsn {
    let _guard = sentry::init((dsn.as_str(), sentry::ClientOptions {
        release: Some(env!("CARGO_PKG_VERSION").into()),
        environment: Some(
            std::env::var("ENVIRONMENT").unwrap_or("development".into()).into()
        ),
        traces_sample_rate: 0.1,  // 10% of transactions
        ..Default::default()
    }));
}
```

**Cargo dependency:**
```toml
sentry = { version = "0.34", features = ["tracing", "tower", "reqwest"] }
```

#### Frontend (Next.js)

```typescript
// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
});
```

### Structured Logging (Backend)

Already configured with `tracing-subscriber` JSON output:

```rust
tracing_subscriber::fmt()
    .with_env_filter(EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "habitarc_api=info,tower_http=info".into()))
    .json()
    .init();
```

**Log format:**
```json
{
  "timestamp": "2026-02-10T12:34:56.789Z",
  "level": "INFO",
  "target": "habitarc_api::handlers::auth",
  "message": "User login successful",
  "user_id": "550e8400-...",
  "ip": "1.2.3.4",
  "span": { "request_id": "req_abc123" }
}
```

**Fly.io log access:**
```bash
fly logs --app habitarc-api
fly logs --app habitarc-api --region iad
```

### Metrics Dashboards

#### Key Metrics to Track

| Metric | Source | Dashboard |
|---|---|---|
| **Request rate** (req/s) | Fly.io metrics | Fly Dashboard |
| **Response time** (p50, p95, p99) | Fly.io metrics / Sentry | Fly + Sentry Performance |
| **Error rate** (4xx, 5xx) | Fly.io metrics / Sentry | Fly + Sentry |
| **DB connection pool** (active, idle, waiting) | Application logs | Custom (Grafana or Fly) |
| **WebSocket connections** (active count) | Application logs | Custom |
| **Stripe webhook latency** | Application logs | Custom |
| **Claude API latency** | Application logs | Sentry Performance |
| **Insight generation rate** (claude vs fallback) | DB query | Custom |
| **Offline sync replay rate** | Frontend Sentry | Sentry |
| **Core Web Vitals** (LCP, FID, CLS) | Vercel Analytics | Vercel Dashboard |

#### Application Metrics Logging

```rust
// Log key metrics as structured tracing events
tracing::info!(
    metric = "http_request",
    method = %method,
    path = %path,
    status = status.as_u16(),
    duration_ms = elapsed.as_millis() as u64,
    user_id = %user_id,
);

tracing::info!(
    metric = "insight_generated",
    source = %source,  // "claude" or "fallback"
    latency_ms = latency,
    input_tokens = input_tokens,
    output_tokens = output_tokens,
    cost_usd = cost,
);

tracing::info!(
    metric = "stripe_webhook",
    event_type = %event_type,
    processing_ms = elapsed.as_millis() as u64,
    duplicate = is_duplicate,
);
```

---

## 13. SLO/SLI Definitions

### Service Level Indicators (SLIs)

| SLI | Definition | Measurement |
|---|---|---|
| **Availability** | % of successful HTTP responses (non-5xx) | `1 - (5xx_count / total_requests)` |
| **API Latency** | p95 response time for API requests | Fly.io metrics + Sentry |
| **Error Rate** | % of requests returning 5xx | `5xx_count / total_requests` |
| **WebSocket Uptime** | % of time WS endpoint accepts connections | Synthetic monitor |
| **Webhook Processing** | % of Stripe webhooks processed within 5s | Application logs |
| **Insight Generation** | % of insight requests that return within 45s | Application logs |
| **Frontend Performance** | Largest Contentful Paint (LCP) | Vercel Analytics |

### Service Level Objectives (SLOs)

| SLO | Target | Window | Error Budget |
|---|---|---|---|
| **API Availability** | 99.9% | 30-day rolling | 43.2 min/month downtime |
| **API Latency (p95)** | < 300ms | 30-day rolling | 5% of requests can exceed |
| **API Latency (p99)** | < 1000ms | 30-day rolling | 1% of requests can exceed |
| **Error Rate** | < 0.1% | 30-day rolling | 1 in 1000 requests |
| **WebSocket Uptime** | 99.5% | 30-day rolling | 3.6 hrs/month |
| **Webhook Processing** | 99.9% within 5s | 30-day rolling | 1 in 1000 webhooks |
| **Insight Generation** | 95% within 45s | 30-day rolling | 5% can use fallback |
| **Frontend LCP** | < 2.5s (p75) | 30-day rolling | 25% of loads can exceed |

### Error Budget Policy

| Budget Consumed | Action |
|---|---|
| 0-50% | Normal development velocity |
| 50-75% | Increase monitoring, review recent changes |
| 75-90% | Freeze non-critical deploys, focus on reliability |
| 90-100% | **Deploy freeze.** All engineering effort on reliability. |
| > 100% | Incident review required. No deploys until budget recovers. |

---

## 14. Alert Policies

### Critical Alerts (PagerDuty / Slack #alerts-critical)

| Alert | Condition | Action |
|---|---|---|
| **API Down** | `/health` fails for > 2 minutes | Page on-call engineer |
| **High Error Rate** | 5xx rate > 5% for 5 minutes | Page on-call engineer |
| **Database Unreachable** | `/readyz` fails for > 1 minute | Page on-call engineer |
| **All Machines Down** | 0 running machines on Fly.io | Page on-call engineer |

### Warning Alerts (Slack #alerts-warning)

| Alert | Condition | Action |
|---|---|---|
| **Elevated Latency** | p95 > 500ms for 10 minutes | Notify channel |
| **Elevated Error Rate** | 5xx rate > 1% for 10 minutes | Notify channel |
| **DB Connection Pool Exhausted** | Waiting connections > 5 for 5 minutes | Notify channel |
| **Stripe Webhook Failures** | > 3 webhook processing failures in 1 hour | Notify channel |
| **Claude API Failures** | > 50% fallback rate for 1 hour | Notify channel |
| **Disk Usage** | > 80% on any volume | Notify channel |
| **Memory Usage** | > 90% on any machine | Notify channel |
| **Certificate Expiry** | TLS cert expires within 14 days | Notify channel |

### Informational (Slack #alerts-info)

| Alert | Condition |
|---|---|
| **Deploy Completed** | Successful production deploy |
| **Migration Ran** | New migration applied |
| **Error Budget** | Monthly error budget > 50% consumed |

---

## 15. Runbook: Incident Response

### Severity Levels

| Level | Definition | Response Time | Examples |
|---|---|---|---|
| **SEV-1** | Service completely down | 15 minutes | API unreachable, DB down |
| **SEV-2** | Major feature broken | 30 minutes | Auth broken, payments failing |
| **SEV-3** | Minor feature degraded | 4 hours | Insights fallback only, slow queries |
| **SEV-4** | Cosmetic / low impact | Next business day | UI glitch, non-critical log errors |

### Incident Response Procedure

```
1. DETECT
   □ Alert fires (PagerDuty / Sentry / Fly dashboard)
   □ Or: user report via support channel

2. ACKNOWLEDGE (within response time SLA)
   □ Acknowledge alert in PagerDuty
   □ Post in #incidents: "Investigating: [brief description]"
   □ Assign incident commander (IC)

3. TRIAGE (first 5 minutes)
   □ Check Fly dashboard: are machines running?
     fly status --app habitarc-api
   □ Check health endpoint:
     curl -sf https://api.habitarc.com/health
   □ Check readiness:
     curl -sf https://api.habitarc.com/readyz
   □ Check recent deploys:
     fly releases --app habitarc-api
   □ Check logs:
     fly logs --app habitarc-api | tail -100
   □ Check Sentry for new errors

4. MITIGATE (stop the bleeding)
   □ If recent deploy caused it → ROLLBACK (see Runbook §16)
   □ If DB issue → check DB status (see Runbook §18)
   □ If external service (Stripe/Claude) → check status pages
   □ If traffic spike → scale up:
     fly scale count 4 --app habitarc-api

5. RESOLVE
   □ Apply fix (code change, config change, or infra change)
   □ Verify fix via health/readiness endpoints
   □ Monitor for 15 minutes after fix

6. POST-INCIDENT
   □ Update #incidents with resolution
   □ Write post-mortem within 48 hours (SEV-1/2)
   □ File follow-up tickets for preventive measures
   □ Update runbooks if needed
```

---

## 16. Runbook: Rollback

### Backend Rollback (Fly.io)

```
SITUATION: Recent deploy introduced a bug. Need to revert.

1. IDENTIFY the last known good release:
   fly releases --app habitarc-api
   # Output:
   # v42  2026-02-10T12:00:00Z  deployed  (current — broken)
   # v41  2026-02-09T15:00:00Z  deployed  (last good)

2. ROLLBACK to previous release:
   fly deploy --app habitarc-api --image registry.fly.io/habitarc-api:deployment-v41

   # Alternative: use Fly's built-in rollback
   fly releases rollback --app habitarc-api

3. VERIFY:
   curl -sf https://api.habitarc.com/health | jq .
   curl -sf https://api.habitarc.com/readyz | jq .

4. MONITOR for 15 minutes:
   fly logs --app habitarc-api

5. IF MIGRATION WAS INVOLVED:
   ⚠️  Migrations cannot be automatically rolled back.
   □ If the migration was backward-compatible → no action needed
   □ If the migration broke something → apply a corrective migration
     (add a new migration that reverses the change)
   □ NEVER manually edit the _sqlx_migrations table

6. NOTIFY:
   Post in #incidents: "Rolled back habitarc-api from v42 to v41. Reason: [description]"
```

### Frontend Rollback (Vercel)

```
SITUATION: Frontend deploy broke something.

1. Go to Vercel Dashboard → habitarc → Deployments
2. Find the last working deployment
3. Click "..." → "Promote to Production"
4. Vercel instantly serves the previous build (< 10 seconds)

No CLI needed. Vercel keeps all previous deployments available.
```

### Rollback Decision Matrix

| Scenario | Action | Time |
|---|---|---|
| API returning 5xx after deploy | `fly releases rollback` | < 2 min |
| Frontend broken after deploy | Vercel "Promote to Production" | < 30 sec |
| Migration broke queries | Deploy corrective migration | 5-15 min |
| Bad config change | `fly secrets set` + restart | < 2 min |
| Database corruption | PITR restore (see §18) | 15-30 min |

---

## 17. Runbook: Stripe Webhook Outage

### Symptoms

- Subscription changes not reflected in app
- Users report they paid but still see "Free" tier
- `stripe_events` table shows no new entries
- Sentry shows Stripe-related errors

### Diagnosis

```
1. CHECK Stripe status page:
   https://status.stripe.com/

2. CHECK webhook endpoint in Stripe Dashboard:
   Dashboard → Developers → Webhooks → habitarc endpoint
   □ Is the endpoint active?
   □ What's the recent delivery success rate?
   □ Are there pending retries?

3. CHECK our logs:
   fly logs --app habitarc-api | grep -i stripe

4. CHECK if webhook signature validation is failing:
   Look for: "Invalid Stripe webhook signature" in logs

5. CHECK if the webhook secret rotated:
   Compare STRIPE_WEBHOOK_SECRET in Fly secrets with Stripe Dashboard
```

### Recovery

```
CASE A: Stripe is down (their issue)
  □ Nothing to do — Stripe will retry webhooks for up to 3 days
  □ Monitor Stripe status page
  □ Post in #incidents: "Stripe webhook delivery delayed. Stripe is aware."

CASE B: Our endpoint is rejecting webhooks
  □ Check if STRIPE_WEBHOOK_SECRET is correct:
    fly secrets list --app habitarc-api | grep STRIPE
  □ If secret is wrong:
    fly secrets set STRIPE_WEBHOOK_SECRET="whsec_correct_value" --app habitarc-api
  □ Verify: check Stripe Dashboard for successful deliveries

CASE C: Our endpoint is down
  □ This is an API outage — follow Incident Response runbook (§15)

CASE D: Webhooks were missed (gap in processing)
  □ Use Stripe CLI to replay events:
    stripe events resend evt_xxx --webhook-endpoint we_xxx
  □ Or: manually reconcile from Stripe Dashboard:
    1. List recent subscriptions in Stripe
    2. For each, verify our DB matches
    3. If mismatch: manually update subscription status in DB

CASE E: Duplicate events causing issues
  □ Our idempotency layer (stripe_events table) should handle this
  □ If duplicates are getting through:
    Check: SELECT event_id, COUNT(*) FROM stripe_events GROUP BY event_id HAVING COUNT(*) > 1;
  □ If PK constraint is missing → emergency migration to add it
```

### Post-Recovery Verification

```
□ Trigger a test webhook from Stripe Dashboard
□ Verify it appears in stripe_events table
□ Verify subscription state is correct for 3 random users
□ Check Sentry for any new Stripe-related errors
```

---

## 18. Runbook: Database Failover

### Managed Postgres HA (Fly Postgres / Neon)

Most managed Postgres providers handle failover automatically. This runbook covers manual intervention when automatic failover fails or when a manual restore is needed.

### Symptoms

- `/readyz` returning 503 (database check failing)
- Application logs: "connection refused" or "connection timed out" to DB
- Sentry: spike in database errors

### Diagnosis

```
1. CHECK database status:
   # Fly Postgres
   fly postgres connect --app habitarc-db
   fly status --app habitarc-db

   # Or: try connecting directly
   psql $DATABASE_URL -c "SELECT 1;"

2. CHECK if it's a connection issue vs data issue:
   □ Can you connect at all? → Connection issue
   □ Can you connect but queries fail? → Data issue
   □ Can you connect but it's very slow? → Performance issue

3. CHECK Fly Postgres cluster health:
   fly postgres list --app habitarc-db
   # Shows primary and replica status
```

### Recovery: Connection Issue

```
CASE A: Primary is down, replica available
  □ Fly Postgres auto-promotes replica (usually < 30s)
  □ If auto-promotion failed:
    fly postgres failover --app habitarc-db
  □ Verify: psql $DATABASE_URL -c "SELECT 1;"
  □ Restart API to pick up new connection:
    fly machines restart --app habitarc-api

CASE B: All nodes down
  □ Check Fly.io status: https://status.flyio.net/
  □ If Fly infra issue → wait for resolution
  □ If our issue → restart PG machines:
    fly machines restart --app habitarc-db
  □ If data is corrupted → PITR restore (below)
```

### Recovery: Point-in-Time Restore (PITR)

```
⚠️  THIS WILL CAUSE DATA LOSS for events after the restore point.

1. DECIDE on restore point:
   □ Identify the timestamp just before the corruption/issue
   □ Example: "2026-02-10T12:00:00Z"

2. PERFORM PITR (provider-specific):
   # Fly Postgres
   fly postgres restore --app habitarc-db --time "2026-02-10T12:00:00Z"

   # Neon
   # Use Neon Console → Branch → Restore to timestamp

3. UPDATE connection string if it changed:
   fly secrets set DATABASE_URL="postgres://new-connection-string" --app habitarc-api

4. RESTART API:
   fly machines restart --app habitarc-api

5. VERIFY:
   curl -sf https://api.habitarc.com/readyz | jq .

6. ASSESS DATA LOSS:
   □ Check: SELECT MAX(created_at) FROM audit_logs;
   □ Check: SELECT MAX(created_at) FROM habit_completions;
   □ Communicate to affected users if needed

7. REPLAY STRIPE EVENTS (if any were lost):
   □ Check Stripe Dashboard for events in the lost window
   □ Resend: stripe events resend evt_xxx
```

### Recovery: Logical Restore from Backup

```
USE WHEN: PITR is not available or backup is from a different provider.

1. CREATE new database:
   fly postgres create --name habitarc-db-restored --region iad

2. DOWNLOAD backup:
   aws s3 cp s3://habitarc-backups/daily/habitarc_YYYYMMDD_030000.sql.gz /tmp/

3. RESTORE:
   gunzip -c /tmp/habitarc_*.sql.gz | psql $NEW_DATABASE_URL

4. RUN MIGRATIONS (backup may be behind):
   DATABASE_URL=$NEW_DATABASE_URL cargo sqlx migrate run

5. SWITCH API to new database:
   fly secrets set DATABASE_URL="$NEW_DATABASE_URL" --app habitarc-api

6. RESTART:
   fly machines restart --app habitarc-api

7. VERIFY and assess data loss (same as PITR step 5-7)
```

---

## 19. Gaps in Current Setup

| # | Area | Gap | Severity | Fix |
|---|---|---|---|---|
| 1 | CI | **No CI pipeline exists** (no `.github/workflows/`) | **Critical** | Create `ci.yml` and `deploy-backend.yml` |
| 2 | Dockerfile | No non-root user in runtime stage | **Medium** | Add `USER habitarc` |
| 3 | Dockerfile | No Docker-level HEALTHCHECK | **Low** | Add `HEALTHCHECK` instruction |
| 4 | Dockerfile | `migrations_v2` not copied to runtime image | **High** | Add `COPY migrations_v2` |
| 5 | fly.toml | `auto_stop_machines = true` — kills WebSocket connections | **High** | Set to `false` for production |
| 6 | fly.toml | `min_machines_running = 1` — no HA | **High** | Set to `2` for production |
| 7 | fly.toml | No health/readiness check configuration | **High** | Add `[checks]` section |
| 8 | fly.toml | No `[deploy] strategy = "rolling"` | **Medium** | Add rolling deploy strategy |
| 9 | Backend | No `/readyz` endpoint (only `/health`) | **High** | Add readiness probe with DB check |
| 10 | Backend | No Sentry SDK integration | **Medium** | Add `sentry` crate |
| 11 | Backend | No `ENVIRONMENT` env var for Sentry/logging context | **Low** | Add to Config |
| 12 | Backend | No structured metric logging (latency, token usage) | **Medium** | Add `tracing::info!(metric = ...)` |
| 13 | Frontend | No `vercel.json` configuration | **Low** | Add with security headers and region |
| 14 | Frontend | No Sentry SDK integration | **Medium** | Add `@sentry/nextjs` |
| 15 | Infra | No backup automation | **High** | Add `pg_dump` cron or GitHub Actions schedule |
| 16 | Infra | No staging environment | **High** | Create `habitarc-api-staging` on Fly |
| 17 | Infra | No secret rotation procedure documented | **Medium** | Document in this runbook (done) |
| 18 | Ops | No alert policies configured | **Medium** | Configure in Sentry + Fly |
| 19 | Ops | No on-call rotation defined | **Low** | Set up PagerDuty or Opsgenie |

---

*Document version: 1.0.0 — Generated for HabitArc*
*Last updated: 2026-02-10*
