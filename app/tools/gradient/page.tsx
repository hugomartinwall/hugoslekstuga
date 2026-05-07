"use client";

import { useCallback, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:gradient:state";

type GradientType = "linear" | "radial" | "conic";

type Stop = { id: number; color: string; pos: number };

type State = {
  type: GradientType;
  angle: number;
  stops: Stop[];
};

const DEFAULT: State = {
  type: "linear",
  angle: 135,
  stops: [
    { id: 1, color: "#ff7ab2", pos: 0 },
    { id: 2, color: "#4f66f2", pos: 100 },
  ],
};


function buildCss(state: State): string {
  const sorted = [...state.stops].sort((a, b) => a.pos - b.pos);
  const stopList = sorted.map((s) => `${s.color} ${s.pos}%`).join(", ");
  if (state.type === "linear") {
    return `linear-gradient(${state.angle}deg, ${stopList})`;
  }
  if (state.type === "radial") {
    return `radial-gradient(circle at center, ${stopList})`;
  }
  return `conic-gradient(from ${state.angle}deg at 50% 50%, ${stopList})`;
}

export default function GradientPage() {
  const tool = findTool("gradient")!;
  const [state, setState] = useLocalStorageState<State>(STORAGE_KEY, DEFAULT);
  const [copied, setCopied] = useState(false);

  const css = useMemo(() => buildCss(state), [state]);

  const updateStop = useCallback(
    (id: number, patch: Partial<Omit<Stop, "id">>) => {
      setState((s) => ({
        ...s,
        stops: s.stops.map((st) => (st.id === id ? { ...st, ...patch } : st)),
      }));
    },
    [setState],
  );

  const addStop = useCallback(() => {
    setState((s) => {
      // Derive a fresh id from the current stops rather than a module-level
      // counter — nextId would get out of sync with localStorage state
      // across tabs / page reloads.
      const id = s.stops.reduce((m, st) => Math.max(m, st.id), 0) + 1;
      return {
        ...s,
        stops: [...s.stops, { id, color: "#ffc233", pos: 50 }],
      };
    });
  }, [setState]);

  const removeStop = useCallback((id: number) => {
    setState((s) =>
      s.stops.length <= 2
        ? s
        : { ...s, stops: s.stops.filter((st) => st.id !== id) },
    );
  }, [setState]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`background: ${css};`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div
          className="card-chunk h-56 w-full rounded-[var(--radius-card)] sm:h-72"
          style={{ background: css }}
          aria-label="Live gradient preview"
        />

        <div className="flex flex-wrap items-center gap-2">
          {(["linear", "radial", "conic"] as GradientType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setState((s) => ({ ...s, type: t }))}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                state.type === t
                  ? "bg-pink text-cream"
                  : "bg-cream hover:bg-pink-soft"
              }`}
            >
              {t}
            </button>
          ))}
          {(state.type === "linear" || state.type === "conic") && (
            <label className="ml-auto flex items-center gap-2 text-xs">
              <span className="font-semibold text-ink-muted">angle</span>
              <input
                type="range"
                min={0}
                max={360}
                value={state.angle}
                onChange={(e) =>
                  setState((s) => ({ ...s, angle: Number(e.target.value) }))
                }
                className="w-24 accent-pink"
              />
              <span className="font-mono tabular-nums">{state.angle}°</span>
            </label>
          )}
        </div>

        <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Stops
            </p>
            <button
              type="button"
              onClick={addStop}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-pink-soft"
            >
              + add
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {state.stops.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-md border-2 border-ink bg-cream-deep p-2"
              >
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => updateStop(s.id, { color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded-md border-2 border-ink"
                />
                <input
                  type="text"
                  value={s.color}
                  onChange={(e) => updateStop(s.id, { color: e.target.value })}
                  className="w-20 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-xs"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={s.pos}
                  onChange={(e) => updateStop(s.id, { pos: Number(e.target.value) })}
                  className="flex-1 accent-pink"
                />
                <span className="w-10 font-mono text-xs tabular-nums">
                  {s.pos}%
                </span>
                <button
                  type="button"
                  onClick={() => removeStop(s.id)}
                  disabled={state.stops.length <= 2}
                  className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-tomato hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Remove stop"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            CSS
          </p>
          <div className="flex items-start gap-2">
            <pre className="card-chunk flex-1 overflow-x-auto rounded-[var(--radius-card)] bg-cream-deep p-3 font-mono text-xs">
{`background: ${css};`}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="btn-chunk shrink-0 rounded-[var(--radius-button)] bg-pink px-4 py-2 font-display text-sm font-extrabold text-cream"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </ToolFrame>
  );
}
