"use client";

import { motion } from "framer-motion";
import { Calendar, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useWeeklyReview } from "@/hooks/use-habits";
import { format, parseISO } from "date-fns";

export function WeeklyReviewCard() {
  const { data: review, isLoading } = useWeeklyReview();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    );
  }

  if (!review) return null;

  const pct = Math.round(review.completion_rate * 100);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Weekly Review</CardTitle>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(review.week_start), "MMM d")} –{" "}
              {format(parseISO(review.week_end), "MMM d, yyyy")}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Overall rate */}
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Overall completion</span>
              <span className="font-bold">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
            <p className="mt-1 text-xs text-muted-foreground">
              {review.total_completions} of {review.total_possible} possible
            </p>
          </div>

          {/* Best / Worst day */}
          <div className="grid grid-cols-2 gap-4">
            {review.best_day && (
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  Best day
                </div>
                <p className="mt-1 text-sm font-semibold">{review.best_day}</p>
              </div>
            )}
            {review.worst_day && (
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingDown className="h-3 w-3 text-red-500" />
                  Needs work
                </div>
                <p className="mt-1 text-sm font-semibold">{review.worst_day}</p>
              </div>
            )}
          </div>

          {/* Per-habit breakdown */}
          {review.habits.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BarChart3 className="h-4 w-4" />
                Per-habit breakdown
              </div>
              {review.habits.map((h) => (
                <div key={h.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{h.name}</span>
                    <span className="text-muted-foreground">
                      {h.completed}/{h.possible} ({Math.round(h.rate * 100)}%)
                    </span>
                  </div>
                  <Progress value={Math.round(h.rate * 100)} className="h-1.5" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
