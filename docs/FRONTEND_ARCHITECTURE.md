# HabitArc — Frontend Architecture

> Principal Frontend Engineer specification.
> Next.js 15 App Router · React 19 · TypeScript strict · TanStack Query · Zustand · Tailwind + shadcn/ui
> Consumes Rust API only — no business logic in the frontend.

---

## Table of Contents

1. [Folder Tree](#1-folder-tree)
2. [Dependency Map](#2-dependency-map)
3. [Typed API Client Layer](#3-typed-api-client-layer)
4. [Type System](#4-type-system)
5. [Zustand Stores](#5-zustand-stores)
6. [TanStack Query Hooks](#6-tanstack-query-hooks)
7. [Component Contracts](#7-component-contracts)
8. [Page Contracts](#8-page-contracts)
9. [IndexedDB Offline Queue](#9-indexeddb-offline-queue)
10. [WebSocket Client](#10-websocket-client)
11. [PWA Service Worker Strategy](#11-pwa-service-worker-strategy)
12. [Accessibility](#12-accessibility)
13. [Error Boundaries & Loading](#13-error-boundaries--loading)
14. [Route Map & Deep Linking](#14-route-map--deep-linking)

---

## 1. Folder Tree

```
frontend/
├── public/
│   ├── manifest.json
│   ├── sw.js                          # Service worker (hand-written, not Workbox)
│   ├── icons/                         # PWA icons 192/512
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # RootLayout: html, body, <Providers>, fonts
│   │   ├── page.tsx                   # / → redirect to /today or /onboarding
│   │   ├── providers.tsx              # QueryClientProvider, online/offline listeners, SW registration
│   │   ├── globals.css                # Tailwind base + theme tokens
│   │   ├── not-found.tsx              # 404 page
│   │   ├── error.tsx                  # Root error boundary
│   │   │
│   │   ├── (auth)/                    # Unauthenticated layout group
│   │   │   ├── layout.tsx             # Centered card layout, no sidebar
│   │   │   ├── onboarding/page.tsx    # 3-screen carousel → guest or signup
│   │   │   ├── login/page.tsx         # Email + password login
│   │   │   └── signup/page.tsx        # Registration with optional guest_token merge
│   │   │
│   │   └── (app)/                     # Authenticated layout group
│   │       ├── layout.tsx             # Sidebar, bottom nav, guest banner, WS connect
│   │       ├── error.tsx              # App-scoped error boundary with retry
│   │       ├── loading.tsx            # App-scoped skeleton
│   │       ├── today/page.tsx         # Primary dashboard — today's habits
│   │       ├── calendar/page.tsx      # Per-habit heatmap + daily stats chart
│   │       ├── review/page.tsx        # Weekly review panel
│   │       ├── insights/page.tsx      # AI insights (tier-gated)
│   │       ├── settings/page.tsx      # Profile, timezone, notifications
│   │       └── billing/page.tsx       # Subscription status, upgrade, portal
│   │
│   ├── components/
│   │   ├── ui/                        # shadcn/ui primitives (button, card, dialog, etc.)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── select.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── sheet.tsx              # For HabitEditSheet (slide-over panel)
│   │   │   ├── skeleton.tsx           # Skeleton loading primitives
│   │   │   ├── slider.tsx             # For mood logger
│   │   │   ├── switch.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   └── tooltip.tsx
│   │   │
│   │   ├── habits/
│   │   │   ├── habit-card.tsx         # Single habit row with toggle, streak, schedule
│   │   │   ├── completion-toggle.tsx  # Extracted toggle button (large touch target)
│   │   │   ├── streak-badge.tsx       # Flame icon + streak count
│   │   │   ├── habit-edit-sheet.tsx   # Slide-over edit form (Sheet)
│   │   │   ├── create-habit-dialog.tsx# Modal for new habit
│   │   │   ├── habit-list.tsx         # Renders list of HabitCards with AnimatePresence
│   │   │   └── habit-skeleton.tsx     # Skeleton for habit list loading state
│   │   │
│   │   ├── mood/
│   │   │   ├── mood-logger.tsx        # Sliders for mood/energy/stress + save
│   │   │   └── mood-chart.tsx         # Recharts line chart for mood trends
│   │   │
│   │   ├── insights/
│   │   │   ├── insight-cards.tsx      # Renders wins, improvements, tip
│   │   │   └── insight-skeleton.tsx   # Skeleton for insight loading
│   │   │
│   │   ├── review/
│   │   │   ├── weekly-review-panel.tsx# Full weekly review with per-habit breakdown
│   │   │   └── review-skeleton.tsx    # Skeleton for review loading
│   │   │
│   │   ├── calendar/
│   │   │   ├── calendar-heatmap.tsx   # GitHub-style heatmap grid
│   │   │   └── daily-stats-chart.tsx  # Recharts bar chart for daily completion rate
│   │   │
│   │   ├── billing/
│   │   │   ├── paywall-modal.tsx      # Upgrade prompt when hitting tier limits
│   │   │   ├── plan-card.tsx          # Single plan display (Free/Plus/Pro)
│   │   │   └── subscription-badge.tsx # Tier badge in sidebar
│   │   │
│   │   ├── feedback/
│   │   │   ├── celebration-animation.tsx  # Confetti/check animation (respects prefers-reduced-motion)
│   │   │   ├── offline-sync-banner.tsx    # "You're offline — N actions queued"
│   │   │   ├── notification-prompt.tsx    # Push notification opt-in
│   │   │   ├── error-fallback.tsx         # Error boundary fallback with retry button
│   │   │   └── empty-state.tsx            # Generic empty state with illustration
│   │   │
│   │   └── layout/
│   │       ├── sidebar.tsx            # Desktop sidebar nav
│   │       ├── bottom-nav.tsx         # Mobile bottom tab bar
│   │       ├── mobile-header.tsx      # Mobile top bar
│   │       └── guest-banner.tsx       # "Sign up to save progress" banner
│   │
│   ├── hooks/
│   │   ├── use-habits.ts             # TanStack Query hooks for habits domain
│   │   ├── use-mood.ts               # TanStack Query hooks for mood domain
│   │   ├── use-insights.ts           # TanStack Query hooks for insights domain
│   │   ├── use-review.ts             # TanStack Query hooks for weekly review
│   │   ├── use-billing.ts            # TanStack Query hooks for billing domain
│   │   ├── use-websocket.ts          # WebSocket connection + auto-reconnect
│   │   ├── use-offline-sync.ts       # IndexedDB queue drain on reconnect
│   │   ├── use-media-query.ts        # Responsive breakpoint hook
│   │   ├── use-reduced-motion.ts     # prefers-reduced-motion detection
│   │   └── use-local-date.ts         # Today's date in user timezone
│   │
│   ├── lib/
│   │   ├── api-client.ts             # Typed API client class (replaces api.ts)
│   │   ├── api.ts                    # Singleton instance + domain method namespaces
│   │   ├── types.ts                  # All API contract types
│   │   ├── errors.ts                 # ApiError class with error code parsing
│   │   ├── offline-db.ts             # IndexedDB wrapper (idb-keyval or raw)
│   │   ├── query-keys.ts             # Centralized query key factory
│   │   ├── constants.ts              # Tier limits, colors, schedule labels
│   │   ├── register-sw.ts            # Service worker registration
│   │   └── utils.ts                  # cn(), formatDate(), etc.
│   │
│   └── stores/
│       ├── auth-store.ts             # User session, login, register, guest, logout
│       ├── offline-store.ts          # Online/offline state + IndexedDB queue
│       └── ui-store.ts               # Sheet open state, active modals, toast queue
│
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.js
└── package.json
```

---

## 2. Dependency Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         PAGES (app/)                            │
│  /today  /calendar  /review  /insights  /settings  /billing     │
└────────────────────────────┬────────────────────────────────────┘
                             │ import
┌────────────────────────────▼────────────────────────────────────┐
│                      COMPONENTS                                  │
│  HabitCard  MoodLogger  InsightCards  PaywallModal  etc.         │
└────────────────────────────┬────────────────────────────────────┘
                             │ import
┌────────────────────────────▼────────────────────────────────────┐
│                    HOOKS (TanStack Query)                         │
│  useHabitsToday  useToggle  useMoodUpsert  useInsights  etc.     │
└──────────┬─────────────────┬────────────────────────────────────┘
           │                 │
     ┌─────▼─────┐   ┌──────▼──────┐
     │  STORES   │   │  API CLIENT │
     │ (Zustand) │   │ (lib/api)   │
     └─────┬─────┘   └──────┬──────┘
           │                 │
     ┌─────▼─────┐   ┌──────▼──────┐
     │ offline-  │   │   fetch()   │
     │  db.ts    │   │  + refresh  │
     │ (IndexDB) │   │  + retry    │
     └───────────┘   └─────────────┘
```

**Data flow rules:**
1. Pages import components. Components import hooks. Hooks import API client.
2. **No raw `fetch()` in components or pages.** All API calls go through `lib/api-client.ts`.
3. **No business logic in the frontend.** Entitlement checks, streak calculations, date bucketing — all server-side. Frontend only reads and displays.
4. Zustand stores hold **UI state only** (auth session, online status, modal state). Server state lives in TanStack Query cache.
5. Components are **pure renderers** — they receive data via hooks and emit events via mutation callbacks.

---

## 3. Typed API Client Layer

### Architecture

```
lib/api-client.ts    — ApiClient class (generic request, refresh, error handling)
lib/api.ts           — Singleton + domain namespaces (api.auth.login, api.habits.today, etc.)
lib/errors.ts        — ApiError class with stable error codes
lib/query-keys.ts    — Centralized query key factory
```

### `lib/errors.ts` — Typed API Error

```typescript
/**
 * Stable error codes from the Rust API.
 * Must stay in sync with backend/src/error.rs
 */
export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_REFRESH_REVOKED"
  | "AUTH_FORBIDDEN"
  | "VALIDATION_FAILED"
  | "VALIDATION_DATE_RANGE"
  | "VALIDATION_ENUM"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_CONFLICT"
  | "RESOURCE_GONE"
  | "ENTITLEMENT_HABIT_LIMIT"
  | "ENTITLEMENT_SCHEDULE"
  | "ENTITLEMENT_HEATMAP"
  | "ENTITLEMENT_ANALYTICS"
  | "ENTITLEMENT_INSIGHTS"
  | "RATE_LIMITED"
  | "STRIPE_ERROR"
  | "INSIGHT_GENERATION_FAIL"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Is this a tier-gating error? Show paywall modal. */
  get isEntitlementError(): boolean {
    return this.code.startsWith("ENTITLEMENT_");
  }

  /** Is this an auth error? Redirect to login. */
  get isAuthError(): boolean {
    return this.code.startsWith("AUTH_");
  }

  /** Is this a conflict? Show "already exists" message. */
  get isConflict(): boolean {
    return this.code === "RESOURCE_CONFLICT";
  }

  /** Is this rate limiting? Show "slow down" message. */
  get isRateLimited(): boolean {
    return this.code === "RATE_LIMITED";
  }
}
```

### `lib/api-client.ts` — Core Client

```typescript
import { ApiError, type ApiErrorCode } from "./errors";

interface RequestOptions extends Omit<RequestInit, "body"> {
  skipAuth?: boolean;
  idempotencyKey?: string;
  body?: unknown;
}

export class ApiClient {
  private baseUrl: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // ── Token management ─────────────────────────────────────────

  private getAccessToken(): string | null { /* localStorage */ }
  private getRefreshToken(): string | null { /* localStorage */ }
  setTokens(access: string, refresh: string): void { /* localStorage */ }
  clearTokens(): void { /* localStorage */ }

  // ── Token refresh (deduplicated) ─────────────────────────────

  private async refreshAccessToken(): Promise<boolean> {
    // Deduplicate concurrent refresh attempts
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;

      try {
        const resp = await fetch(`${this.baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        this.setTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  // ── Core request ─────────────────────────────────────────────

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { skipAuth = false, idempotencyKey, body, ...fetchOpts } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(fetchOpts.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = this.getAccessToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const fetchOptions: RequestInit = {
      ...fetchOpts,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    let response = await fetch(`${this.baseUrl}${endpoint}`, fetchOptions);

    // 401 → try refresh once
    if (response.status === 401 && !skipAuth) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        headers["Authorization"] = `Bearer ${this.getAccessToken()}`;
        response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...fetchOptions,
          headers,
        });
      } else {
        this.clearTokens();
        throw new ApiError("AUTH_TOKEN_EXPIRED", 401, "Session expired");
      }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({
        error: { code: "INTERNAL_ERROR", message: "Request failed", status: response.status }
      }));
      throw new ApiError(
        body.error?.code as ApiErrorCode ?? "INTERNAL_ERROR",
        body.error?.status ?? response.status,
        body.error?.message ?? "Request failed",
        body.error?.details,
      );
    }

    return response.json();
  }

  // ── Convenience methods ──────────────────────────────────────

  get<T>(endpoint: string, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>(endpoint, { ...opts, method: "GET" });
  }

  post<T>(endpoint: string, body?: unknown, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>(endpoint, { ...opts, method: "POST", body });
  }

  put<T>(endpoint: string, body?: unknown, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>(endpoint, { ...opts, method: "PUT", body });
  }

  del<T>(endpoint: string, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>(endpoint, { ...opts, method: "DELETE" });
  }
}
```

### `lib/api.ts` — Domain Namespaces

```typescript
import { ApiClient } from "./api-client";
import type * as T from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const client = new ApiClient(API_URL);

export const api = {
  client, // expose for token management

  auth: {
    signup:  (body: T.SignupRequest)  => client.post<T.AuthResponse>("/api/auth/signup", body, { skipAuth: true }),
    login:   (body: T.LoginRequest)   => client.post<T.AuthResponse>("/api/auth/login", body, { skipAuth: true }),
    refresh: (body: T.RefreshRequest) => client.post<T.AuthResponse>("/api/auth/refresh", body, { skipAuth: true }),
    logout:  ()                       => client.post<T.MessageResponse>("/api/auth/logout"),
    guest:   (body: T.GuestRequest)   => client.post<T.GuestAuthResponse>("/api/auth/guest", body, { skipAuth: true }),
    me:      ()                       => client.get<T.UserProfile>("/api/auth/me"),
  },

  habits: {
    list:    ()                                 => client.get<T.HabitResponse[]>("/api/habits"),
    today:   ()                                 => client.get<T.HabitTodayResponse[]>("/api/habits/today"),
    create:  (body: T.CreateHabitRequest)       => client.post<T.HabitResponse>("/api/habits", body),
    update:  (id: string, body: T.UpdateHabitRequest) => client.put<T.HabitResponse>(`/api/habits/${id}`, body),
    delete:  (id: string)                       => client.del<T.DeleteResponse>(`/api/habits/${id}`),
    toggle:  (id: string, body?: T.CompleteRequest) => client.post<T.ToggleResponse>(`/api/habits/${id}/complete`, body),
    calendar:(id: string, months?: number)      => client.get<T.CalendarEntry[]>(`/api/habits/${id}/calendar${months ? `?months=${months}` : ""}`),
    stats:   (id: string)                       => client.get<T.HabitStatsResponse>(`/api/habits/${id}/stats`),
  },

  mood: {
    upsert: (body: T.MoodRequest)              => client.post<T.MoodLogResponse>("/api/mood", body),
    list:   (range?: string)                   => client.get<T.MoodLogResponse[]>(`/api/mood${range ? `?range=${range}` : ""}`),
  },

  insights: {
    generate: ()                               => client.post<T.InsightResponse>("/api/insights/generate"),
    latest:   ()                               => client.get<T.InsightResponse>("/api/insights/latest"),
  },

  reviews: {
    weekly: (week?: string)                    => client.get<T.WeeklyReviewResponse>(`/api/reviews/weekly${week ? `?week=${week}` : ""}`),
  },

  billing: {
    status:   ()                               => client.get<T.SubscriptionStatusResponse>("/api/subscription/status"),
    checkout: (body: T.CheckoutRequest)        => client.post<T.CheckoutResponse>("/api/subscription/checkout", body),
    portal:   ()                               => client.post<T.PortalResponse>("/api/subscription/portal"),
  },

  system: {
    health: () => client.get<T.HealthResponse>("/health", { skipAuth: true }),
    readyz: () => client.get<T.ReadyzResponse>("/readyz", { skipAuth: true }),
  },
};
```

### `lib/query-keys.ts` — Centralized Key Factory

```typescript
export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  habits: {
    all:      ["habits"] as const,
    today:    ["habits", "today"] as const,
    detail:   (id: string) => ["habits", id] as const,
    calendar: (id: string, months?: number) => ["habits", id, "calendar", months] as const,
    stats:    (id: string) => ["habits", id, "stats"] as const,
  },
  mood: {
    list: (range?: string) => ["mood", range ?? "7d"] as const,
  },
  insights: {
    latest: ["insights", "latest"] as const,
  },
  reviews: {
    weekly: (week?: string) => ["reviews", "weekly", week ?? "latest"] as const,
  },
  billing: {
    status: ["billing", "status"] as const,
  },
} as const;
```

---

## 4. Type System

### `lib/types.ts` — Complete API Contract Types

```typescript
// ── Enums ──────────────────────────────────────────────────────

export type SubscriptionTier   = "free" | "plus" | "pro";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "inactive";
export type HabitFrequency     = "daily" | "weekly_days" | "weekly_target";
export type InsightSource      = "claude" | "fallback";
export type ToggleAction       = "created" | "deleted";

// ── Auth ───────────────────────────────────────────────────────

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  timezone?: string;
  guest_token?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface GuestRequest {
  timezone?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserSummary;
}

export interface GuestAuthResponse extends AuthResponse {
  guest_token: string;
}

export interface UserSummary {
  id: string;
  email?: string;
  name: string;
  is_guest: boolean;
  timezone: string;
  tier: SubscriptionTier;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email?: string;
  name: string;
  avatar_url?: string;
  is_guest: boolean;
  timezone: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  entitlements: UserEntitlements;
  created_at: string;
}

export interface UserEntitlements {
  max_habits: number | null;          // null = unlimited
  schedule_types: HabitFrequency[];
  analytics_days: number;
  heatmap_months: number;
  ai_insights_per_week: number | null; // null = unlimited or disabled
  reminders: "none" | "unlimited" | { limited: number };
  data_export: boolean;
}

// ── Habits ─────────────────────────────────────────────────────

export interface ScheduleConfig {
  days?: number[];          // weekly_days: ISO day 1-7
  times_per_week?: number;  // weekly_target: 1-7
}

export interface CreateHabitRequest {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  frequency?: HabitFrequency;
  schedule?: ScheduleConfig;
  target_per_day?: number;
}

export interface UpdateHabitRequest {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  frequency?: HabitFrequency;
  schedule?: ScheduleConfig;
  target_per_day?: number;
  sort_order?: number;
}

export interface HabitResponse {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  frequency: HabitFrequency;
  schedule?: ScheduleConfig;
  target_per_day: number;
  sort_order: number;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  created_at: string;
  updated_at: string;
}

export interface HabitTodayResponse {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  frequency: HabitFrequency;
  schedule?: ScheduleConfig;
  target_per_day: number;
  sort_order: number;
  current_streak: number;
  completed_today: number;
  is_complete: boolean;
  is_due_today: boolean;
}

export interface CompleteRequest {
  date?: string; // YYYY-MM-DD, default today in user TZ
}

export interface ToggleResponse {
  action: ToggleAction;
  completion?: CompletionRecord;
  habit: StreakSummary;
}

export interface CompletionRecord {
  id: string;
  habit_id: string;
  local_date_bucket: string;
  value: number;
  created_at: string;
}

export interface StreakSummary {
  current_streak: number;
  longest_streak: number;
  total_completions: number;
}

export interface CalendarEntry {
  date: string;
  count: number;
  target: number;
}

export interface HabitStatsResponse {
  habit_id: string;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  completion_rate_30d: number;
  completions_this_week: number;
  target_this_week: number;
}

// ── Mood ───────────────────────────────────────────────────────

export interface MoodRequest {
  date?: string;
  mood?: number;    // 1-5
  energy?: number;  // 1-5
  stress?: number;  // 1-5
  note?: string;
}

export interface MoodLogResponse {
  id: string;
  local_date_bucket: string;
  mood?: number;
  energy?: number;
  stress?: number;
  note?: string;
  created_at: string;
  updated_at: string;
}

// ── Insights ───────────────────────────────────────────────────

export interface InsightResponse {
  id: string;
  week_start_date: string;
  source: InsightSource;
  summary: string;
  wins: string[];
  improvements: string[];
  mood_correlation?: string;
  streak_analysis: string;
  tip_of_the_week: string;
  generated_at: string;
}

// ── Reviews ────────────────────────────────────────────────────

export interface WeeklyReviewResponse {
  week_start: string;
  week_end: string;
  overall: {
    total_completions: number;
    total_possible: number;
    completion_rate: number;
    best_day?: string;
    worst_day?: string;
  };
  habits: WeeklyHabitBreakdown[];
}

export interface WeeklyHabitBreakdown {
  id: string;
  name: string;
  color: string;
  completed: number;
  possible: number;
  rate: number;
}

// ── Billing ────────────────────────────────────────────────────

export interface CheckoutRequest {
  price_id: string;
  tier: string;
}

export interface CheckoutResponse {
  checkout_url: string;
}

export interface PortalResponse {
  portal_url: string;
}

export interface SubscriptionStatusResponse {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  entitlements: UserEntitlements;
}

// ── Common ─────────────────────────────────────────────────────

export interface MessageResponse {
  message: string;
}

export interface DeleteResponse {
  deleted: boolean;
  id: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface ReadyzResponse {
  status: string;
  checks: { database: boolean; migrations: boolean };
}
```

---

## 5. Zustand Stores

### `stores/auth-store.ts`

```typescript
interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login:    (email: string, password: string) => Promise<void>;
  signup:   (req: SignupRequest) => Promise<void>;
  guest:    (timezone?: string) => Promise<void>;
  logout:   () => Promise<void>;
  fetchUser:() => Promise<void>;
}
```

**Key behaviors:**
- `login` / `signup` / `guest` → call `api.auth.*`, store tokens, fetch profile, set state.
- `signup` reads `localStorage.guest_token` and passes it for guest merge.
- `logout` → calls `api.auth.logout()`, clears tokens + guest_token, redirects to `/login`.
- `fetchUser` → called once on app mount in `providers.tsx`. If no token → `isAuthenticated = false`.

### `stores/offline-store.ts`

```typescript
interface OfflineState {
  isOnline: boolean;
  queueSize: number;        // derived from IndexedDB count

  setOnline:    (online: boolean) => void;
  enqueue:      (action: OfflineAction) => Promise<void>;
  dequeue:      (id: string) => Promise<void>;
  getQueue:     () => Promise<OfflineAction[]>;
  drainQueue:   () => Promise<DrainResult>;
}

interface OfflineAction {
  id: string;
  endpoint: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey: string;
  createdAt: number;
}

interface DrainResult {
  succeeded: number;
  failed: number;
  conflicts: string[];  // error codes for items that got 409
}
```

**Key behaviors:**
- Queue is persisted in **IndexedDB** (not localStorage — survives larger payloads, structured data).
- `drainQueue` is called when `isOnline` transitions from `false → true`.
- Each action carries an `idempotencyKey` (UUID generated at enqueue time).
- On 409 (conflict), the action is removed from queue and the conflict is surfaced in `DrainResult`.
- On 5xx, the action stays in queue for next drain attempt.

### `stores/ui-store.ts`

```typescript
interface UIState {
  // Sheet / modal state
  editingHabitId: string | null;
  isCreateDialogOpen: boolean;
  isPaywallOpen: boolean;
  paywallFeature: string | null;

  // Actions
  openEditSheet:    (habitId: string) => void;
  closeEditSheet:   () => void;
  openCreateDialog: () => void;
  closeCreateDialog:() => void;
  openPaywall:      (feature: string) => void;
  closePaywall:     () => void;
}
```

---

## 6. TanStack Query Hooks

### Query Client Configuration (`providers.tsx`)

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,           // 30s — habits change infrequently
      gcTime: 5 * 60_000,         // 5min garbage collection
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.isAuthError) return false;
        if (error instanceof ApiError && error.status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});
```

### `hooks/use-habits.ts`

```typescript
// ── Queries ────────────────────────────────────────────────────

/** GET /api/habits/today — primary dashboard query */
export function useHabitsToday() {
  return useQuery({
    queryKey: queryKeys.habits.today,
    queryFn: () => api.habits.today(),
  });
}

/** GET /api/habits — all active habits (for settings, reorder) */
export function useHabits() {
  return useQuery({
    queryKey: queryKeys.habits.all,
    queryFn: () => api.habits.list(),
  });
}

/** GET /api/habits/{id}/calendar */
export function useHabitCalendar(habitId: string, months?: number) {
  return useQuery({
    queryKey: queryKeys.habits.calendar(habitId, months),
    queryFn: () => api.habits.calendar(habitId, months),
    enabled: !!habitId,
  });
}

/** GET /api/habits/{id}/stats */
export function useHabitStats(habitId: string) {
  return useQuery({
    queryKey: queryKeys.habits.stats(habitId),
    queryFn: () => api.habits.stats(habitId),
    enabled: !!habitId,
  });
}

// ── Mutations ──────────────────────────────────────────────────

/** POST /api/habits — create with entitlement error → paywall */
export function useCreateHabit() {
  const qc = useQueryClient();
  const openPaywall = useUIStore((s) => s.openPaywall);

  return useMutation({
    mutationFn: (data: CreateHabitRequest) => api.habits.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all });
      qc.invalidateQueries({ queryKey: queryKeys.habits.today });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isEntitlementError) {
        openPaywall(error.code);
      }
    },
  });
}

/** PUT /api/habits/{id} — partial update */
export function useUpdateHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHabitRequest }) =>
      api.habits.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all });
      qc.invalidateQueries({ queryKey: queryKeys.habits.today });
      qc.invalidateQueries({ queryKey: queryKeys.habits.detail(id) });
    },
  });
}

/** DELETE /api/habits/{id} — soft delete */
export function useDeleteHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.habits.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all });
      qc.invalidateQueries({ queryKey: queryKeys.habits.today });
    },
  });
}

