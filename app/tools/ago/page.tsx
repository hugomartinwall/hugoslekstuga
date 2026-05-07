"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:ago:date";

function isoForLocalInput(d: Date): string {
  // datetime-local format: YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Span = {
  label: string;
  value: number;
  small?: boolean;
};

function breakdown(thenMs: number, nowMs: number): Span[] {
  const past = nowMs >= thenMs;
  let diff = Math.abs(nowMs - thenMs);

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  // Months/years are approximate.
  const YEAR = 365.25 * DAY;
  const MONTH = YEAR / 12;

  const years = Math.floor(diff / YEAR);
  diff -= years * YEAR;
  const months = Math.floor(diff / MONTH);
  diff -= months * MONTH;
  const weeks = Math.floor(diff / WEEK);
  diff -= weeks * WEEK;
  const days = Math.floor(diff / DAY);
  diff -= days * DAY;
  const hours = Math.floor(diff / HOUR);
  diff -= hours * HOUR;
  const minutes = Math.floor(diff / MIN);
  diff -= minutes * MIN;
  const seconds = Math.floor(diff / SEC);

  void past;

  return [
    { label: "Years", value: years },
    { label: "Months", value: months },
    { label: "Weeks", value: weeks },
    { label: "Days", value: days },
    { label: "Hours", value: hours, small: true },
    { label: "Minutes", value: minutes, small: true },
    { label: "Seconds", value: seconds, small: true },
  ];
}

const SAMPLES: { label: string; iso: string }[] = [
  { label: "Y2K", iso: "2000-01-01T00:00" },
  { label: "Apollo 11", iso: "1969-07-20T20:17" },
  { label: "iPhone launch", iso: "2007-06-29T18:00" },
  { label: "Berlin Wall fell", iso: "1989-11-09T18:53" },
];

export default function AgoPage() {
  const tool = findTool("ago")!;
  const [input, setInput] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
  const [hydrated, setHydrated] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setInput(saved);
      else setInput(isoForLocalInput(new Date(Date.now() - 24 * 60 * 60 * 1000)));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input) localStorage.setItem(STORAGE_KEY, input);
    } catch {}
  }, [input, hydrated]);

  // Tick once per second
  useEffect(() => {
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= 250) {
        setNow(Date.now());
        last = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const thenMs = useMemo(() => {
    if (!input) return Date.now();
    const t = new Date(input).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }, [input]);

  const past = now >= thenMs;
  const spans = useMemo(() => breakdown(thenMs, now), [thenMs, now]);
  const totalSeconds = Math.floor(Math.abs(now - thenMs) / 1000);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="ago-input"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            Pick a date and time
          </label>
          <input
            id="ago-input"
            type="datetime-local"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-base focus:outline-none"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setInput(s.iso)}
                className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-purple-soft"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-purple-soft p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            That was
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {spans.slice(0, 4).map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center rounded-[var(--radius-card)] border-2 border-ink bg-cream p-3"
              >
                <span className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                  {s.value}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {spans.slice(4).map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center rounded-[var(--radius-card)] border-2 border-ink bg-cream p-2"
              >
                <span className="font-mono text-lg font-bold tabular-nums">
                  {s.value}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-soft">
            {past ? "ago." : "from now."}{" "}
            <span className="font-mono text-xs">
              ({totalSeconds.toLocaleString()} seconds total)
            </span>
          </p>
        </div>

        <p className="text-xs text-ink-muted">
          Months and years are approximate (calendar months vary).
          The seconds keep ticking — leave the page open and watch it run.
        </p>
      </div>
    </ToolFrame>
  );
}
