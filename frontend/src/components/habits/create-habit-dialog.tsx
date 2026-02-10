"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateHabit } from "@/hooks/use-habits";
import type { HabitFrequency } from "@/lib/types";

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
];

interface CreateHabitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DAY_LABELS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const SCHEDULE_OPTIONS: { value: HabitFrequency; label: string; desc: string }[] = [
  { value: "daily", label: "Daily", desc: "Every day" },
  { value: "weekly_days", label: "Specific days", desc: "Choose which days" },
  { value: "weekly_target", label: "Weekly target", desc: "N times per week" },
];

export function CreateHabitDialog({
  open,
  onOpenChange,
}: CreateHabitDialogProps) {
  const createHabit = useCreateHabit();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [targetPerDay, setTargetPerDay] = useState(1);
  const [frequency, setFrequency] = useState<HabitFrequency>("daily");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timesPerWeek, setTimesPerWeek] = useState(3);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const buildFrequencyConfig = () => {
    switch (frequency) {
      case "weekly_days":
        return { days: selectedDays };
      case "weekly_target":
        return { times_per_week: timesPerWeek };
      default:
        return {};
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await createHabit.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        frequency,
        frequency_config: buildFrequencyConfig(),
        target_per_day: targetPerDay,
      });
      setName("");
      setDescription("");
      setColor(COLORS[0]);
      setTargetPerDay(1);
      setFrequency("daily");
      setSelectedDays([1, 2, 3, 4, 5]);
      setTimesPerWeek(3);
      onOpenChange(false);
    } catch {
      // Error handled by TanStack Query
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Habit</DialogTitle>
          <DialogDescription>
            Add a new habit to track. Start small and build consistency.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="habit-name">Name</Label>
            <Input
              id="habit-name"
              placeholder="e.g., Morning meditation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="habit-description">Description (optional)</Label>
            <Input
              id="habit-description"
              placeholder="e.g., 10 minutes of mindfulness"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full transition-transform ${
                    color === c ? "scale-110 ring-2 ring-ring ring-offset-2" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCHEDULE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFrequency(opt.value)}
                  className={`rounded-lg border p-2 text-center text-xs transition-colors ${
                    frequency === opt.value
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {frequency === "weekly_days" && (
            <div className="space-y-2">
              <Label>Which days?</Label>
              <div className="flex gap-1.5">
                {DAY_LABELS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      selectedDays.includes(d.value)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted-foreground/10"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {frequency === "weekly_target" && (
            <div className="space-y-2">
              <Label htmlFor="times-per-week">Times per week</Label>
              <Input
                id="times-per-week"
                type="number"
                min={1}
                max={7}
                value={timesPerWeek}
                onChange={(e) => setTimesPerWeek(parseInt(e.target.value) || 1)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="target">Daily target</Label>
            <Input
              id="target"
              type="number"
              min={1}
              max={100}
              value={targetPerDay}
              onChange={(e) => setTargetPerDay(parseInt(e.target.value) || 1)}
            />
            <p className="text-xs text-muted-foreground">
              How many times per day do you want to complete this habit?
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createHabit.isPending}>
              {createHabit.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create Habit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
