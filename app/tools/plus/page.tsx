"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:plus:state";

type State = {
  // start time as HH:mm
  start: string;
  // delta in minutes
  deltaMin: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function nowHHmm(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseHHmm(s: string): { h: number; m: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function fmtDelta(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

function dayLabel(deltaMin: number, startMin: number): string {
  const total = startMin + deltaMin;
  const dayShift = Math.floor(total / (24 * 60));
  if (dayShift === 0) return "today";
  if (dayShift === 1) return "tomorrow";
  if (dayShift === -1) return "yesterday";
  if (dayShift > 1) return `+${dayShift} days`;
  return `${Math.abs(dayShift)} days ago`;
}

function ClockFace({
  hours,
  minutes,
  size = 200,
  accent,
}: {
  hours: number;
  minutes: number;
  size?: number;
  accent: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const minuteAngle = (minutes / 60) * 360 - 90;
  const hourAngle = (((hours % 12) + minutes / 60) / 12) * 360 - 90;
  const tip = (angle: number, length: number) => {
    const a = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(a) * length, y: cy + Math.sin(a) * length };
  };
  const minTip = tip(minuteAngle, r * 0.78);
  const hourTip = tip(hourAngle, r * 0.55);
  const ticks = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="#fbf6ee"
        stroke="#1a1812"
        strokeWidth={3}
      />
      {ticks.map((i) => {
        const angle = (i / 12) * 360 - 90;
        const a = tip(angle, r - 4);
        const b = tip(angle, r - (i % 3 === 0 ? 14 : 10));
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#1a1812"
            strokeWidth={i % 3 === 0 ? 3 : 2}
            strokeLinecap="round"
          />
        );
      })}
      <line
        x1={cx}
        y1={cy}
        x2={hourTip.x}
        y2={hourTip.y}
        stroke="#1a1812"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={minTip.x}
        y2={minTip.y}
        stroke={accent}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={5} fill="#1a1812" />
    </svg>
  );
}

export default function PlusPage() {
  const tool = findTool("plus")!;
  const [state, setState] = useState<State>({ start: "12:00", deltaMin: 60 });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (parseHHmm(parsed.start)) {
          setState(parsed);
        } else {
          setState({ start: nowHHmm(), deltaMin: 60 });
        }
      } else {
        setState({ start: nowHHmm(), deltaMin: 60 });
      }
    } catch {
      setState({ start: nowHHmm(), deltaMin: 60 });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const parsed = useMemo(() => parseHHmm(state.start), [state.start]);
  const startMin = parsed ? parsed.h * 60 + parsed.m : 0;
  const totalRaw = startMin + state.deltaMin;
  const totalMin = ((totalRaw % (24 * 60)) + 24 * 60) % (24 * 60);
  const endH = Math.floor(totalMin / 60);
  const endM = totalMin % 60;
  const dayDelta = dayLabel(state.deltaMin, startMin);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="plus-start"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            Start at
          </label>
          <div className="flex items-center gap-3">
            <input
              id="plus-start"
              type="time"
              value={state.start}
              onChange={(e) => setState((s) => ({ ...s, start: e.target.value }))}
              className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-lg font-bold focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, start: nowHHmm() }))}
              className="text-xs font-semibold text-yellow underline-offset-2 hover:underline"
            >
              now
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Add
            </span>
            <span className="font-display text-2xl font-extrabold tabular-nums">
              {fmtDelta(state.deltaMin)}
            </span>
          </div>
          <input
            type="range"
            min={-24 * 60}
            max={24 * 60}
            step={5}
            value={state.deltaMin}
            onChange={(e) =>
              setState((s) => ({ ...s, deltaMin: Number(e.target.value) }))
            }
            className="w-full accent-yellow"
          />
          <div className="flex flex-wrap gap-2">
            {[15, 30, 60, 90, 120, 240, 480, 720].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setState((s) => ({ ...s, deltaMin: m }))}
                className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-yellow-soft"
              >
                +{m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, deltaMin: 0 }))}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
            >
              reset
            </button>
          </div>
        </div>

        <div className="card-chunk grid grid-cols-2 items-center gap-4 rounded-[var(--radius-card)] bg-yellow-soft p-5">
          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Start
            </span>
            <ClockFace
              hours={parsed?.h ?? 0}
              minutes={parsed?.m ?? 0}
              size={140}
              accent="#1a1812"
            />
            <span className="font-mono text-lg font-bold">{state.start}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              End
            </span>
            <ClockFace
              hours={endH}
              minutes={endM}
              size={180}
              accent="#ff5a3c"
            />
            <span className="font-mono text-2xl font-extrabold">
              {pad(endH)}:{pad(endM)}
            </span>
            <span className="text-xs font-semibold text-ink-muted">{dayDelta}</span>
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Drag the slider, watch the second clock swing. Range is ±24 hours;
          for further jumps just change the start time and slide again.
        </p>
      </div>
    </ToolFrame>
  );
}
