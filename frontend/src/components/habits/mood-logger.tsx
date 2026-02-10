"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Smile, Zap, Brain, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUpsertDailyLog } from "@/hooks/use-habits";

const MOOD_LABELS = ["", "Awful", "Bad", "Okay", "Good", "Great"];
const ENERGY_LABELS = ["", "Drained", "Low", "Normal", "High", "Energized"];
const STRESS_LABELS = ["", "Calm", "Low", "Moderate", "High", "Overwhelmed"];

interface SliderRowProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  labels: string[];
  onChange: (v: number) => void;
  color: string;
}

function SliderRow({ icon, label, value, labels, onChange, color }: SliderRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className="text-xs text-muted-foreground">
          {value > 0 ? labels[value] : "Not set"}
        </span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`h-8 flex-1 rounded-md text-xs font-medium transition-all ${
              v === value
                ? `${color} text-white shadow-sm`
                : v <= value
                ? `${color}/20`
                : "bg-muted hover:bg-muted-foreground/10"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MoodLogger() {
  const [mood, setMood] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [stress, setStress] = useState(0);
  const [saved, setSaved] = useState(false);
  const upsertLog = useUpsertDailyLog();

  const handleSave = async () => {
    if (mood === 0 && energy === 0 && stress === 0) return;
    await upsertLog.mutateAsync({
      mood: mood || undefined,
      energy: energy || undefined,
      stress: stress || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How are you feeling today?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <SliderRow
            icon={<Smile className="h-4 w-4 text-yellow-500" />}
            label="Mood"
            value={mood}
            labels={MOOD_LABELS}
            onChange={setMood}
            color="bg-yellow-500"
          />
          <SliderRow
            icon={<Zap className="h-4 w-4 text-blue-500" />}
            label="Energy"
            value={energy}
            labels={ENERGY_LABELS}
            onChange={setEnergy}
            color="bg-blue-500"
          />
          <SliderRow
            icon={<Brain className="h-4 w-4 text-red-500" />}
            label="Stress"
            value={stress}
            labels={STRESS_LABELS}
            onChange={setStress}
            color="bg-red-500"
          />

          <Button
            className="w-full"
            size="sm"
            onClick={handleSave}
            disabled={
              (mood === 0 && energy === 0 && stress === 0) ||
              upsertLog.isPending
            }
          >
            {saved ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Saved
              </>
            ) : upsertLog.isPending ? (
              "Saving..."
            ) : (
              "Log Today"
            )}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
