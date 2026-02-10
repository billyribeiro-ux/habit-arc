# HabitArc Migration Set v2 — Production Schema

## Migration Strategy

These migrations replace the original `migrations/` directory with a properly
normalized, production-grade schema. They are designed to be run on a **fresh
database** (e.g., `sqlx database reset`).

### File Naming Convention

```
YYYYMMDDHHMMSS_<description>.sql          -- forward migration
YYYYMMDDHHMMSS_<description>.down.sql     -- rollback
```

SQLx uses the `.down.sql` suffix convention for reversible migrations when
running `sqlx migrate revert`.

### Ordering

```
001  enums + utility functions
002  users
003  habits + habit_schedules
004  habit_completions
005  mood_logs
006  insights
007  subscriptions + feature_entitlements + stripe_events
008  refresh_tokens
009  notification_jobs
010  audit_logs
011  seed data (dev only — guarded by DO $$ block)
```

### SQLx Compatibility Notes

See `SQLX_NOTES.md` in this directory for compile-time query considerations.

### Running

```bash
# Forward (apply all pending)
sqlx migrate run --source migrations_v2

# Revert last migration
sqlx migrate revert --source migrations_v2

# Reset (drop + recreate + migrate)
sqlx database reset --source migrations_v2
```
