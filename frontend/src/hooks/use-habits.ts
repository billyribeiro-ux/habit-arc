import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  HabitWithStatus,
  Habit,
  CreateHabitRequest,
  UpdateHabitRequest,
  Completion,
  CreateCompletionRequest,
  ToggleCompletionRequest,
  StreakInfo,
  DailyStats,
  HeatmapEntry,
  WeeklyReview,
  DailyLog,
  UpsertDailyLogRequest,
} from "@/lib/types";

export function useHabits() {
  return useQuery<HabitWithStatus[]>({
    queryKey: ["habits"],
    queryFn: () => api.get("/api/habits"),
  });
}

export function useHabit(id: string) {
  return useQuery<Habit>({
    queryKey: ["habits", id],
    queryFn: () => api.get(`/api/habits/${id}`),
    enabled: !!id,
  });
}

export function useCreateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHabitRequest) =>
      api.post<Habit>("/api/habits", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
    },
  });
}

export function useUpdateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHabitRequest }) =>
      api.put<Habit>(`/api/habits/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
    },
  });
}

export function useDeleteHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/habits/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
    },
  });
}

export function useCreateCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCompletionRequest) =>
      api.post<Completion>("/api/completions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      queryClient.invalidateQueries({ queryKey: ["completions"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useToggleCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ToggleCompletionRequest) =>
      api.post<{ action: string; completion_id: string }>(
        "/api/completions/toggle",
        data
      ),
    onMutate: async (data) => {
      // Optimistic UI: toggle the habit's completion state immediately
      await queryClient.cancelQueries({ queryKey: ["habits"] });
      const previous = queryClient.getQueryData<HabitWithStatus[]>(["habits"]);
      if (previous) {
        queryClient.setQueryData<HabitWithStatus[]>(
          ["habits"],
          previous.map((h) =>
            h.id === data.habit_id
              ? {
                  ...h,
                  completed_today: h.is_complete
                    ? Math.max(0, h.completed_today - 1)
                    : h.completed_today + 1,
                  is_complete: !h.is_complete,
                }
              : h
          )
        );
      }
      return { previous };
    },
    onError: (_err, _data, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(["habits"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      queryClient.invalidateQueries({ queryKey: ["completions"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["heatmap"] });
    },
  });
}

export function useCompletions(params?: {
  start_date?: string;
  end_date?: string;
  habit_id?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.start_date) searchParams.set("start_date", params.start_date);
  if (params?.end_date) searchParams.set("end_date", params.end_date);
  if (params?.habit_id) searchParams.set("habit_id", params.habit_id);

  const query = searchParams.toString();
  return useQuery<Completion[]>({
    queryKey: ["completions", params],
    queryFn: () => api.get(`/api/completions${query ? `?${query}` : ""}`),
  });
}

export function useStreak(habitId: string) {
  return useQuery<StreakInfo>({
    queryKey: ["streak", habitId],
    queryFn: () => api.get(`/api/habits/${habitId}/streak`),
    enabled: !!habitId,
  });
}

export function useDailyStats(params?: {
  start_date?: string;
  end_date?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.start_date) searchParams.set("start_date", params.start_date);
  if (params?.end_date) searchParams.set("end_date", params.end_date);

  const query = searchParams.toString();
  return useQuery<DailyStats[]>({
    queryKey: ["stats", "daily", params],
    queryFn: () => api.get(`/api/stats/daily${query ? `?${query}` : ""}`),
  });
}

export function useHeatmap(habitId: string, months?: number) {
  const searchParams = new URLSearchParams();
  if (months) searchParams.set("months", months.toString());
  const query = searchParams.toString();
  return useQuery<HeatmapEntry[]>({
    queryKey: ["heatmap", habitId, months],
    queryFn: () =>
      api.get(`/api/habits/${habitId}/heatmap${query ? `?${query}` : ""}`),
    enabled: !!habitId,
  });
}

export function useWeeklyReview() {
  return useQuery<WeeklyReview>({
    queryKey: ["stats", "weekly-review"],
    queryFn: () => api.get("/api/stats/weekly-review"),
  });
}

export function useDailyLogs(params?: {
  start_date?: string;
  end_date?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.start_date) searchParams.set("start_date", params.start_date);
  if (params?.end_date) searchParams.set("end_date", params.end_date);
  const query = searchParams.toString();
  return useQuery<DailyLog[]>({
    queryKey: ["daily-logs", params],
    queryFn: () => api.get(`/api/daily-logs${query ? `?${query}` : ""}`),
  });
}

export function useUpsertDailyLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertDailyLogRequest) =>
      api.post<DailyLog>("/api/daily-logs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-logs"] });
    },
  });
}
