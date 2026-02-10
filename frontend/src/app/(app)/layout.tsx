"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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

function tierBadgeClass(tier?: string, isDemo?: boolean) {
  if (isDemo) return "bg-amber-500/15 text-amber-500";
  switch (tier) {
    case "plus": return "bg-primary/15 text-primary";
    case "pro": return "bg-emerald-500/15 text-emerald-500";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { isDemo, refreshStatus } = useDemoStore();

  useWebSocket();

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
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — dark, premium */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] bg-[hsl(var(--sidebar))] lg:flex lg:flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Flame className="h-4.5 w-4.5 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">HabitArc</span>
          {!isOnline && (
            <WifiOff className="ml-auto h-3.5 w-3.5 text-[hsl(var(--sidebar-foreground))]" />
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 pt-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <item.icon className={`h-[18px] w-[18px] transition-colors ${isActive ? "text-primary" : "text-[hsl(var(--sidebar-foreground))] group-hover:text-white"}`} />
                {item.label}
                {isActive && (
                  <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-white/[0.08] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-sm font-semibold text-white ring-1 ring-white/10">
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium text-white">{user?.name}</p>
              <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tierBadgeClass(user?.subscription_tier, user?.is_demo)}`}>
                {tierLabel(user?.subscription_tier, user?.is_demo)}
              </span>
            </div>
            <button
              onClick={logout}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--sidebar-foreground))] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-card/80 backdrop-blur-md px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <span className="font-bold tracking-tight">HabitArc</span>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && <WifiOff className="h-4 w-4 text-muted-foreground" />}
          {isOnline && <Wifi className="h-4 w-4 text-emerald-500" />}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 lg:pl-[260px]">
        <DemoBanner />
        {user?.is_guest && !user?.is_demo && !bannerDismissed && (
          <div className="border-b bg-primary/[0.04] px-4 py-2.5 text-center text-sm">
            <span className="text-muted-foreground">
              You&apos;re using a guest account.
            </span>{" "}
            <Link
              href="/register"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Sign up to save your progress
            </Link>
            <button
              onClick={() => setBannerDismissed(true)}
              className="ml-3 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="page-enter mx-auto max-w-6xl px-4 py-6 pt-20 sm:px-6 lg:px-8 lg:pt-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t bg-card/80 backdrop-blur-md lg:hidden">
        {navItems.slice(0, 4).map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
