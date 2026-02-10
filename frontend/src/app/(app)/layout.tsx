"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Flame,
  LayoutDashboard,
  BarChart3,
  Sparkles,
  CreditCard,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  UserPlus,
  X,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useOfflineStore } from "@/stores/offline-store";
import { useDemoStore } from "@/stores/demo-store";
import { useWebSocket } from "@/hooks/use-websocket";
import { DemoBanner } from "@/components/demo-banner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

function tierLabel(tier?: string, isDemo?: boolean) {
  if (isDemo) return "Demo Mode";
  switch (tier) {
    case "plus": return "Plus Plan";
    case "pro": return "Pro Plan";
    default: return "Free Plan";
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { isDemo, refreshStatus } = useDemoStore();

  useWebSocket();

  // Sync demo state from user profile
  useEffect(() => {
    if (user?.is_demo) {
      refreshStatus();
    }
  }, [user?.is_demo, refreshStatus]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/onboarding");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-lg text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r bg-card lg:block">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-2 px-6">
            <Flame className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">HabitArc</span>
            {!isOnline && (
              <WifiOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <Separator />

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          {/* User section */}
          <div className="border-t p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 truncate">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {tierLabel(user?.subscription_tier, user?.is_demo)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                className="h-8 w-8"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          <span className="font-bold">HabitArc</span>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && <WifiOff className="h-4 w-4 text-muted-foreground" />}
          {isOnline && <Wifi className="h-4 w-4 text-green-500" />}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 lg:pl-64">
        {/* Demo mode banner */}
        <DemoBanner />
        {/* Guest signup banner */}
        {user?.is_guest && !user?.is_demo && !bannerDismissed && (
          <div className="border-b bg-primary/5 px-4 py-2.5 text-center text-sm">
            <span className="text-muted-foreground">
              You&apos;re using a guest account.
            </span>{" "}
            <Link
              href="/register"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Sign up to save your progress
            </Link>
            <button
              onClick={() => setBannerDismissed(true)}
              className="ml-3 inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="container mx-auto max-w-6xl p-6 pt-20 lg:pt-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t bg-card lg:hidden">
        {navItems.slice(0, 4).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-1 text-muted-foreground"
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px]">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
