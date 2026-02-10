# SQLx Compile-Time Query Compatibility Notes

> For HabitArc migration set v2 against Postgres 16 with `sqlx` 0.7.x

---

## 1. Custom Enum Types

### Problem
SQLx compile-time checking requires Rust types to map exactly to Postgres enum types.
Postgres enums are **case-sensitive** and **order-sensitive**.

### Mapping Rules

| Postgres Enum | Postgres Values | Rust Enum | Derive |
|---|---|---|---|
| `subscription_tier` | `free`, `plus`, `pro` | `SubscriptionTier` | `sqlx::Type` |
| `subscription_status` | `active`, `trialing`, `past_due`, `canceled`, `inactive` | `SubscriptionStatus` | `sqlx::Type` |
| `habit_frequency` | `daily`, `weekly_days`, `weekly_target` | `HabitFrequency` | `sqlx::Type` |
| `insight_source` | `claude`, `fallback` | `InsightSource` | `sqlx::Type` |
| `job_status` | `pending`, `running`, `completed`, `failed`, `dead_letter` | `JobStatus` | `sqlx::Type` |
| `notification_channel` | `web_push`, `email` | `NotificationChannel` | `sqlx::Type` |
| `audit_action` | `login`, `login_failed`, `register`, ... | `AuditAction` | `sqlx::Type` |

### Rust Pattern

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "habit_frequency", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum HabitFrequency {
    Daily,
    #[sqlx(rename = "weekly_days")]
    #[serde(rename = "weekly_days")]
    WeeklyDays,
    #[sqlx(rename = "weekly_target")]
    #[serde(rename = "weekly_target")]
    WeeklyTarget,
}
```

**Critical:** The `#[sqlx(type_name = "...")]` must match the Postgres type name
exactly (lowercase). The `rename` attributes must match the Postgres enum values
exactly.

### Adding New Enum Values

Postgres supports `ALTER TYPE ... ADD VALUE` but **not** `DROP VALUE` or `RENAME VALUE`
in a transaction. When adding new enum values:

```sql
-- This CANNOT be inside a transaction block
ALTER TYPE audit_action ADD VALUE 'mfa_enabled';
```

SQLx migrations run each file in a transaction by default. To add enum values,
you must use the `-- no-transaction` comment at the top of the migration file:

```sql
-- no-transaction
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'mfa_enabled';
```

---

## 2. UUID Columns

All `UUID` columns use `gen_random_uuid()` (Postgres 16 built-in, no extension needed).

**Rust mapping:** `uuid::Uuid` with feature `sqlx` enabled in `Cargo.toml`:
```toml
uuid = { version = "1", features = ["v4", "serde"] }
sqlx = { version = "0.7", features = ["uuid"] }
```

---

## 3. TIMESTAMPTZ vs NaiveDate

### TIMESTAMPTZ columns → `DateTime<Utc>`

```rust
use chrono::{DateTime, Utc};

pub struct User {
    pub created_at: DateTime<Utc>,  // maps to TIMESTAMPTZ
}
```

### DATE columns → `NaiveDate`

```rust
use chrono::NaiveDate;

pub struct HabitCompletion {
    pub local_date_bucket: NaiveDate,  // maps to DATE
}
```

**Critical:** Never use `DateTime<Utc>` for `DATE` columns or vice versa.
SQLx will give a compile-time error if the types don't match.

### Required Cargo.toml features

```toml
chrono = { version = "0.4", features = ["serde"] }
sqlx = { version = "0.7", features = ["chrono"] }
```

---

## 4. JSONB Columns

JSONB columns map to `serde_json::Value` in Rust:

```rust
pub struct Insight {
    pub wins: serde_json::Value,          // JSONB
    pub improvements: serde_json::Value,  // JSONB
}
```

For `sqlx::query_as!` with JSONB, you must cast in the SQL:

