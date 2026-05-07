"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:zones:state";

type ZoneEntry = {
  id: string;
  label: string;
  tz: string; // IANA timezone
};

// Curated common zones, lightly favouring Europe/America since that's where
// most of Hugo's collaborators are likely to be.
const PRESET_ZONES: { label: string; tz: string }[] = [
  { label: "Stockholm", tz: "Europe/Stockholm" },
  { label: "London", tz: "Europe/London" },
  { label: "Paris", tz: "Europe/Paris" },
  { label: "Berlin", tz: "Europe/Berlin" },
  { label: "Madrid", tz: "Europe/Madrid" },
  { label: "Helsinki", tz: "Europe/Helsinki" },
  { label: "Lisbon", tz: "Europe/Lisbon" },
  { label: "Reykjavík", tz: "Atlantic/Reykjavik" },
  { label: "New York", tz: "America/New_York" },
  { label: "Toronto", tz: "America/Toronto" },
  { label: "Chicago", tz: "America/Chicago" },
  { label: "Denver", tz: "America/Denver" },
  { label: "Los Angeles", tz: "America/Los_Angeles" },
  { label: "São Paulo", tz: "America/Sao_Paulo" },
  { label: "Mexico City", tz: "America/Mexico_City" },
  { label: "Dubai", tz: "Asia/Dubai" },
  { label: "Mumbai", tz: "Asia/Kolkata" },
  { label: "Bangkok", tz: "Asia/Bangkok" },
  { label: "Singapore", tz: "Asia/Singapore" },
  { label: "Hong Kong", tz: "Asia/Hong_Kong" },
  { label: "Shanghai", tz: "Asia/Shanghai" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
  { label: "Seoul", tz: "Asia/Seoul" },
  { label: "Sydney", tz: "Australia/Sydney" },
  { label: "Auckland", tz: "Pacific/Auckland" },
  { label: "Cape Town", tz: "Africa/Johannesburg" },
  { label: "Lagos", tz: "Africa/Lagos" },
  { label: "Cairo", tz: "Africa/Cairo" },
];

const DEFAULT_ZONES: ZoneEntry[] = [
  { id: "home", label: "Stockholm", tz: "Europe/Stockholm" },
  { id: "ny", label: "New York", tz: "America/New_York" },
  { id: "ldn", label: "London", tz: "Europe/London" },
  { id: "tok", label: "Tokyo", tz: "Asia/Tokyo" },
];

export default function ZonesPage() {
  const tool = findTool("zones")!;
  const [zones, setZones] = useLocalStorageState<ZoneEntry[]>(STORAGE_KEY, DEFAULT_ZONES);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pickerSlider, setPickerSlider] = useState<number>(0); // minutes offset from now

  // Tick clock every 30s — minute precision is enough.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const targetTime = useMemo(() => now + pickerSlider * 60 * 1000, [now, pickerSlider]);

  const removeZone = useCallback((id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id));
  }, []);

  const addZone = useCallback((label: string, tz: string) => {
    setZones((prev) => [
      ...prev,
      { id: `${tz}-${Date.now()}`, label, tz },
    ]);
  }, []);

  const moveZone = useCallback((id: string, dir: -1 | 1) => {
    setZones((prev) => {
      const idx = prev.findIndex((z) => z.id === id);
      if (idx < 0) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next;
    });
  }, []);

  const presetSorted = useMemo(() => {
    const used = new Set(zones.map((z) => z.tz));
    return PRESET_ZONES.filter((p) => !used.has(p.tz));
  }, [zones]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <Picker
          minutesOffset={pickerSlider}
          onChange={setPickerSlider}
          targetTime={targetTime}
          firstZone={zones[0]}
        />

        <ol className="flex flex-col gap-2">
          {zones.map((z, i) => (
            <li key={z.id}>
              <ZoneRow
                zone={z}
                targetTime={targetTime}
                isHome={i === 0}
                isFirst={i === 0}
                isLast={i === zones.length - 1}
                onRemove={() => removeZone(z.id)}
                onUp={() => moveZone(z.id, -1)}
                onDown={() => moveZone(z.id, 1)}
              />
            </li>
          ))}
        </ol>

        <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-4">
          <summary className="cursor-pointer font-display text-base font-bold">
            Add a city
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {presetSorted.map((p) => (
              <button
                key={p.tz}
                type="button"
                onClick={() => addZone(p.label, p.tz)}
                className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-blue-soft"
              >
                + {p.label}
              </button>
            ))}
          </div>
        </details>
      </div>
    </ToolFrame>
  );
}

