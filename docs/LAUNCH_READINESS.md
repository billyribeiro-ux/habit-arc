# HabitArc — Launch Readiness Report

> Program Orchestrator · 12-Phase Audit
> Strict phase-gate evaluation against Definition of Done
> No placeholders in critical path · Security/entitlement/streak invariants enforced

---

## Executive Verdict

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   OVERALL STATUS:  🟡 CONDITIONAL PASS — IMPLEMENTATION REQUIRED         │
│                                                                          │
│   Design phase:    ✅ COMPLETE (10/10 engineering docs produced)          │
│   Code phase:      🟡 SCAFFOLD COMPLETE, GAPS EXIST (see below)          │
│   Test phase:      🔴 NOT STARTED (spec complete, no test files exist)   │
│   Deploy phase:    🟡 PARTIAL (Dockerfile + fly.toml exist, no CI/CD)    │
│                                                                          │
│   BLOCKING ITEMS:  14 (must resolve before launch)                       │
│   HIGH-RISK ITEMS: 7  (must resolve before beta)                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Phase-by-Phase Audit

---

### Phase 1: Stack Lock Confirmation

**Status: ✅ PASS**

| Component | Locked Version | Verified In |
|---|---|---|
| **Rust** | 1.75 (`rust-version = "1.75"`) | `backend/Cargo.toml:4` |
| **Axum** | 0.7 (ws + macros) | `backend/Cargo.toml:9` |
| **SQLx** | 0.7 (postgres, uuid, chrono, migrate) | `backend/Cargo.toml:17` |
| **Tokio** | 1 (full) | `backend/Cargo.toml:13` |
| **PostgreSQL** | 16-alpine | `docker-compose.yml:5` |
| **Next.js** | ^15.1.0 | `frontend/package.json:12` |
| **React** | ^19.0.0 | `frontend/package.json:13` |
| **TypeScript** | ^5.7.0 | `frontend/package.json:41` |
| **TanStack Query** | ^5.62.0 | `frontend/package.json:15` |
| **Zustand** | ^5.0.0 | `frontend/package.json:16` |
| **Tailwind CSS** | ^3.4.17 | `frontend/package.json:45` |
| **shadcn/ui (Radix)** | Multiple ^1.x / ^2.x | `frontend/package.json:25-38` |
| **Framer Motion** | ^11.15.0 | `frontend/package.json:17` |
| **Recharts** | ^2.15.0 | `frontend/package.json:18` |
| **Stripe** | stripe-rust 0.34 | `backend/Cargo.toml:51` |
| **jsonwebtoken** | 9 | `backend/Cargo.toml:22` |
| **argon2** | 0.5 | `backend/Cargo.toml:23` |

**Artifacts:** `backend/Cargo.toml`, `frontend/package.json`, `docker-compose.yml`
**Blockers:** None
**Risks:** None
**DoD:** All dependencies pinned with semver ranges. No floating `latest` references.

---

### Phase 2: PRD

**Status: ✅ PASS**

| Requirement | Present | Location |
|---|---|---|
| Executive summary | ✅ | PRD.md §1 |
| Business model (3 tiers, pricing) | ✅ | PRD.md §2 |
| Architecture constraints | ✅ | PRD.md §3 |
| User personas (3) | ✅ | PRD.md §4 |
| Feature backlog (P0/P1/P2) | ✅ | PRD.md §5 |
| User stories with acceptance criteria (12 P0 + 4 P1) | ✅ | PRD.md §6 |
| Domain invariants (12 invariants) | ✅ | PRD.md §7 |
| Streak engine specification (3 algorithms) | ✅ | PRD.md §8 |
| Offline queue & sync conflict handling | ✅ | PRD.md §9 |
| Freemium entitlements matrix | ✅ | PRD.md §10 |
| Data privacy & abuse prevention | ✅ | PRD.md §11 |
| API contract summary (28 endpoints) | ✅ | PRD.md §12 |
| Risk register (12 risks) | ✅ | PRD.md §13 |
| Launch plan (2-week schedule) | ✅ | PRD.md §14 |
| KPI definitions & targets | ✅ | PRD.md §15 |
| Codebase gap analysis (23 BE + 11 FE gaps) | ✅ | PRD.md §16 |

**Artifacts:** `docs/PRD.md` (1,007 lines, 43.6 KB)
**Blockers:** None
**Risks:** None
**DoD:** Complete PRD with acceptance criteria for all P0 features, domain invariants, and gap analysis.

---

