"use client";

import { motion } from "framer-motion";
import { Check, Flame, Trash2, Edit, CalendarDays, Repeat, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToggleCompletion, useDeleteHabit } from "@/hooks/use-habits";
import type { HabitWithStatus } from "@/lib/types";

interface HabitCardProps {
  habit: HabitWithStatus;
  onEdit: (habit: HabitWithStatus) => void;
}

function scheduleLabel(habit: HabitWithStatus) {
  switch (habit.frequency) {
    case "weekly_days": {
      const days = (habit.frequency_config?.days as number[]) ?? [];
      const names = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
      return days.map((d) => names[d - 1]).join(", ");
    }
    case "weekly_target": {
      const n = (habit.frequency_config?.times_per_week as number) ?? 1;
      return `${n}x/week`;
    }
    default:
      return null;
  }
}

function ScheduleIcon({ frequency }: { frequency: string }) {
  switch (frequency) {
    case "weekly_days":
      return <CalendarDays className="h-3 w-3" />;
    case "weekly_target":
      return <Hash className="h-3 w-3" />;
    default:
      return <Repeat className="h-3 w-3" />;
  }
}

export function HabitCard({ habit, onEdit }: HabitCardProps) {
  const toggleCompletion = useToggleCompletion();
  const deleteHabit = useDeleteHabit();

  const progress =
    habit.target_per_day > 0
      ? Math.min((habit.completed_today / habit.target_per_day) * 100, 100)
      : 0;

  const handleToggle = () => {
    // Haptic feedback on mobile
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(50);
    }
    toggleCompletion.mutate({ habit_id: habit.id });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this habit?")) {
      deleteHabit.mutate(habit.id);
    }
  };

  const schedule = scheduleLabel(habit);
  const isDimmed = !habit.is_due_today && !habit.is_complete;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={`group relative overflow-hidden p-4 transition-shadow hover:shadow-md ${isDimmed ? "opacity-50" : ""}`}>
        {/* Color accent bar */}
        <div
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: habit.color }}
        />

        <div className="flex items-center gap-4 pl-3">
          {/* Completion toggle button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleToggle}
            disabled={toggleCompletion.isPending}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
              habit.is_complete
                ? "border-green-500 bg-green-500 text-white"
                : "border-muted-foreground/30 hover:border-primary"
            }`}
          >
            {habit.is_complete && <Check className="h-5 w-5" />}
          </motion.button>

          {/* Habit info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3
                className={`truncate font-medium ${
                  habit.is_complete
                    ? "text-muted-foreground line-through"
                    : ""
                }`}
              >
                {habit.name}
              </h3>
              {habit.current_streak > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-500">
                  <Flame className="h-3 w-3" />
                  {habit.current_streak}
                </span>
              )}
              {schedule && (
                <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <ScheduleIcon frequency={habit.frequency} />
                  {schedule}
                </span>
              )}
              {!habit.is_due_today && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Not due today
                </span>
              )}
            </div>

            {habit.target_per_day > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <Progress value={progress} className="h-2" />
                <span className="text-xs text-muted-foreground">
                  {habit.completed_today}/{habit.target_per_day}
                </span>
              </div>
            )}

            {habit.description && (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {habit.description}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(habit)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
