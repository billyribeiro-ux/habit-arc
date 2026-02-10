"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Plus, Flame, Target, TrendingUp, Calendar, Zap } from "lucide-react";
import { useHabits, useDailyStats } from "@/hooks/use-habits";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HabitCard } from "@/components/habits/habit-card";
import { CreateHabitDialog } from "@/components/habits/create-habit-dialog";
import { MoodLogger } from "@/components/habits/mood-logger";
import { WeeklyReviewCard } from "@/components/habits/weekly-review-card";
import type { HabitWithStatus } from "@/lib/types";

const STAT_CARDS = [
  { key: "progress", label: "Today's Progress", icon: Target, color: "text-primary", bg: "bg-primary/10" },
  { key: "streaks", label: "Active Streaks", icon: Flame, color: "text-orange-500", bg: "bg-orange-500/10" },
  { key: "completions", label: "Total Completions", icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { key: "tracked", label: "Tracked Habits", icon: Calendar, color: "text-blue-500", bg: "bg-blue-500/10" },
] as const;

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { data: habits, isLoading } = useHabits();
  const { data: stats } = useDailyStats();
  const [createOpen, setCreateOpen] = useState(false);
  const [editHabit, setEditHabit] = useState<HabitWithStatus | null>(null);

  const today = format(new Date(), "EEEE, MMMM d");
  const completedCount = habits?.filter((h) => h.is_complete).length ?? 0;
  const totalCount = habits?.length ?? 0;
  const completionRate =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const longestStreak = habits
    ? Math.max(...habits.map((h) => h.longest_streak), 0)
    : 0;
  const totalCompletions = habits
    ? habits.reduce((sum, h) => sum + h.total_completions, 0)
    : 0;
  const activeStreaks = habits?.filter((h) => h.current_streak > 0).length ?? 0;

  const statValues: Record<string, { value: string | number; sub: string }> = {
    progress: { value: `${completionRate}%`, sub: `${completedCount} of ${totalCount} habits` },
    streaks: { value: activeStreaks, sub: `Longest: ${longestStreak} days` },
    completions: { value: totalCompletions, sub: "All time" },
    tracked: { value: totalCount, sub: "Active habits" },
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Good {getGreeting()},{" "}
            <span className="gradient-text">{user?.name?.split(" ")[0]}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{today}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Habit</span>
        </Button>
      </div>

      {/* Stats cards */}
      <div className="stagger-enter grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((stat) => {
          const { value, sub } = statValues[stat.key];
          return (
            <Card key={stat.key} className="group hover:shadow-md transition-shadow">
              <CardContent className="flex items-center gap-4 p-5">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                  <p className="font-mono-num text-2xl font-bold tracking-tight">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{sub}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Habits list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Today&apos;s Habits</h2>
          {totalCount > 0 && (
            <span className="text-xs font-medium text-muted-foreground">
              {completedCount}/{totalCount} done
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[72px] animate-pulse rounded-xl bg-muted/60"
              />
            ))}
          </div>
        ) : habits && habits.length > 0 ? (
          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  onEdit={setEditHabit}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <Card className="flex flex-col items-center justify-center p-16 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">No habits yet</h3>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Create your first habit to start building better routines and tracking your progress.
            </p>
            <Button className="mt-6 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first habit
            </Button>
          </Card>
        )}
      </div>

      {/* Sidebar cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MoodLogger />
        <WeeklyReviewCard />
      </div>

      <CreateHabitDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