/**
 * POST /api/habits/{id}/complete — TOGGLE with optimistic UI
 *
 * This is the most critical mutation in the app. It must:
 * 1. Optimistically flip is_complete + completed_today in the cache
 * 2. Fire haptic feedback
 * 3. Trigger celebration animation on complete
 * 4. Rollback cache on error
 * 5. If offline, enqueue to IndexedDB and still show optimistic state
 */
export function useToggleCompletion() {
  const qc = useQueryClient();
  const { isOnline, enqueue } = useOfflineStore();

  return useMutation({
    mutationFn: async ({ habitId, date }: { habitId: string; date?: string }) => {
      if (!isOnline) {
        // Offline: enqueue and return a synthetic response
        await enqueue({
          endpoint: `/api/habits/${habitId}/complete`,
          method: "POST",
          body: date ? { date } : undefined,
          idempotencyKey: crypto.randomUUID(),
        });
        return null; // optimistic only
      }
      return api.habits.toggle(habitId, date ? { date } : undefined);
    },

    onMutate: async ({ habitId }) => {
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
      if (context?.previous) {
        qc.setQueryData(queryKeys.habits.today, context.previous);
      }
    },

    onSettled: () => {
      if (isOnline) {
        qc.invalidateQueries({ queryKey: queryKeys.habits.today });
        qc.invalidateQueries({ queryKey: queryKeys.habits.all });
      }
    },
  });
}
```

### `hooks/use-mood.ts`

```typescript
export function useMoodLogs(range?: string) {
  return useQuery({
    queryKey: queryKeys.mood.list(range),
    queryFn: () => api.mood.list(range),
  });
}

