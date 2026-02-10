import { create } from "zustand";
import { api } from "@/lib/api";
import type { User, TokenPair, GuestTokenResponse, DemoStartResponse } from "@/lib/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  startGuestSession: (timezone?: string) => Promise<void>;
  startDemoSession: () => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const tokens = await api.post<TokenPair>("/api/auth/login", {
      email,
      password,
    }, { skipAuth: true });
    api.setTokens(tokens.access_token, tokens.refresh_token);
    const user = await api.get<User>("/api/me");
    set({ user, isAuthenticated: true, isLoading: false });
  },

  register: async (email: string, password: string, name: string) => {
    const guestToken = typeof window !== "undefined"
      ? localStorage.getItem("guest_token")
      : null;
    const tokens = await api.post<TokenPair>("/api/auth/register", {
      email,
      password,
      name,
      guest_token: guestToken || undefined,
    }, { skipAuth: true });
    api.setTokens(tokens.access_token, tokens.refresh_token);
    if (typeof window !== "undefined") {
      localStorage.removeItem("guest_token");
    }
    const user = await api.get<User>("/api/me");
    set({ user, isAuthenticated: true, isLoading: false });
  },

  startGuestSession: async (timezone?: string) => {
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const resp = await api.post<GuestTokenResponse>("/api/auth/guest", {
      timezone: tz,
    }, { skipAuth: true });
    api.setTokens(resp.access_token, resp.refresh_token);
    if (typeof window !== "undefined") {
      localStorage.setItem("guest_token", resp.guest_token);
    }
    const user = await api.get<User>("/api/me");
    set({ user, isAuthenticated: true, isLoading: false });
  },

  startDemoSession: async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const resp = await api.post<DemoStartResponse>(
      "/api/demo/start",
      { timezone: tz },
      { skipAuth: true }
    );
    // Demo tokens: access only (no refresh)
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", resp.access_token);
      localStorage.setItem("is_demo", "true");
    }
    const user = await api.get<User>("/api/me");
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    api.clearTokens();
    if (typeof window !== "undefined") {
      localStorage.removeItem("guest_token");
      localStorage.removeItem("is_demo");
      window.location.href = "/login";
    }
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  fetchUser: async () => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      if (!token) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const user = await api.get<User>("/api/me");
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  setUser: (user) => set({ user, isAuthenticated: !!user }),
}));