### Phase 3: Architecture

**Status: ✅ PASS**

| Deliverable | Present | Document |
|---|---|---|
| High-level topology diagram | ✅ | ARCHITECTURE.md §1 |
| Bounded contexts (Auth, Habits, Billing, Insights, Sync) | ✅ | ARCHITECTURE.md §2 |
| Sequence diagrams (auth, completion, billing, insight) | ✅ | ARCHITECTURE.md §3 |
| Consistency model | ✅ | ARCHITECTURE.md §4 |
| Reliability model | ✅ | ARCHITECTURE.md §5 |
| Security model | ✅ | ARCHITECTURE.md §6 |
| Data model summary | ✅ | ARCHITECTURE.md §7 |
| Edge cases appendix | ✅ | ARCHITECTURE.md §8 |
| Frontend architecture (folder tree, hooks, stores) | ✅ | FRONTEND_ARCHITECTURE.md |
| API contracts (28 endpoints, DTOs, error model) | ✅ | API_CONTRACTS.md |

**Artifacts:** `docs/ARCHITECTURE.md` (73.9 KB), `docs/FRONTEND_ARCHITECTURE.md` (61.4 KB), `docs/API_CONTRACTS.md` (40.7 KB)
**Blockers:** None
**Risks:** None
**DoD:** System architecture documented with topology, bounded contexts, sequence diagrams, and data model.

---

### Phase 4: DB Migrations

**Status: ✅ PASS (design) · 🟡 CONDITIONAL (runtime)**

| Migration | File | Tables |
|---|---|---|
| Enums & functions | `20260210000001_enums_and_functions.sql` | Custom types, `set_updated_at` trigger |
| Users | `20260210000002_users.sql` | `users` (guest support, timezone, tiers) |
| Habits & schedules | `20260210000003_habits_and_schedules.sql` | `habits` (frequency enum, JSONB config) |
| Completions | `20260210000004_habit_completions.sql` | `completions` (unique per habit+date+user) |
| Mood logs | `20260210000005_mood_logs.sql` | `mood_logs` (1-5 scale, unique per user+date) |
| Insights | `20260210000006_insights.sql` | `insights` (weekly cache, source enum) |
| Subscriptions & entitlements | `20260210000007_subscriptions_and_entitlements.sql` | `subscriptions`, `feature_entitlements`, `stripe_events` |
| Refresh tokens | `20260210000008_refresh_tokens.sql` | `refresh_tokens` (SHA-256 hash, family chain) |
| Notification jobs | `20260210000009_notification_jobs.sql` | Push subscription + notification queue |
| Audit logs | `20260210000010_audit_logs.sql` | `audit_logs` (immutable, append-only) |
| Seed data | `20260210000011_seed_dev_data.sql` | Demo user, habits, entitlements per tier |

**Also present:** Down migrations for all 11 files, `QUERIES.sql` reference, `SQLX_NOTES.md`.

**Artifacts:** 11 up migrations + 11 down migrations in `backend/migrations_v2/`
**Blockers:**
- ⚠️ **B-01:** `backend/src/main.rs:49` references `sqlx::migrate!("./migrations")` (v1 folder), NOT `./migrations_v2`. The v2 migrations have never been applied by the running application.
- ⚠️ **B-02:** The v1 migrations (`migrations/20240101000001_initial.sql`, `migrations/20240101000002_prd_alignment.sql`) create a different schema than v2. The two migration sets are incompatible — a clean cutover is needed.

**Risks:**
- **R-01:** Running the app against a fresh DB will apply v1 migrations (wrong schema). Must switch `migrate!` path to `./migrations_v2` or consolidate.

**DoD:** All 11 migration files exist with up + down. **CONDITIONAL** — migration path in `main.rs` must be updated before runtime verification.

---

### Phase 5: API Contracts

**Status: ✅ PASS (design) · 🟡 CONDITIONAL (implementation gaps)**

**Endpoints defined in code (`backend/src/main.rs`):**

