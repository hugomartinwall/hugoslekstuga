"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:tally:state";
const RESET_HOLD_MS = 700;

type Counter = { id: string; label: string; count: number };
type State = { counters: Counter[]; activeId: string };

function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const FIRST_ID = "t-first";
const TALLY_DEFAULT: State = {
  counters: [{ id: FIRST_ID, label: "Tally", count: 0 }],
  activeId: FIRST_ID,
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
  const [state, setState] = useLocalStorageState<State>(STORAGE_KEY, TALLY_DEFAULT);
  // Defensive coercion: an older single-counter shape might still be in
  // localStorage; this falls through to the default if anything's off.
  const safeState: State = useMemo(() => {
    const counters =
      Array.isArray(state.counters) && state.counters.length > 0
        ? state.counters
        : TALLY_DEFAULT.counters;
    const activeId = counters.some((c) => c.id === state.activeId)
      ? state.activeId
      : counters[0].id;
    return { counters, activeId };
  }, [state]);

  const active =
    safeState.counters.find((c) => c.id === safeState.activeId) ??
    safeState.counters[0];

  const [holding, setHolding] = useState(0);
  const [bumpId, setBumpId] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const holdRafRef = useRef<number | null>(null);

  const ensureAudio = () => {
    if (!audioRef.current) {
      try {
        audioRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {}
    }
    return audioRef.current;
  };

  // ---- counter operations ----------------------------------------------

  const updateActive = useCallback(
    (patch: Partial<Counter> | ((c: Counter) => Counter)) => {
      setState((s) => ({
        ...s,
        counters: s.counters.map((c) =>
          c.id === s.activeId
            ? typeof patch === "function"
              ? patch(c)
              : { ...c, ...patch }
            : c,
        ),
      }));
    },
    [setState],
  );

  const tap = useCallback(() => {
    updateActive((c) => ({ ...c, count: c.count + 1 }));
    setBumpId((b) => b + 1);
    const ctx = ensureAudio();
    if (ctx) {
      const jitter = 540 + Math.random() * 240;
      softClick(ctx, jitter);
    }
  }, [updateActive]);

  const undo = useCallback(() => {
    updateActive((c) => ({ ...c, count: Math.max(0, c.count - 1) }));
  }, [updateActive]);

  const resetActive = useCallback(() => {
    updateActive((c) => ({ ...c, count: 0 }));
  }, [updateActive]);

  const setActiveLabel = (label: string) => updateActive({ label });

  const switchTo = (id: string) => {
    setState((s) => ({ ...s, activeId: id }));
  };

  const addCounter = () => {
    const id = newId();
    setState((s) => ({
      counters: [...s.counters, { id, label: `Tally ${s.counters.length + 1}`, count: 0 }],
      activeId: id,
    }));
  };

  const removeCounter = (id: string) => {
    setState((s) => {
      if (s.counters.length <= 1) return s; // keep at least one
      const counters = s.counters.filter((c) => c.id !== id);
      const activeId = s.activeId === id ? counters[0].id : s.activeId;
      return { counters, activeId };
    });
  };

  // ---- long-press to reset ---------------------------------------------

  const startHold = useCallback(() => {
    holdStartRef.current = performance.now();
    const tick = () => {
      if (holdStartRef.current === null) return;
      const elapsed = performance.now() - holdStartRef.current;
      const pct = Math.min(1, elapsed / RESET_HOLD_MS);
      setHolding(pct);
      if (pct >= 1) {
        resetActive();
        holdStartRef.current = null;
        setHolding(0);
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  }, [resetActive]);

  const endHold = useCallback(() => {
    holdStartRef.current = null;
    setHolding(0);
    if (holdRafRef.current !== null) cancelAnimationFrame(holdRafRef.current);
  }, []);

  // ---- keyboard shortcuts ----------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLButtonElement
      )
        return;
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
      <div className="flex flex-col gap-4">
        {/* Tab bar — one chip per counter, plus add */}
        <div className="flex flex-wrap items-center gap-2">
          {safeState.counters.map((c) => {
            const isActive = c.id === safeState.activeId;
            return (
              <div key={c.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => switchTo(c.id)}
                  className={`flex items-center gap-2 rounded-l-full border-2 border-r-0 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    isActive ? "bg-orange text-cream" : "bg-cream hover:bg-orange-soft"
                  }`}
                >
                  <span className="max-w-[120px] truncate">{c.label}</span>
                  <span className="rounded-full bg-cream/20 px-1.5 font-mono tabular-nums">
                    {c.count}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeCounter(c.id)}
                  disabled={safeState.counters.length <= 1}
                  aria-label={`Remove ${c.label}`}
                  className={`rounded-r-full border-2 border-ink px-2 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isActive ? "bg-orange text-cream hover:bg-tomato" : "bg-cream hover:bg-tomato hover:text-cream"
                  }`}
                  title="Remove counter"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addCounter}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-orange-soft"
          >
            + add
          </button>
        </div>

        <input
          type="text"
          value={active.label}
          onChange={(e) => setActiveLabel(e.target.value)}
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
            aria-label={`Add one to ${active.label}. Spacebar also taps.`}
            className="card-chunk relative flex h-72 w-full select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-card)] bg-orange transition-transform active:scale-[0.985] sm:h-96"
          >
            <span
              key={`${active.id}-${bumpId}`}
              className="featured-in font-display text-7xl font-extrabold tabular-nums text-cream sm:text-9xl"
              style={{
                textShadow: "0 4px 0 #1a1812",
                transform: `rotate(${(bumpId % 5) - 2}deg)`,
              }}
            >
              {active.count}
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
            disabled={active.count === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
          >
            undo
          </button>
          <button
            type="button"
            onClick={resetActive}
            disabled={active.count === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
          >
            reset
          </button>
        </div>

        <p className="text-center text-xs text-ink-muted">
          Multiple counters keep their own count. Hold the big button for{" "}
          {RESET_HOLD_MS}ms to reset just the active one. Everything persists
          locally — close the tab and come back tomorrow.
        </p>
      </div>
    </ToolFrame>
  );
}