function Picker({
  minutesOffset,
  onChange,
  targetTime,
  firstZone,
}: {
  minutesOffset: number;
  onChange: (n: number) => void;
  targetTime: number;
  firstZone: ZoneEntry | undefined;
}) {
  const homeTz = firstZone?.tz;
  const homeLabel = firstZone?.label ?? "Home";
  return (
    <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Find a meeting time
        </p>
        <button
          type="button"
          onClick={() => onChange(0)}
          disabled={minutesOffset === 0}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-semibold transition-colors hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          Now
        </button>
      </div>
      <p className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
        {homeTz ? formatTime(targetTime, homeTz) : "—"}
      </p>
      <p className="text-sm text-ink-soft">
        {homeTz ? formatDate(targetTime, homeTz) : ""} · {homeLabel}
      </p>
      <input
        type="range"
        min={-12 * 60}
        max={36 * 60}
        step={15}
        value={minutesOffset}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-blue"
      />
      <p className="text-xs text-ink-muted">
        {offsetLabel(minutesOffset)} from now
      </p>
    </div>
  );
}

function ZoneRow({
  zone,
  targetTime,
  isHome,
  isFirst,
  isLast,
  onRemove,
  onUp,
  onDown,
}: {
  zone: ZoneEntry;
  targetTime: number;
  isHome: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const hour = getHour(targetTime, zone.tz);
  const tone = workHourTone(hour);
  return (
    <div
      className={`card-chunk flex items-center gap-3 rounded-[var(--radius-card)] p-4 sm:gap-5 ${tone.bg}`}
    >
      <div className="flex flex-col">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {zone.label}
          {isHome && (
            <span className="ml-2 rounded-full border-2 border-ink bg-blue px-2 py-0.5 text-[10px] font-bold text-cream">
              home
            </span>
          )}
        </p>
        <p className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
          {formatTime(targetTime, zone.tz)}
        </p>
        <p className="text-xs text-ink-soft">
          {formatDate(targetTime, zone.tz)} · {tone.label} · UTC{offsetForZone(targetTime, zone.tz)}
        </p>
      </div>
      <div className="ml-auto flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onUp}
            disabled={isFirst}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onDown}
            disabled={isLast}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-semibold text-ink-muted hover:text-tomato"
        >
          remove
        </button>
      </div>
    </div>
  );
}

function formatTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

function formatDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function getHour(ms: number, tz: string): number {
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return Number(t);
}

function offsetForZone(ms: number, tz: string): string {
  // Format: +02:00
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return off.replace(/^GMT/, "").replace(/^UTC/, "") || "+00:00";
}

function workHourTone(hour: number): { label: string; bg: string } {
  if (hour >= 9 && hour < 17) return { label: "working hours", bg: "bg-green-soft" };
  if (hour >= 7 && hour < 9) return { label: "early morning", bg: "bg-yellow-soft" };
  if (hour >= 17 && hour < 21) return { label: "evening", bg: "bg-yellow-soft" };
  return { label: "outside hours", bg: "bg-tomato-soft" };
}

function offsetLabel(min: number): string {
  if (min === 0) return "Now";
  const sign = min > 0 ? "+" : "−";
  const m = Math.abs(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${sign}${mm} min`;
  if (mm === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${mm}m`;
}
