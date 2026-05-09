"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:picker:names";

const SHUFFLE_FRAMES = 18;
const SHUFFLE_INTERVAL = 70;

const SAMPLES = [
  ["Aria", "Bjorn", "Cyrus", "Dahlia", "Elias", "Freya", "Gus"],
  ["Pizza", "Burritos", "Ramen", "Curry", "Tacos", "Pho", "Sushi"],
  ["Walk", "Coffee", "Dishes", "Email", "Gym", "Read"],
];

export default function PickerPage() {
  const tool = findTool("picker")!;
  const [text, setText] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [face, setFace] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const lastTickRef = useRef(0);

  const names = useMemo(() => {
    return text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [text]);

  const remaining = useMemo(
    () => names.filter((n) => !removed.has(n)),
    [names, removed],
  );

  const pick = useCallback(() => {
    if (running || remaining.length === 0) return;
    setWinner(null);
    setRunning(true);
    let frame = 0;
    let last = "";
    lastTickRef.current = performance.now();
    const tick = () => {
      frame++;
      let n: string;
      let attempts = 0;
      do {
        n = remaining[Math.floor(Math.random() * remaining.length)];
        attempts++;
      } while (attempts < 6 && n === last);
      last = n;
      setFace(n);
      if (frame >= SHUFFLE_FRAMES) {
        const w = remaining[Math.floor(Math.random() * remaining.length)];
        setFace(w);
        setWinner(w);
        setRunning(false);
        return;
      }
      window.setTimeout(tick, SHUFFLE_INTERVAL);
    };
    tick();
  }, [running, remaining]);

  const removeWinner = () => {
    if (winner) {
      setRemoved((s) => new Set(s).add(winner));
      setWinner(null);
      setFace(null);
    }
  };

  const reset = () => {
    setRemoved(new Set());
    setWinner(null);
    setFace(null);
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="picker-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              One name per line (or comma-separated)
            </label>
            {names.length === 0 ? (
              <button
                type="button"
                onClick={() =>
                  setText(SAMPLES[Math.floor(Math.random() * SAMPLES.length)].join("\n"))
                }
                className="text-xs font-semibold text-tomato underline-offset-2 hover:underline"
              >
                try a sample
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  reset();
                }}
                className="text-xs font-semibold text-ink-muted hover:text-ink"
              >
                clear
              </button>
            )}
          </div>
          <textarea
            id="picker-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Aria\nBjorn\nCyrus\nDahlia\nElias"}
            rows={6}
            className="card-chunk min-h-[160px] rounded-[var(--radius-card)] bg-cream p-4 font-mono text-sm focus:outline-none"
          />
        </div>

        <div className="card-chunk relative flex h-44 w-full items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-tomato-soft">
          {face ? (
            <span
              key={face + (winner ? "-win" : "-shuffle")}
              className={`featured-in font-display font-extrabold tracking-tight ${winner ? "text-5xl text-tomato sm:text-6xl" : "text-3xl text-ink sm:text-4xl"}`}
            >
              {face}
            </span>
          ) : (
            <p className="text-sm text-ink-muted">
              {names.length === 0
                ? "Add some names above."
                : `${remaining.length} name${remaining.length === 1 ? "" : "s"} ready · hit pick`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={pick}
            disabled={running || remaining.length === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-6 py-3 font-display text-base font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "…shuffling…" : winner ? "Pick again" : "Pick"}
          </button>
          {winner && (
            <button
              type="button"
              onClick={removeWinner}
              className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-3 font-display text-sm font-extrabold"
            >
              Remove and pick next
            </button>
          )}
          {removed.size > 0 && (
            <button
              type="button"
              onClick={reset}
              className="text-xs font-semibold text-ink-muted hover:text-ink"
            >
              put everyone back ({removed.size} removed)
            </button>
          )}
        </div>

        {removed.size > 0 && (
          <div className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Already picked
            </p>
            <p className="mt-1 break-words font-mono text-sm text-ink-soft">
              {[...removed].join(", ")}
            </p>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Useful for raffles, who-pays, who-goes-first, pair-ups, draws.
          Names persist on this device — close the tab and come back to the same list.
        </p>
      </div>
    </ToolFrame>
  );
}
