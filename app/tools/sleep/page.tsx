"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Mode = "wake" | "sleep";

const STORAGE_KEY = "hugoslekstuga:sleep:state";

const FALL_ASLEEP_MIN = 15;
const CYCLE_MIN = 90;
const CYCLE_OPTIONS = [4, 5, 6]; // typical adult range

export default function SleepPage() {
  const tool = findTool("sleep")!;
  const [mode, setMode] = useState<Mode>("wake");
  const [time, setTime] = useState<string>("07:00");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { mode?: Mode; time?: string };
        if (s.mode === "wake" || s.mode === "sleep") setMode(s.mode);
        if (s.time && /^\d{2}:\d{2}$/.test(s.time)) setTime(s.time);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, time }));
    } catch {}
  }, [mode, time, hydrated]);

  const targetMinutes = useMemo(() => parseTime(time), [time]);

  const results = useMemo(() => {
    if (targetMinutes === null) return [];
    if (mode === "wake") {
      // We want to wake at targetMinutes. Suggest go-to-bed times.
      // Bedtime + 15 min fall asleep + cycles*90 min ≡ wake time.
      return CYCLE_OPTIONS.map((cycles) => {
        const bedAt = (targetMinutes - cycles * CYCLE_MIN - FALL_ASLEEP_MIN + 24 * 60 * 7) % (24 * 60);
        return {
          cycles,
          minutes: bedAt,
          totalSleepMin: cycles * CYCLE_MIN,
        };
      }).reverse(); // longest sleep first
    }
    // mode === "sleep": user is going to bed at targetMinutes; suggest wake times.
    return CYCLE_OPTIONS.map((cycles) => {
      const wakeAt = (targetMinutes + FALL_ASLEEP_MIN + cycles * CYCLE_MIN) % (24 * 60);
      return {
        cycles,
        minutes: wakeAt,
        totalSleepMin: cycles * CYCLE_MIN,
      };
    });
  }, [mode, targetMinutes]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            I want to…
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("wake")}
              className={`btn-chunk rounded-[var(--radius-button)] px-5 py-2 font-display text-base font-extrabold transition-colors ${
                mode === "wake" ? "bg-blue text-cream" : "bg-cream"
              }`}
            >
              Wake up at…
            </button>
            <button
              type="button"
              onClick={() => setMode("sleep")}
              className={`btn-chunk rounded-[var(--radius-button)] px-5 py-2 font-display text-base font-extrabold transition-colors ${
                mode === "sleep" ? "bg-blue text-cream" : "bg-cream"
              }`}
            >
              Go to bed at…
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="sleep-time"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            {mode === "wake" ? "Wake time" : "Bedtime"}
          </label>
          <input
            id="sleep-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="card-chunk w-fit rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-2xl font-extrabold tabular-nums focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {mode === "wake"
              ? "To wake up feeling rested, go to bed at one of these times"
              : "If you fall asleep around then, ideal wake times are"}
          </p>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {results.map((r, i) => (
              <li
                key={`${r.cycles}-${r.minutes}`}
                className={`card-chunk flex flex-col gap-1 rounded-[var(--radius-card)] p-4 ${
                  i === 0 ? "bg-blue-soft" : "bg-cream"
                }`}
              >
                <p className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                  {formatTime(r.minutes)}
                </p>
                <p className="text-sm text-ink-soft">
                  {Math.round(r.totalSleepMin / 60)}h {r.totalSleepMin % 60 === 0 ? "" : `${r.totalSleepMin % 60}m`}{" "}
                  · {r.cycles} cycles
                </p>
                {i === 0 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue">
                    Recommended
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-ink-muted">
          Most people fall asleep about 15 minutes after lights-out, then move
          through 90-minute sleep cycles. Waking between cycles is gentler
          than waking inside one. Your mileage may vary.
        </p>
      </div>
    </ToolFrame>
  );
}

function parseTime(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return h * 60 + mn;
}

function formatTime(totalMin: number): string {
  const m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
