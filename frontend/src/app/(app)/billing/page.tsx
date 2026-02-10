"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, Crown, Loader2, Zap, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SubscriptionInfo } from "@/lib/types";

const PLANS = [
  {
    name: "Free",
    tier: "free" as const,
    price: "$0",
    period: "forever",
    features: [
      "Up to 3 habits",
      "Daily schedule only",
      "Basic streak tracking",
      "7-day analytics",
      "1-month heatmap",
      "Mood / energy / stress logging",
    ],
  },
  {
    name: "Plus",
    tier: "plus" as const,
    price: "$4.99",
    period: "/month",
    priceId: "price_plus_monthly",
    features: [
      "Up to 15 habits",
      "All schedule types",
      "30-day analytics",
      "6-month heatmap",
      "1 AI insight per week",
      "Unlimited reminders",
      "Heatmap export",
    ],
    popular: true,
  },
  {
    name: "Pro",
    tier: "pro" as const,
    price: "$9.99",
    period: "/month",
    priceId: "price_pro_monthly",
    features: [
      "Unlimited habits",
      "Everything in Plus",
      "365-day analytics",
      "12-month heatmap",
      "On-demand AI insights",
      "CSV + JSON data export",
      "Priority support",
    ],
  },
];

export default function BillingPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isDemo = user?.is_demo ?? false;
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SubscriptionInfo>("/api/billing/subscription")
      .then(setSubscription)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCheckout = async (priceId: string) => {
    if (isDemo) {
      router.push("/demo/convert");
      return;
    }
    setCheckoutLoading(priceId);
    try {
      const { checkout_url } = await api.post<{ checkout_url: string }>(
        "/api/billing/checkout",
        { price_id: priceId }
      );
      window.location.href = checkout_url;
    } catch {
      // Handle error
    } finally {
      setCheckoutLoading(null);
    }
  };

  const currentTier = subscription?.tier ?? user?.subscription_tier ?? "free";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your subscription and billing
        </p>
      </div>

      {/* Current plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-500" />
            Current Plan: {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {subscription?.status === "active"
              ? "Your subscription is active."
              : currentTier === "free"
                ? "You are on the free plan."
                : `Status: ${subscription?.status ?? "unknown"}`}
          </p>
        </CardContent>
      </Card>

      {/* Demo mode billing guardrail */}
      {isDemo && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Billing is disabled in demo mode. Create an account to upgrade.
            </p>
            <Button
              size="sm"
              onClick={() => router.push("/demo/convert")}
              className="shrink-0"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Sign Up
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Plans */}
      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.tier}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card
              className={`relative flex h-full flex-col ${
                plan.popular ? "border-primary shadow-lg" : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Most Popular
                </div>
              )}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {plan.name}
                  {plan.popular && <Zap className="h-4 w-4 text-primary" />}
                </CardTitle>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Check className="h-4 w-4 shrink-0 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {plan.tier === currentTier ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : plan.priceId ? (
                    <Button
                      className="w-full"
                      variant={plan.popular ? "default" : "outline"}
                      onClick={() => handleCheckout(plan.priceId!)}
                      disabled={!!checkoutLoading}
                    >
                      {checkoutLoading === plan.priceId && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {isDemo ? "Sign up to upgrade" : `Upgrade to ${plan.name}`}
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full" disabled>
                      Free Forever
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
