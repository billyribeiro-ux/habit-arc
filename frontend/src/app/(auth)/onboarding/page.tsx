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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background via-background to-primary/[0.03] px-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-12 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">HabitArc</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center text-center"
          >
            <div
              className={`mb-8 flex h-20 w-20 items-center justify-center rounded-2xl ${screen.bg} shadow-lg shadow-black/[0.03]`}
            >
              <screen.icon className={`h-10 w-10 ${screen.iconColor}`} />
            </div>

            <h1 className="text-3xl font-bold tracking-tight">
              {screen.title}
            </h1>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-muted-foreground">
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
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-primary shadow-sm shadow-primary/30"
                  : "w-2 bg-muted-foreground/20 hover:bg-muted-foreground/30"
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
                className="w-full gap-2"
                onClick={handleGetStarted}
                disabled={loading || demoLoading}
              >
                {loading ? "Setting up..." : "Get Started"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full gap-2 border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/30"
                onClick={handleTryMe}
                disabled={loading || demoLoading}
              >
                {demoLoading ? "Loading demo..." : "Try Me — no signup needed"}
                <Play className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full text-muted-foreground"
                onClick={handleSkipToSignup}
              >
                I already have an account
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" className="w-full gap-2" onClick={handleNext}>
                Next
                <ChevronRight className="h-4 w-4" />
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