```rust
sqlx::query_as!(
    Insight,
    r#"SELECT wins as "wins: serde_json::Value" FROM insights WHERE id = $1"#,
    id
)
```

Or use `sqlx::types::Json<T>` for typed JSONB:

```rust
use sqlx::types::Json;

pub struct NotificationJob {
    pub payload: Json<serde_json::Value>,
}
```

**Note:** The `Json<T>` wrapper adds `"` escaping in serde serialization.
For API responses, prefer extracting the inner value:
```rust
let payload = job.payload.0; // unwrap Json wrapper
```

---

## 5. INET Columns

The `audit_logs.ip_address` column uses Postgres `INET` type.

**Rust mapping options:**

Option A — Use `String` and cast in SQL:
```rust
pub struct AuditLog {
    pub ip_address: Option<String>,
}

// In query:
sqlx::query!(
    "INSERT INTO audit_logs (ip_address) VALUES ($1::INET)",
    ip_str
)
```

Option B — Use `ipnetwork::IpNetwork`:
```toml
# Cargo.toml
ipnetwork = "0.20"
sqlx = { version = "0.7", features = ["ipnetwork"] }
```
```rust
use ipnetwork::IpNetwork;

pub struct AuditLog {
    pub ip_address: Option<IpNetwork>,
}
```

**Recommendation:** Option A is simpler for this use case since we only store
single addresses, not subnets.

---

## 6. SMALLINT Columns

Postgres `SMALLINT` maps to Rust `i16`:

```rust
pub struct HabitSchedule {
    pub day_of_week: Option<i16>,     // SMALLINT, nullable
    pub times_per_week: Option<i16>,  // SMALLINT, nullable
}

pub struct MoodLog {
    pub mood: Option<i16>,    // SMALLINT, nullable
    pub energy: Option<i16>,  // SMALLINT, nullable
    pub stress: Option<i16>,  // SMALLINT, nullable
}
```

**Warning:** If your existing Rust models use `i32` for these fields, you must
change them to `i16` or SQLx compile-time checking will fail.

---

## 7. Nullable Columns and `Option<T>`

SQLx enforces nullability at compile time:

| SQL Column | Rust Type |
|---|---|
| `TEXT NOT NULL` | `String` |
| `TEXT` (nullable) | `Option<String>` |
| `UUID NOT NULL` | `Uuid` |
| `UUID` (nullable) | `Option<Uuid>` |

**Common mistake:** Forgetting to make a Rust field `Option<T>` when the column
is nullable. SQLx will give a compile-time error.

---

## 8. Partial Unique Indexes and ON CONFLICT

The `habit_completions` table has:
```sql
CONSTRAINT uq_completion_habit_date UNIQUE (habit_id, local_date_bucket)
```

For `ON CONFLICT` to work with SQLx, reference the constraint by column list:

```rust
sqlx::query!(
    r#"
    INSERT INTO habit_completions (habit_id, user_id, local_date_bucket, value)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (habit_id, local_date_bucket) DO UPDATE
        SET value = habit_completions.value
    RETURNING id
    "#,
    habit_id, user_id, date, value
)
```

**Do NOT** use `ON CONFLICT ON CONSTRAINT uq_completion_habit_date` — while
valid Postgres, SQLx's compile-time checker sometimes has issues resolving
named constraints. Column-list form is always safe.

---

## 9. Soft Delete Pattern

The `habits` table uses `deleted_at TIMESTAMPTZ` for soft delete.

**Every query that reads habits must include:**
```sql
WHERE deleted_at IS NULL
```

**SQLx model pattern:**
```rust
pub struct Habit {
    pub deleted_at: Option<DateTime<Utc>>,  // NULL = active, Some = soft-deleted
}
```

**Soft delete operation:**
```rust
sqlx::query!(
    "UPDATE habits SET deleted_at = NOW() WHERE id = $1 AND user_id = $2",
    habit_id, user_id
)
```

