"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ToolColor } from "@/lib/tools";
import { accentVars } from "@/lib/colors";

/**
 * A labelled range: pixel label on the left, the value big on the right,
 * a track that fills with the accent, and a keycap thumb.
 *
 * It is a native <input type="range"> underneath (`range-chunk`, see
 * "The kit" in app/globals.css), so the keyboard, touch and screen
 * readers behave exactly as they always did. The 44px of height is the
 * touch target; the visible track is 8px.
 *
 * `color` is optional: inside a tool page the accent is already set by
 * ToolFrame. `display` replaces the value readout when the number alone
 * would not say enough ("off", "5 min").
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
  display,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
  unit?: string;
  color?: ToolColor;
  display?: ReactNode;
  className?: string;
}) {
  const span = max - min;
  const fill = span > 0 ? ((value - min) / span) * 100 : 0;
  const style = {
    ...(color ? accentVars(color) : null),
    "--fill": `${Math.min(100, Math.max(0, fill))}%`,
  } as CSSProperties;
  return (
    <label className={`block ${className}`.trim()}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="label-pixel">{label}</span>
        <span className="font-display text-xl leading-none tabular-nums text-ink">
          {display ?? (
            <>
              {value}
              {unit ?? ""}
            </>
          )}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-chunk"
        style={style}
      />
      {hint ? (
        <span className="block text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}
