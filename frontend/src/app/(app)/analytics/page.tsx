"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { CalendarDays, TrendingUp, Grid3X3 } from "lucide-react";
import { useDailyStats, useHabits } from "@/hooks/use-habits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarHeatmap } from "@/components/habits/calendar-heatmap";

type Range = 7 | 14 | 30 | 90;

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>(30);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const startDate = format(subDays(new Date(), range), "yyyy-MM-dd");
  const endDate = format(new Date(), "yyyy-MM-dd");

  const { data: stats, isLoading } = useDailyStats({
    start_date: startDate,
    end_date: endDate,
  });
  const { data: habits } = useHabits();

  const chartData =
    stats?.map((s) => ({
      date: format(new Date(s.date), "MMM d"),
      rate: Math.round(s.completion_rate * 100),
      completed: Number(s.completed_habits),
      total: Number(s.total_habits),
    })) ?? [];

  const avgRate =
    chartData.length > 0
      ? Math.round(chartData.reduce((sum, d) => sum + d.rate, 0) / chartData.length)
      : 0;

  const habitStreaks =
    habits
      ?.filter((h) => h.current_streak > 0)
      .sort((a, b) => b.current_streak - a.current_streak) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your habit performance over time
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {([7, 14, 30, 90] as Range[]).map((r) => (
            <Button
              key={r}
              variant={range === r ? "default" : "ghost"}
              size="sm"
              className={`rounded-lg px-3 text-xs ${range === r ? "" : "text-muted-foreground"}`}
              onClick={() => setRange(r)}
            >
              {r}d
            </Button>
          ))}
        </div>
      </div>

      {/* Completion rate chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Completion Rate</CardTitle>
            <p className="text-sm text-muted-foreground">
              Average: {avgRate}% over last {range} days
            </p>
          </div>
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="animate-pulse text-muted-foreground">
                Loading chart...
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(262, 83%, 58%)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(262, 83%, 58%)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  domain={[0, 100]}
                  className="text-xs"
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(value: number) => [`${value}%`, "Completion Rate"]}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="hsl(262, 83%, 58%)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRate)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily completions bar chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Daily Completions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Habits completed per day
            </p>
          </div>
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-[250px] items-center justify-center">
              <div className="animate-pulse text-muted-foreground">
                Loading chart...
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  className="text-xs"
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Bar
                  dataKey="completed"
                  fill="hsl(262, 83%, 58%)"
                  radius={[4, 4, 0, 0]}
                  name="Completed"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Calendar Heatmap */}
      {habits && habits.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Calendar Heatmap</CardTitle>
              <p className="text-sm text-muted-foreground">
                Completion density over time
              </p>
            </div>
            <Grid3X3 className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {habits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setSelectedHabitId(h.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedHabitId === h.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/10"
                  }`}
                >
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: h.color }}
                  />
                  {h.name}
                </button>
              ))}
            </div>
            {selectedHabitId ? (
              <CalendarHeatmap habitId={selectedHabitId} months={3} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Select a habit above to view its heatmap
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Streak leaderboard */}
      {habitStreaks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Streaks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {habitStreaks.map((habit) => (
                <div
                  key={habit.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: habit.color }}
                    />
                    <span className="font-medium">{habit.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-orange-500">
                      {habit.current_streak} days
                    </span>
                    <span className="text-muted-foreground">
                      (best: {habit.longest_streak})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
