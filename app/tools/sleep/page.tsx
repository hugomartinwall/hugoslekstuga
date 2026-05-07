"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

type Mode = "wake" | "sleep";

const STORAGE_KEY = "hugoslekstuga:sleep:state";

const FALL_ASLEEP_MIN = 15;
const CYCLE_MIN = 90;
const CYCLE_OPTIONS = [4, 5, 6];

type Result = {
  cycles: number;
  /** Time in minutes since midnight. */
  minutes: number;
  totalSleepMin: number;
};

type SleepStored = { mode: Mode; time: string };
const SLEEP_DEFAULT: SleepStored = { mode: "wake", time: "07:00" };

export default function SleepPage() {
  const tool = findTool("sleep")!;
  const [stored, setStored] = useLocalStorageState<SleepStored>(STORAGE_KEY, SLEEP_DEFAULT);
  const mode: Mode =
    stored.mode === "wake" || stored.mode === "sleep" ? stored.mode : "wake";
  const time = /^\d{2}:\d{2}$/.test(stored.time) ? stored.time : "07:00";
  const setMode = (m: Mode) => setStored((s) => ({ ...s, mode: m }));
  const setTime = (t: string) => setStored((s) => ({ ...s, time: t }));
  const [selected, setSelected] = useState<number>(0);

  // Reset selected when mode/time changes.
  useEffect(() => {
    setSelected(0);
  }, [mode, time]);

  const targetMinutes = useMemo(() => parseTime(time), [time]);

  const results: Result[] = useMemo(() => {
    if (targetMinutes === null) return [];
    if (mode === "wake") {
      return CYCLE_OPTIONS.map((cycles) => ({
        cycles,
        minutes:
          (targetMinutes - cycles * CYCLE_MIN - FALL_ASLEEP_MIN + 24 * 60 * 7) %
          (24 * 60),
        totalSleepMin: cycles * CYCLE_MIN,
      })).reverse(); // longest first (recommended at index 0)
    }
    return CYCLE_OPTIONS.map((cycles) => ({
      cycles,
      minutes:
        (targetMinutes + FALL_ASLEEP_MIN + cycles * CYCLE_MIN) % (24 * 60),
      totalSleepMin: cycles * CYCLE_MIN,
    }));
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

        {results.length > 0 && targetMinutes !== null && (
          <CycleChart
            mode={mode}
            results={results}
            selected={selected}
            targetMinutes={targetMinutes}
          />
        )}

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {mode === "wake"
              ? "To wake feeling rested, go to bed at"
              : "Ideal wake times if you fall asleep around then"}
          </p>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {results.map((r, i) => (
              <li key={`${r.cycles}-${r.minutes}`}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className={`card-chunk flex w-full flex-col gap-1 rounded-[var(--radius-card)] p-4 text-left transition-colors ${
                    selected === i
                      ? "bg-blue text-cream"
                      : i === 0
                        ? "bg-blue-soft hover:bg-blue hover:text-cream"
                        : "bg-cream hover:bg-blue-soft"
                  }`}
                >
                  <p className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                    {formatTime(r.minutes)}
                  </p>
                  <p
                    className={`text-sm ${selected === i ? "text-cream/80" : "text-ink-soft"}`}
                  >
                    {Math.round(r.totalSleepMin / 60)}h{" "}
                    {r.totalSleepMin % 60 === 0
                      ? ""
                      : `${r.totalSleepMin % 60}m`}{" "}
                    · {r.cycles} cycles
                  </p>
                  {i === 0 && (
                    <p
                      className={`text-xs font-semibold uppercase tracking-wide ${selected === i ? "text-cream" : "text-blue"}`}
                    >
                      Recommended
                    </p>
                  )}
                </button>
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

function CycleChart({
  mode,
  results,
  selected,
  targetMinutes,
}: {
  mode: Mode;
  results: Result[];
  selected: number;
  targetMinutes: number;
}) {
  const r = results[selected];
  if (!r) return null;

  // Define the night as bedtime → wake time in minutes.
  let bedtimeMin: number;
  let wakeMin: number;
  if (mode === "wake") {
    bedtimeMin = r.minutes;
    wakeMin = targetMinutes;
  } else {
    bedtimeMin = targetMinutes;
    wakeMin = r.minutes;
  }

  // Total night length, accounting for wrap past midnight.
  let nightTotal = wakeMin - bedtimeMin;
  if (nightTotal <= 0) nightTotal += 24 * 60;
  const sleepStart = FALL_ASLEEP_MIN; // minutes from bedtime when sleep begins
  const cycles = r.cycles;

  // Build the SVG geometry.
  const W = 1000;
  const H = 220;
  const PAD_L = 36;
  const PAD_R = 36;
  const PAD_T = 24;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xFor = (m: number) => PAD_L + (m / nightTotal) * innerW;
  const yFor = (depth: number) => PAD_T + depth * innerH; // 0 = surface, 1 = deep

  // Sample the wave: for each minute, depth = some sine over cycles.
  // We treat sleep as starting at `sleepStart` minutes in. Before that, depth = 0.
  const points: string[] = [];
  for (let m = 0; m <= nightTotal; m += 4) {
    let depth = 0;
    if (m >= sleepStart && m <= sleepStart + cycles * CYCLE_MIN) {
      const minIntoSleep = m - sleepStart;
      // Sine-shaped cycle: 0 at start/end of each cycle, peaks at half cycle.
      const phase = (minIntoSleep / CYCLE_MIN) * Math.PI; // 0..pi*cycles
      // Scale per-cycle so first cycle is deepest, later ones are shallower.
      const cycleIdx = Math.floor(minIntoSleep / CYCLE_MIN);
      const cycleScale = Math.max(0.5, 1 - cycleIdx * 0.12);
      depth = Math.sin(phase) * cycleScale;
      // Clamp to [0, 1] for visualization (we don't show "above water").
      depth = Math.max(0, depth);
    }
    points.push(`${xFor(m).toFixed(2)},${yFor(depth).toFixed(2)}`);
  }
  const linePath = `M ${points.join(" L ")}`;
  // Closed path for fill (extend to bottom-left and bottom-right).
  const fillPath = `${linePath} L ${xFor(nightTotal).toFixed(2)},${(PAD_T + innerH).toFixed(2)} L ${xFor(0).toFixed(2)},${(PAD_T + innerH).toFixed(2)} Z`;

  // Cycle boundaries — these are good wake points.
  const wakePoints: { m: number; idx: number }[] = [];
  for (let i = 0; i <= cycles; i++) {
    wakePoints.push({ m: sleepStart + i * CYCLE_MIN, idx: i });
  }

  return (
    <div className="card-chunk overflow-hidden rounded-[var(--radius-card)] bg-cream">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" preserveAspectRatio="none">
        {/* Surface line */}
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={W - PAD_R}
          y2={PAD_T}
          stroke="#1a1812"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          opacity="0.3"
        />
        <text
          x={PAD_L - 8}
          y={PAD_T + 4}
          fill="#8a857a"
          fontSize="11"
          textAnchor="end"
          fontWeight="600"
        >
          light
        </text>
        <text
          x={PAD_L - 8}
          y={PAD_T + innerH + 4}
          fill="#8a857a"
          fontSize="11"
          textAnchor="end"
          fontWeight="600"
        >
          deep
        </text>

        {/* Wave fill */}
        <path d={fillPath} fill="rgba(79, 102, 242, 0.18)" />
        <path d={linePath} fill="none" stroke="#4f66f2" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

        {/* Cycle markers (good wake times) */}
        {wakePoints.map(({ m, idx }) => (
          <g key={`wake-${idx}`}>
            <line
              x1={xFor(m)}
              y1={PAD_T}
              x2={xFor(m)}
              y2={PAD_T + innerH}
              stroke="#1a1812"
              strokeWidth="1"
              opacity="0.3"
            />
            {idx > 0 && (
              <circle
                cx={xFor(m)}
                cy={PAD_T}
                r={5}
                fill="#3fa66e"
                stroke="#1a1812"
                strokeWidth="2"
              />
            )}
          </g>
        ))}

        {/* Bedtime label */}
        <text x={PAD_L} y={H - 12} fill="#1a1812" fontSize="13" fontWeight="700" textAnchor="start">
          {formatTime(bedtimeMin)}
        </text>
        <text x={PAD_L} y={H - 28} fill="#8a857a" fontSize="11" fontWeight="600" textAnchor="start">
          BEDTIME
        </text>

        {/* Sleep starts marker */}
        <line
          x1={xFor(sleepStart)}
          y1={PAD_T + innerH - 4}
          x2={xFor(sleepStart)}
          y2={PAD_T + innerH + 12}
          stroke="#1a1812"
          strokeWidth="1.5"
        />
        <text
          x={xFor(sleepStart)}
          y={H - 12}
          fill="#8a857a"
          fontSize="10"
          textAnchor="middle"
        >
          asleep
        </text>

        {/* Wake label */}
        <text x={W - PAD_R} y={H - 12} fill="#1a1812" fontSize="13" fontWeight="700" textAnchor="end">
          {formatTime(wakeMin)}
        </text>
        <text x={W - PAD_R} y={H - 28} fill="#8a857a" fontSize="11" fontWeight="600" textAnchor="end">
          WAKE
        </text>
      </svg>
    </div>
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
