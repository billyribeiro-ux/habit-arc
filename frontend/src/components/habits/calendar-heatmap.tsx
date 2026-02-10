"use client";

import { useMemo } from "react";
import { format, eachDayOfInterval, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { useHeatmap } from "@/hooks/use-habits";
import { cn } from "@/lib/utils";

interface CalendarHeatmapProps {
  habitId: string;
  months?: number;
}

export function CalendarHeatmap({ habitId, months = 3 }: CalendarHeatmapProps) {
  const { data: entries, isLoading } = useHeatmap(habitId, months);

  const { grid, weekLabels } = useMemo(() => {
    const today = new Date();
    const start = startOfWeek(subMonths(today, months), { weekStartsOn: 1 });
    const end = endOfWeek(today, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start, end });

    const entryMap = new Map<string, { count: number; target: number }>();
    entries?.forEach((e) => {
      entryMap.set(e.date, { count: e.count, target: e.target });
    });

    // Build grid: columns = weeks, rows = days (Mon-Sun)
    const weeks: { date: Date; count: number; target: number; intensity: number }[][] = [];
    let currentWeek: typeof weeks[0] = [];

    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      const entry = entryMap.get(key);
      const count = entry?.count ?? 0;
      const target = entry?.target ?? 1;
      const intensity = target > 0 ? Math.min(count / target, 1) : 0;

      currentWeek.push({ date: day, count, target, intensity });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    const labels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
    return { grid: weeks, weekLabels: labels };
  }, [entries, months]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-0.5">
        {/* Day labels */}
        <div className="flex flex-col gap-0.5 pr-1">
          {weekLabels.map((label, i) => (
            <div
              key={i}
              className="flex h-3 w-6 items-center text-[9px] text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => (
              <div
                key={di}
                title={`${format(day.date, "MMM d, yyyy")}: ${day.count}/${day.target}`}
                className={cn(
                  "h-3 w-3 rounded-sm transition-colors",
                  day.intensity === 0 && "bg-muted",
                  day.intensity > 0 && day.intensity <= 0.25 && "bg-primary/20",
                  day.intensity > 0.25 && day.intensity <= 0.5 && "bg-primary/40",
                  day.intensity > 0.5 && day.intensity <= 0.75 && "bg-primary/60",
                  day.intensity > 0.75 && "bg-primary"
                )}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        <div className="h-3 w-3 rounded-sm bg-muted" />
        <div className="h-3 w-3 rounded-sm bg-primary/20" />
        <div className="h-3 w-3 rounded-sm bg-primary/40" />
        <div className="h-3 w-3 rounded-sm bg-primary/60" />
        <div className="h-3 w-3 rounded-sm bg-primary" />
        <span>More</span>
      </div>
    </div>
  );
}
