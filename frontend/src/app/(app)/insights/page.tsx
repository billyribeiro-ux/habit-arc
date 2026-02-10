"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, Lightbulb, TrendingUp, Brain, Trophy, ArrowUpRight, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InsightResponse } from "@/lib/types";

export default function InsightsPage() {
  const [insights, setInsights] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchInsights = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<InsightResponse>("/api/insights");
      setInsights(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate insights"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get personalized recommendations powered by Claude
          </p>
        </div>
        <Button onClick={fetchInsights} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {insights ? "Refresh Insights" : "Generate Insights"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!insights && !loading && !error && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Brain className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="text-lg font-medium">No insights yet</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Click &quot;Generate Insights&quot; to get AI-powered analysis of
            your habit data from the last 30 days.
          </p>
        </Card>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">
            Analyzing your habit data...
          </p>
        </div>
      )}

      {insights && !loading && (
        <div className="space-y-6">
          {insights.source === "fallback" && (
            <p className="text-xs text-muted-foreground text-center">
              AI was unavailable — showing template-based insights.
            </p>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-muted-foreground">
                  {insights.summary}
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {insights.wins.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardHeader className="flex flex-row items-center gap-3">
                  <Trophy className="h-5 w-5 text-green-500" />
                  <CardTitle>Wins</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.wins.map((win, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="mt-0.5 text-green-500">&#10003;</span>
                        {win}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <ArrowUpRight className="h-5 w-5 text-yellow-500" />
                <CardTitle>Areas to Improve</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {insights.improvements.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <CardTitle>Streak Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-muted-foreground">
                  {insights.streak_analysis}
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {insights.mood_correlation && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card>
                <CardHeader className="flex flex-row items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-blue-500" />
                  <CardTitle>Mood Correlation</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="leading-relaxed text-muted-foreground">
                    {insights.mood_correlation}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="flex flex-row items-center gap-3">
                <Lightbulb className="h-5 w-5 text-primary" />
                <CardTitle>Tip of the Week</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed font-medium">
                  {insights.tip_of_the_week}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}
