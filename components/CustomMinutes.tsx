"use client";

import { useState } from "react";
import type { ToolColor } from "@/lib/tools";
import { bgClass, preferredTextClass } from "@/lib/colors";

/**
 * Pill-shaped "Custom" input for tools that offer a few preset durations
 * plus an arbitrary minute value (Focus, Talk). Highlights itself when
 * the active duration isn't one of the presets.
 */
export default function CustomMinutes({
  currentSec,
  presets,
  onChange,
  color,
  min = 1,
  max = 180,
}: {
  currentSec: number;
  presets: number[];
  onChange: (min: number) => void;
  color: ToolColor;
  min?: number;
  max?: number;
}) {
  const isPreset = presets.includes(currentSec / 60);
  const [val, setVal] = useState<string>(
    isPreset ? "" : String(currentSec / 60),
  );
  const active = !isPreset && val;
  return (
    <label
      className={`flex items-center gap-2 rounded-full border-2 border-ink px-3 py-2 text-sm font-bold transition-colors ${
        active ? `${bgClass(color)} ${preferredTextClass(color)}` : "bg-cream"
      }`}
    >
      <span>Custom</span>
      <input
        type="number"
        min={min}
        max={max}
        value={val}
        onChange={(e) => {
          const v = e.target.value;
          setVal(v);
          const n = Number(v);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        className="w-12 bg-transparent text-center outline-none"
        placeholder="0"
      />
      <span>min</span>
    </label>
  );
}
