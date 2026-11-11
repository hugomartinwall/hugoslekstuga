"use client";

import { useState } from "react";

/**
 * The "Custom — N min" chip for tools that offer a few preset durations
 * plus an arbitrary minute value (Focus). A `chip-chunk` with a small
 * `field-chunk` well in it for the number; the chip fills with the accent
 * when the active duration isn't one of the presets. It goes in the
 * trailing slot of the presets' `ChipGroup`, and takes its colour from
 * --accent like every other chip.
 *
 * The whole chip is the <label>, so a tap anywhere on it lands in the
 * number well.
 */
export default function CustomMinutes({
  currentSec,
  presets,
  onChange,
  min = 1,
  max = 180,
}: {
  currentSec: number;
  presets: number[];
  onChange: (min: number) => void;
  min?: number;
  max?: number;
}) {
  const isPreset = presets.includes(currentSec / 60);
  const [val, setVal] = useState<string>(
    isPreset ? "" : String(currentSec / 60),
  );
  const active = !isPreset && val;
  return (
    <label className="chip-chunk" aria-current={active ? "true" : undefined}>
      <span>Custom</span>
      {/* The well stays dark on a lit chip, so the number reads as a
          readout in both states. 16px text: iPhones zoom on less.
          `scheme-dark` only re-colours the browser's own stepper arrows,
          which are otherwise a white box on the dark well. */}
      <span className="field-chunk min-h-8 w-16 bg-cream">
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
          className="px-1 py-1 text-center tabular-nums scheme-dark select-text"
          placeholder="0"
        />
      </span>
      <span>min</span>
    </label>
  );
}
