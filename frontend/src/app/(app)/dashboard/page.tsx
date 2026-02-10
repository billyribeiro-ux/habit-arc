"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Plus, Flame, Target, TrendingUp, Calendar } from "lucide-react";
import { useHabits, useDailyStats } from "@/hooks/use-habits";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HabitCard } from "@/components/habits/habit-card";
import { CreateHabitDialog } from "@/components/habits/create-habit-dialog";
import { MoodLogger } from "@/components/habits/mood-logger";
import { WeeklyReviewCard } from "@/components/habits/weekly-review-card";
import type { HabitWithStatus } from "@/lib/types";

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Good {getGreeting()}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-1 text-muted-foreground">{today}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Habit
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Today&apos;s Progress
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completionRate}%</div>
              <p className="text-xs text-muted-foreground">
                {completedCount} of {totalCount} habits
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Streaks
              </CardTitle>
              <Flame className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {habits?.filter((h) => h.current_streak > 0).length ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Longest: {longestStreak} days
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Completions
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCompletions}</div>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tracked Habits
              </CardTitle>
              <Calendar className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCount}</div>
              <p className="text-xs text-muted-foreground">Active habits</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Habits list */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Today&apos;s Habits</h2>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        ) : habits && habits.length > 0 ? (
          <div className="space-y-3">
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
          <Card className="flex flex-col items-center justify-center p-12 text-center">
            <Target className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="text-lg font-medium">No habits yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first habit to start building better routines.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first habit
            </Button>
          </Card>
        )}
      </div>

      {/* Sidebar cards */}
      <div className="grid gap-6 lg:grid-cols-2">
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
