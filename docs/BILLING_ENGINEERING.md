# HabitArc — Billing & Subscription Engineering

> Principal Payments Engineer specification.
> Stripe Checkout + Customer Portal · Signed webhooks · Idempotent processing
> Subscription state machine · 7-day grace period · Entitlement recompute + cache

---

## Table of Contents

1. [Plan Configuration](#1-plan-configuration)
2. [Subscription State Machine](#2-subscription-state-machine)
3. [Entitlement Model](#3-entitlement-model)
4. [Webhook Event Handling Matrix](#4-webhook-event-handling-matrix)
5. [Signed Webhook Validation](#5-signed-webhook-validation)
6. [Idempotent Webhook Processing](#6-idempotent-webhook-processing)
7. [Checkout Session Endpoint](#7-checkout-session-endpoint)
8. [Customer Portal Endpoint](#8-customer-portal-endpoint)
9. [Subscription Status Endpoint](#9-subscription-status-endpoint)
10. [DB Update Transactions](#10-db-update-transactions)
11. [7-Day Grace Period & Downgrade](#11-7-day-grace-period--downgrade)
12. [Downgrade Behavior Without Data Loss](#12-downgrade-behavior-without-data-loss)
13. [Entitlement Recompute & Cache](#13-entitlement-recompute--cache)
14. [Out-of-Order & Duplicate Event Handling](#14-out-of-order--duplicate-event-handling)
15. [Test Specifications](#15-test-specifications)
16. [Gaps in Current Code](#16-gaps-in-current-code)
17. [Implementation: Rust Code](#17-implementation-rust-code)

---

## 1. Plan Configuration

### Stripe Products

| Plan | Tier | Monthly Price | Stripe Price ID (env) | Stripe Product Metadata |
|---|---|---|---|---|
| **Free** | `free` | $0.00 | — (no Stripe object) | — |
| **Plus Monthly** | `plus` | $4.99 | `STRIPE_PRICE_PLUS_MONTHLY` | `tier=plus` |
| **Pro Monthly** | `pro` | $9.99 | `STRIPE_PRICE_PRO_MONTHLY` | `tier=pro` |

### Stripe Dashboard Configuration

```
Product: HabitArc Plus
  └── Price: $4.99/month (recurring, USD)
       └── Metadata: tier=plus

Product: HabitArc Pro
  └── Price: $9.99/month (recurring, USD)
       └── Metadata: tier=pro

Webhook endpoint: https://api.habitarc.com/api/webhook/stripe
  Events:
    - checkout.session.completed
    - customer.subscription.created
    - customer.subscription.updated
    - customer.subscription.deleted
    - customer.subscription.paused
    - customer.subscription.resumed
    - invoice.payment_succeeded
    - invoice.payment_failed
    - invoice.paid
    - customer.updated
```

### Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PLUS_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
```

### Config Extension

```rust
pub struct Config {
    // ... existing fields ...
    pub stripe_price_plus_monthly: String,
    pub stripe_price_pro_monthly: String,
}
```

---

## 2. Subscription State Machine

### States

```
┌──────────┐    checkout.session.completed     ┌──────────┐
│          │ ─────────────────────────────────► │          │
│   FREE   │                                    │  ACTIVE  │◄─────────────┐
│          │ ◄───────────────────────────────── │          │              │
└──────────┘    subscription.deleted            └────┬─────┘              │
     ▲          (after grace expires)                │                    │
     │                                               │                    │
     │                                    invoice.payment_failed          │
     │                                               │                    │
     │                                               ▼                    │
     │                                         ┌──────────┐              │
     │                                         │          │   invoice.   │
     │         7-day grace expires             │ PAST_DUE │   payment_  │
     │         (background job)                │          │   succeeded │
     │         ◄────────────────────────────── │  (grace) │ ────────────┘
     │                                         └────┬─────┘
     │                                              │
     │                              subscription.deleted
     │                              (Stripe auto-cancel after
     │                               all retries exhausted)
     │                                              │
     │                                              ▼
     │                                        ┌──────────┐
     │                                        │          │
     └─────────────────────────────────────── │ CANCELED │
              downgrade_to_free()             │          │
                                              └──────────┘


                    ┌──────────┐
                    │          │   subscription.updated
                    │ TRIALING │ ──────────────────────► ACTIVE
                    │          │   (trial ends, payment succeeds)
                    └──────────┘
                         │
                         │  trial ends, payment fails
                         ▼
                      PAST_DUE
```

### State Transition Table

| From | Event | To | Action |
|---|---|---|---|
| `free` | `checkout.session.completed` | `active` | Create subscription row, set tier, recompute entitlements |
| `active` | `invoice.payment_failed` | `past_due` | Set status, record `grace_period_end = NOW() + 7 days` |
| `past_due` | `invoice.payment_succeeded` | `active` | Clear grace period, set status active |
| `past_due` | Grace period expires (7d) | `canceled` → `free` | Downgrade tier, archive excess habits, recompute entitlements |
| `past_due` | `subscription.deleted` | `canceled` → `free` | Same as grace expiry |
| `active` | `subscription.updated` (cancel_at_period_end=true) | `active` | Set `cancel_at_period_end = true` (still active until period end) |
| `active` | `subscription.deleted` | `canceled` → `free` | Downgrade immediately |
| `trialing` | Trial ends + payment succeeds | `active` | Normal active flow |
| `trialing` | Trial ends + payment fails | `past_due` | Grace period starts |
| `active` | `subscription.updated` (plan change) | `active` | Update tier (plus↔pro), recompute entitlements |
| `canceled` | New checkout | `active` | New subscription row, set tier |

### Postgres Enum Mapping

```
Stripe status       →  Our subscription_status  →  Tier behavior
─────────────────────────────────────────────────────────────────
"active"            →  active                    →  Full tier access
"trialing"          →  trialing                  →  Full tier access
"past_due"          →  past_due                  →  Full tier access (grace period)
"canceled"          →  canceled                  →  Downgrade to free
"unpaid"            →  canceled                  →  Downgrade to free
"incomplete"        →  (ignored)                 →  No change
"incomplete_expired"→  (ignored)                 →  No change
"paused"            →  inactive                  →  Downgrade to free
```

**Key design decision:** During `past_due`, the user **retains full tier access** for the 7-day grace period. This prevents data loss from transient payment failures (expired card, bank hold, etc.).

---

## 3. Entitlement Model

### Entitlement Matrix

| Feature Key | Free | Plus ($4.99) | Pro ($9.99) | Type |
|---|---|---|---|---|
| `max_habits` | 3 | 15 | unlimited | `i32 \| null` |
| `schedule_types` | `daily` | `daily,weekly_days,weekly_target` | all | `text` |
| `analytics_days` | 7 | 30 | 365 | `i32` |
| `heatmap_months` | 1 | 6 | 12 | `i32` |
| `ai_insights_per_week` | 0 (disabled) | 1 | unlimited | `i32 \| null` |
| `max_reminders` | 1 | unlimited | unlimited | `i32 \| null` |
| `data_export` | false | false | true | `bool` |
| `unlimited_habits` | false | false | true | `bool` |
| `advanced_ai_insights` | false | true | true | `bool` |
| `per_habit_reminders` | false | true | true | `bool` |
| `csv_export` | false | false | true | `bool` |
| `challenges_access` | false | false | true | `bool` |
| `premium_themes` | false | true | true | `bool` |
| `smart_reminders` | false | false | true | `bool` |

### DB Schema (existing `feature_entitlements` table)

```sql
-- Each row: one feature for one tier
-- UNIQUE(tier, feature_key)
INSERT INTO feature_entitlements (tier, feature_key, value_int, value_bool, value_text) VALUES
    -- Free
    ('free', 'max_habits',            3,    NULL,  NULL),
    ('free', 'unlimited_habits',      NULL, false, NULL),
    ('free', 'advanced_ai_insights',  NULL, false, NULL),
    ('free', 'per_habit_reminders',   NULL, false, NULL),
    ('free', 'csv_export',            NULL, false, NULL),
    ('free', 'challenges_access',     NULL, false, NULL),
    ('free', 'premium_themes',        NULL, false, NULL),
    ('free', 'smart_reminders',       NULL, false, NULL),
    ('free', 'analytics_days',        7,    NULL,  NULL),
    ('free', 'heatmap_months',        1,    NULL,  NULL),
    ('free', 'ai_insights_per_week',  0,    NULL,  NULL),
    ('free', 'max_reminders',         1,    NULL,  NULL),
    ('free', 'data_export',           NULL, false, NULL),
    ('free', 'schedule_types',        NULL, NULL,  'daily'),

    -- Plus
    ('plus', 'max_habits',            15,   NULL,  NULL),
    ('plus', 'unlimited_habits',      NULL, false, NULL),
    ('plus', 'advanced_ai_insights',  NULL, true,  NULL),
    ('plus', 'per_habit_reminders',   NULL, true,  NULL),
    ('plus', 'csv_export',            NULL, false, NULL),
    ('plus', 'challenges_access',     NULL, false, NULL),
    ('plus', 'premium_themes',        NULL, true,  NULL),
    ('plus', 'smart_reminders',       NULL, false, NULL),
    ('plus', 'analytics_days',        30,   NULL,  NULL),
    ('plus', 'heatmap_months',        6,    NULL,  NULL),
    ('plus', 'ai_insights_per_week',  1,    NULL,  NULL),
    ('plus', 'max_reminders',         NULL, NULL,  NULL),  -- NULL int = unlimited
    ('plus', 'data_export',           NULL, false, NULL),
    ('plus', 'schedule_types',        NULL, NULL,  'daily,weekly_days,weekly_target'),

    -- Pro
    ('pro', 'max_habits',             NULL, NULL,  NULL),  -- NULL int = unlimited
    ('pro', 'unlimited_habits',       NULL, true,  NULL),
    ('pro', 'advanced_ai_insights',   NULL, true,  NULL),
    ('pro', 'per_habit_reminders',    NULL, true,  NULL),
    ('pro', 'csv_export',             NULL, true,  NULL),
    ('pro', 'challenges_access',      NULL, true,  NULL),
    ('pro', 'premium_themes',         NULL, true,  NULL),
    ('pro', 'smart_reminders',        NULL, true,  NULL),
    ('pro', 'analytics_days',         365,  NULL,  NULL),
    ('pro', 'heatmap_months',         12,   NULL,  NULL),
    ('pro', 'ai_insights_per_week',   NULL, NULL,  NULL),  -- NULL = unlimited
    ('pro', 'max_reminders',          NULL, NULL,  NULL),
    ('pro', 'data_export',            NULL, true,  NULL),
    ('pro', 'schedule_types',         NULL, NULL,  'daily,weekly_days,weekly_target');
```

### Rust Entitlement Struct

```rust
#[derive(Debug, Serialize, Clone)]
pub struct Entitlements {
    // Numeric limits (None = unlimited)
    pub max_habits: Option<i32>,
    pub analytics_days: i32,
    pub heatmap_months: i32,
    pub ai_insights_per_week: Option<i32>,  // None = unlimited, Some(0) = disabled
    pub max_reminders: Option<i32>,

    // Boolean feature flags
    pub unlimited_habits: bool,
    pub advanced_ai_insights: bool,
    pub per_habit_reminders: bool,
    pub csv_export: bool,
    pub challenges_access: bool,
    pub premium_themes: bool,
    pub smart_reminders: bool,
    pub data_export: bool,

    // Compound
    pub schedule_types: Vec<String>,
}
```

---

## 4. Webhook Event Handling Matrix

| # | Stripe Event | Handled | DB Action | Entitlement Recompute | Audit Log |
|---|---|---|---|---|---|
| 1 | `checkout.session.completed` | **Yes** | Upsert subscription (tier from metadata, status=active), link `stripe_subscription_id` | Yes | `subscription_changed` |
| 2 | `customer.subscription.created` | **Yes** | Upsert subscription (tier from price metadata, status from event) | Yes | `subscription_changed` |
| 3 | `customer.subscription.updated` | **Yes** | Update tier (if plan changed), update status, update period dates, set `cancel_at_period_end` | Yes (if tier or status changed) | `subscription_changed` |
| 4 | `customer.subscription.deleted` | **Yes** | Set status=canceled, set canceled_at, trigger downgrade | Yes | `subscription_changed` |
| 5 | `customer.subscription.paused` | **Yes** | Set status=inactive, trigger downgrade | Yes | `subscription_changed` |
| 6 | `customer.subscription.resumed` | **Yes** | Set status=active, restore tier | Yes | `subscription_changed` |
| 7 | `invoice.payment_succeeded` | **Yes** | If past_due → set active, clear grace. Update period dates. | Yes (if status changed) | — |
| 8 | `invoice.payment_failed` | **Yes** | Set status=past_due, record `grace_period_end` | No (grace keeps access) | `subscription_changed` |
| 9 | `invoice.paid` | **Yes** | Same as `payment_succeeded` (belt-and-suspenders) | Conditional | — |
| 10 | `customer.updated` | **Partial** | Update `stripe_customer_id` if email changed | No | — |
| 11 | All others | **No** | Log and acknowledge (200) | No | — |

### Event Priority

When multiple events arrive for the same subscription, we use **Stripe's `created` timestamp** on the event object to determine ordering. If an older event arrives after a newer one, we skip it (see §14).

---

## 5. Signed Webhook Validation

### Stripe Signature Scheme

Stripe signs webhooks using HMAC-SHA256. The `Stripe-Signature` header contains:

```
Stripe-Signature: t=1614556828,v1=abc123...,v1=def456...
```

- `t` — Unix timestamp of when Stripe sent the event
- `v1` — HMAC-SHA256 signature(s)

### Verification Algorithm

```
1. Extract t and v1 values from header
2. Construct signed_payload = "{t}.{raw_body}"
3. Compute expected = HMAC-SHA256(webhook_secret, signed_payload)
4. Compare expected with each v1 value (constant-time)
5. Verify t is within tolerance (±300 seconds) to prevent replay
```

### Rust Implementation

```rust
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const SIGNATURE_TOLERANCE_SECS: i64 = 300; // 5 minutes

pub fn verify_stripe_signature(
    payload: &[u8],
    sig_header: &str,
    webhook_secret: &str,
) -> Result<(), AppError> {
    // 1. Parse header
    let mut timestamp: Option<i64> = None;
    let mut signatures: Vec<Vec<u8>> = Vec::new();

    for part in sig_header.split(',') {
        let (key, value) = part.split_once('=')
            .ok_or_else(|| AppError::Validation("Invalid Stripe-Signature format".into()))?;

        match key.trim() {
            "t" => {
                timestamp = Some(value.parse::<i64>().map_err(|_|
                    AppError::Validation("Invalid timestamp in Stripe-Signature".into())
                )?);
            }
            "v1" => {
                let sig_bytes = hex::decode(value).map_err(|_|
                    AppError::Validation("Invalid hex in Stripe-Signature".into())
                )?;
                signatures.push(sig_bytes);
            }
            _ => {} // Ignore unknown scheme versions
        }
    }

    let timestamp = timestamp
        .ok_or_else(|| AppError::Validation("Missing timestamp in Stripe-Signature".into()))?;

    if signatures.is_empty() {
        return Err(AppError::Validation("No v1 signatures in Stripe-Signature".into()));
    }

    // 2. Check timestamp tolerance (prevent replay attacks)
    let now = chrono::Utc::now().timestamp();
    if (now - timestamp).abs() > SIGNATURE_TOLERANCE_SECS {
        return Err(AppError::Validation("Stripe webhook timestamp too old".into()));
    }

    // 3. Compute expected signature
    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(payload));
    let mut mac = HmacSha256::new_from_slice(webhook_secret.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Invalid webhook secret")))?;
    mac.update(signed_payload.as_bytes());
    let expected = mac.finalize().into_bytes();

    // 4. Constant-time comparison against all v1 signatures
    let matched = signatures.iter().any(|sig| {
        sig.len() == expected.len()
            && sig.as_slice().ct_eq(expected.as_slice()).into()
    });

    if !matched {
        return Err(AppError::Validation("Invalid Stripe webhook signature".into()));
    }

    Ok(())
}
```

### Dependencies to Add

```toml
# Cargo.toml
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
subtle = "2"  # constant-time comparison
```

---

## 6. Idempotent Webhook Processing

### Deduplication Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    WEBHOOK ARRIVES                               │
│                                                                 │
│  1. Verify Stripe-Signature (HMAC-SHA256)                       │
│     └── FAIL → 400 (Stripe will retry)                          │
│                                                                 │
│  2. Parse event JSON, extract event_id                          │
│                                                                 │
│  3. INSERT INTO stripe_events (event_id, event_type)            │
│     ON CONFLICT (event_id) DO NOTHING                           │
│     RETURNING event_id                                          │
│     └── NULL returned → DUPLICATE, return 200 immediately       │
│     └── event_id returned → NEW event, proceed                  │
│                                                                 │
│  4. Process event in a DB TRANSACTION:                          │
│     BEGIN;                                                      │
│       - Read current subscription state                         │
│       - Apply state transition                                  │
│       - Recompute entitlements if needed                        │
│       - Write audit log                                         │
│     COMMIT;                                                     │
│                                                                 │
│  5. Return 200 { "received": true }                             │
│                                                                 │
│  ON ERROR:                                                      │
│     - ROLLBACK transaction                                      │
│     - DELETE FROM stripe_events WHERE event_id = $1             │
│       (allow retry on next delivery)                            │
│     - Return 500 (Stripe will retry with backoff)               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decision: Insert-Before-Process

The `stripe_events` insert happens **before** processing. If processing fails, we **delete** the event record so Stripe's retry will be accepted. This prevents:
- **Duplicate processing** on success (event_id is PK)
- **Lost events** on failure (record is cleaned up)

### stripe_events Schema (existing)

```sql
CREATE TABLE stripe_events (
    event_id        TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. Checkout Session Endpoint

### `POST /api/subscription/checkout`

**Auth:** Bearer (registered users only)

```rust
pub async fn create_checkout(
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

**Validation:**
- `price_id` must match one of `STRIPE_PRICE_PLUS_MONTHLY` or `STRIPE_PRICE_PRO_MONTHLY`
- `tier` must be `"plus"` or `"pro"`
- `tier` must match the `price_id` (prevent mismatch attacks)
- User must not be a guest (`require_registered` middleware)

**Flow:**

```
1. Validate price_id matches tier
2. Get or create Stripe customer:
   a. SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1
   b. If NULL: POST /v1/customers { email, name, metadata: { user_id } }
   c. Store stripe_customer_id on subscription row
3. Create Checkout Session:
   POST /v1/checkout/sessions {
     customer: cus_xxx,
     mode: "subscription",
     line_items: [{ price: price_id, quantity: 1 }],
     metadata: { user_id, tier },
     subscription_data: {
       metadata: { user_id, tier }
     },
     success_url: "{frontend}/billing?success=true&session_id={CHECKOUT_SESSION_ID}",
     cancel_url: "{frontend}/billing?canceled=true",
     allow_promotion_codes: true,
   }
4. Return { checkout_url: session.url }
```

**Response `200`:**
```json
{
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

**Why `metadata.tier` on both session and subscription_data:**
- Session metadata: available in `checkout.session.completed` event
- Subscription metadata: available in all `customer.subscription.*` events
- This ensures we can determine the tier regardless of which event arrives first

---

## 8. Customer Portal Endpoint

### `POST /api/subscription/portal`

**Auth:** Bearer (registered users only)

```rust
pub async fn create_portal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<PortalResponse>>
```

**Flow:**

```
1. Look up stripe_customer_id for user
   └── If NULL → 400 "No active subscription"
2. POST /v1/billing_portal/sessions {
     customer: cus_xxx,
     return_url: "{frontend}/billing",
   }
3. Return { portal_url: session.url }
```

**Response `200`:**
```json
{
  "portal_url": "https://billing.stripe.com/p/session/..."
}
```

**Portal capabilities (configured in Stripe Dashboard):**
- View invoices
- Update payment method
- Cancel subscription
- Switch between Plus ↔ Pro (proration)

---

## 9. Subscription Status Endpoint

### `GET /api/subscription/status`

**Auth:** Bearer

```rust
pub async fn get_status(
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
  "grace_period_end": null,
  "entitlements": {
    "max_habits": 15,
    "unlimited_habits": false,
    "advanced_ai_insights": true,
    "per_habit_reminders": true,
    "csv_export": false,
    "challenges_access": false,
    "premium_themes": true,
    "smart_reminders": false,
    "analytics_days": 30,
    "heatmap_months": 6,
    "ai_insights_per_week": 1,
    "max_reminders": null,
    "data_export": false,
    "schedule_types": ["daily", "weekly_days", "weekly_target"]
  }
}
```

**Query:**
```sql
SELECT
    s.tier,
    s.status,
    s.current_period_end,
    s.cancel_at_period_end,
    s.grace_period_end
FROM subscriptions s
WHERE s.user_id = $1
  AND s.status IN ('active', 'trialing', 'past_due')
ORDER BY s.created_at DESC
LIMIT 1;
```

If no subscription found → return `{ tier: "free", status: "active", ... }` with free entitlements.

---

## 10. DB Update Transactions

### Webhook Processing Transaction

Every webhook event that modifies subscription state runs inside a single Postgres transaction:

```rust
pub async fn process_webhook_event(
    db: &PgPool,
    event: &StripeEvent,
    entitlement_cache: &EntitlementCache,
) -> AppResult<()> {
    let mut tx = db.begin().await?;

    match event.event_type.as_str() {
        "checkout.session.completed" => {
            handle_checkout_completed(&mut tx, event).await?;
        }
        "customer.subscription.created" |
        "customer.subscription.updated" => {
            handle_subscription_upsert(&mut tx, event, entitlement_cache).await?;
        }
        "customer.subscription.deleted" => {
            handle_subscription_deleted(&mut tx, event, entitlement_cache).await?;
        }
        "invoice.payment_failed" => {
            handle_payment_failed(&mut tx, event).await?;
        }
        "invoice.payment_succeeded" | "invoice.paid" => {
            handle_payment_succeeded(&mut tx, event, entitlement_cache).await?;
        }
        _ => {
            tracing::debug!(event_type = %event.event_type, "Unhandled Stripe event");
        }
    }

    tx.commit().await?;
    Ok(())
}
```

### `handle_checkout_completed`

```rust
async fn handle_checkout_completed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &StripeEvent,
) -> AppResult<()> {
    let obj = &event.data["object"];
    let customer_id = obj["customer"].as_str().unwrap_or("");
    let subscription_id = obj["subscription"].as_str().unwrap_or("");
    let tier = obj["metadata"]["tier"].as_str().unwrap_or("plus");

    // Find user by stripe_customer_id
    // (customer was created/linked during checkout creation)
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1",
    )
    .bind(customer_id)
    .fetch_optional(&mut **tx)
    .await?;

    // If no subscription row yet, find user from users table (legacy path)
    let user_id = match user_id {
        Some(id) => id,
        None => {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM users WHERE stripe_customer_id = $1",
            )
            .bind(customer_id)
            .fetch_one(&mut **tx)
            .await?
        }
    };

    let tier_enum: SubscriptionTier = match tier {
        "pro" => SubscriptionTier::Pro,
        _ => SubscriptionTier::Plus,
    };

    // Upsert subscription
    sqlx::query(
        r#"
        INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id)
        VALUES ($1, $2, 'active', $3, $4)
        ON CONFLICT (user_id) WHERE status IN ('active', 'trialing')
        DO UPDATE SET
            tier = $2,
            status = 'active',
            stripe_subscription_id = $4,
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(tier_enum)
    .bind(customer_id)
    .bind(subscription_id)
    .execute(&mut **tx)
    .await?;

    // Audit log
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, metadata) VALUES ($1, 'subscription_changed', $2)",
    )
    .bind(user_id)
    .bind(serde_json::json!({
        "event": "checkout.session.completed",
        "tier": tier,
        "stripe_subscription_id": subscription_id,
    }))
    .execute(&mut **tx)
    .await?;

    Ok(())
}
```

### `handle_subscription_upsert`

```rust
async fn handle_subscription_upsert(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &StripeEvent,
    cache: &EntitlementCache,
) -> AppResult<()> {
    let sub = &event.data["object"];
    let stripe_sub_id = sub["id"].as_str().unwrap_or("");
    let customer_id = sub["customer"].as_str().unwrap_or("");
    let status = sub["status"].as_str().unwrap_or("active");
    let tier = sub["metadata"]["tier"].as_str().unwrap_or("plus");
    let cancel_at_period_end = sub["cancel_at_period_end"].as_bool().unwrap_or(false);

    let period_start = sub["current_period_start"].as_i64()
        .map(|ts| chrono::DateTime::from_timestamp(ts, 0));
    let period_end = sub["current_period_end"].as_i64()
        .map(|ts| chrono::DateTime::from_timestamp(ts, 0));

    // Map Stripe status to our enum
    let our_status = match status {
        "active" => "active",
        "trialing" => "trialing",
        "past_due" => "past_due",
        "canceled" | "unpaid" => "canceled",
        "paused" => "inactive",
        _ => return Ok(()), // Ignore incomplete/incomplete_expired
    };

    let tier_enum = match tier {
        "pro" => "pro",
        "plus" => "plus",
        _ => "plus",
    };

    // Out-of-order protection: check event timestamp vs last update
    let existing = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>,)>(
        "SELECT updated_at FROM subscriptions WHERE stripe_subscription_id = $1",
    )
    .bind(stripe_sub_id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some((last_updated,)) = existing {
        let event_ts = chrono::DateTime::from_timestamp(event.created, 0)
            .unwrap_or(chrono::Utc::now());
        if event_ts < last_updated {
            tracing::warn!(
                event_id = %event.id,
                "Skipping out-of-order subscription event"
            );
            return Ok(());
        }
    }

    // Upsert
    sqlx::query(
        r#"
        INSERT INTO subscriptions (
            user_id, tier, status, stripe_customer_id, stripe_subscription_id,
            current_period_start, current_period_end, cancel_at_period_end
        )
        SELECT u.id, $2::subscription_tier, $3::subscription_status, $4, $5, $6, $7, $8
        FROM users u
        WHERE u.stripe_customer_id = $4
        ON CONFLICT (stripe_subscription_id)
        DO UPDATE SET
            tier = $2::subscription_tier,
            status = $3::subscription_status,
            current_period_start = COALESCE($6, subscriptions.current_period_start),
            current_period_end = COALESCE($7, subscriptions.current_period_end),
            cancel_at_period_end = $8,
            updated_at = NOW()
        "#,
    )
    .bind(stripe_sub_id)
    .bind(tier_enum)
    .bind(our_status)
    .bind(customer_id)
    .bind(stripe_sub_id)
    .bind(period_start.flatten())
    .bind(period_end.flatten())
    .bind(cancel_at_period_end)
    .execute(&mut **tx)
    .await?;

    // If status is canceled/inactive → trigger downgrade
    if our_status == "canceled" || our_status == "inactive" {
        downgrade_to_free(tx, customer_id).await?;
    }

    // Invalidate entitlement cache for this user
    if let Some(user_id) = find_user_by_customer(tx, customer_id).await? {
        cache.invalidate(user_id);
    }

    Ok(())
}
```

---

## 11. 7-Day Grace Period & Downgrade

### Grace Period Schema Addition

```sql
-- Add to subscriptions table (new migration)
ALTER TABLE subscriptions ADD COLUMN grace_period_end TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
```

### `handle_payment_failed`

```rust
async fn handle_payment_failed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &StripeEvent,
) -> AppResult<()> {
    let invoice = &event.data["object"];
    let customer_id = invoice["customer"].as_str().unwrap_or("");
    let subscription_id = invoice["subscription"].as_str().unwrap_or("");

    // Only act on subscription invoices (not one-time)
    if subscription_id.is_empty() {
        return Ok(());
    }

    let grace_end = chrono::Utc::now() + chrono::Duration::days(7);

    sqlx::query(
        r#"
        UPDATE subscriptions SET
            status = 'past_due',
            grace_period_end = $2,
            updated_at = NOW()
        WHERE stripe_subscription_id = $1
          AND status IN ('active', 'trialing')
        "#,
    )
    .bind(subscription_id)
    .bind(grace_end)
    .execute(&mut **tx)
    .await?;

    // Audit log
    if let Some(user_id) = find_user_by_customer(tx, customer_id).await? {
        sqlx::query(
            "INSERT INTO audit_logs (user_id, action, metadata) VALUES ($1, 'subscription_changed', $2)",
        )
        .bind(user_id)
        .bind(serde_json::json!({
            "event": "invoice.payment_failed",
            "grace_period_end": grace_end.to_rfc3339(),
            "stripe_subscription_id": subscription_id,
        }))
        .execute(&mut **tx)
        .await?;
    }

    // NOTE: User retains full tier access during grace period.
    // The background job (below) handles the actual downgrade.

    Ok(())
}
```

### `handle_payment_succeeded`

```rust
async fn handle_payment_succeeded(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &StripeEvent,
    cache: &EntitlementCache,
) -> AppResult<()> {
    let invoice = &event.data["object"];
    let subscription_id = invoice["subscription"].as_str().unwrap_or("");

    if subscription_id.is_empty() {
        return Ok(());
    }

    // Clear grace period, restore active status
    sqlx::query(
        r#"
        UPDATE subscriptions SET
            status = 'active',
            grace_period_end = NULL,
            updated_at = NOW()
        WHERE stripe_subscription_id = $1
          AND status = 'past_due'
        "#,
    )
    .bind(subscription_id)
    .execute(&mut **tx)
    .await?;

    // Invalidate cache
    let customer_id = invoice["customer"].as_str().unwrap_or("");
    if let Some(user_id) = find_user_by_customer(tx, customer_id).await? {
        cache.invalidate(user_id);
    }

    Ok(())
}
```

### Background Grace Period Enforcer

```rust
/// Runs every 15 minutes. Finds subscriptions where grace_period_end has passed
/// and downgrades them to free.
pub async fn enforce_grace_periods(db: &PgPool, cache: &EntitlementCache) {
    let expired = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        SELECT s.id, s.user_id, s.stripe_subscription_id
        FROM subscriptions s
        WHERE s.status = 'past_due'
          AND s.grace_period_end IS NOT NULL
          AND s.grace_period_end < NOW()
        "#,
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    for (sub_id, user_id, stripe_sub_id) in expired {
        tracing::info!(
            user_id = %user_id,
            subscription_id = %sub_id,
            "Grace period expired — downgrading to free"
        );

        let mut tx = match db.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                tracing::error!(error = %e, "Failed to begin grace period tx");
                continue;
            }
        };

        // Downgrade
        if let Err(e) = downgrade_subscription(&mut tx, sub_id, user_id).await {
            tracing::error!(error = %e, user_id = %user_id, "Failed to downgrade");
            continue;
        }

        if let Err(e) = tx.commit().await {
            tracing::error!(error = %e, "Failed to commit grace period downgrade");
            continue;
        }

        cache.invalidate(user_id);
    }
}
```

---

## 12. Downgrade Behavior Without Data Loss

### Core Principle: **Never delete user data on downgrade.**

When a user downgrades from Plus/Pro to Free, their data is preserved but access is restricted.

### Downgrade Actions

```rust
async fn downgrade_subscription(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subscription_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    // 1. Update subscription to canceled/free
    sqlx::query(
        r#"
        UPDATE subscriptions SET
            status = 'canceled',
            canceled_at = NOW(),
            grace_period_end = NULL,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(subscription_id)
    .execute(&mut **tx)
    .await?;

    // 2. Archive excess habits (soft-disable, NOT delete)
    //    Free tier allows 3 habits. Keep the 3 with lowest sort_order.
    //    The rest get is_archived = true.
    sqlx::query(
        r#"
        UPDATE habits SET
            is_archived = true,
            updated_at = NOW()
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND is_archived = false
          AND id NOT IN (
              SELECT id FROM habits
              WHERE user_id = $1 AND deleted_at IS NULL AND is_archived = false
              ORDER BY sort_order ASC, created_at ASC
              LIMIT 3
          )
        "#,
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    // 3. Audit log
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, metadata) VALUES ($1, 'subscription_changed', $2)",
    )
    .bind(user_id)
    .bind(serde_json::json!({
        "event": "downgrade_to_free",
        "reason": "grace_period_expired",
    }))
    .execute(&mut **tx)
    .await?;

    Ok(())
}
```

### What Happens to Each Feature on Downgrade

| Feature | Downgrade Behavior |
|---|---|
| **Habits > 3** | Excess habits archived (`is_archived = true`). User sees "Upgrade to access N archived habits" in UI. Data preserved. |
| **weekly_days / weekly_target schedules** | Existing schedules preserved but habits with non-daily schedules are treated as daily until user upgrades. No data deleted. |
| **Calendar heatmap > 1 month** | Historical data preserved. API returns only 1 month. Full data accessible on re-upgrade. |
| **Analytics > 7 days** | Same — data preserved, API limits response window. |
| **AI insights** | Cached insights remain viewable. New generation blocked. |
| **CSV export** | Blocked at API level. Data still in DB. |
| **Premium themes** | Reverted to default theme. Theme preference saved for re-upgrade. |
| **Smart reminders** | Downgraded to basic reminders (1 per habit). Reminder configs preserved. |
| **Completions, mood logs, streaks** | **Never touched.** All historical data is fully preserved. |

### Re-Upgrade Behavior

When a user re-upgrades:
1. Archived habits are **automatically unarchived** (up to new tier limit).
2. All historical data immediately accessible at the new tier's limits.
3. Cached insights become viewable again.
4. Theme preference restored.

```rust
async fn restore_on_upgrade(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    new_tier: &SubscriptionTier,
) -> AppResult<()> {
    let max_habits = match new_tier {
        SubscriptionTier::Free => 3,
        SubscriptionTier::Plus => 15,
        SubscriptionTier::Pro => i32::MAX, // effectively unlimited
    };

    // Unarchive habits up to the new limit
    sqlx::query(
        r#"
        UPDATE habits SET
            is_archived = false,
            updated_at = NOW()
        WHERE user_id = $1
          AND is_archived = true
          AND deleted_at IS NULL
          AND id IN (
              SELECT id FROM habits
              WHERE user_id = $1 AND is_archived = true AND deleted_at IS NULL
              ORDER BY sort_order ASC, created_at ASC
              LIMIT $2
          )
        "#,
    )
    .bind(user_id)
    .bind(max_habits)
    .execute(&mut **tx)
    .await?;

    Ok(())
}
```

---

## 13. Entitlement Recompute & Cache

### In-Memory Cache

```rust
use dashmap::DashMap;
use std::time::{Duration, Instant};

pub struct EntitlementCache {
    /// user_id → (entitlements, cached_at)
    cache: DashMap<Uuid, (Entitlements, Instant)>,
    /// Cache TTL
    ttl: Duration,
}

impl EntitlementCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            cache: DashMap::new(),
            ttl,
        }
    }

    /// Get cached entitlements or compute from DB
    pub async fn get_or_compute(
        &self,
        db: &PgPool,
        user_id: Uuid,
    ) -> AppResult<Entitlements> {
        // Check cache
        if let Some(entry) = self.cache.get(&user_id) {
            let (entitlements, cached_at) = entry.value();
            if cached_at.elapsed() < self.ttl {
                return Ok(entitlements.clone());
            }
        }

        // Cache miss or expired — compute from DB
        let entitlements = compute_entitlements(db, user_id).await?;
        self.cache.insert(user_id, (entitlements.clone(), Instant::now()));
        Ok(entitlements)
    }

    /// Invalidate a user's cached entitlements (called after webhook processing)
    pub fn invalidate(&self, user_id: Uuid) {
        self.cache.remove(&user_id);
    }

    /// Periodic cleanup of expired entries
    pub fn cleanup(&self) {
        let now = Instant::now();
        self.cache.retain(|_, (_, cached_at)| {
            now.duration_since(*cached_at) < self.ttl * 2
        });
    }
}
```

### Compute from DB

```rust
/// Determine the user's effective tier, then load entitlements for that tier.
async fn compute_entitlements(db: &PgPool, user_id: Uuid) -> AppResult<Entitlements> {
    // 1. Find active subscription
    let sub = sqlx::query_as::<_, (SubscriptionTier, SubscriptionStatus)>(
        r#"
        SELECT tier, status FROM subscriptions
        WHERE user_id = $1
          AND status IN ('active', 'trialing', 'past_due')
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    let effective_tier = match sub {
        Some((tier, status)) => {
            match status {
                // Active and trialing get full tier access
                SubscriptionStatus::Active | SubscriptionStatus::Trialing => tier,
                // Past due gets full tier access (grace period)
                SubscriptionStatus::PastDue => tier,
                // Everything else → free
                _ => SubscriptionTier::Free,
            }
        }
        None => SubscriptionTier::Free,
    };

    // 2. Load entitlements from feature_entitlements table
    let rows = sqlx::query_as::<_, (String, Option<i32>, Option<bool>, Option<String>)>(
        "SELECT feature_key, value_int, value_bool, value_text FROM feature_entitlements WHERE tier = $1",
    )
    .bind(&effective_tier)
    .fetch_all(db)
    .await?;

    // 3. Build Entitlements struct from rows
    let mut ent = Entitlements::default_free();

    for (key, v_int, v_bool, v_text) in rows {
        match key.as_str() {
            "max_habits"           => ent.max_habits = v_int,
            "unlimited_habits"     => ent.unlimited_habits = v_bool.unwrap_or(false),
            "advanced_ai_insights" => ent.advanced_ai_insights = v_bool.unwrap_or(false),
            "per_habit_reminders"  => ent.per_habit_reminders = v_bool.unwrap_or(false),
            "csv_export"           => ent.csv_export = v_bool.unwrap_or(false),
            "challenges_access"    => ent.challenges_access = v_bool.unwrap_or(false),
            "premium_themes"       => ent.premium_themes = v_bool.unwrap_or(false),
            "smart_reminders"      => ent.smart_reminders = v_bool.unwrap_or(false),
            "analytics_days"       => ent.analytics_days = v_int.unwrap_or(7),
            "heatmap_months"       => ent.heatmap_months = v_int.unwrap_or(1),
            "ai_insights_per_week" => ent.ai_insights_per_week = v_int,
            "max_reminders"        => ent.max_reminders = v_int,
            "data_export"          => ent.data_export = v_bool.unwrap_or(false),
            "schedule_types"       => {
                ent.schedule_types = v_text
                    .unwrap_or_else(|| "daily".into())
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect();
            }
            _ => {} // Unknown feature key — ignore
        }
    }

    Ok(ent)
}
```

### Cache TTL

| Environment | TTL | Rationale |
|---|---|---|
| Production | 5 minutes | Balance between freshness and DB load |
| Development | 10 seconds | Fast iteration |

### When Cache Is Invalidated

1. After **every webhook event** that changes subscription state
2. After **checkout completion** (user returns to billing page)
3. After **manual admin action** (future)
4. On **cache TTL expiry** (automatic)

---

## 14. Out-of-Order & Duplicate Event Handling

### Problem

Stripe does not guarantee event delivery order. Example:

```
Time 1: subscription.updated (status=active, tier=pro)    → delivered at T+5
Time 2: subscription.updated (status=past_due)             → delivered at T+2
Time 3: invoice.payment_succeeded                          → delivered at T+8
```

If we process events in delivery order (T+2, T+5, T+8), we'd incorrectly set `past_due` after `active`.

### Solution: Event Timestamp Ordering

Every Stripe event has a `created` field (Unix timestamp). We compare this against the subscription's `updated_at` in our DB:

```rust
// In handle_subscription_upsert:
if let Some((last_updated,)) = existing {
    let event_ts = chrono::DateTime::from_timestamp(event.created, 0)
        .unwrap_or(chrono::Utc::now());
    if event_ts < last_updated {
        tracing::warn!("Skipping out-of-order event");
        return Ok(());
    }
}
```

### Duplicate Handling

Duplicates are caught by the `stripe_events` PK:

```sql
INSERT INTO stripe_events (event_id, event_type)
VALUES ($1, $2)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;
```

If `RETURNING` returns no rows → duplicate → return 200 immediately.

### Edge Cases

| Scenario | Behavior |
|---|---|
| Same event delivered twice | Second delivery returns 200 (dedup by event_id) |
| Older event arrives after newer | Skipped (event.created < subscription.updated_at) |
| checkout.session.completed + subscription.created arrive together | Both are idempotent upserts; second one is a no-op |
| payment_failed then payment_succeeded in quick succession | payment_succeeded clears grace period regardless of order |
| subscription.deleted arrives before payment_failed | Deleted takes precedence (terminal state) |
| Event processing fails mid-transaction | TX rolled back, event_id removed from stripe_events, Stripe retries |

---

## 15. Test Specifications

### Test 1: Duplicate Event Rejection

```rust
#[tokio::test]
async fn test_duplicate_webhook_event_is_idempotent() {
    // Setup: DB with user + subscription
    let (db, state) = setup_test_db().await;
    let event = make_stripe_event("evt_test_001", "customer.subscription.updated", json!({
        "id": "sub_123",
        "customer": "cus_123",
        "status": "active",
        "metadata": { "tier": "plus" },
        "current_period_end": future_timestamp(),
    }));

    // First delivery: should succeed
    let result1 = process_webhook(&state, &event).await;
    assert!(result1.is_ok());

    // Second delivery: should return Ok (duplicate, no-op)
    let result2 = process_webhook(&state, &event).await;
    assert!(result2.is_ok());

    // Verify subscription was only updated once
    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::Active);

    // Verify stripe_events has exactly one row
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stripe_events WHERE event_id = $1")
        .bind("evt_test_001")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
```

### Test 2: Out-of-Order Events

```rust
#[tokio::test]
async fn test_out_of_order_events_use_timestamp() {
    let (db, state) = setup_test_db().await;
    create_user_with_subscription(&db, "cus_123", "sub_123", "plus", "active").await;

    // Event 1: newer (active → past_due), delivered first
    let newer_event = make_stripe_event_with_ts(
        "evt_newer", "customer.subscription.updated",
        chrono::Utc::now().timestamp(),
        json!({ "id": "sub_123", "customer": "cus_123", "status": "past_due",
                "metadata": { "tier": "plus" } }),
    );
    process_webhook(&state, &newer_event).await.unwrap();

    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::PastDue);

    // Event 2: older (was active), delivered second — should be SKIPPED
    let older_event = make_stripe_event_with_ts(
        "evt_older", "customer.subscription.updated",
        (chrono::Utc::now() - chrono::Duration::minutes(5)).timestamp(),
        json!({ "id": "sub_123", "customer": "cus_123", "status": "active",
                "metadata": { "tier": "plus" } }),
    );
    process_webhook(&state, &older_event).await.unwrap();

    // Subscription should STILL be past_due (older event was skipped)
    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::PastDue);
}
```

### Test 3: Checkout → Subscription Created (Race)

```rust
#[tokio::test]
async fn test_checkout_and_subscription_created_race() {
    let (db, state) = setup_test_db().await;
    create_user_with_stripe_customer(&db, "cus_123").await;

    // Both events arrive for the same new subscription
    let checkout_event = make_stripe_event("evt_checkout", "checkout.session.completed", json!({
        "customer": "cus_123",
        "subscription": "sub_123",
        "metadata": { "tier": "plus" },
    }));

    let sub_created_event = make_stripe_event("evt_sub_created", "customer.subscription.created", json!({
        "id": "sub_123",
        "customer": "cus_123",
        "status": "active",
        "metadata": { "tier": "plus" },
        "current_period_end": future_timestamp(),
    }));

    // Process both (order shouldn't matter)
    process_webhook(&state, &checkout_event).await.unwrap();
    process_webhook(&state, &sub_created_event).await.unwrap();

    // Should have exactly one active subscription
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE stripe_customer_id = 'cus_123') AND status = 'active'"
    ).fetch_one(&db).await.unwrap();
    assert_eq!(count, 1);
}
```

### Test 4: Payment Failed → Grace → Payment Succeeded

```rust
#[tokio::test]
async fn test_grace_period_recovery() {
    let (db, state) = setup_test_db().await;
    create_user_with_subscription(&db, "cus_123", "sub_123", "plus", "active").await;

    // Payment fails → past_due with grace
    let fail_event = make_stripe_event("evt_fail", "invoice.payment_failed", json!({
        "customer": "cus_123",
        "subscription": "sub_123",
    }));
    process_webhook(&state, &fail_event).await.unwrap();

    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::PastDue);
    assert!(sub.grace_period_end.is_some());

    // Payment succeeds → back to active, grace cleared
    let success_event = make_stripe_event("evt_success", "invoice.payment_succeeded", json!({
        "customer": "cus_123",
        "subscription": "sub_123",
    }));
    process_webhook(&state, &success_event).await.unwrap();

    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert!(sub.grace_period_end.is_none());
}
```

### Test 5: Grace Period Expiry → Downgrade

```rust
#[tokio::test]
async fn test_grace_period_expiry_downgrades() {
    let (db, state) = setup_test_db().await;
    let user_id = create_user_with_subscription(&db, "cus_123", "sub_123", "plus", "past_due").await;

    // Set grace_period_end to the past
    sqlx::query("UPDATE subscriptions SET grace_period_end = NOW() - INTERVAL '1 hour' WHERE stripe_subscription_id = 'sub_123'")
        .execute(&db).await.unwrap();

    // Create 5 habits (exceeds free limit of 3)
    for i in 0..5 {
        create_habit(&db, user_id, &format!("Habit {}", i), i).await;
    }

    // Run grace period enforcer
    enforce_grace_periods(&db, &state.entitlement_cache).await;

    // Subscription should be canceled
    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.status, SubscriptionStatus::Canceled);

    // 3 habits should be active, 2 archived (NOT deleted)
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND deleted_at IS NULL AND is_archived = false"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(active, 3);

    let archived: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_archived = true"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(archived, 2);

    // Total habits still 5 (nothing deleted)
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM habits WHERE user_id = $1 AND deleted_at IS NULL"
    ).bind(user_id).fetch_one(&db).await.unwrap();
    assert_eq!(total, 5);
}
```

### Test 6: Webhook Signature Validation

```rust
#[tokio::test]
async fn test_webhook_signature_validation() {
    let secret = "whsec_test_secret";
    let payload = br#"{"id":"evt_123","type":"test"}"#;
    let timestamp = chrono::Utc::now().timestamp();

    // Compute valid signature
    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(payload));
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(signed_payload.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    let header = format!("t={},v1={}", timestamp, sig);

    // Valid signature should pass
    assert!(verify_stripe_signature(payload, &header, secret).is_ok());

    // Tampered payload should fail
    let tampered = br#"{"id":"evt_123","type":"tampered"}"#;
    assert!(verify_stripe_signature(tampered, &header, secret).is_err());

    // Wrong secret should fail
    assert!(verify_stripe_signature(payload, &header, "wrong_secret").is_err());

    // Old timestamp should fail (replay protection)
    let old_header = format!("t={},v1={}", timestamp - 600, sig);
    assert!(verify_stripe_signature(payload, &old_header, secret).is_err());
}
```

### Test 7: Plan Change (Plus → Pro)

```rust
#[tokio::test]
async fn test_plan_upgrade_plus_to_pro() {
    let (db, state) = setup_test_db().await;
    let user_id = create_user_with_subscription(&db, "cus_123", "sub_123", "plus", "active").await;

    // Subscription updated with new tier
    let event = make_stripe_event("evt_upgrade", "customer.subscription.updated", json!({
        "id": "sub_123",
        "customer": "cus_123",
        "status": "active",
        "metadata": { "tier": "pro" },
        "current_period_end": future_timestamp(),
    }));
    process_webhook(&state, &event).await.unwrap();

    let sub = get_subscription(&db, "sub_123").await;
    assert_eq!(sub.tier, SubscriptionTier::Pro);
    assert_eq!(sub.status, SubscriptionStatus::Active);

    // Entitlements should reflect Pro
    let ent = state.entitlement_cache.get_or_compute(&db, user_id).await.unwrap();
    assert!(ent.unlimited_habits);
    assert!(ent.csv_export);
    assert!(ent.challenges_access);
    assert!(ent.smart_reminders);
}
```

---

## 16. Gaps in Current Code

| # | File | Gap | Severity | Fix |
|---|---|---|---|---|
| 1 | `handlers/billing.rs` L148 | **Webhook signature NOT verified** — `TODO` comment, no HMAC check | **Critical** | Implement `verify_stripe_signature()` |
| 2 | `handlers/billing.rs` | Subscription state stored on `users` table, not `subscriptions` table | **High** | Migrate to use `subscriptions` table from migrations_v2 |
| 3 | `handlers/billing.rs` | No customer portal endpoint | **Medium** | Add `POST /api/subscription/portal` |
| 4 | `handlers/billing.rs` | `checkout.session.completed` determines tier from session metadata only — no fallback to price lookup | **Medium** | Add price→tier mapping as fallback |
| 5 | `handlers/billing.rs` | No grace period on payment failure — immediate status change | **High** | Add `grace_period_end` column, 7-day grace logic |
| 6 | `handlers/billing.rs` | No out-of-order event protection | **Medium** | Add event timestamp comparison |
| 7 | `handlers/billing.rs` | Dedup check uses `SELECT COUNT(*)` then separate `INSERT` — race condition | **Medium** | Use `INSERT ... ON CONFLICT ... RETURNING` in single query |
| 8 | `handlers/billing.rs` | No transaction wrapping for webhook processing | **High** | Wrap in `db.begin()` / `tx.commit()` |
| 9 | `handlers/billing.rs` | `reqwest::Client::new()` created per request — no connection pooling | **Low** | Store `reqwest::Client` in `AppState` |
| 10 | `handlers/billing.rs` | No entitlement cache invalidation after webhook | **Medium** | Add `EntitlementCache` to `AppState` |
| 11 | `handlers/billing.rs` | No `invoice.payment_failed` handler | **High** | Add handler with grace period logic |
| 12 | `handlers/billing.rs` | No downgrade logic (archiving excess habits) | **High** | Add `downgrade_to_free()` |
| 13 | `models/user.rs` | Entitlements hardcoded in Rust, not read from `feature_entitlements` table | **Medium** | Read from DB + cache |
| 14 | `config.rs` | No `STRIPE_PRICE_PLUS_MONTHLY` / `STRIPE_PRICE_PRO_MONTHLY` env vars | **Low** | Add to Config |

---

## 17. Implementation: Rust Code

### Complete Webhook Handler

```rust
use axum::{
    body::Bytes,
    extract::State,
    http::HeaderMap,
    Json,
};

pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<WebhookAckResponse>> {
    // 1. Verify signature
    let sig_header = headers
        .get("Stripe-Signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Validation("Missing Stripe-Signature header".into()))?;

    verify_stripe_signature(&body, sig_header, &state.config.stripe_webhook_secret)?;

    // 2. Parse event
    let event: StripeEvent = serde_json::from_slice(&body)
        .map_err(|e| AppError::Validation(format!("Invalid webhook payload: {}", e)))?;

    // 3. Idempotency check (insert-before-process)
    let is_new = sqlx::query_scalar::<_, Option<String>>(
        "INSERT INTO stripe_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
    )
    .bind(&event.id)
    .bind(&event.event_type)
    .fetch_optional(&state.db)
    .await?;

    if is_new.is_none() {
        tracing::debug!(event_id = %event.id, "Duplicate Stripe event, skipping");
        return Ok(Json(WebhookAckResponse { received: true, duplicate: true }));
    }

    // 4. Process event in transaction
    let result = process_webhook_event(&state.db, &event, &state.entitlement_cache).await;

    if let Err(ref e) = result {
        // Processing failed — remove event record so Stripe can retry
        tracing::error!(
            event_id = %event.id,
            event_type = %event.event_type,
            error = %e,
            "Webhook processing failed, allowing retry"
        );
        let _ = sqlx::query("DELETE FROM stripe_events WHERE event_id = $1")
            .bind(&event.id)
            .execute(&state.db)
            .await;
        return Err(AppError::Internal(anyhow::anyhow!("Webhook processing failed")));
    }

    tracing::info!(
        event_id = %event.id,
        event_type = %event.event_type,
        "Stripe webhook processed successfully"
    );

    Ok(Json(WebhookAckResponse { received: true, duplicate: false }))
}

#[derive(Debug, Deserialize)]
pub struct StripeEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub created: i64,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct WebhookAckResponse {
    pub received: bool,
    pub duplicate: bool,
}
```

### Stripe Client Helper

```rust
/// Reusable Stripe API client. Stored in AppState for connection pooling.
pub struct StripeClient {
    http: reqwest::Client,
    secret_key: String,
    base_url: String,
}

impl StripeClient {
    pub fn new(secret_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            secret_key,
            base_url: "https://api.stripe.com/v1".into(),
        }
    }

    async fn post_form<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> AppResult<T> {
        let resp = self.http
            .post(format!("{}{}", self.base_url, path))
            .header("Authorization", format!("Bearer {}", self.secret_key))
            .form(params)
            .send()
            .await
            .map_err(|e| AppError::Stripe(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(status = %status, body = %body, "Stripe API error");
            return Err(AppError::Stripe(format!("Stripe API {} error", status)));
        }

        resp.json::<T>().await
            .map_err(|e| AppError::Stripe(format!("Parse error: {}", e)))
    }

    pub async fn create_customer(
        &self,
        email: &str,
        name: &str,
        user_id: Uuid,
    ) -> AppResult<String> {
        let user_id_str = user_id.to_string();
        let resp: serde_json::Value = self.post_form("/customers", &[
            ("email", email),
            ("name", name),
            ("metadata[user_id]", &user_id_str),
        ]).await?;

        resp["id"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::Stripe("No customer ID in response".into()))
    }

    pub async fn create_checkout_session(
        &self,
        customer_id: &str,
        price_id: &str,
        tier: &str,
        user_id: Uuid,
        success_url: &str,
        cancel_url: &str,
    ) -> AppResult<String> {
        let user_id_str = user_id.to_string();
        let resp: serde_json::Value = self.post_form("/checkout/sessions", &[
            ("customer", customer_id),
            ("mode", "subscription"),
            ("line_items[0][price]", price_id),
            ("line_items[0][quantity]", "1"),
            ("metadata[user_id]", &user_id_str),
            ("metadata[tier]", tier),
            ("subscription_data[metadata][user_id]", &user_id_str),
            ("subscription_data[metadata][tier]", tier),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
            ("allow_promotion_codes", "true"),
        ]).await?;

        resp["url"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::Stripe("No checkout URL in response".into()))
    }

    pub async fn create_portal_session(
        &self,
        customer_id: &str,
        return_url: &str,
    ) -> AppResult<String> {
        let resp: serde_json::Value = self.post_form("/billing_portal/sessions", &[
            ("customer", customer_id),
            ("return_url", return_url),
        ]).await?;

        resp["url"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::Stripe("No portal URL in response".into()))
    }
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
}
```

### Background Jobs Setup

```rust
// In main.rs, after AppState creation:

let db_clone = state.db.clone();
let cache_clone = state.entitlement_cache.clone();

// Grace period enforcer: every 15 minutes
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(900));
    loop {
        interval.tick().await;
        enforce_grace_periods(&db_clone, &cache_clone).await;
    }
});

// Entitlement cache cleanup: every 30 minutes
let cache_cleanup = state.entitlement_cache.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(1800));
    loop {
        interval.tick().await;
        cache_cleanup.cleanup();
    }
});
```

### Helper: Find User by Stripe Customer

```rust
async fn find_user_by_customer(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    customer_id: &str,
) -> AppResult<Option<Uuid>> {
    let user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT s.user_id FROM subscriptions s
        WHERE s.stripe_customer_id = $1
        LIMIT 1
        "#,
    )
    .bind(customer_id)
    .fetch_optional(&mut **tx)
    .await?;

    // Fallback: check users table (legacy path)
    if user_id.is_some() {
        return Ok(user_id);
    }

    Ok(sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE stripe_customer_id = $1",
    )
    .bind(customer_id)
    .fetch_optional(&mut **tx)
    .await?)
}
```

---

*Document version: 1.0.0 — Generated for HabitArc backend*
*Last updated: 2026-02-10*