export function useUpsertMood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MoodRequest) => api.mood.upsert(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mood"] }); // invalidate all mood queries
    },
  });
}
```

### `hooks/use-insights.ts`

```typescript
export function useLatestInsight() {
  return useQuery({
    queryKey: queryKeys.insights.latest,
    queryFn: () => api.insights.latest(),
    retry: false, // 404 = no insight yet, don't retry
  });
}

export function useGenerateInsight() {
  const qc = useQueryClient();
  const openPaywall = useUIStore((s) => s.openPaywall);

  return useMutation({
    mutationFn: () => api.insights.generate(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insights.latest });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "ENTITLEMENT_INSIGHTS") {
        openPaywall("ENTITLEMENT_INSIGHTS");
      }
    },
  });
}
```

### `hooks/use-review.ts`

```typescript
export function useWeeklyReview(week?: string) {
  return useQuery({
    queryKey: queryKeys.reviews.weekly(week),
    queryFn: () => api.reviews.weekly(week),
  });
}
```

### `hooks/use-billing.ts`

```typescript
export function useSubscriptionStatus() {
  return useQuery({
    queryKey: queryKeys.billing.status,
    queryFn: () => api.billing.status(),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (data: CheckoutRequest) => api.billing.checkout(data),
    onSuccess: (data) => {
      window.location.href = data.checkout_url;
    },
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: () => api.billing.portal(),
    onSuccess: (data) => {
      window.location.href = data.portal_url;
    },
  });
}
```

### `hooks/use-reduced-motion.ts`

```typescript
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
```

### `hooks/use-local-date.ts`

```typescript
/** Returns today's date string (YYYY-MM-DD) in the user's timezone */
export function useLocalDate(): string {
  const timezone = useAuthStore((s) => s.user?.timezone ?? "UTC");
  return useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA = YYYY-MM-DD
  }, [timezone]);
}
```

---

## 7. Component Contracts

### `HabitCard`

```typescript
interface HabitCardProps {
  habit: HabitTodayResponse;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  isToggling?: boolean;
}
```

- **Touch target:** Toggle button is 48×48px minimum (AA).
- **Haptic:** `navigator.vibrate(50)` on toggle (if available).
- **Animation:** `framer-motion` layout animation. Respects `prefers-reduced-motion`.
- **Visual states:** complete (green check + strikethrough), not-due (dimmed 50%), pending (spinner).
- **Accessibility:** `role="button"`, `aria-pressed={is_complete}`, `aria-label="Toggle {name}"`.

### `CompletionToggle`

```typescript
interface CompletionToggleProps {
  isComplete: boolean;
  isLoading: boolean;
  onToggle: () => void;
  color: string;
  size?: "sm" | "md" | "lg";  // 32/40/48px
}
```

Extracted from HabitCard for reuse. Large circular button with check icon.
- `aria-pressed`, `aria-label="Mark as complete"` / `"Mark as incomplete"`.
- `min-h-[48px] min-w-[48px]` for mobile touch target.

### `StreakBadge`

```typescript
interface StreakBadgeProps {
  count: number;
  showFlame?: boolean;  // default true
  size?: "sm" | "md";
}
```

Renders `🔥 14` badge. Hidden when `count === 0`.

### `HabitEditSheet`

```typescript
interface HabitEditSheetProps {
  habitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Slide-over panel (Radix Sheet) for editing an existing habit. Fetches habit data via `useHabit(habitId)`.
Contains same form fields as CreateHabitDialog but pre-populated.

### `MoodLogger`

```typescript
interface MoodLoggerProps {
  date?: string;           // default: today
  initialValues?: {
    mood?: number;
    energy?: number;
    stress?: number;
  };
  onSaved?: () => void;
}
```

Three sliders (1-5) + optional note + save button. Uses `useUpsertMood()`.
- Sliders use `@radix-ui/react-slider` with `aria-label="Mood level"` etc.
- Shows saved confirmation toast on success.

### `WeeklyReviewPanel`

```typescript
interface WeeklyReviewPanelProps {
  week?: string;  // "YYYY-WNN", default last week
}
```

Full-width panel showing:
- Overall completion rate (large number)
- Best/worst day badges
- Per-habit progress bars sorted by rate descending
- Uses `useWeeklyReview(week)`.

### `InsightCards`

```typescript
interface InsightCardsProps {
  insight: InsightResponse;
}
```

Renders insight sections as cards:
- Summary card (full width)
- Wins list (green accent)
- Improvements list (amber accent)
- Mood correlation (if present)
- Tip of the week (highlighted)
- Source badge ("AI" or "Basic")

### `PaywallModal`

```typescript
interface PaywallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: string | null;  // error code like "ENTITLEMENT_HABIT_LIMIT"
}
```

Modal showing:
- What feature was blocked
- Current tier vs required tier
- Plan comparison (Free/Plus/Pro)
- "Upgrade" CTA → `useCheckout()`
- "Maybe later" dismiss

Triggered automatically by entitlement errors in mutation hooks.

### `OfflineSyncBanner`

```typescript
interface OfflineSyncBannerProps {
  queueSize: number;
  isOnline: boolean;
  onSync: () => void;
}
```

Sticky banner at top of app:
- **Offline:** "You're offline — {N} actions queued"
- **Syncing:** "Syncing {N} actions..." with spinner
- **Sync complete:** "All caught up!" (auto-dismiss after 3s)
- **Sync error:** "Some actions failed — tap to retry"

### `NotificationPrompt`

```typescript
interface NotificationPromptProps {
  onAllow: () => void;
  onDismiss: () => void;
}
```

One-time prompt card (not a browser dialog) asking to enable push notifications.
Shown on 3rd app visit or after first week of use. Dismissible, remembers choice in localStorage.

### `CelebrationAnimation`

```typescript
interface CelebrationAnimationProps {
  trigger: boolean;
  type?: "confetti" | "checkmark" | "streak";
}
```

- **confetti:** Burst of particles on habit completion.
- **checkmark:** Animated check circle.
- **streak:** Fire animation on streak milestone (7, 14, 30, 60, 100).
- **Respects `prefers-reduced-motion`:** Falls back to a simple opacity fade.

```typescript
const reduced = useReducedMotion();
// If reduced: simple opacity transition
// If not: full particle/spring animation
```

---

## 8. Page Contracts

### `/onboarding`

- 3-screen horizontal carousel (swipe or button navigation)
- Screen 1: "Track habits that matter" + illustration
- Screen 2: "Build streaks, see progress" + heatmap preview
- Screen 3: "Get AI-powered insights" + insight card preview
- CTA: "Get Started" → `startGuestSession()` → redirect to `/today`
- Secondary: "Already have an account? Log in" → `/login`

### `/today` (primary dashboard)

- `useHabitsToday()` — main data source
- Greeting: "Good morning, {name}" with date
- Stats row: total habits, completed today, current best streak
- Habit list with `HabitCard` components, `AnimatePresence` for add/remove
- Floating "+" button → `CreateHabitDialog`
- `MoodLogger` in collapsible section at bottom
- `CelebrationAnimation` triggered on completion

### `/calendar`

- Habit selector dropdown (or tabs for ≤5 habits)
- `CalendarHeatmap` for selected habit
- `DailyStatsChart` (Recharts bar chart) below
- Date range controlled by entitlement (`heatmap_months`)

### `/review`

- `WeeklyReviewPanel` for last complete week
- Week selector (prev/next arrows)
- `MoodChart` showing mood/energy/stress trends for the week

### `/insights`

- `useLatestInsight()` to show cached insight
- "Generate New Insight" button → `useGenerateInsight()`
- `InsightCards` rendering the response
- Free tier: `PaywallModal` shown instead of generate button
- Loading: `InsightSkeleton`

### `/settings`

- Profile section: name, email (read-only for guests), avatar
- Timezone selector (IANA timezone list)
- Notification preferences toggle
- "Sign up" CTA for guest users
- "Delete account" danger zone
- App version display

### `/billing`

- `useSubscriptionStatus()` for current plan info
- Three `PlanCard` components (Free/Plus/Pro)
- Current plan highlighted
- "Upgrade" → `useCheckout()`
- "Manage subscription" → `usePortal()`
- Feature comparison table

### `/login`

- Email + password form
- "Forgot password?" link (future)
- "Don't have an account? Sign up" link
- Error display for wrong credentials
- Rate limit message display

### `/signup`

- Email + password + name form
- Password strength indicator
- Timezone auto-detected from browser
- Guest token auto-attached from localStorage
- "Already have an account? Log in" link

---

## 9. IndexedDB Offline Queue

### `lib/offline-db.ts`

```typescript
const DB_NAME = "habitarc-offline";
const DB_VERSION = 1;
const STORE_NAME = "action-queue";

interface OfflineAction {
  id: string;
  endpoint: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey: string;
  createdAt: number;
  retryCount: number;
}

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

  async enqueue(action: Omit<OfflineAction, "id" | "createdAt" | "retryCount">): Promise<string>;
  async dequeue(id: string): Promise<void>;
  async getAll(): Promise<OfflineAction[]>;  // ordered by createdAt ASC (FIFO)
  async count(): Promise<number>;
  async clear(): Promise<void>;
}

export const offlineDB = new OfflineDB();
```

### Sync Protocol (`hooks/use-offline-sync.ts`)

```typescript
export function useOfflineSync() {
  const { isOnline } = useOfflineStore();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isOnline) return;

    const drain = async () => {
      const actions = await offlineDB.getAll();
      if (actions.length === 0) return;

      let succeeded = 0;
      let failed = 0;

      for (const action of actions) {
        try {
          await api.client.request(action.endpoint, {
            method: action.method,
            body: action.body,
            idempotencyKey: action.idempotencyKey,
          });
          await offlineDB.dequeue(action.id);
          succeeded++;
        } catch (error) {
          if (error instanceof ApiError) {
            if (error.status === 409 || error.status === 404) {
              // Conflict or gone — remove from queue, data is stale
              await offlineDB.dequeue(action.id);
              succeeded++; // count as resolved
            } else if (error.status >= 500) {
              // Server error — keep in queue for retry
              failed++;
            } else {
              // Client error (4xx) — remove, won't succeed on retry
              await offlineDB.dequeue(action.id);
              failed++;
            }
          }
        }
      }

      // Refresh all data after sync
      if (succeeded > 0) {
        qc.invalidateQueries();
      }

      // Update queue size in store
      const remaining = await offlineDB.count();
      useOfflineStore.getState().setQueueSize(remaining);
    };

    drain();
  }, [isOnline, qc]);
}
```

**Sync rules:**
1. FIFO order — actions are replayed in the order they were created.
2. **409 Conflict** → action is removed (server state wins). No user notification needed for toggle conflicts.
3. **404 Not Found** → action is removed (resource was deleted). No retry.
4. **5xx Server Error** → action stays in queue. Retried on next online transition.
5. **4xx Client Error** → action is removed. Won't succeed on retry.
6. After drain, invalidate all TanStack Query caches to refresh from server truth.

---

## 10. WebSocket Client

### `hooks/use-websocket.ts`

```typescript
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";

interface WSMessage {
  type: "completion_changed" | "habit_updated" | "insight_ready" | "subscription_changed";
  user_id: string;
  habit_id?: string;
  data?: unknown;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000); // exponential backoff: 1s, 2s, 4s, 8s, max 30s

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    // Pass token as query param for auth (WS doesn't support headers)
    const ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.onopen = () => {
      reconnectDelay.current = 1000; // reset backoff
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "completion_changed":
            qc.invalidateQueries({ queryKey: queryKeys.habits.today });
            if (msg.habit_id) {
              qc.invalidateQueries({ queryKey: queryKeys.habits.stats(msg.habit_id) });
              qc.invalidateQueries({ queryKey: queryKeys.habits.calendar(msg.habit_id) });
            }
            break;
          case "habit_updated":
            qc.invalidateQueries({ queryKey: queryKeys.habits.all });
            qc.invalidateQueries({ queryKey: queryKeys.habits.today });
            break;
          case "insight_ready":
            qc.invalidateQueries({ queryKey: queryKeys.insights.latest });
            break;
          case "subscription_changed":
            qc.invalidateQueries({ queryKey: queryKeys.billing.status });
            qc.invalidateQueries({ queryKey: queryKeys.auth.me });
            break;
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      // Exponential backoff reconnect
      const delay = Math.min(reconnectDelay.current, 30_000);
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

**Key behaviors:**
- Auth via query param `?token=<access_token>` (WebSocket doesn't support custom headers).
- Exponential backoff reconnect: 1s → 2s → 4s → 8s → ... → max 30s.
- Each message type invalidates specific query keys (not `invalidateQueries()` globally).
- Connected in `(app)/layout.tsx` — only for authenticated users.

---

## 11. PWA Service Worker Strategy

### `public/sw.js`

```javascript
const CACHE_NAME = "habitarc-v1";
const STATIC_ASSETS = [
  "/",
  "/today",
  "/calendar",
  "/review",
  "/insights",
  "/settings",
  "/billing",
  "/login",
  "/signup",
  "/onboarding",
  "/manifest.json",
];

// ── Install: pre-cache app shell ───────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ─────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ─────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests: network-only (never cache API responses in SW)
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation requests: network-first, fallback to cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});
```

### Strategy Summary

| Resource Type | Strategy | Rationale |
|---|---|---|
| **API requests** (`/api/*`) | Network-only | Data must be fresh; offline handled by IndexedDB queue |
| **Page navigations** | Network-first, cache fallback | Show latest version; offline shows cached shell |
| **Static assets** (JS, CSS, images) | Cache-first, network fallback | Immutable hashed filenames; fast loads |
| **WebSocket** | Not cached | Real-time connection, not cacheable |

### `public/manifest.json`

```json
{
  "name": "HabitArc",
  "short_name": "HabitArc",
  "description": "Build better habits with streaks, insights, and tracking",
  "start_url": "/today",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#7c3aed",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## 12. Accessibility

### WCAG 2.1 AA Compliance Checklist

| Requirement | Implementation |
|---|---|
| **Color contrast** | All text meets 4.5:1 ratio. Habit colors are decorative accents only, never sole information carriers. |
| **Touch targets** | Minimum 48×48px for all interactive elements. CompletionToggle is 48px. Bottom nav items are 48px tall. |
| **Focus management** | Visible focus rings on all interactive elements. Dialog/Sheet trap focus. Escape closes modals. |
| **Screen reader** | All icons have `aria-label`. Habit cards use `aria-pressed` for toggle state. Progress bars use `aria-valuenow`. |
| **Keyboard navigation** | All actions reachable via Tab/Enter/Space. Habit list navigable with arrow keys. |
| **Reduced motion** | `useReducedMotion()` hook. Framer Motion animations disabled. CelebrationAnimation falls back to opacity fade. |
| **Error messages** | Associated with inputs via `aria-describedby`. Error boundaries have clear retry affordance. |
| **Loading states** | Skeleton components with `aria-busy="true"`. Spinners have `aria-label="Loading"`. |
| **Language** | `<html lang="en">` set in root layout. |

### Component-Level Patterns

```tsx
// CompletionToggle — accessible toggle button
<button
  role="switch"
  aria-checked={isComplete}
  aria-label={`Mark ${habitName} as ${isComplete ? "incomplete" : "complete"}`}
  className="min-h-[48px] min-w-[48px] ..."
  onClick={onToggle}
>
  {isComplete && <Check aria-hidden="true" />}
</button>

// StreakBadge — decorative, hidden from screen readers when zero
{count > 0 && (
  <span aria-label={`${count} day streak`}>
    <Flame aria-hidden="true" /> {count}
  </span>
)}

// Skeleton — announces loading state
<div role="status" aria-busy="true" aria-label="Loading habits">
  <HabitSkeleton />
  <span className="sr-only">Loading...</span>
</div>
```

---

## 13. Error Boundaries & Loading

### Error Boundary Hierarchy

```
RootLayout
├── app/error.tsx              — catches unhandled errors globally
│   └── "Something went wrong" + "Reload" button
│
└── (app)/
    ├── error.tsx              — catches errors within authenticated app
    │   └── "Failed to load" + "Retry" button + "Go to dashboard" link
    │
    └── [page]/
        └── Components use per-query error states
            └── Inline error message + "Retry" button
```

### `components/feedback/error-fallback.tsx`

```typescript
interface ErrorFallbackProps {
  error: Error;
  reset: () => void;       // from Next.js error boundary
  title?: string;
  showHome?: boolean;
}
```

Renders:
- Error icon
- Title (default: "Something went wrong")
- Error message (redacted for INTERNAL_ERROR)
- "Try again" button → calls `reset()`
- Optional "Go to dashboard" link

### Loading States

Every page has a corresponding skeleton:

```
/today    → HabitSkeleton (3 cards with pulse animation)
/calendar → HeatmapSkeleton (grid of grey squares)
/review   → ReviewSkeleton (progress bars + stats)
/insights → InsightSkeleton (text blocks)
/billing  → PlanCardSkeleton (3 plan cards)
```

Pattern:
```tsx
// In page component
const { data, isLoading, error } = useHabitsToday();

if (isLoading) return <HabitSkeleton count={3} />;
if (error) return <ErrorFallback error={error} reset={() => refetch()} />;
if (!data?.length) return <EmptyState title="No habits yet" action="Create your first habit" />;

return <HabitList habits={data} />;
```

---

## 14. Route Map & Deep Linking

### Route Table

| Path | Auth | Layout | Deep-linkable | Notes |
|---|---|---|---|---|
| `/` | — | — | — | Redirects to `/today` or `/onboarding` |
| `/onboarding` | — | `(auth)` | Yes | 3-screen carousel |
| `/login` | — | `(auth)` | Yes | Email/password |
| `/signup` | — | `(auth)` | Yes | Registration + guest merge |
| `/today` | Required | `(app)` | Yes | Primary dashboard |
| `/calendar` | Required | `(app)` | Yes | `?habit={id}` pre-selects habit |
| `/review` | Required | `(app)` | Yes | `?week=2026-W06` selects week |
| `/insights` | Required | `(app)` | Yes | Shows latest or generate prompt |
| `/settings` | Required | `(app)` | Yes | Profile + preferences |
| `/billing` | Required | `(app)` | Yes | `?success=true` / `?canceled=true` from Stripe |

### Deep Link Support

All query parameters are read from `useSearchParams()` and used to initialize component state:

```typescript
// /calendar?habit=abc-123
const searchParams = useSearchParams();
const preselectedHabit = searchParams.get("habit");

// /billing?success=true
const isSuccess = searchParams.get("success") === "true";
useEffect(() => {
  if (isSuccess) {
    toast.success("Subscription activated!");
    // Refresh subscription status
    queryClient.invalidateQueries({ queryKey: queryKeys.billing.status });
  }
}, [isSuccess]);
```

### Auth Guard

The `(app)/layout.tsx` handles auth gating:
1. On mount, `fetchUser()` is called in `providers.tsx`.
2. While loading → show skeleton.
3. If not authenticated → redirect to `/onboarding`.
4. If authenticated → render children + sidebar + bottom nav.

Guest users can access all `(app)` routes. Billing routes show "Sign up first" for guests.

---

*Document version: 1.0.0 — Generated for HabitArc frontend*
*Last updated: 2026-02-10*
