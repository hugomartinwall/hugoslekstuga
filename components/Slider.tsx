"use client";

import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ToolColor } from "@/lib/tools";
import { accentVars } from "@/lib/colors";

/**
 * A labelled range: pixel label on the left, the value big on the right,
 * a track that fills with the accent, and a keycap thumb.
 *
 * It is a native <input type="range"> underneath (`range-chunk`, see
 * "The kit" in app/globals.css), so the keyboard, the mouse and screen
 * readers behave exactly as they always did. The 44px of height is the
 * touch target; the visible track is 8px.
 *
 * Under a finger the page takes over from the native control. A native
 * range jumps to wherever it is touched, and this one is 44px tall and
 * as wide as its panel: a page scroll that happened to begin on it
 * changed the value (on Strip that threw away the prepared file). So
 * where the main pointer is a finger the input ignores the pointer
 * (kit CSS) and the strip around it does the work: a sideways drag
 * moves the thumb, a tap goes to where it landed, and a swipe that
 * turns out to be a scroll changes nothing.
 *
 * `color` is optional: inside a tool page the accent is already set by
 * ToolFrame. `display` replaces the value readout when the number alone
 * would not say enough ("off", "5 min").
 */
/** The thumb's width, as the kit draws it (.range-chunk in globals.css). */
const THUMB_W = 18;
/** How far from the thumb's centre a finger still counts as on it. */
const THUMB_REACH = 24;
/** A touch that moves less than this before lifting is a tap. */
const TAP_SLOP = 8;
/** Sideways travel before a touch on the thumb becomes a drag. */
const DRAG_SLOP = 4;

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

  const inputRef = useRef<HTMLInputElement>(null);
  /** The touch in progress, if this strip is handling one. */
  const touch = useRef<{
    id: number;
    x: number;
    y: number;
    /** Where on the thumb it landed (0 when it began on the bare track). */
    grip: number;
    dragging: boolean;
    moved: boolean;
  } | null>(null);

  // The thumb's centre travels from half a thumb inside one end of the
  // track to half a thumb inside the other, as the browser draws it.
  const geometry = () => {
    const el = inputRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const run = Math.max(1, r.width - THUMB_W);
    return { left: r.left + THUMB_W / 2, run };
  };
  const valueAt = (clientX: number): number => {
    const g = geometry();
    if (!g || span <= 0) return value;
    const t = Math.min(1, Math.max(0, (clientX - g.left) / g.run));
    const s = step ?? 1;
    const snapped = min + Math.round((t * span) / s) * s;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const el = inputRef.current;
    const g = geometry();
    // Only where the kit has told the input to ignore the pointer (a
    // finger is the main pointer). Everywhere else the native control
    // is in charge and this does nothing.
    if (!el || !g || getComputedStyle(el).pointerEvents !== "none") return;
    const thumbX = g.left + (span > 0 ? (value - min) / span : 0) * g.run;
    const onThumb = Math.abs(e.clientX - thumbX) <= THUMB_REACH;
    touch.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      // A grab on the thumb keeps the finger's offset on it, so the
      // thumb does not jump under the finger. From the bare track the
      // thumb comes to the finger, as a native range's does.
      grip: onThumb ? e.clientX - thumbX : 0,
      dragging: false,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const t = touch.current;
    if (!t || t.id !== e.pointerId) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) t.moved = true;
    // A drag starts once the finger has gone sideways more than up or
    // down. A swipe that goes up or down is the page's (touch-action
    // lets it scroll, and the browser then takes the touch away).
    if (!t.dragging) {
      if (Math.abs(dx) < DRAG_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
      t.dragging = true;
    }
    const next = valueAt(e.clientX - t.grip);
    if (next !== value) onChange(next);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const t = touch.current;
    if (!t || t.id !== e.pointerId) return;
    touch.current = null;
    // A touch that lifted where it landed is a tap: go there.
    if (!t.dragging && !t.moved) {
      const next = valueAt(e.clientX);
      if (next !== value) onChange(next);
    }
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (touch.current?.id === e.pointerId) touch.current = null;
  };

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
      <span
        className="range-touch block"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <input
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range-chunk"
          style={style}
        />
      </span>
      {hint ? (
        <span className="block text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}
