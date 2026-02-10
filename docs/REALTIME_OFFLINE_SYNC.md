# HabitArc — Real-Time & Offline Sync Engineering

> Principal Distributed Systems Engineer specification.
> WebSocket per-user channels · Offline IndexedDB queue · Ordered replay
> Conflict resolution · Canonical state reconciliation · UX rules

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [WebSocket Architecture](#2-websocket-architecture)
3. [Event Schema](#3-event-schema)
4. [Server-Side Broadcast](#4-server-side-broadcast)
5. [Client-Side Event Handling](#5-client-side-event-handling)
6. [Offline Queue Schema](#6-offline-queue-schema)
7. [Offline Enqueue Behavior](#7-offline-enqueue-behavior)
8. [Replay Algorithm](#8-replay-algorithm)
9. [Canonical State Reconciliation](#9-canonical-state-reconciliation)
10. [Conflict Policy](#10-conflict-policy)
11. [Conflict Handling UX Rules](#11-conflict-handling-ux-rules)
12. [Connection Lifecycle](#12-connection-lifecycle)
13. [Gaps in Current Code](#13-gaps-in-current-code)
14. [Implementation: Backend (Rust)](#14-implementation-backend-rust)
15. [Implementation: Frontend (TypeScript)](#15-implementation-frontend-typescript)

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌─────────────┐         ┌──────────────┐         ┌─────────────┐       │
│  │  BROWSER A   │◄───WS──►│  AXUM SERVER │◄───WS──►│  BROWSER B   │      │
│  │  (Phone)     │         │              │         │  (Desktop)   │      │
│  └──────┬──────┘         │  ┌────────┐  │         └──────┬──────┘       │
│         │                │  │ Per-   │  │                │              │
│         │                │  │ User   │  │                │              │
│         │                │  │ Channel│  │                │              │
│         │                │  │ Map    │  │                │              │
│         │                │  └────────┘  │                │              │
│         │                └──────┬───────┘                │              │
│         │                       │                        │              │
│         │                ┌──────▼───────┐                │              │
│         │                │  PostgreSQL   │                │              │
│         │                │  (canonical)  │                │              │
│         │                └──────────────┘                │              │
│         │                                                │              │
│  ┌──────▼──────┐                                  ┌──────▼──────┐       │
│  │  IndexedDB   │                                  │  IndexedDB   │      │
│  │  (offline    │                                  │  (offline    │      │
│  │   queue)     │                                  │   queue)     │      │
│  └─────────────┘                                  └─────────────┘       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core Invariants

1. **PostgreSQL is the single source of truth.** Client state is always a projection of server state.
2. **Optimistic UI is a local illusion.** The client may show a toggled completion before the server confirms, but the server's response is canonical.
3. **Offline actions are best-effort.** They are replayed in order on reconnect, but the server may reject any of them. The client must reconcile.
4. **WebSocket events are notifications, not state transfers.** They tell the client "something changed" — the client then fetches fresh state via TanStack Query invalidation.
5. **Idempotency keys prevent duplicate side effects.** Every offline action carries a UUID that the server uses for deduplication.

---

## 2. WebSocket Architecture

### Connection Model: Per-User Channels

The current code uses a single `broadcast::channel` that sends every event to every connected client. This must change to **per-user channels** so users only receive their own events.

```
┌──────────────────────────────────────────────────────────────────┐
│                    SERVER STATE                                   │
│                                                                  │
│  AppState {                                                      │
│      user_channels: DashMap<Uuid, broadcast::Sender<WsEvent>>   │
│  }                                                               │
│                                                                  │
│  On WS connect:                                                  │
│    1. Authenticate via ?token= query param                       │
│    2. Look up or create channel for user_id                      │
│    3. Subscribe to that channel                                  │
│    4. Send queued events (if any)                                │
│                                                                  │
│  On WS disconnect:                                               │
│    1. Drop subscriber                                            │
│    2. If no subscribers left for user, keep channel alive        │
│       for 5 minutes (reconnect grace), then clean up             │
│                                                                  │
│  On mutation (e.g., toggle completion):                           │
│    1. Handler writes to DB                                       │
│    2. Handler sends event to user_channels[user_id]              │
│    3. All connected clients for that user receive the event      │
└──────────────────────────────────────────────────────────────────┘
```

### Authentication

WebSocket connections cannot carry custom headers. Auth is via query parameter:

```
wss://api.habitarc.com/ws?token=eyJhbGciOiJIUzI1NiJ9...
```

The server validates the JWT access token on upgrade. If invalid or expired → reject with 401 close code.

```rust
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<WsAuthParams>,
) -> Result<Response, AppError> {
    // Validate JWT
    let token_data = verify_token(&params.token, &state.config)
        .map_err(|_| AppError::Unauthorized)?;

    if token_data.claims.token_type != TokenType::Access {
        return Err(AppError::Unauthorized);
    }

    let user_id = token_data.claims.sub;

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user_id)))
}
```

---

## 3. Event Schema

### Wire Format

All WebSocket messages are JSON. Direction: **server → client only** (client sends nothing over WS; all mutations go through REST API).

### Base Envelope

```typescript
interface WsEvent {
  /** Unique event ID for deduplication on the client */
  id: string;
  /** Event type discriminator */
  type: WsEventType;
  /** User who triggered the event (always the connected user) */
  user_id: string;
  /** ISO 8601 timestamp of when the event occurred on the server */
  timestamp: string;
  /** Event-specific payload */
  payload: Record<string, unknown>;
}

type WsEventType =
  | "habit_completed"
  | "habit_uncompleted"
  | "streak_updated"
  | "habit_created"
  | "habit_updated"
  | "habit_deleted"
  | "review_ready"
  | "insight_ready"
  | "subscription_changed"
  | "sync_complete";
```

### Event Definitions

#### `habit_completed`

Fired when a completion is created (via toggle or direct create).

```json
{
  "id": "evt_01HZ...",
  "type": "habit_completed",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T12:34:56Z",
  "payload": {
    "habit_id": "660e8400-...",
    "habit_name": "Morning Meditation",
    "completion_id": "770e8400-...",
    "date": "2026-02-10",
    "value": 1,
    "current_streak": 15,
    "is_milestone": false
  }
}
```

#### `habit_uncompleted`

Fired when a completion is deleted (via toggle or direct delete).

```json
{
  "id": "evt_01HZ...",
  "type": "habit_uncompleted",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T12:35:00Z",
  "payload": {
    "habit_id": "660e8400-...",
    "habit_name": "Morning Meditation",
    "completion_id": "770e8400-...",
    "date": "2026-02-10",
    "current_streak": 14
  }
}
```

#### `streak_updated`

Fired when a streak crosses a milestone boundary (7, 14, 21, 30, 60, 90, 100, 365 days).

```json
{
  "id": "evt_01HZ...",
  "type": "streak_updated",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T12:34:56Z",
  "payload": {
    "habit_id": "660e8400-...",
    "habit_name": "Morning Meditation",
    "current_streak": 30,
    "longest_streak": 30,
    "milestone": 30,
    "is_personal_best": true
  }
}
```

#### `habit_created` / `habit_updated` / `habit_deleted`

```json
{
  "id": "evt_01HZ...",
  "type": "habit_updated",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T12:40:00Z",
  "payload": {
    "habit_id": "660e8400-...",
    "change": "updated"
  }
}
```

#### `review_ready`

Fired when the weekly review data is available (Sunday night or Monday morning).

```json
{
  "id": "evt_01HZ...",
  "type": "review_ready",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T00:00:00Z",
  "payload": {
    "week_start": "2026-02-03",
    "week_end": "2026-02-09"
  }
}
```

#### `insight_ready`

Fired when a new AI insight has been generated and stored.

```json
{
  "id": "evt_01HZ...",
  "type": "insight_ready",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T23:15:00Z",
  "payload": {
    "insight_id": "880e8400-...",
    "week_start": "2026-02-03",
    "source": "claude"
  }
}
```

#### `subscription_changed`

Fired after a Stripe webhook updates the user's subscription.

```json
{
  "id": "evt_01HZ...",
  "type": "subscription_changed",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T14:00:00Z",
  "payload": {
    "old_tier": "free",
    "new_tier": "plus",
    "status": "active"
  }
}
```

#### `sync_complete`

Fired after the server finishes processing an offline queue replay batch. Tells the client to refresh all data.

```json
{
  "id": "evt_01HZ...",
  "type": "sync_complete",
  "user_id": "550e8400-...",
  "timestamp": "2026-02-10T12:36:00Z",
  "payload": {
    "actions_processed": 5,
    "actions_succeeded": 4,
    "actions_conflicted": 1,
    "conflicts": [
      {
        "action_id": "act_01HZ...",
        "idempotency_key": "idem_01HZ...",
        "error_code": "RESOURCE_GONE",
        "message": "Habit was deleted"
      }
    ]
  }
}
```

### Rust Event Struct

```rust
#[derive(Debug, Serialize, Clone)]
pub struct WsEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub user_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub payload: serde_json::Value,
}

impl WsEvent {
    pub fn new(event_type: &str, user_id: Uuid, payload: serde_json::Value) -> Self {
        Self {
            id: format!("evt_{}", Uuid::new_v4().simple()),
            event_type: event_type.into(),
            user_id,
            timestamp: Utc::now(),
            payload,
        }
    }
}
```

---

## 4. Server-Side Broadcast

### Per-User Channel Map

```rust
use dashmap::DashMap;
use tokio::sync::broadcast;
use std::sync::Arc;

/// Manages per-user WebSocket channels.
pub struct UserChannels {
    channels: DashMap<Uuid, broadcast::Sender<String>>,
    channel_capacity: usize,
}

impl UserChannels {
    pub fn new(capacity: usize) -> Self {
        Self {
            channels: DashMap::new(),
            channel_capacity: capacity,
        }
    }

    /// Get or create a broadcast channel for a user.
    pub fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<String> {
        let entry = self.channels
            .entry(user_id)
            .or_insert_with(|| {
                let (tx, _) = broadcast::channel(self.channel_capacity);
                tx
            });
        entry.value().subscribe()
    }

    /// Send an event to all connected clients for a user.
    /// Returns Ok(receiver_count) or Err if no subscribers.
    pub fn send(&self, user_id: Uuid, event: &WsEvent) -> Result<usize, ()> {
        if let Some(tx) = self.channels.get(&user_id) {
            let json = serde_json::to_string(event).unwrap_or_default();
            tx.send(json).map_err(|_| ())
        } else {
            Err(()) // No channel for this user (not connected)
        }
    }

    /// Send an event to a user. If they're not connected, the event is silently dropped.
    /// This is fire-and-forget — WebSocket events are notifications, not guarantees.
    pub fn notify(&self, user_id: Uuid, event: WsEvent) {
        let _ = self.send(user_id, &event);
    }

    /// Clean up channels with no active subscribers.
    pub fn cleanup(&self) {
        self.channels.retain(|_, tx| tx.receiver_count() > 0);
    }
}
```

### Updated AppState

```rust
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub user_channels: Arc<UserChannels>,
    // ... other fields
}
```

### Emitting Events from Handlers

```rust
// In toggle_completion handler, after DB write:
let event_type = if action == "created" { "habit_completed" } else { "habit_uncompleted" };

state.user_channels.notify(auth_user.id, WsEvent::new(
    event_type,
    auth_user.id,
    json!({
        "habit_id": body.habit_id,
        "habit_name": habit.name,
        "completion_id": completion_id,
        "date": completed_date.to_string(),
        "current_streak": updated_streak,
    }),
));

// Check for streak milestone
const MILESTONES: &[i32] = &[7, 14, 21, 30, 60, 90, 100, 365];
if MILESTONES.contains(&updated_streak) {
    state.user_channels.notify(auth_user.id, WsEvent::new(
        "streak_updated",
        auth_user.id,
        json!({
            "habit_id": body.habit_id,
            "habit_name": habit.name,
            "current_streak": updated_streak,
            "longest_streak": updated_longest,
            "milestone": updated_streak,
            "is_personal_best": updated_streak == updated_longest,
        }),
    ));
}
```

---

## 5. Client-Side Event Handling

### Event → Query Invalidation Map

| Event Type | TanStack Query Keys Invalidated | Additional Action |
|---|---|---|
| `habit_completed` | `habits.today`, `habits.stats(habit_id)`, `habits.calendar(habit_id)` | Trigger `CelebrationAnimation` if milestone |
| `habit_uncompleted` | `habits.today`, `habits.stats(habit_id)`, `habits.calendar(habit_id)` | — |
| `streak_updated` | `habits.today`, `habits.stats(habit_id)` | Trigger `CelebrationAnimation` type=streak |
| `habit_created` | `habits.all`, `habits.today` | — |
| `habit_updated` | `habits.all`, `habits.today`, `habits.detail(habit_id)` | — |
| `habit_deleted` | `habits.all`, `habits.today` | Close edit sheet if open for this habit |
| `review_ready` | `reviews.weekly` | Show notification badge on Review tab |
| `insight_ready` | `insights.latest` | Show notification badge on Insights tab |
| `subscription_changed` | `billing.status`, `auth.me` | Refresh entitlements, close paywall if open |
| `sync_complete` | **All queries** (global invalidation) | Show sync result toast |

### Client Event Deduplication

The client maintains a small LRU set of recently seen event IDs to prevent processing the same event twice (e.g., if the server retransmits on reconnect):

```typescript
const SEEN_EVENTS_MAX = 100;
const seenEvents = new Set<string>();

function handleWsMessage(event: WsEvent) {
  if (seenEvents.has(event.id)) return; // deduplicate
  seenEvents.add(event.id);
  if (seenEvents.size > SEEN_EVENTS_MAX) {
    const first = seenEvents.values().next().value;
    seenEvents.delete(first);
  }
  // ... process event
}
```

---

## 6. Offline Queue Schema

### IndexedDB Store

```
Database: habitarc-offline
Version: 1

Object Store: action-queue
  keyPath: id
  Indexes:
    - createdAt (non-unique, ordered)
```

### Action Record

```typescript
interface OfflineAction {
  /** Unique action ID (UUID v4, generated client-side) */
  id: string;

  /** Idempotency key sent as header to the server */
  idempotencyKey: string;

  /** REST endpoint to call on replay */
  endpoint: string;

  /** HTTP method */
  method: "POST" | "PUT" | "DELETE";

  /** Request body (JSON-serializable) */
  body?: unknown;

  /** Client-local timestamp when the action was created (ms since epoch) */
  createdAt: number;

  /** The date the user intended this action for (YYYY-MM-DD in user TZ) */
  localDate: string;

  /** Number of replay attempts so far */
  retryCount: number;

  /** Last error message if replay failed */
  lastError?: string;

  /** Action-specific metadata for UI reconciliation */
  meta: {
    /** What type of action this is */
    actionType: "toggle_completion" | "create_habit" | "update_habit" | "delete_habit" | "upsert_mood";
    /** Habit ID (for completion toggles) */
    habitId?: string;
    /** Habit name (for conflict UX messages) */
    habitName?: string;
    /** The optimistic state change applied locally */
    optimisticChange?: "completed" | "uncompleted";
  };
}
```

### Why IndexedDB, Not localStorage

| Concern | localStorage | IndexedDB |
|---|---|---|
| Storage limit | ~5 MB | ~50+ MB |
| Structured data | JSON string only | Native objects |
| Indexing | None | Indexed queries |
| Transactions | None | ACID transactions |
| Concurrent access | Race conditions | Transaction isolation |
| Service worker access | No | Yes |

---

## 7. Offline Enqueue Behavior

### When Does Enqueue Happen?

```
User taps "complete" on a habit
  │
  ├── navigator.onLine === true?
  │     │
  │     ├── YES → Normal API call (POST /api/completions/toggle)
  │     │         └── On network error (fetch throws) → Enqueue + optimistic UI
  │     │
  │     └── NO → Enqueue immediately + optimistic UI
  │
  └── In both cases: Apply optimistic update to TanStack Query cache
```

### Enqueue Implementation

```typescript
async function enqueueOfflineAction(action: Omit<OfflineAction, "id" | "createdAt" | "retryCount">) {
  const record: OfflineAction = {
    ...action,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    retryCount: 0,
  };

  // 1. Write to IndexedDB
  await offlineDB.enqueue(record);

  // 2. Update queue size in Zustand store
  const count = await offlineDB.count();
  useOfflineStore.getState().setQueueSize(count);

  return record;
}
```

### Toggle Completion (Offline-Aware)

```typescript
export function useToggleCompletion() {
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);

  return useMutation({
    mutationFn: async ({ habitId, habitName, date }: ToggleParams) => {
      const localDate = date ?? todayInUserTimezone();

      if (!isOnline) {
        await enqueueOfflineAction({
          idempotencyKey: crypto.randomUUID(),
          endpoint: "/api/completions/toggle",
          method: "POST",
          body: { habit_id: habitId, completed_date: localDate },
          localDate,
          meta: {
            actionType: "toggle_completion",
            habitId,
            habitName,
            optimisticChange: undefined, // determined in onMutate
          },
        });
        return null; // optimistic only, no server response
      }

      return api.habits.toggle(habitId, { date: localDate });
    },

    onMutate: async ({ habitId }) => {
      // Cancel in-flight queries
      await qc.cancelQueries({ queryKey: queryKeys.habits.today });
      const previous = qc.getQueryData<HabitTodayResponse[]>(queryKeys.habits.today);

      if (previous) {
        qc.setQueryData<HabitTodayResponse[]>(
          queryKeys.habits.today,
          previous.map((h) =>
            h.id === habitId
              ? {
                  ...h,
                  completed_today: h.is_complete
                    ? Math.max(0, h.completed_today - 1)
                    : h.completed_today + 1,
                  is_complete: !h.is_complete,
                  current_streak: h.is_complete
                    ? Math.max(0, h.current_streak - 1)
                    : h.current_streak + 1,
                }
              : h,
          ),
        );
      }

      return { previous };
    },

    onError: (_err, _vars, context) => {
      // Rollback optimistic update
      if (context?.previous) {
        qc.setQueryData(queryKeys.habits.today, context.previous);
      }
    },

    onSettled: () => {
      // Only refetch if online (offline stays optimistic)
      if (isOnline) {
        qc.invalidateQueries({ queryKey: queryKeys.habits.today });
      }
    },
  });
}
```

---

## 8. Replay Algorithm

### Trigger: Online Transition

```
navigator fires "online" event
  │
  ├── 1. Set isOnline = true in Zustand store
  │
  ├── 2. Wait 1 second (debounce — avoid flapping)
  │
  ├── 3. Verify connectivity: HEAD /health
  │       └── If fails → stay in offline mode, retry in 5s
  │
  ├── 4. Read all actions from IndexedDB, ordered by createdAt ASC (FIFO)
  │
  ├── 5. Replay each action sequentially (NOT in parallel)
  │       │
  │       ├── For each action:
  │       │   ├── Send HTTP request with Idempotency-Key header
  │       │   ├── On 2xx → Remove from IndexedDB ✓
  │       │   ├── On 409 Conflict → Remove from IndexedDB ✓ (server state wins)
  │       │   ├── On 404 Not Found → Remove from IndexedDB ✓ (resource gone)
  │       │   ├── On 422 Validation → Remove from IndexedDB ✓ (won't succeed on retry)
  │       │   ├── On 401 Unauthorized → Stop replay, refresh token, restart
  │       │   ├── On 429 Rate Limited → Pause, wait Retry-After, resume
  │       │   └── On 5xx Server Error → Keep in IndexedDB, stop replay, retry later
  │       │
  │       └── Collect results: { succeeded, conflicted, failed, conflicts[] }
  │
  ├── 6. After replay: Invalidate ALL TanStack Query caches
  │       └── This fetches canonical state from server
  │
  ├── 7. Show sync result to user (toast or banner)
  │
  └── 8. Update queue size in Zustand store
```

### Replay Implementation

```typescript
interface ReplayResult {
  total: number;
  succeeded: number;
  conflicted: number;
  failed: number;
  conflicts: ConflictInfo[];
}

interface ConflictInfo {
  actionId: string;
  habitName?: string;
  errorCode: string;
  message: string;
}

async function replayOfflineQueue(): Promise<ReplayResult> {
  const actions = await offlineDB.getAll(); // ordered by createdAt ASC
  if (actions.length === 0) return { total: 0, succeeded: 0, conflicted: 0, failed: 0, conflicts: [] };

  const result: ReplayResult = {
    total: actions.length,
    succeeded: 0,
    conflicted: 0,
    failed: 0,
    conflicts: [],
  };

  for (const action of actions) {
    try {
      await api.client.request(action.endpoint, {
        method: action.method,
        body: action.body,
        idempotencyKey: action.idempotencyKey,
      });

      // Success — remove from queue
      await offlineDB.dequeue(action.id);
      result.succeeded++;

    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409 || error.status === 404 || error.status === 410) {
          // Conflict or gone — server state wins, remove from queue
          await offlineDB.dequeue(action.id);
          result.conflicted++;
          result.conflicts.push({
            actionId: action.id,
            habitName: action.meta.habitName,
            errorCode: error.code,
            message: conflictMessage(error, action),
          });

        } else if (error.status === 422) {
          // Validation error (e.g., date out of range) — remove, won't succeed
          await offlineDB.dequeue(action.id);
          result.conflicted++;
          result.conflicts.push({
            actionId: action.id,
            habitName: action.meta.habitName,
            errorCode: error.code,
            message: conflictMessage(error, action),
          });

        } else if (error.status === 401) {
          // Auth expired — stop replay, let token refresh happen, retry later
          break;

        } else if (error.status === 429) {
          // Rate limited — pause and retry
          const retryAfter = parseInt(error.details?.retry_after ?? "5", 10);
          await sleep(retryAfter * 1000);
          // Don't remove — will be retried on next drain

        } else if (error.status >= 500) {
          // Server error — stop replay, keep remaining actions
          result.failed++;
          break;

        } else {
          // Other 4xx — remove (won't succeed on retry)
          await offlineDB.dequeue(action.id);
          result.conflicted++;
        }
      } else {
        // Network error — stop replay
        result.failed++;
        break;
      }
    }
  }

  return result;
}
```

### Why Sequential, Not Parallel

Completion toggles are **order-dependent**. If a user toggled a habit on, then off, then on while offline, replaying in parallel could produce:

```
Parallel: toggle(on) + toggle(off) + toggle(on) → race condition → unpredictable state
Sequential: toggle(on) → toggle(off) → toggle(on) → correct final state: ON
```

The toggle endpoint is stateful (creates if missing, deletes if exists), so order matters.

---

## 9. Canonical State Reconciliation

### After Replay: Full Refresh

After the offline queue is drained, the client must fetch the server's canonical state and replace its local cache:

```typescript
async function reconcileAfterSync(qc: QueryClient) {
  // Invalidate everything — forces TanStack Query to refetch
  await qc.invalidateQueries();

  // The refetch will:
  // 1. GET /api/habits → canonical habit list with is_complete, streaks
  // 2. GET /api/habits/today → canonical today view
  // 3. Any other active queries will refetch on next access
}
```

### Why Not Merge?

We do **not** attempt to merge local optimistic state with server state. Reasons:

1. **The server is the source of truth.** Streaks, completion counts, and date bucketing are computed server-side.
2. **Merge is complex and error-prone.** Conflict resolution for toggles (which are idempotent but stateful) would require tracking the full toggle history.
3. **Full refresh is cheap.** The `/api/habits/today` endpoint returns ~1-2 KB. Refetching is faster than computing a merge.
4. **TanStack Query handles this natively.** `invalidateQueries()` triggers background refetches with stale-while-revalidate behavior.

### Reconciliation Sequence

```
Client                          Server                          UI
  │                               │                               │
  │  [comes back online]          │                               │
  │                               │                               │
  │  Replay action 1/5 ─────────►│                               │
  │  ◄── 200 OK                  │                               │
  │  Replay action 2/5 ─────────►│                               │
  │  ◄── 200 OK                  │                               │
  │  Replay action 3/5 ─────────►│                               │
  │  ◄── 404 (habit deleted)     │                               │
  │  Replay action 4/5 ─────────►│                               │
  │  ◄── 200 OK                  │                               │
  │  Replay action 5/5 ─────────►│                               │
  │  ◄── 422 (date out of range) │                               │
  │                               │                               │
  │  invalidateQueries() ────────►│                               │
  │                               │                               │
  │  GET /api/habits/today ──────►│                               │
  │  ◄── canonical state          │                               │
  │                               │                               │
  │  setQueryData(canonical) ─────────────────────────────────────► UI updates
  │                               │                               │
  │  Show toast: "Synced 5 actions. 2 had conflicts." ────────────► Toast
  │                               │                               │
```

---

## 10. Conflict Policy

### Conflict Scenarios

#### C-1: Habit Soft-Deleted While Offline Action Queued

```
Timeline:
  T1: User goes offline
  T2: User toggles "Exercise" complete (queued)
  T3: On another device, user deletes "Exercise"
  T4: User comes back online, queue replays

Server response: 404 Not Found (habit doesn't exist)
```

**Policy:** Remove action from queue. Show conflict toast. No data loss — the deletion was intentional on another device.

**Server behavior:** The toggle endpoint does `SELECT * FROM habits WHERE id = $1 AND user_id = $2`. If the habit is soft-deleted (`deleted_at IS NOT NULL`), it returns 404.

#### C-2: Duplicate Toggle (Idempotency)

```
Timeline:
  T1: User toggles "Meditation" complete (queued offline)
  T2: Network flickers — action partially sent
  T3: User comes online, queue replays the same action

Server response: Toggle is idempotent via Idempotency-Key header.
  - If the server already processed this key → return cached response (200)
  - If not → process normally
```

**Policy:** The `Idempotency-Key` header ensures the server processes each action exactly once. Duplicate replays are safe.

**Server implementation:**

```rust
// In toggle handler:
if let Some(key) = idempotency_key {
    // Check if we've already processed this key
    let cached = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2",
    )
    .bind(&key)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(cached_response) = cached {
        return Ok(Json(cached_response));
    }
}

// ... process toggle ...

// Store idempotency result
if let Some(key) = idempotency_key {
    sqlx::query(
        "INSERT INTO idempotency_keys (key, user_id, response_body, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING",
    )
    .bind(&key)
    .bind(auth_user.id)
    .bind(&result)
    .execute(&state.db)
    .await?;
}
```

#### C-3: Late Action Outside Local Day Bucket

```
Timeline:
  T1: 11:55 PM — User goes offline
  T2: 11:58 PM — User toggles "Reading" complete for today (Feb 10)
  T3: 12:30 AM (Feb 11) — User comes online, queue replays
  T4: Server receives toggle with completed_date = "2026-02-10"

Server validation: ±1 day from server-now. Feb 10 is within ±1 day of Feb 11. ✓ Accepted.
```

**Policy:** The ±1 day validation window is intentionally generous to handle this exact scenario. The `completed_date` in the queued action is the date the user intended, not the replay date.

**Edge case:** If the user was offline for >1 day:

```
Timeline:
  T1: Feb 9 — User goes offline
  T2: Feb 9 — User toggles "Reading" complete for Feb 9
  T3: Feb 11 — User comes online, queue replays
  T4: Server receives toggle with completed_date = "2026-02-09"

Server validation: Feb 9 is 2 days before Feb 11. ±1 day check FAILS.
Server response: 422 Validation Error
```

**Policy:** Remove action from queue. Show conflict toast: "A completion for Reading on Feb 9 couldn't be synced because it's too far in the past." This is a deliberate safety boundary — we don't allow backdating completions beyond ±1 day.

#### C-4: Concurrent Toggle from Two Devices

```
Timeline:
  T1: Device A toggles "Meditation" ON → server: created
  T2: Device B (offline) toggles "Meditation" ON → queued
  T3: Device B comes online, replays toggle

Server behavior: Toggle checks if completion exists.
  - Completion already exists (from Device A) → toggle DELETES it
  - This is WRONG — user intended to complete, not uncomplete
```

**Policy:** This is the fundamental problem with toggle-based APIs in offline scenarios. Mitigation:

1. **Offline actions use explicit `create` or `delete`, not `toggle`.** When the user taps "complete" offline, we queue a `POST /api/completions` (create), not a toggle. When they tap "uncomplete", we queue a `DELETE /api/completions/{id}`.

2. **The offline queue records the intended action** (`optimisticChange: "completed"` or `"uncompleted"`), not just "toggle."

3. **On replay, we check current server state first:**

```typescript
// Before replaying a completion action:
if (action.meta.actionType === "toggle_completion") {
  // Fetch current state
  const habits = await api.habits.today();
  const habit = habits.find(h => h.id === action.meta.habitId);

  if (habit) {
    const serverIsComplete = habit.is_complete;
    const intendedComplete = action.meta.optimisticChange === "completed";

    if (serverIsComplete === intendedComplete) {
      // Server already in desired state — skip this action
      await offlineDB.dequeue(action.id);
      continue;
    }
  }
}
```

#### C-5: Queue Contains Contradictory Actions

```
Timeline:
  T1: User toggles "Meditation" ON (queued)
  T2: User toggles "Meditation" OFF (queued)
  T3: User toggles "Meditation" ON (queued)
```

**Policy:** Before replay, **compact the queue** by collapsing contradictory actions for the same habit+date:

```typescript
function compactQueue(actions: OfflineAction[]): OfflineAction[] {
  // Group by (habitId, localDate)
  const groups = new Map<string, OfflineAction[]>();

  for (const action of actions) {
    if (action.meta.actionType === "toggle_completion" && action.meta.habitId) {
      const key = `${action.meta.habitId}:${action.localDate}`;
      const group = groups.get(key) ?? [];
      group.push(action);
      groups.set(key, group);
    }
  }

  const toRemove = new Set<string>();

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Keep only the LAST action for this habit+date
    // Remove all earlier ones
    for (let i = 0; i < group.length - 1; i++) {
      toRemove.add(group[i].id);
    }
  }

  return actions.filter(a => !toRemove.has(a.id));
}
```

---

## 11. Conflict Handling UX Rules

### Toast Messages

| Conflict | Toast Message | Severity | Auto-Dismiss |
|---|---|---|---|
| Habit deleted (404) | "**{habitName}** was deleted on another device. The offline completion was skipped." | Info | 5s |
| Date out of range (422) | "A completion for **{habitName}** on {date} couldn't be synced — it's too far in the past." | Warning | 8s |
| Duplicate (idempotency hit) | *(no toast — silently resolved)* | — | — |
| Server error (5xx) | "Some actions couldn't be synced. We'll try again automatically." | Warning | 5s |
| Auth expired (401) | *(handled by token refresh flow, no toast)* | — | — |
| Rate limited (429) | "Syncing paused — too many requests. Resuming shortly." | Info | 3s |

### Sync Banner States

The `OfflineSyncBanner` component shows different states:

```
┌─────────────────────────────────────────────────────────────┐
│ STATE: OFFLINE                                               │
│ "You're offline — {N} actions queued"                        │
│ [icon: wifi-off]  [color: amber]                             │
├─────────────────────────────────────────────────────────────┤
│ STATE: SYNCING                                               │
│ "Syncing {N} actions..."                                     │
│ [icon: spinner]  [color: blue]                               │
├─────────────────────────────────────────────────────────────┤
│ STATE: SYNC_SUCCESS                                          │
│ "All caught up!"                                             │
│ [icon: check]  [color: green]  [auto-dismiss: 3s]           │
├─────────────────────────────────────────────────────────────┤
│ STATE: SYNC_PARTIAL                                          │
│ "Synced {succeeded} actions. {conflicted} had conflicts."    │
│ [icon: alert-triangle]  [color: amber]  [auto-dismiss: 8s]  │
├─────────────────────────────────────────────────────────────┤
│ STATE: SYNC_FAILED                                           │
│ "Sync failed — tap to retry"                                 │
│ [icon: x-circle]  [color: red]  [action: retry button]      │
└─────────────────────────────────────────────────────────────┘
```

### Optimistic UI During Offline

While offline, the UI shows optimistic state:
- Toggled habits appear completed/uncompleted immediately
- Streak counts are locally incremented/decremented
- A small "offline" indicator appears in the header

**On reconciliation (after sync):**
- If the server state matches the optimistic state → no visual change
- If the server state differs → the UI snaps to server state. This may cause a brief visual "flicker" as a habit toggles back. This is acceptable and expected.

### No "Undo" for Synced Conflicts

Once an offline action is replayed and the server rejects it, the action is **permanently removed** from the queue. We do not offer an undo. Rationale:
- The server's rejection is authoritative (habit deleted, date invalid, etc.)
- Retrying would produce the same result
- The user is informed via toast

---

## 12. Connection Lifecycle

### Full Lifecycle Diagram

```
App Launch
  │
  ├── 1. Providers mount
  │     ├── fetchUser() → auth check
  │     ├── registerServiceWorker()
  │     └── Listen for online/offline events
  │
  ├── 2. (app)/layout.tsx mounts
  │     └── useWebSocket() called
  │           │
  │           ├── Read access_token from localStorage
  │           ├── Connect: wss://api.habitarc.com/ws?token=eyJ...
  │           │
  │           ├── onopen:
  │           │   ├── Reset reconnect backoff to 1s
  │           │   ├── If queue has items → trigger replay
  │           │   └── Log "WebSocket connected"
  │           │
  │           ├── onmessage:
  │           │   ├── Parse JSON → WsEvent
  │           │   ├── Deduplicate by event.id
  │           │   └── Dispatch to event handler (invalidate queries)
  │           │
  │           ├── onclose:
  │           │   ├── Log "WebSocket disconnected"
  │           │   ├── Schedule reconnect with exponential backoff
  │           │   │   (1s → 2s → 4s → 8s → 16s → 30s max)
  │           │   └── On reconnect → re-authenticate with fresh token
  │           │
  │           └── onerror:
  │               └── Close socket (triggers onclose → reconnect)
  │
  ├── 3. Online/Offline transitions
  │     │
  │     ├── "offline" event:
  │     │   ├── setOnline(false)
  │     │   ├── Show offline banner
  │     │   └── Mutations start enqueuing to IndexedDB
  │     │
  │     └── "online" event:
  │         ├── setOnline(true)
  │         ├── Wait 1s debounce
  │         ├── HEAD /health to verify
  │         ├── Replay offline queue
  │         ├── Reconcile (invalidateQueries)
  │         ├── Show sync result
  │         └── WebSocket will auto-reconnect via onclose handler
  │
  └── 4. App unmount / page navigation
        └── Close WebSocket cleanly
```

### Reconnect Backoff

```typescript
const MIN_RECONNECT_DELAY = 1000;   // 1s
const MAX_RECONNECT_DELAY = 30000;  // 30s
let reconnectDelay = MIN_RECONNECT_DELAY;

function scheduleReconnect() {
  setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// On successful connect:
reconnectDelay = MIN_RECONNECT_DELAY;
```

### Token Refresh on Reconnect

If the access token has expired while the socket was disconnected:

```typescript
async function connect() {
  let token = localStorage.getItem("access_token");

  // Check if token is expired (decode JWT, check exp)
  if (token && isTokenExpired(token)) {
    const refreshed = await api.client.refreshAccessToken();
    if (!refreshed) {
      // Session expired — redirect to login
      return;
    }
    token = localStorage.getItem("access_token");
  }

  if (!token) return;

  const ws = new WebSocket(`${WS_URL}?token=${token}`);
  // ... handlers
}
```

---

## 13. Gaps in Current Code

| # | File | Gap | Severity | Fix |
|---|---|---|---|---|
| 1 | `handlers/ws.rs` | **No auth on WS connect** — any client can connect | **Critical** | Add JWT validation from `?token=` query param |
| 2 | `handlers/ws.rs` | **Global broadcast** — all users see all events | **Critical** | Replace with per-user `UserChannels` map |
| 3 | `handlers/ws.rs` | No heartbeat/ping — stale connections not detected | **Medium** | Add periodic ping/pong (30s interval) |
| 4 | `handlers/completions.rs` | Broadcasts `completion_changed` — not `habit_completed`/`habit_uncompleted` | **Medium** | Split into distinct event types with payload |
| 5 | `handlers/completions.rs` | No streak milestone detection in broadcast | **Medium** | Check milestone array after streak update |
| 6 | `handlers/completions.rs` | No `Idempotency-Key` header support | **High** | Add idempotency_keys table + handler logic |
| 7 | `stores/offline-store.ts` | Uses **localStorage** for queue — not IndexedDB | **High** | Migrate to IndexedDB for reliability |
| 8 | `stores/offline-store.ts` | No `idempotencyKey` on queued actions | **High** | Add UUID idempotency key per action |
| 9 | `stores/offline-store.ts` | No `localDate` or `meta` on queued actions | **Medium** | Add action metadata for conflict UX |
| 10 | `hooks/use-websocket.ts` | No auth token on WS connect | **Critical** | Add `?token=` query param |
| 11 | `hooks/use-websocket.ts` | Fixed 3s reconnect — no exponential backoff | **Medium** | Implement backoff (1s → 30s max) |
| 12 | `hooks/use-websocket.ts` | No event deduplication | **Low** | Add LRU set of seen event IDs |
| 13 | `hooks/use-habits.ts` | `useToggleCompletion` doesn't enqueue offline | **High** | Add offline detection + enqueue path |
| 14 | Frontend | No `use-offline-sync.ts` hook for replay on reconnect | **High** | Implement replay algorithm |
| 15 | Frontend | No queue compaction before replay | **Medium** | Add `compactQueue()` for contradictory toggles |
| 16 | Frontend | No sync result toast/banner | **Medium** | Add `OfflineSyncBanner` component |
| 17 | Backend | No `idempotency_keys` table | **High** | Add migration |

---

## 14. Implementation: Backend (Rust)

### Idempotency Keys Migration

```sql
CREATE TABLE idempotency_keys (
    key         TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL,
    status_code SMALLINT NOT NULL,
    response_body JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (key, user_id)
);

-- Cleanup: purge keys older than 24 hours
CREATE INDEX idx_idempotency_keys_created
    ON idempotency_keys (created_at);
```

### Idempotency Middleware

```rust
use axum::http::header::HeaderMap;

/// Extract idempotency key from request headers.
pub fn extract_idempotency_key(headers: &HeaderMap) -> Option<String> {
    headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Check if an idempotency key has already been processed.
pub async fn check_idempotency(
    db: &PgPool,
    key: &str,
    user_id: Uuid,
) -> AppResult<Option<(i16, serde_json::Value)>> {
    let row = sqlx::query_as::<_, (i16, serde_json::Value)>(
        "SELECT status_code, response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2",
    )
    .bind(key)
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    Ok(row)
}

/// Store an idempotency result.
pub async fn store_idempotency(
    db: &PgPool,
    key: &str,
    user_id: Uuid,
    endpoint: &str,
    status_code: i16,
    response: &serde_json::Value,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO idempotency_keys (key, user_id, endpoint, status_code, response_body)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (key, user_id) DO NOTHING
        "#,
    )
    .bind(key)
    .bind(user_id)
    .bind(endpoint)
    .bind(status_code)
    .bind(response)
    .execute(db)
    .await?;

    Ok(())
}
```

### Updated WebSocket Handler

```rust
#[derive(Debug, Deserialize)]
pub struct WsAuthParams {
    pub token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<WsAuthParams>,
) -> Result<Response, AppError> {
    // 1. Validate JWT
    let token_data = verify_token(&params.token, &state.config)
        .map_err(|_| AppError::Unauthorized)?;

    if token_data.claims.token_type != TokenType::Access {
        return Err(AppError::Unauthorized);
    }

    let user_id = token_data.claims.sub;

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user_id)))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to user's channel
    let mut rx = state.user_channels.subscribe(user_id);

    tracing::info!(user_id = %user_id, "WebSocket client connected");

    // Forward user events to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages (ping/pong, future bidirectional features)
    let channels = state.user_channels.clone();
    let uid = user_id;
    let mut recv_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                msg = receiver.next() => {
                    match msg {
                        Some(Ok(Message::Ping(data))) => {
                            // Pong is handled automatically by axum
                            let _ = data;
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    // Server-initiated ping to detect dead connections
                    // (handled by axum's built-in ping/pong)
                }
            }
        }

        tracing::info!(user_id = %uid, "WebSocket client disconnected");
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}
```

### Idempotency Key Cleanup Job

```rust
/// Run hourly. Purges idempotency keys older than 24 hours.
pub async fn cleanup_idempotency_keys(db: &PgPool) {
    let result = sqlx::query(
        "DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'",
    )
    .execute(db)
    .await;

    match result {
        Ok(r) => tracing::info!(deleted = r.rows_affected(), "Cleaned up idempotency keys"),
        Err(e) => tracing::error!(error = %e, "Failed to clean up idempotency keys"),
    }
}
```

---

## 15. Implementation: Frontend (TypeScript)

### `lib/offline-db.ts` — IndexedDB Wrapper

```typescript
const DB_NAME = "habitarc-offline";
const DB_VERSION = 1;
const STORE_NAME = "action-queue";

class OfflineDB {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async enqueue(action: OfflineAction): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(action);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async dequeue(id: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAll(): Promise<OfflineAction[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("createdAt");
      const req = index.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async count(): Promise<number> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const offlineDB = new OfflineDB();
```

### `hooks/use-offline-sync.ts` — Replay Hook

```typescript
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOfflineStore } from "@/stores/offline-store";
import { offlineDB } from "@/lib/offline-db";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { toast } from "@/components/ui/toast";

export function useOfflineSync() {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const setQueueSize = useOfflineStore((s) => s.setQueueSize);
  const setSyncState = useOfflineStore((s) => s.setSyncState);
  const qc = useQueryClient();
  const isReplaying = useRef(false);

  useEffect(() => {
    if (!isOnline || isReplaying.current) return;

    const drain = async () => {
      // Debounce: wait 1s to avoid flapping
      await new Promise((r) => setTimeout(r, 1000));

      // Verify connectivity
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { method: "HEAD" });
      } catch {
        return; // Not actually online
      }

      const actions = await offlineDB.getAll();
      if (actions.length === 0) return;

      isReplaying.current = true;
      setSyncState("syncing");

      // Compact contradictory toggles
      const compacted = compactQueue(actions);

      // Remove compacted-out actions from IndexedDB
      const removedIds = new Set(actions.map(a => a.id));
      compacted.forEach(a => removedIds.delete(a.id));
      for (const id of removedIds) {
        await offlineDB.dequeue(id);
      }

      const result = await replayOfflineQueue(compacted);

      // Reconcile: fetch canonical state
      await qc.invalidateQueries();

      // Update store
      const remaining = await offlineDB.count();
      setQueueSize(remaining);

      // Show result
      if (result.conflicted > 0) {
        setSyncState("partial");
        for (const conflict of result.conflicts) {
          toast.warning(conflict.message, { duration: 8000 });
        }
      } else if (result.failed > 0) {
        setSyncState("failed");
        toast.error("Some actions couldn't be synced. We'll try again automatically.", { duration: 5000 });
      } else {
        setSyncState("success");
        if (result.succeeded > 0) {
          toast.success("All caught up!", { duration: 3000 });
        }
      }

      isReplaying.current = false;
    };

    drain();
  }, [isOnline, qc, setQueueSize, setSyncState]);
}

function compactQueue(actions: OfflineAction[]): OfflineAction[] {
  const groups = new Map<string, OfflineAction[]>();

  for (const action of actions) {
    if (action.meta.actionType === "toggle_completion" && action.meta.habitId) {
      const key = `${action.meta.habitId}:${action.localDate}`;
      const group = groups.get(key) ?? [];
      group.push(action);
      groups.set(key, group);
    }
  }

  const toRemove = new Set<string>();
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    for (let i = 0; i < group.length - 1; i++) {
      toRemove.add(group[i].id);
    }
  }

  return actions.filter((a) => !toRemove.has(a.id));
}

function conflictMessage(error: ApiError, action: OfflineAction): string {
  const name = action.meta.habitName ?? "A habit";
  switch (error.code) {
    case "RESOURCE_NOT_FOUND":
    case "RESOURCE_GONE":
      return `${name} was deleted on another device. The offline action was skipped.`;
    case "VALIDATION_DATE_RANGE":
      return `A completion for ${name} on ${action.localDate} couldn't be synced — it's too far in the past.`;
    case "RESOURCE_CONFLICT":
      return `${name} had a sync conflict that was automatically resolved.`;
    default:
      return `An offline action for ${name} couldn't be synced: ${error.message}`;
  }
}
```

### Updated `stores/offline-store.ts`

```typescript
import { create } from "zustand";

type SyncState = "idle" | "syncing" | "success" | "partial" | "failed";

interface OfflineState {
  isOnline: boolean;
  queueSize: number;
  syncState: SyncState;

  setOnline: (online: boolean) => void;
  setQueueSize: (size: number) => void;
  setSyncState: (state: SyncState) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  queueSize: 0,
  syncState: "idle",

  setOnline: (online) => set({ isOnline: online }),
  setQueueSize: (size) => set({ queueSize: size }),
  setSyncState: (state) => set({ syncState: state }),
}));
```

### Updated `hooks/use-websocket.ts`

```typescript
import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";
const MIN_RECONNECT = 1000;
const MAX_RECONNECT = 30000;
const SEEN_MAX = 100;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();
  const reconnectDelay = useRef(MIN_RECONNECT);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const seenEvents = useRef(new Set<string>());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.onopen = () => {
      reconnectDelay.current = MIN_RECONNECT;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Deduplicate
        if (data.id && seenEvents.current.has(data.id)) return;
        if (data.id) {
          seenEvents.current.add(data.id);
          if (seenEvents.current.size > SEEN_MAX) {
            const first = seenEvents.current.values().next().value;
            if (first) seenEvents.current.delete(first);
          }
        }

        // Dispatch by event type
        switch (data.type) {
          case "habit_completed":
          case "habit_uncompleted":
            qc.invalidateQueries({ queryKey: queryKeys.habits.today });
            if (data.payload?.habit_id) {
              qc.invalidateQueries({ queryKey: queryKeys.habits.stats(data.payload.habit_id) });
              qc.invalidateQueries({ queryKey: queryKeys.habits.calendar(data.payload.habit_id) });
            }
            break;
          case "streak_updated":
            qc.invalidateQueries({ queryKey: queryKeys.habits.today });
            break;
          case "habit_created":
          case "habit_updated":
          case "habit_deleted":
            qc.invalidateQueries({ queryKey: queryKeys.habits.all });
            qc.invalidateQueries({ queryKey: queryKeys.habits.today });
            break;
          case "review_ready":
            qc.invalidateQueries({ queryKey: queryKeys.reviews.weekly() });
            break;
          case "insight_ready":
            qc.invalidateQueries({ queryKey: queryKeys.insights.latest });
            break;
          case "subscription_changed":
            qc.invalidateQueries({ queryKey: queryKeys.billing.status });
            qc.invalidateQueries({ queryKey: queryKeys.auth.me });
            break;
          case "sync_complete":
            qc.invalidateQueries();
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      const delay = Math.min(reconnectDelay.current, MAX_RECONNECT);
      reconnectTimer.current = setTimeout(connect, delay);
      reconnectDelay.current *= 2;
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}
```

---

*Document version: 1.0.0 — Generated for HabitArc*
*Last updated: 2026-02-10*
