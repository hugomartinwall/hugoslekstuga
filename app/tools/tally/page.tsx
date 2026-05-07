"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:tally:state";
const RESET_HOLD_MS = 700;

type State = {
  label: string;
  count: number;
};

function softClick(ctx: AudioContext, freq: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "triangle";
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.07);
}

export default function TallyPage() {
  const tool = findTool("tally")!;
  const [state, setState] = useState<State>({ label: "Tally", count: 0 });
  const [hydrated, setHydrated] = useState(false);
  const [holding, setHolding] = useState(0);
  const [bumpId, setBumpId] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const holdRafRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (typeof parsed.count === "number") setState(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const ensureAudio = () => {
    if (!audioRef.current) {
      try {
        audioRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {}
    }
    return audioRef.current;
  };

  const tap = useCallback(() => {
    setState((s) => ({ ...s, count: s.count + 1 }));
    setBumpId((b) => b + 1);
    const ctx = ensureAudio();
    if (ctx) {
      const jitter = 540 + Math.random() * 240;
      softClick(ctx, jitter);
    }
  }, []);

  const undo = useCallback(() => {
    setState((s) => ({ ...s, count: Math.max(0, s.count - 1) }));
  }, []);

  // Long-press to reset
  const startHold = useCallback(() => {
    holdStartRef.current = performance.now();
    const tick = () => {
      if (holdStartRef.current === null) return;
      const elapsed = performance.now() - holdStartRef.current;
      const pct = Math.min(1, elapsed / RESET_HOLD_MS);
      setHolding(pct);
      if (pct >= 1) {
        setState((s) => ({ ...s, count: 0 }));
        holdStartRef.current = null;
        setHolding(0);
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  }, []);

  const endHold = useCallback(() => {
    holdStartRef.current = null;
    setHolding(0);
    if (holdRafRef.current !== null) cancelAnimationFrame(holdRafRef.current);
  }, []);

  // Spacebar to tap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        tap();
      } else if (e.key === "Backspace") {
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, undo]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <input
          type="text"
          value={state.label}
          onChange={(e) => setState((s) => ({ ...s, label: e.target.value }))}
          placeholder="What are you counting?"
          maxLength={32}
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 text-center font-display text-xl font-bold focus:outline-none"
        />

        <div className="relative">
          <button
            type="button"
            onClick={tap}
            onMouseDown={startHold}
            onMouseUp={endHold}
            onMouseLeave={endHold}
            onTouchStart={startHold}
            onTouchEnd={endHold}
            aria-label={`Add one to ${state.label}. Spacebar also taps.`}
            className="card-chunk relative flex h-72 w-full select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-card)] bg-orange transition-transform active:scale-[0.985] sm:h-96"
          >
            <span
              key={bumpId}
              className="featured-in font-display text-7xl font-extrabold tabular-nums text-cream sm:text-9xl"
              style={{
                textShadow: "0 4px 0 #1a1812",
                transform: `rotate(${(bumpId % 5) - 2}deg)`,
              }}
            >
              {state.count}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-cream/80">
              tap, spacebar, or hold to reset
            </span>
            {holding > 0 && (
              <span
                className="pointer-events-none absolute bottom-0 left-0 h-2 bg-tomato"
                style={{ width: `${holding * 100}%` }}
              />
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={undo}
            disabled={state.count === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
          >
            undo
          </button>
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, count: 0 }))}
            disabled={state.count === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
          >
            reset
          </button>
        </div>

        <p className="text-center text-xs text-ink-muted">
          Hold the big button for {RESET_HOLD_MS}ms to reset. Counts persist on
          this device — you can close the tab and come back tomorrow.
        </p>
      </div>
    </ToolFrame>
  );
}
