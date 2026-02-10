export type SubscriptionTier = "free" | "plus" | "pro";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "inactive";
export type HabitFrequency = "daily" | "weekly_days" | "weekly_target";

export interface UserEntitlements {
  max_habits: number | null;
  schedule_types: string[];
  analytics_days: number;
  heatmap_months: number;
  ai_insights_per_week: number | null;
  reminders: "none" | { limited: number } | "unlimited";
  data_export: boolean;
}

export interface User {
  id: string;
  email: string | null;
  name: string;
  avatar_url: string | null;
  is_guest: boolean;
  is_demo: boolean;
  demo_expires_at: string | null;
  timezone: string;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus;
  entitlements: UserEntitlements;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface GuestTokenResponse extends TokenPair {
  guest_token: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  frequency: HabitFrequency;
  frequency_config: Record<string, unknown>;
  target_per_day: number;
  reminder_time: string | null;
  is_archived: boolean;
  sort_order: number;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  created_at: string;
  updated_at: string;
}

export interface HabitWithStatus extends Habit {
  completed_today: number;
  is_complete: boolean;
  is_due_today: boolean;
}

export interface Completion {
  id: string;
  habit_id: string;
  user_id: string;
  completed_date: string;
  value: number;
  note: string | null;
  created_at: string;
}

export interface StreakInfo {
  habit_id: string;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  completion_rate_30d: number;
}

export interface DailyStats {
  date: string;
  total_habits: number;
  completed_habits: number;
  completion_rate: number;
}

export interface HeatmapEntry {
  date: string;
  count: number;
  target: number;
}

export interface WeeklyReview {
  week_start: string;
  week_end: string;
  total_completions: number;
  total_possible: number;
  completion_rate: number;
  best_day: string | null;
  worst_day: string | null;
  habits: WeeklyHabitReview[];
}

export interface WeeklyHabitReview {
  id: string;
  name: string;
  completed: number;
  possible: number;
  rate: number;
}

export interface DailyLog {
  id: string;
  user_id: string;
  log_date: string;
  mood: number | null;
  energy: number | null;
  stress: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightResponse {
  summary: string;
  wins: string[];
  improvements: string[];
  mood_correlation: string | null;
  streak_analysis: string;
  tip_of_the_week: string;
  source: "claude" | "fallback";
}

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
}

export interface CreateHabitRequest {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  frequency?: HabitFrequency;
  frequency_config?: Record<string, unknown>;
  target_per_day?: number;
  reminder_time?: string;
}

export interface UpdateHabitRequest {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  frequency?: HabitFrequency;
  frequency_config?: Record<string, unknown>;
  target_per_day?: number;
  reminder_time?: string;
  is_archived?: boolean;
  sort_order?: number;
}

export interface CreateCompletionRequest {
  habit_id: string;
  completed_date?: string;
  value?: number;
  note?: string;
}

export interface ToggleCompletionRequest {
  habit_id: string;
  completed_date?: string;
}

export interface UpsertDailyLogRequest {
  log_date?: string;
  mood?: number;
  energy?: number;
  stress?: number;
  note?: string;
}

// ── Demo / Try Me Mode ───────────────────────────────────────────────────────

export interface DemoStartResponse {
  access_token: string;
  expires_in: number;
  demo_expires_at: string;
}

export interface DemoStatusResponse {
  is_demo: boolean;
  demo_expires_at: string | null;
  seconds_remaining: number;
  insight_calls_used: number;
  insight_calls_max: number;
  habits_count: number;
  completions_count: number;
}

export interface DemoConvertRequest {
  email: string;
  password: string;
  name: string;
}

export interface DemoConvertResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  migrated_habits: number;
  migrated_completions: number;
  migrated_streaks: boolean;
}