| # | Route | Handler | Exists in Code |
|---|---|---|---|
| 1 | `GET /health` | `health::health_check` | ✅ |
| 2 | `POST /api/auth/register` | `auth::register` | ✅ |
| 3 | `POST /api/auth/login` | `auth::login` | ✅ |
| 4 | `POST /api/auth/refresh` | `auth::refresh` | ✅ |
| 5 | `POST /api/auth/guest` | `auth::guest` | ✅ |
| 6 | `GET /api/me` | `auth::me` | ✅ |
| 7 | `GET /api/habits` | `habits::list_habits` | ✅ |
| 8 | `POST /api/habits` | `habits::create_habit` | ✅ |
| 9 | `GET /api/habits/:id` | `habits::get_habit` | ✅ |
| 10 | `PUT /api/habits/:id` | `habits::update_habit` | ✅ |
| 11 | `DELETE /api/habits/:id` | `habits::delete_habit` | ✅ |
| 12 | `POST /api/completions` | `completions::create_completion` | ✅ |
| 13 | `GET /api/completions` | `completions::list_completions` | ✅ |
| 14 | `DELETE /api/completions/:id` | `completions::delete_completion` | ✅ |
| 15 | `POST /api/completions/toggle` | `completions::toggle_completion` | ✅ |
| 16 | `GET /api/habits/:id/streak` | `completions::get_streak` | ✅ |
| 17 | `GET /api/habits/:id/heatmap` | `completions::get_heatmap` | ✅ |
| 18 | `GET /api/stats/daily` | `completions::get_daily_stats` | ✅ |
| 19 | `GET /api/stats/weekly-review` | `completions::get_weekly_review` | ✅ |
| 20 | `POST /api/daily-logs` | `daily_logs::upsert_daily_log` | ✅ |
| 21 | `GET /api/daily-logs` | `daily_logs::list_daily_logs` | ✅ |
| 22 | `GET /api/insights` | `insights::get_insights` | ✅ |
| 23 | `GET /api/billing/subscription` | `billing::get_subscription` | ✅ |
| 24 | `POST /api/billing/checkout` | `billing::create_checkout` | ✅ |
| 25 | `POST /api/billing/webhook` | `billing::stripe_webhook` | ✅ |
| 26 | `GET /ws` | `ws::ws_handler` | ✅ |

**Missing from code (defined in API_CONTRACTS.md but not in `main.rs`):**

| # | Route | Status |
|---|---|---|
| M-01 | `POST /api/auth/logout` | ❌ Not implemented |
| M-02 | `GET /readyz` | ❌ Not implemented |
| M-03 | `POST /api/insights/generate` | ❌ (only `GET /api/insights` exists) |
| M-04 | `GET /api/insights/latest` | ❌ Not implemented |
| M-05 | `GET /api/billing/portal` | ❌ Not implemented |
| M-06 | `DELETE /api/account` | ❌ Not implemented |
| M-07 | `GET /api/account/export` | ❌ Not implemented |

**Artifacts:** `docs/API_CONTRACTS.md` (40.7 KB), 26 routes in `main.rs`
**Blockers:**
- ⚠️ **B-03:** `POST /api/auth/logout` is missing — users cannot securely end sessions.
- ⚠️ **B-04:** `GET /readyz` is missing — Fly.io cannot perform readiness checks.

**Risks:**
- **R-02:** Missing `DELETE /api/account` blocks GDPR compliance.

**DoD:** 26/33 endpoints implemented. 7 missing endpoints documented. **CONDITIONAL** — B-03 and B-04 must be implemented before launch.

---

### Phase 6: Frontend Implementation

**Status: ✅ PASS (scaffold) · 🟡 CONDITIONAL (gaps per REALTIME_OFFLINE_SYNC.md)**

**Pages verified:**

| Page | Route | File |
|---|---|---|
| Landing / redirect | `/` | `app/page.tsx` |
| Onboarding | `/onboarding` | `app/(auth)/onboarding/` |
| Login | `/login` | `app/(auth)/login/` |
| Register | `/register` | `app/(auth)/register/` |
| Dashboard | `/dashboard` | `app/(app)/dashboard/` |
| Analytics | `/analytics` | `app/(app)/analytics/` |
| Insights | `/insights` | `app/(app)/insights/` |
| Billing | `/billing` | `app/(app)/billing/` |
| Settings | `/settings` | `app/(app)/settings/` |

**Key components verified:** `habit-card.tsx` (toggle, streak badge, animations), `create-habit-dialog.tsx` (schedule picker), `(app)/layout.tsx` (sidebar, mobile nav, auth gating, WebSocket hook).

**Key hooks verified:** `use-habits.ts` (CRUD, toggle with optimistic UI, heatmap, weekly review, mood), `use-websocket.ts` (auto-reconnect), `api.ts` (client with token refresh).

**Key stores verified:** `auth-store.ts` (guest + login), `offline-store.ts` (queue).

