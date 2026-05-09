"use client";

import type { ToolColor } from "@/lib/tools";
import { accentClass } from "@/lib/colors";

/**
 * Boxed range input with an inline label + tabular-num value display.
 * The pattern was inlined in ascii, shadow, and trace; pulled out here so
 * the next slider doesn't reinvent it.
 *
 * Tools that compose a slider into a larger row (lorem) or pair it with
 * preset buttons (squeeze) keep their inline range — this component is
 * for the standalone "labelled slider in a card" case.
 */
export default function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
  unit,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
  unit?: string;
  color: ToolColor;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-md border-2 border-ink bg-cream-deep p-2 text-xs">
      <span className="flex items-center justify-between font-semibold uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink">
          {value}
          {unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={accentClass(color)}
      />
      {hint && <span className="text-[10px] text-ink-muted">{hint}</span>}
    </label>
  );
}
