"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

type Mode = "wake" | "sleep" | "nap";

const STORAGE_KEY = "hugoslekstuga:sleep:state";

const CYCLE_MIN = 90;
const CYCLE_OPTIONS = [4, 5, 6];

/** Power-nap and full-cycle nap durations (minutes). The dead-zone in the
 *  middle (~30–80 min) tends to leave you groggy because you wake mid-deep. */
const NAP_OPTIONS = [
  { mins: 20, label: "Power nap", hint: "Alert, no grogginess" },
  { mins: 90, label: "Full cycle", hint: "One full sleep cycle" },
];

type Result = {
  cycles: number;
  /** Time in minutes since midnight. */
  minutes: number;
  totalSleepMin: number;
};

type SleepStored = {
  mode: Mode;
  time: string;
  /** Minutes the user typically takes to fall asleep. Defaults to 15. */
  fallAsleepMin: number;
};

const SLEEP_DEFAULT: SleepStored = {
  mode: "wake",
  time: "07:00",
  fallAsleepMin: 15,
};

export default function SleepPage() {
  const tool = findTool("sleep")!;
  const [stored, setStored] = useLocalStorageState<SleepStored>(STORAGE_KEY, SLEEP_DEFAULT);
  const mode: Mode =
    stored.mode === "wake" || stored.mode === "sleep" || stored.mode === "nap"
      ? stored.mode
      : "wake";
  const time = /^\d{2}:\d{2}$/.test(stored.time) ? stored.time : "07:00";
  const fallAsleepMin = clampInt(stored.fallAsleepMin ?? 15, 5, 45);
  const setMode = (m: Mode) => setStored((s) => ({ ...s, mode: m }));
  const setTime = (t: string) => setStored((s) => ({ ...s, time: t }));
  const setFallAsleepMin = (n: number) =>
    setStored((s) => ({ ...s, fallAsleepMin: clampInt(n, 5, 45) }));
  const [selected, setSelected] = useState<number>(0);

  // Reset selected when mode/time/fall-asleep changes. Selected is updated
  // by user clicks too, so it can't be a pure derived value.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelected(0);
  }, [mode, time, fallAsleepMin]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const targetMinutes = useMemo(() => parseTime(time), [time]);

  const results: Result[] = useMemo(() => {
    if (targetMinutes === null) return [];
    if (mode === "wake") {
      return CYCLE_OPTIONS.map((cycles) => ({
        cycles,
        minutes:
          (targetMinutes - cycles * CYCLE_MIN - fallAsleepMin + 24 * 60 * 7) %
          (24 * 60),
        totalSleepMin: cycles * CYCLE_MIN,
      })).reverse(); // longest first (recommended at index 0)
    }
    if (mode === "sleep") {
      return CYCLE_OPTIONS.map((cycles) => ({
        cycles,
        minutes:
          (targetMinutes + fallAsleepMin + cycles * CYCLE_MIN) % (24 * 60),
        totalSleepMin: cycles * CYCLE_MIN,
      }));
    }
    return [];
  }, [mode, targetMinutes, fallAsleepMin]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            I want to…
          </p>
          <div className="flex flex-wrap gap-2">
            <ModeButton active={mode === "wake"} onClick={() => setMode("wake")}>
              Wake up at…
            </ModeButton>
            <ModeButton active={mode === "sleep"} onClick={() => setMode("sleep")}>
              Go to bed at…
            </ModeButton>
            <ModeButton active={mode === "nap"} onClick={() => setMode("nap")}>
              Take a nap
            </ModeButton>
          </div>
        </div>

        {mode === "nap" ? (
          <NapPanel />
        ) : (
          <NightPanel
            mode={mode}
            time={time}
            setTime={setTime}
            fallAsleepMin={fallAsleepMin}
            setFallAsleepMin={setFallAsleepMin}
            results={results}
            targetMinutes={targetMinutes}
            selected={selected}
            setSelected={setSelected}
          />
        )}

        <WindDown />

        <p className="text-xs leading-relaxed text-ink-muted">
          Sleep cycles average about 90 minutes but vary 70–110 between people
          and across the night. Use these times as a useful default, not a
          prescription. The bigger wins are <em>consistent</em> bed and wake
          times, daylight in the eyes within an hour of waking, and a cool,
          dark, screen-free last hour before bed.
        </p>
      </div>
    </ToolFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Night panel — wake or sleep target                                  */
/* ------------------------------------------------------------------ */

function NightPanel({
  mode,
  time,
  setTime,
  fallAsleepMin,
  setFallAsleepMin,
  results,
  targetMinutes,
  selected,
  setSelected,
}: {
  mode: "wake" | "sleep";
  time: string;
  setTime: (t: string) => void;
  fallAsleepMin: number;
  setFallAsleepMin: (n: number) => void;
  results: Result[];
  targetMinutes: number | null;
  selected: number;
  setSelected: (n: number) => void;
}) {
  return (
    <>
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

      <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Time to fall asleep:{" "}
          <span className="font-bold tabular-nums">{fallAsleepMin} min</span>
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="range"
            min={5}
            max={45}
            step={1}
            value={fallAsleepMin}
            onChange={(e) => setFallAsleepMin(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-ink-muted">
            Average is 10–20 minutes. Bump it up if you tend to lie awake; bump
            it down if you crash the moment your head hits the pillow.
          </p>
        </div>
      </details>

      {results.length > 0 && targetMinutes !== null && (
        <CycleChart
          mode={mode}
          results={results}
          selected={selected}
          targetMinutes={targetMinutes}
          fallAsleepMin={fallAsleepMin}
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Nap panel                                                           */
/* ------------------------------------------------------------------ */

function NapPanel() {
  // Re-render once a minute so the "starts now" clock stays accurate.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const nowMins = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        If you lie down right now ({formatTime(nowMins)}), set the alarm for
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NAP_OPTIONS.map((n) => (
          <div
            key={n.mins}
            className="card-chunk flex flex-col gap-1 rounded-[var(--radius-card)] bg-cream p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-blue">
              {n.label}
            </p>
            <p className="font-display text-4xl font-extrabold tabular-nums sm:text-5xl">
              {formatTime((nowMins + n.mins) % (24 * 60))}
            </p>
            <p className="text-sm text-ink-soft">
              {n.mins} min · {n.hint}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        The middle ground (≈30–80 min) tends to leave you groggy — you wake
        mid-deep-sleep instead of after it. So either keep it short or commit
        to a full cycle. Caffeine right before a 20-min nap (a &ldquo;coffee
        nap&rdquo;) compounds the alertness boost.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wind-down checklist — collapsible                                   */
/* ------------------------------------------------------------------ */

function WindDown() {
  return (
    <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream p-4 text-sm">
      <summary className="cursor-pointer font-display text-base font-bold">
        Wind-down protocol{" "}
        <span className="font-normal text-ink-muted">
          · for the hour before bed
        </span>
      </summary>
      <ol className="mt-3 flex flex-col gap-2 pl-1 text-ink-soft">
        <li className="leading-relaxed">
          <span className="font-bold text-ink">60 min before:</span> stop
          eating. Especially anything heavy. Digestion fights deep sleep.
        </li>
        <li className="leading-relaxed">
          <span className="font-bold text-ink">60 min before:</span> dim the
          house lights. Big overheads off, lamps on. Your eyes are reading the
          time of day from this.
        </li>
        <li className="leading-relaxed">
          <span className="font-bold text-ink">45 min before:</span> screens
          off — or at least, no doomscroll, no social, no news. Reading on a
          dim e-reader is fine.
        </li>
        <li className="leading-relaxed">
          <span className="font-bold text-ink">30 min before:</span> cool the
          room. 16–19°C is the sweet spot for most adults. Cracking a window
          counts.
        </li>
        <li className="leading-relaxed">
          <span className="font-bold text-ink">15 min before:</span> brain
          dump anything still spinning. Pen and paper. &ldquo;Tomorrow
          I&rsquo;ll&hellip;&rdquo; Open loops on the page sleep better than
          open loops in your head.
        </li>
        <li className="leading-relaxed">
          <span className="font-bold text-ink">In bed:</span> lights off. If
          you&rsquo;re still awake after 20 minutes, get up briefly, sit
          somewhere dim, do something boring. Don&rsquo;t lie there fighting
          it.
        </li>
      </ol>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers + chart                                                     */
/* ------------------------------------------------------------------ */

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-chunk rounded-[var(--radius-button)] px-5 py-2 font-display text-base font-extrabold transition-colors ${
        active ? "bg-blue text-cream" : "bg-cream"
      }`}
    >
      {children}
    </button>
  );
}

function CycleChart({
  mode,
  results,
  selected,
  targetMinutes,
  fallAsleepMin,
}: {
  mode: "wake" | "sleep";
  results: Result[];
  selected: number;
  targetMinutes: number;
  fallAsleepMin: number;
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
  const sleepStart = fallAsleepMin; // minutes from bedtime when sleep begins
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

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}
