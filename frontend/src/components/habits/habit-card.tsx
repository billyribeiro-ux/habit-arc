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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className={`group relative overflow-hidden transition-all duration-200 hover:shadow-md ${isDimmed ? "opacity-40" : ""}`}>
        {/* Color accent bar */}
        <div
          className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
          style={{ backgroundColor: habit.color }}
        />

        <div className="flex items-center gap-4 p-4 pl-5">
          {/* Completion toggle button */}
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={handleToggle}
            disabled={toggleCompletion.isPending}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-200 ${
              habit.is_complete
                ? "border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                : "border-muted-foreground/20 hover:border-primary hover:bg-primary/5"
            }`}
          >
            {habit.is_complete && <Check className="h-5 w-5" />}
          </motion.button>

          {/* Habit info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3
                className={`truncate text-sm font-semibold ${
                  habit.is_complete
                    ? "text-muted-foreground line-through"
                    : ""
                }`}
              >
                {habit.name}
              </h3>
              {habit.current_streak > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-semibold text-orange-500">
                  <Flame className="h-3 w-3" />
                  {habit.current_streak}
                </span>
              )}
              {schedule && (
                <span className="hidden sm:flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <ScheduleIcon frequency={habit.frequency} />
                  {schedule}
                </span>
              )}
              {!habit.is_due_today && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  Not due today
                </span>
              )}
            </div>

            {habit.target_per_day > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <Progress value={progress} className="h-1.5" />
                <span className="text-[11px] font-medium text-muted-foreground">
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
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => onEdit(habit)}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
