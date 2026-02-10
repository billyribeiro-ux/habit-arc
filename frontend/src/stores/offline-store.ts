import { create } from "zustand";

interface QueuedAction {
  id: string;
  endpoint: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  timestamp: number;
}

interface OfflineState {
  isOnline: boolean;
  queue: QueuedAction[];
  setOnline: (online: boolean) => void;
  addToQueue: (action: Omit<QueuedAction, "id" | "timestamp">) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  queue: [],

  setOnline: (online) => set({ isOnline: online }),

  addToQueue: (action) => {
    const id = crypto.randomUUID();
    set((state) => ({
      queue: [...state.queue, { ...action, id, timestamp: Date.now() }],
    }));
    // Persist to localStorage
    if (typeof window !== "undefined") {
      const queue = get().queue;
      localStorage.setItem("offline_queue", JSON.stringify(queue));
    }
  },

  removeFromQueue: (id) => {
    set((state) => ({
      queue: state.queue.filter((item) => item.id !== id),
    }));
    if (typeof window !== "undefined") {
      const queue = get().queue;
      localStorage.setItem("offline_queue", JSON.stringify(queue));
    }
  },

  clearQueue: () => {
    set({ queue: [] });
    if (typeof window !== "undefined") {
      localStorage.removeItem("offline_queue");
    }
  },
}));