**Artifacts:** 9 pages, ~20 components, typed hooks, API client, auth store, offline store
**Blockers:**
- ⚠️ **B-05:** Offline store uses `localStorage`, not IndexedDB (per REALTIME_OFFLINE_SYNC.md §6, gap #7).
- ⚠️ **B-06:** No `idempotencyKey` on queued offline actions (gap #8).
- ⚠️ **B-07:** WebSocket has no auth token on connect (gap #10).

**Risks:**
- **R-03:** `localStorage` offline queue risks data loss on storage pressure.

**DoD:** All pages exist and build. Optimistic UI implemented. **CONDITIONAL** — offline queue must migrate to IndexedDB.

---

### Phase 7: Auth / Security

**Status: 🟡 CONDITIONAL PASS**

| Requirement | Code Status | Doc Status |
|---|---|---|
| Argon2id password hashing | ✅ `auth/password.rs` | ✅ AUTH_SECURITY.md |
| JWT access token (15 min) | ✅ `auth/jwt.rs` | ✅ |
| JWT refresh token (7 day) | ✅ `auth/jwt.rs` | ✅ |
| Auth middleware (Bearer extraction) | ✅ `auth/middleware.rs` | ✅ |
| Guest session creation | ✅ `handlers/auth.rs::guest` | ✅ |
| Guest merge on signup | ✅ `handlers/auth.rs::register` | ✅ |
| Refresh token rotation | ⚠️ Partial — no DB-backed hash storage | ✅ Spec'd in AUTH_SECURITY.md |
| Token family revocation | ❌ Not implemented | ✅ Spec'd |
| Logout (revoke refresh) | ❌ No endpoint | ✅ Spec'd |
| Rate limiting on auth | ❌ Not implemented | ✅ Spec'd |
| Account lockout | ❌ Not implemented | ✅ Spec'd |
| Audit logging | ❌ Table exists in migration, no code writes to it | ✅ Spec'd |
| Stripe webhook signature verification | ⚠️ TODO in code | ✅ Spec'd |

**Artifacts:** `docs/AUTH_SECURITY.md` (61.9 KB), `backend/src/auth/` (3 modules)
**Blockers:**
- 🔴 **B-08:** Refresh token rotation is not DB-backed — tokens are not stored as hashes, so revocation and reuse detection are impossible. This is a **security-critical** gap.
- 🔴 **B-09:** No logout endpoint — users cannot end sessions.
- 🔴 **B-10:** No rate limiting on auth endpoints — brute-force attacks are unmitigated.

**Risks:**
- **R-04:** Without DB-backed refresh tokens, a stolen refresh token cannot be revoked.
- **R-05:** Without rate limiting, credential stuffing is trivial.

**DoD:** ❌ **FAIL on security invariant.** B-08 (refresh token DB storage) and B-10 (rate limiting) must be implemented. The spec is complete and detailed in AUTH_SECURITY.md — implementation must follow it.

---

### Phase 8: Billing / Entitlements

**Status: 🟡 CONDITIONAL PASS**

| Requirement | Code Status | Doc Status |
|---|---|---|
| Stripe Checkout session creation | ✅ `handlers/billing.rs::create_checkout` | ✅ BILLING_ENGINEERING.md |
| Stripe Customer Portal | ❌ No endpoint | ✅ Spec'd |
| Webhook handler | ✅ `handlers/billing.rs::stripe_webhook` | ✅ |
| Webhook signature verification | ⚠️ TODO in code | ✅ Spec'd |
| Event deduplication (`stripe_events` table) | ⚠️ Basic check, not using dedicated table | ✅ Spec'd |
| Subscription state machine | ⚠️ Partial — updates `users` table directly | ✅ Spec'd (dedicated `subscriptions` table) |
| 7-day grace period on past_due | ❌ Not implemented | ✅ Spec'd |
| Entitlement enforcement (create_habit) | ✅ `handlers/habits.rs:107-117` (Free=3, Plus=15, Pro=unlimited) | ✅ |
| Entitlement cache | ❌ Not implemented | ✅ Spec'd |
| Downgrade without data loss (archive, not delete) | ❌ Not implemented | ✅ Spec'd |

**Entitlement enforcement verified in code:**
```rust
// handlers/habits.rs:107-111
let max_habits: Option<i64> = match user_tier {
    SubscriptionTier::Free => Some(3),
    SubscriptionTier::Plus => Some(15),
    SubscriptionTier::Pro => None, // unlimited
};
```
✅ Tier limits match PRD (3/15/unlimited).

**Artifacts:** `docs/BILLING_ENGINEERING.md` (65.1 KB), `backend/src/handlers/billing.rs`
**Blockers:**
- 🔴 **B-11:** Stripe webhook signature verification is a TODO — webhooks can be spoofed.
- ⚠️ **B-12:** Downgrade logic does not archive excess habits — data loss risk on tier change.

**Risks:**
- **R-06:** Without webhook signature verification, any attacker can forge subscription changes.

**DoD:** ❌ **FAIL on entitlement invariant.** B-11 (webhook signature) must be implemented. Entitlement limits are correctly enforced in `create_habit`. Downgrade archival (B-12) is a high-priority gap.

---

### Phase 9: AI Insights

**Status: 🟡 CONDITIONAL PASS**

| Requirement | Code Status | Doc Status |
|---|---|---|
| Claude API call | ✅ `handlers/insights.rs::call_claude` | ✅ INSIGHTS_ENGINEERING.md |
| Deterministic fallback | ✅ `handlers/insights.rs::generate_fallback_insight` | ✅ |
| Source tracking (claude/fallback) | ✅ `InsightResponse.source` field | ✅ |
| Structured JSON schema with confidence scores | ❌ Flat `InsightResponse` without confidence | ✅ Spec'd (§3) |
| Safety validation (blocked terms) | ❌ Not implemented | ✅ Spec'd (§5) |
| 3-stage JSON validation | ❌ Not implemented | ✅ Spec'd (§8) |
| Retry with exponential backoff | ❌ Single attempt | ✅ Spec'd (§6) |
| Timeout on Claude call | ❌ No timeout | ✅ Spec'd (§6) |
| Token usage tracking | ❌ Not implemented | ✅ Spec'd (§10) |
| Prompt versioning | ❌ Not implemented | ✅ Spec'd (§4) |
| Weekly caching | ❌ Generates fresh every request | ✅ Spec'd (§10) |
| Entitlement gating | ❌ Any user can call | ✅ Spec'd (§13) |
| Mood data in prompt | ❌ Not queried | ✅ Spec'd (§2) |
| System prompt separation | ❌ Mixed into user prompt | ✅ Spec'd (§4) |

**Artifacts:** `docs/INSIGHTS_ENGINEERING.md` (68.0 KB), `backend/src/handlers/insights.rs`
**Blockers:**
- ⚠️ **B-13:** No safety validation — Claude could return clinical terms or guilt language.
- ⚠️ **B-14:** No timeout — Claude call can hang indefinitely, blocking the request.

**Risks:**
- **R-07:** Without safety validation, AI output could contain harmful language.
- **R-08:** Without caching, every request triggers a Claude API call ($0.0135 each).

**DoD:** Basic Claude integration + fallback exist. **CONDITIONAL** — safety validation (B-13) and timeout (B-14) are required before production AI insights are enabled. The complete implementation plan is in INSIGHTS_ENGINEERING.md.

---

### Phase 10: Realtime / Offline Sync

**Status: 🟡 CONDITIONAL PASS**

| Requirement | Code Status | Doc Status |
|---|---|---|
| WebSocket endpoint `/ws` | ✅ `handlers/ws.rs` | ✅ REALTIME_OFFLINE_SYNC.md |
| Auth on WS connection | ❌ No auth — any client can connect | ✅ Spec'd (§2) |
| Per-user channel broadcast | ❌ Global broadcast to all clients | ✅ Spec'd (§4) |
| Event types (completed, uncompleted, streak) | ⚠️ Only `completion_changed` | ✅ Spec'd (10 event types, §3) |
| Offline queue (client) | ✅ `stores/offline-store.ts` | ✅ |
| IndexedDB storage | ❌ Uses localStorage | ✅ Spec'd (§6) |
| Idempotency keys on replay | ❌ Not implemented | ✅ Spec'd (§8) |
| Replay algorithm (ordered, sequential) | ❌ Not implemented | ✅ Spec'd (§8) |
| Conflict handling UX | ❌ Not implemented | ✅ Spec'd (§11) |
| Queue compaction | ❌ Not implemented | ✅ Spec'd (§10, C-5) |
| Reconnect with exponential backoff | ❌ Fixed 3s delay | ✅ Spec'd (§12) |

**Artifacts:** `docs/REALTIME_OFFLINE_SYNC.md` (60.5 KB), `backend/src/handlers/ws.rs`, `frontend/src/stores/offline-store.ts`, `frontend/src/hooks/use-websocket.ts`
**Blockers:**
- 🔴 **B-07 (repeat):** WebSocket has no authentication — security-critical.
- ⚠️ **B-05 (repeat):** Offline queue on localStorage, not IndexedDB.

**Risks:**
- **R-09:** Global WS broadcast leaks events across users.

**DoD:** Basic WebSocket + offline queue scaffolds exist. **CONDITIONAL** — WS auth (B-07) is a security blocker. Full implementation plan in REALTIME_OFFLINE_SYNC.md.

---

### Phase 11: DevOps

**Status: 🟡 CONDITIONAL PASS**

| Requirement | Code/Config Status | Doc Status |
|---|---|---|
| Docker multi-stage build | ✅ `backend/Dockerfile` (2-stage) | ✅ DEPLOYMENT_OPS.md §3 (3-stage, improved) |
| fly.toml configuration | ✅ `backend/fly.toml` | ✅ Spec'd (§7) |
| Health probe (`/health`) | ✅ `handlers/health.rs` | ✅ |
| Readiness probe (`/readyz`) | ❌ Not implemented | ✅ Spec'd (§4) |
| CI pipeline (GitHub Actions) | ❌ No `.github/workflows/` directory | ✅ Spec'd (§5) |
| CD pipeline (staged rollout) | ❌ Not implemented | ✅ Spec'd (§6) |
| Sentry integration (BE) | ❌ Not implemented | ✅ Spec'd (§12) |
| Sentry integration (FE) | ❌ Not implemented | ✅ Spec'd (§12) |
| Backup automation | ❌ Not implemented | ✅ Spec'd (§10) |
| Staging environment | ❌ Not provisioned | ✅ Spec'd (§7) |
| Non-root Docker user | ❌ Runs as root | ✅ Spec'd (§3) |
| docker-compose for local dev | ✅ `docker-compose.yml` | ✅ |

**Artifacts:** `docs/DEPLOYMENT_OPS.md` (52.3 KB), `backend/Dockerfile`, `backend/fly.toml`, `docker-compose.yml`
**Blockers:**
- ⚠️ **B-04 (repeat):** No `/readyz` endpoint for Fly.io readiness checks.
- ⚠️ **B-15:** No CI pipeline — no automated quality gates.

**Risks:**
- **R-10:** Without CI, broken code can be deployed to production.
- **R-11:** fly.toml has `auto_stop_machines = true` which kills WebSocket connections.

**DoD:** Docker + fly.toml exist. **CONDITIONAL** — CI pipeline (B-15) and readiness probe (B-04) must be created. Complete specs in DEPLOYMENT_OPS.md.

---

### Phase 12: QA & Launch Readiness

**Status: 🔴 NOT STARTED (spec complete)**

| Requirement | Code Status | Doc Status |
|---|---|---|
| Unit test files (Rust) | ❌ No `#[cfg(test)]` modules or `tests/` directory | ✅ 60 tests spec'd |
| Unit test files (Frontend) | ❌ No vitest config or test files | ✅ Tests spec'd |
| Integration test harness | ❌ Not implemented | ✅ 30 tests spec'd |
| E2E tests (Playwright) | ❌ Not installed or configured | ✅ 15 tests spec'd |
| Load tests (k6) | ❌ Not implemented | ✅ 4 tests spec'd |
| Security tests | ❌ Not implemented | ✅ 10 tests spec'd |
| Accessibility tests | ❌ Not implemented | ✅ 3 tests spec'd |
| PWA offline tests | ❌ Not implemented | ✅ 3 tests spec'd |
| Go/no-go checklist | N/A | ✅ 30-item checklist |

**Artifacts:** `docs/VERIFICATION_SUITE.md` (61.9 KB) — complete test specifications with code
**Blockers:**
- 🔴 **B-16:** Zero test files exist in the codebase. The verification suite is fully designed but not implemented.

**Risks:**
- **R-12:** Without tests, streak invariants, entitlement enforcement, and security cannot be verified.

**DoD:** ❌ **FAIL.** Test specifications are complete and detailed. No test code exists. Must implement before launch.

---

## Blocker Registry

### 🔴 Critical (Must resolve before ANY deployment)

| ID | Phase | Blocker | Impact | Effort |
|---|---|---|---|---|
| **B-08** | 7 (Auth) | Refresh tokens not DB-backed — no revocation possible | Security: stolen tokens irrevocable | 4h |
| **B-10** | 7 (Auth) | No rate limiting on auth endpoints | Security: brute-force unmitigated | 3h |
| **B-11** | 8 (Billing) | Stripe webhook signature not verified | Security: webhooks can be spoofed | 2h |
| **B-07** | 10 (Sync) | WebSocket has no authentication | Security: events leak across users | 2h |
| **B-01** | 4 (DB) | `main.rs` points to v1 migrations, not v2 | App runs wrong schema | 0.5h |
| **B-16** | 12 (QA) | Zero test files exist | No verification of any invariant | 16h |

### ⚠️ High (Must resolve before beta/launch)

| ID | Phase | Blocker | Impact | Effort |
|---|---|---|---|---|
| **B-03** | 5 (API) | No `POST /api/auth/logout` endpoint | Users cannot end sessions | 2h |
| **B-04** | 5/11 (API/DevOps) | No `GET /readyz` endpoint | Fly.io cannot check readiness | 1h |
| **B-05** | 6/10 (FE/Sync) | Offline queue uses localStorage, not IndexedDB | Data loss risk | 4h |
| **B-06** | 6 (FE) | No idempotency keys on offline actions | Duplicate replays | 2h |
| **B-09** | 7 (Auth) | No logout endpoint (same as B-03) | — | — |
| **B-12** | 8 (Billing) | Downgrade doesn't archive excess habits | Data loss on tier change | 3h |
| **B-13** | 9 (Insights) | No safety validation on AI output | Harmful language risk | 3h |
| **B-14** | 9 (Insights) | No timeout on Claude API call | Request hangs indefinitely | 0.5h |
| **B-15** | 11 (DevOps) | No CI pipeline (GitHub Actions) | No automated quality gates | 4h |

---

## Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Wrong migration path in main.rs | Certain | Critical | Fix B-01 (0.5h) |
| R-02 | Missing account deletion blocks GDPR | Medium | High | Implement M-06 post-launch |
| R-03 | localStorage offline queue data loss | Medium | Medium | Fix B-05 (migrate to IndexedDB) |
| R-04 | Stolen refresh token irrevocable | High | Critical | Fix B-08 (DB-backed tokens) |
| R-05 | Credential stuffing on auth | High | High | Fix B-10 (rate limiting) |
| R-06 | Spoofed Stripe webhooks | Medium | Critical | Fix B-11 (signature verification) |
| R-07 | AI output contains harmful language | Medium | High | Fix B-13 (safety validation) |
| R-08 | Unbounded Claude API costs | Medium | Medium | Implement weekly caching |
| R-09 | WS events leak across users | Certain | High | Fix B-07 (WS auth) |
| R-10 | Broken code deployed without CI | High | High | Fix B-15 (CI pipeline) |
| R-11 | fly.toml kills WS connections | Certain | Medium | Set `auto_stop_machines = false` |
| R-12 | No test verification of invariants | Certain | Critical | Fix B-16 (implement tests) |

---

## Artifact Inventory

### Engineering Documents (10/10 ✅)

| # | Document | Size | Phase |
|---|---|---|---|
| 1 | `docs/PRD.md` | 43.6 KB | Phase 2 |
| 2 | `docs/ARCHITECTURE.md` | 73.9 KB | Phase 3 |
| 3 | `docs/API_CONTRACTS.md` | 40.7 KB | Phase 5 |
| 4 | `docs/FRONTEND_ARCHITECTURE.md` | 61.4 KB | Phase 6 |
| 5 | `docs/AUTH_SECURITY.md` | 61.9 KB | Phase 7 |
| 6 | `docs/BILLING_ENGINEERING.md` | 65.1 KB | Phase 8 |
| 7 | `docs/INSIGHTS_ENGINEERING.md` | 68.0 KB | Phase 9 |
| 8 | `docs/REALTIME_OFFLINE_SYNC.md` | 60.5 KB | Phase 10 |
| 9 | `docs/DEPLOYMENT_OPS.md` | 52.3 KB | Phase 11 |
| 10 | `docs/VERIFICATION_SUITE.md` | 61.9 KB | Phase 12 |

**Total documentation: 589.3 KB across 10 documents.**

### Code Artifacts

| Area | Files | Status |
|---|---|---|
| Backend handlers | 9 files in `src/handlers/` | ✅ All P0 endpoints implemented |
| Backend models | 5 files in `src/models/` | ✅ All domain types defined |
| Backend auth | 3 files in `src/auth/` | 🟡 Partial (no DB-backed refresh) |
| Backend config | `src/config.rs` | ✅ All env vars loaded |
| Backend migrations (v2) | 11 up + 11 down | ✅ Complete schema |
| Frontend pages | 9 routes | ✅ All P0 pages exist |
| Frontend hooks | `use-habits.ts`, `use-websocket.ts` | ✅ CRUD + optimistic UI |
| Frontend stores | `auth-store.ts`, `offline-store.ts` | 🟡 Partial (localStorage) |
| Frontend API client | `lib/api.ts` | ✅ Token refresh built in |
| Docker | `Dockerfile`, `fly.toml`, `docker-compose.yml` | ✅ Deployable |
| Tests | 0 files | 🔴 None exist |
| CI/CD | 0 files | 🔴 None exist |

---

## Implementation Priority Queue

The following is the strict execution order to reach launch readiness. Items are ordered by dependency and criticality.

### Sprint 1: Security & Infrastructure (2 days)

| # | Task | Blocker | Effort | Phase |
|---|---|---|---|---|
| 1 | Fix migration path: `main.rs` → `./migrations_v2` | B-01 | 0.5h | 4 |
| 2 | Implement DB-backed refresh token storage + rotation | B-08 | 4h | 7 |
| 3 | Implement `POST /api/auth/logout` (revoke tokens) | B-03/B-09 | 2h | 7 |
| 4 | Implement rate limiting middleware on auth endpoints | B-10 | 3h | 7 |
| 5 | Implement Stripe webhook signature verification | B-11 | 2h | 8 |
| 6 | Add WebSocket authentication (`?token=` query param) | B-07 | 2h | 10 |
| 7 | Add `GET /readyz` endpoint with DB check | B-04 | 1h | 11 |

### Sprint 2: Data Integrity & Offline (2 days)

| # | Task | Blocker | Effort | Phase |
|---|---|---|---|---|
| 8 | Implement downgrade habit archival (not delete) | B-12 | 3h | 8 |
| 9 | Add Claude API timeout (30s) | B-14 | 0.5h | 9 |
| 10 | Add insight safety validation (blocked terms) | B-13 | 3h | 9 |
| 11 | Migrate offline queue to IndexedDB | B-05 | 4h | 10 |
| 12 | Add idempotency keys to offline actions | B-06 | 2h | 10 |
| 13 | Implement per-user WS channels (replace global broadcast) | — | 3h | 10 |
| 14 | Fix fly.toml: `auto_stop_machines = false`, `min_machines = 2` | R-11 | 0.5h | 11 |

### Sprint 3: CI/CD & Tests (3 days)

| # | Task | Blocker | Effort | Phase |
|---|---|---|---|---|
| 15 | Create `.github/workflows/ci.yml` | B-15 | 4h | 11 |
| 16 | Create `.github/workflows/deploy-backend.yml` | — | 2h | 11 |
| 17 | Implement backend unit tests (schedule, streak, entitlements, tokens) | B-16 | 8h | 12 |
| 18 | Implement backend integration tests (auth, habits, billing) | B-16 | 8h | 12 |
| 19 | Set up Playwright + implement critical E2E tests | B-16 | 6h | 12 |

### Sprint 4: Polish & Launch (2 days)

| # | Task | Effort | Phase |
|---|---|---|---|
| 20 | Implement weekly insight caching | 3h | 9 |
| 21 | Add Sentry integration (BE + FE) | 3h | 11 |
| 22 | Provision staging environment on Fly.io | 2h | 11 |
| 23 | Run go/no-go checklist (VERIFICATION_SUITE.md §10) | 2h | 12 |
| 24 | Production deploy + smoke test | 2h | 11 |

**Total estimated effort: ~9 engineering days.**

---

## Gate Decision

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   PHASE GATE: DO NOT PROCEED TO PRODUCTION DEPLOY UNTIL:                 │
│                                                                          │
│   ✅ B-01: Migration path fixed                                          │
│   ✅ B-08: Refresh tokens DB-backed with revocation                      │
│   ✅ B-10: Rate limiting on auth endpoints                               │
│   ✅ B-11: Stripe webhook signature verified                             │
│   ✅ B-07: WebSocket authenticated                                       │
│   ✅ B-16: Core unit tests passing (streak, entitlements, tokens)        │
│                                                                          │
│   These 6 items are NON-NEGOTIABLE security and correctness gates.       │
│   All other items can ship in a fast-follow within 1 week of launch.     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

*Report version: 1.0.0 — Generated for HabitArc*
*Audit date: 2026-02-10*
*Auditor: Program Orchestrator*
