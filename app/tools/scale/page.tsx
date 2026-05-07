"use client";

import { useMemo } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:scale:value";

type Thing = {
  meters: number;
  label: string;
  glyph: string;
};

const THINGS: Thing[] = [
  { meters: 0.001, label: "Grain of rice", glyph: "·" },
  { meters: 0.005, label: "Pea", glyph: "•" },
  { meters: 0.025, label: "Coin", glyph: "○" },
  { meters: 0.08, label: "Apple", glyph: "◍" },
  { meters: 0.15, label: "Banana", glyph: "⌒" },
  { meters: 0.3, label: "Standard ruler", glyph: "—" },
  { meters: 0.6, label: "Kitchen counter height", glyph: "▭" },
  { meters: 1.0, label: "Acoustic guitar", glyph: "𝅘" },
  { meters: 1.7, label: "Average human", glyph: "𝍫" },
  { meters: 2.4, label: "Door (taller side)", glyph: "▯" },
  { meters: 4.0, label: "Giraffe", glyph: "ʈ" },
  { meters: 6.5, label: "Garbage truck", glyph: "▤" },
  { meters: 12, label: "City bus", glyph: "▥" },
  { meters: 25, label: "Blue whale", glyph: "≋" },
  { meters: 73, label: "Statue of Liberty (no plinth)", glyph: "❡" },
  { meters: 105, label: "Football field (long side)", glyph: "▦" },
  { meters: 324, label: "Eiffel Tower", glyph: "▲" },
  { meters: 828, label: "Burj Khalifa", glyph: "△" },
  { meters: 1600, label: "A mile, more or less", glyph: "→" },
  { meters: 3776, label: "Mount Fuji (peak height)", glyph: "△" },
  { meters: 8849, label: "Mount Everest", glyph: "⏶" },
  { meters: 100_000, label: "Edge of space (Kármán line)", glyph: "⌬" },
  { meters: 12_742_000, label: "Earth — pole to pole", glyph: "⊙" },
  { meters: 384_400_000, label: "Earth to the Moon", glyph: "☾" },
];

function fmt(meters: number): string {
  if (meters < 0.01) return `${(meters * 1000).toFixed(1)} mm`;
  if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
  if (meters < 1000) return `${meters.toFixed(meters < 10 ? 2 : 1)} m`;
  if (meters < 1_000_000) return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
  return `${(meters / 1_000_000).toFixed(2)} Mm`;
}

const PRESETS = [0.1, 1, 10, 100, 1000, 10000];

export default function ScalePage() {
  const tool = findTool("scale")!;
  const [value, setValue] = useLocalStorageState<number>(STORAGE_KEY, 1.7);

  const closest = useMemo(() => {
    let best = THINGS[0];
    let bestDiff = Infinity;
    for (const t of THINGS) {
      const d = Math.abs(Math.log10(t.meters) - Math.log10(value || 1));
      if (d < bestDiff) {
        bestDiff = d;
        best = t;
      }
    }
    return best;
  }, [value]);

  const sortedThings = useMemo(() => [...THINGS].sort((a, b) => a.meters - b.meters), []);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="scale-input"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            How many metres?
          </label>
          <div className="flex items-center gap-3">
            <input
              id="scale-input"
              type="number"
              value={value}
              step="any"
              min={0}
              onChange={(e) => setValue(Number(e.target.value))}
              className="card-chunk flex-1 rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-2xl font-bold tabular-nums focus:outline-none"
            />
            <span className="font-display text-2xl font-extrabold text-ink-muted">
              m
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setValue(p)}
                className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-blue-soft"
              >
                {fmt(p)}
              </button>
            ))}
          </div>
        </div>

        <div className="card-chunk flex flex-col items-center gap-2 rounded-[var(--radius-card)] bg-blue-soft p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            About the size of
          </p>
          <span
            key={closest.label}
            className="featured-in font-display text-3xl font-extrabold tracking-tight text-blue sm:text-4xl"
          >
            {closest.label}
          </span>
          <span className="font-mono text-sm text-ink-soft">
            ({fmt(closest.meters)})
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            On the ladder
          </p>
          <ul className="card-chunk flex flex-col gap-1 rounded-[var(--radius-card)] bg-cream p-3">
            {sortedThings.map((t) => {
              const isClosest = t.label === closest.label;
              return (
                <li
                  key={t.label}
                  className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${isClosest ? "bg-blue-soft" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="w-5 text-center font-mono">
                      {t.glyph}
                    </span>
                    <span className={isClosest ? "font-bold" : ""}>{t.label}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-muted">
                    {fmt(t.meters)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-ink-muted">
          Comparisons span ten orders of magnitude — from a grain of rice to
          the distance to the Moon. Useful when a number is too big or small
          to picture.
        </p>
      </div>
    </ToolFrame>
  );
}
