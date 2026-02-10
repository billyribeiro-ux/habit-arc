"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Flame, Sparkles, ArrowRight, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";

const SCREENS = [
  {
    icon: Target,
    iconColor: "text-primary",
    title: "Build habits that stick",
    description:
      "Track your daily habits with a beautiful, distraction-free interface. One tap to complete, and watch your streaks grow.",
    bg: "bg-primary/5",
  },
  {
    icon: Flame,
    iconColor: "text-orange-500",
    title: "Streaks keep you going",
    description:
      "Never break the chain. HabitArc tracks your streaks automatically — daily, weekly, or custom schedules. Your consistency, visualized.",
    bg: "bg-orange-500/5",
  },
  {
    icon: Sparkles,
    iconColor: "text-purple-500",
    title: "Insights that matter",
    description:
      "Get AI-powered weekly insights, mood correlations, and personalized tips to optimize your routines. Works offline too.",
    bg: "bg-purple-500/5",
  },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const router = useRouter();
  const { startGuestSession, startDemoSession } = useAuthStore();

  const isLast = step === SCREENS.length - 1;

  const handleNext = () => {
    if (isLast) return;
    setStep((s) => s + 1);
  };

  const handleGetStarted = async () => {
    setLoading(true);
    try {
      await startGuestSession();
      router.push("/dashboard");
    } catch {
      router.push("/register");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipToSignup = () => {
    router.push("/register");
  };

  const handleTryMe = async () => {
    setDemoLoading(true);
    try {
      await startDemoSession();
      router.push("/dashboard");
    } catch {
      // Fallback to guest if demo fails
      await startGuestSession();
      router.push("/dashboard");
    } finally {
      setDemoLoading(false);
    }
  };

  const screen = SCREENS[step];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center text-center"
          >
            <div
              className={`mb-8 flex h-24 w-24 items-center justify-center rounded-3xl ${screen.bg}`}
            >
              <screen.icon className={`h-12 w-12 ${screen.iconColor}`} />
            </div>

            <h1 className="text-3xl font-bold tracking-tight">
              {screen.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {screen.description}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div className="mt-10 flex items-center justify-center gap-2">
          {SCREENS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? "w-8 bg-primary"
                  : "w-2 bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="mt-10 flex flex-col gap-3">
          {isLast ? (
            <>
              <Button
                size="lg"
                className="w-full"
                onClick={handleGetStarted}
                disabled={loading || demoLoading}
              >
                {loading ? "Setting up..." : "Get Started"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full border-primary/30 text-primary hover:bg-primary/5"
                onClick={handleTryMe}
                disabled={loading || demoLoading}
              >
                {demoLoading ? "Loading demo..." : "Try Me — no signup needed"}
                <Play className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={handleSkipToSignup}
              >
                I already have an account
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" className="w-full" onClick={handleNext}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={handleTryMe}
                disabled={demoLoading}
              >
                {demoLoading ? "Loading demo..." : "Try the app first"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
