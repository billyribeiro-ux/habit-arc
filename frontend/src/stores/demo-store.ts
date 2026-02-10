import { create } from "zustand";
import { api } from "@/lib/api";
import type {
  DemoStartResponse,
  DemoStatusResponse,
  DemoConvertRequest,
  DemoConvertResponse,
  User,
} from "@/lib/types";

interface DemoState {
  isDemo: boolean;
  demoExpiresAt: string | null;
  secondsRemaining: number;
  insightCallsUsed: number;
  insightCallsMax: number;
  isConverting: boolean;
  convertResult: DemoConvertResponse | null;

  startDemo: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  resetDemo: () => Promise<void>;
  convertDemo: (req: DemoConvertRequest) => Promise<DemoConvertResponse>;
  tick: () => void;
  clear: () => void;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  isDemo: false,
  demoExpiresAt: null,
  secondsRemaining: 0,
  insightCallsUsed: 0,
  insightCallsMax: 2,
  isConverting: false,
  convertResult: null,

  startDemo: async () => {
    const tz = typeof window !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";
    const resp = await api.post<DemoStartResponse>(
      "/api/demo/start",
      { timezone: tz },
      { skipAuth: true }
    );
    // Store the demo token (no refresh token for demo)
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", resp.access_token);
      localStorage.setItem("is_demo", "true");
    }
    set({
      isDemo: true,
      demoExpiresAt: resp.demo_expires_at,
      secondsRemaining: resp.expires_in,
    });
  },

  refreshStatus: async () => {
    try {
      const status = await api.get<DemoStatusResponse>("/api/demo/status");
      set({
        isDemo: status.is_demo,
        demoExpiresAt: status.demo_expires_at,
        secondsRemaining: status.seconds_remaining,
        insightCallsUsed: status.insight_calls_used,
        insightCallsMax: status.insight_calls_max,
      });
    } catch {
      // If status fails, demo may have expired
      get().clear();
    }
  },

  resetDemo: async () => {
    await api.post("/api/demo/reset");
    await get().refreshStatus();
  },

  convertDemo: async (req: DemoConvertRequest) => {
    set({ isConverting: true });
    try {
      const resp = await api.post<DemoConvertResponse>(
        "/api/demo/convert",
        req
      );
      // Replace tokens with real ones
      api.setTokens(resp.access_token, resp.refresh_token);
      if (typeof window !== "undefined") {
        localStorage.removeItem("is_demo");
      }
      set({
        isDemo: false,
        demoExpiresAt: null,
        secondsRemaining: 0,
        isConverting: false,
        convertResult: resp,
      });
      return resp;
    } catch (err) {
      set({ isConverting: false });
      throw err;
    }
  },

  tick: () => {
    const { secondsRemaining } = get();
    if (secondsRemaining > 0) {
      set({ secondsRemaining: secondsRemaining - 1 });
    }
  },

  clear: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("is_demo");
    }
    set({
      isDemo: false,
      demoExpiresAt: null,
      secondsRemaining: 0,
      insightCallsUsed: 0,
      convertResult: null,
    });
  },
}));
