"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, RotateCcw, UserPlus, AlertTriangle } from "lucide-react";
import { useDemoStore } from "@/stores/demo-store";
import { Button } from "@/components/ui/button";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DemoBanner() {
  const router = useRouter();
  const { isDemo, secondsRemaining, tick, resetDemo } = useDemoStore();
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (!isDemo) return;
    const interval = setInterval(() => tick(), 1000);
    return () => clearInterval(interval);
  }, [isDemo, tick]);

  // Show expiry modal when timer hits zero
  useEffect(() => {
    if (isDemo && secondsRemaining <= 0) {
      setShowExpiredModal(true);
    }
  }, [isDemo, secondsRemaining]);

  // Expiry modal overlay
  if (showExpiredModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold">Demo Expired</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your demo session has ended. Sign up to keep your habits, streaks, and insights.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => router.push("/demo/convert")} className="w-full">
              <UserPlus className="mr-2 h-4 w-4" />
              Create Account & Keep Data
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowExpiredModal(false);
                router.replace("/onboarding");
              }}
              className="w-full text-muted-foreground"
            >
              Start over
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isDemo) return null;

  const isUrgent = secondsRemaining < 600; // < 10 min

  return (
    <div
      className={`sticky top-0 z-30 border-b px-4 py-2 text-center text-sm ${
        isUrgent
          ? "bg-destructive/10 border-destructive/20"
          : "bg-amber-500/10 border-amber-500/20"
      }`}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Clock className={`h-3.5 w-3.5 ${isUrgent ? "text-destructive" : "text-amber-600"}`} />
          <span className={isUrgent ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
            Demo Mode
          </span>
          <span className="text-muted-foreground">
            &mdash; {formatTime(secondsRemaining)} remaining
          </span>
        </span>

        <span className="hidden sm:inline text-muted-foreground">|</span>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => resetDemo()}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => router.push("/demo/convert")}
          >
            <UserPlus className="h-3 w-3" />
            Save your progress
          </Button>
        </div>
      </div>
    </div>
  );
}