**Hard delete (for GDPR account deletion):**
```rust
sqlx::query!("DELETE FROM habits WHERE user_id = $1", user_id)
```

---

## 10. `query!` vs `query_as!` vs `query_scalar!`

| Macro | Use When |
|---|---|
| `query!` | You want an anonymous struct (quick one-off queries) |
| `query_as!` | You want to map to a named struct (most handlers) |
| `query_scalar!` | You want a single scalar value (COUNT, EXISTS) |

**Example — `query_as!` with type override:**
```rust
let habits = sqlx::query_as!(
    HabitRow,
    r#"
    SELECT
        id,
        name,
        frequency as "frequency: HabitFrequency",
        deleted_at as "deleted_at: Option<DateTime<Utc>>"
    FROM habits
    WHERE user_id = $1 AND deleted_at IS NULL
    "#,
    user_id
)
.fetch_all(&pool)
.await?;
```

The `"column: Type"` syntax is required when SQLx can't infer the Rust type
from the Postgres type (custom enums, Option wrappers, etc.).

---

## 11. Migration Source Configuration

To use the new `migrations_v2/` directory instead of the default `migrations/`:

### In `main.rs`:
```rust
sqlx::migrate!("./migrations_v2")
    .run(&db)
    .await
    .expect("Failed to run database migrations");
```

### In `.env` (for `sqlx` CLI):
```
DATABASE_URL=postgres://user:pass@localhost/habitarc_dev
```

### CLI commands:
```bash
# Use --source to point to the new directory
sqlx migrate run --source migrations_v2
sqlx migrate revert --source migrations_v2
sqlx migrate info --source migrations_v2

# Prepare offline query data (for CI without a live DB)
cargo sqlx prepare --workspace
```

---

## 12. Offline Mode (`sqlx-data.json`)

For CI/CD where a live database isn't available:

```bash
# Generate the offline query cache
cargo sqlx prepare --workspace

# This creates .sqlx/ directory with query metadata
# Commit this directory to git
```

In `Cargo.toml`, ensure the `offline` feature is available:
```toml
sqlx = { version = "0.7", features = ["offline", ...] }
```

Set the environment variable in CI:
```bash
SQLX_OFFLINE=true cargo build
```

---

## 13. Breaking Changes from v1 Schema

| v1 Column/Table | v2 Equivalent | Migration Impact |
|---|---|---|
| `completions` | `habit_completions` | Table renamed; all queries must update |
| `completions.completed_date` | `habit_completions.local_date_bucket` | Column renamed |
| `daily_logs` | `mood_logs` | Table renamed |
| `daily_logs.log_date` | `mood_logs.local_date_bucket` | Column renamed |
| `weekly_insights` | `insights` | Table renamed |
| `weekly_insights.iso_year/iso_week` | `insights.week_start_date` | Changed from year+week to DATE |
| `habits.frequency_config` (JSONB) | `habit_schedules` table | Normalized into relational table |
| `habits.is_archived` | `habits.deleted_at` | Changed from boolean to soft-delete timestamp |
| `users.subscription_tier` | `subscriptions.tier` | Moved to dedicated table |
| `users.subscription_status` | `subscriptions.status` | Moved to dedicated table |
| `users.stripe_customer_id` | `subscriptions.stripe_customer_id` | Moved to dedicated table |
| `users.password_hash` NOT NULL | `users.password_hash` nullable | Guests have no password |
| `refresh_tokens.revoked` bool only | `refresh_tokens.revoked` + `revoked_at` | Added timestamp |
| N/A | `habit_schedules` | New table |
| N/A | `feature_entitlements` | New table |
| N/A | `notification_jobs` | New table |
| N/A | `audit_logs` | New table |
| N/A | `stripe_events` | New table (existed in v1 migration 002) |

### Rust Model Updates Required

Every `#[derive(FromRow)]` struct must be updated to match the new column names
and types. The compiler will catch all mismatches at build time — this is the
primary advantage of SQLx compile-time checking.
