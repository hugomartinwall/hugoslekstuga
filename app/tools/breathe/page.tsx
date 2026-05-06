"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type PhaseName = "in" | "hold-in" | "out" | "hold-out";

type Phase = {
  name: PhaseName;
  seconds: number;
  label: string;
};

type Pattern = {
  id: "box" | "478" | "calm" | "deep";
  name: string;
  description: string;
  phases: Phase[];
};

const PATTERNS: Pattern[] = [
  {
    id: "box",
    name: "Box · 4-4-4-4",
    description: "Equal in, hold, out, hold. Calm and grounding.",
    phases: [
      { name: "in", seconds: 4, label: "Breathe in" },
      { name: "hold-in", seconds: 4, label: "Hold" },
      { name: "out", seconds: 4, label: "Breathe out" },
      { name: "hold-out", seconds: 4, label: "Hold" },
    ],
  },
  {
    id: "478",
    name: "4-7-8",
    description: "Quick path to a parasympathetic state. For sleep or anxiety.",
    phases: [
      { name: "in", seconds: 4, label: "Breathe in" },
      { name: "hold-in", seconds: 7, label: "Hold" },
      { name: "out", seconds: 8, label: "Breathe out" },
    ],
  },
  {
    id: "calm",
    name: "Calm · 5-5",
    description: "Equal in and out, no holds. Light and rhythmic.",
    phases: [
      { name: "in", seconds: 5, label: "Breathe in" },
      { name: "out", seconds: 5, label: "Breathe out" },
    ],
  },
  {
    id: "deep",
    name: "Deep · 6-2-7",
    description: "A slightly longer exhale. Try this if 4-7-8 feels too sharp.",
    phases: [
      { name: "in", seconds: 6, label: "Breathe in" },
      { name: "hold-in", seconds: 2, label: "Hold" },
      { name: "out", seconds: 7, label: "Breathe out" },
    ],
  },
];

const STORAGE_KEY = "hugoslekstuga:breathe:pattern";

export default function BreathePage() {
  const tool = findTool("breathe")!;
  const [patternId, setPatternId] = useState<Pattern["id"]>("box");
  const [running, setRunning] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cycles, setCycles] = useState(0);
  const phaseStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Hydrate saved pattern.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && PATTERNS.some((p) => p.id === saved)) {
        setPatternId(saved as Pattern["id"]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, patternId);
    } catch {}
  }, [patternId]);

  const pattern = PATTERNS.find((p) => p.id === patternId)!;
  const phase = pattern.phases[phaseIndex] ?? pattern.phases[0];
  const phaseProgress = Math.min(1, elapsed / phase.seconds);

  // Animation loop: drive elapsed, advance phase, count cycles.
  useEffect(() => {
    if (!running) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      phaseStartRef.current = null;
      return;
    }
    phaseStartRef.current = performance.now();
    setElapsed(0);

    const tick = () => {
      if (phaseStartRef.current === null) return;
      const e = (performance.now() - phaseStartRef.current) / 1000;
      setElapsed(e);
      if (e >= phase.seconds) {
        setPhaseIndex((idx) => {
          const next = (idx + 1) % pattern.phases.length;
          if (next === 0) setCycles((c) => c + 1);
          return next;
        });
        phaseStartRef.current = performance.now();
        setElapsed(0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // We depend on phase.seconds and pattern length so phase changes trigger correct timing.
  }, [running, phase.seconds, pattern.phases.length]);

  const start = useCallback(() => {
    setPhaseIndex(0);
    setElapsed(0);
    setCycles(0);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    setPhaseIndex(0);
    setElapsed(0);
  }, []);

  // Compute the circle's scale based on phase + progress.
  const scale = computeScale(phase.name, phaseProgress);
  const circleScale = 0.5 + scale * 0.5; // 0.5 → 1.0
  // Text is light when the dark circle covers the center, dark when the
  // background bleeds through.
  const textOnDark = circleScale > 0.7;
  const textColor = textOnDark ? "#fbf6ee" : "#1a1812";

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-7">
        {!running && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Pick a pattern
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PATTERNS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPatternId(p.id)}
                  className={`card-chunk flex flex-col items-start gap-1 rounded-[var(--radius-card)] p-4 text-left transition-colors ${
                    patternId === p.id ? "bg-blue-soft" : "bg-cream hover:bg-blue-soft"
                  }`}
                >
                  <span className="font-display text-lg font-extrabold tracking-tight">
                    {p.name}
                  </span>
                  <span className="text-xs text-ink-soft">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card-chunk relative aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-blue-soft">
          {/* Aura ring */}
          <div
            className="absolute left-1/2 top-1/2 aspect-square rounded-full bg-blue/15"
            style={{
              width: "92%",
              transform: `translate(-50%, -50%) scale(${circleScale})`,
              transition: "transform 200ms linear",
            }}
            aria-hidden
          />
          {/* Inner breathing circle */}
          <div
            className="absolute left-1/2 top-1/2 aspect-square rounded-full border-2 border-ink bg-blue"
            style={{
              width: "70%",
              transform: `translate(-50%, -50%) scale(${circleScale})`,
              transition: "transform 200ms linear",
            }}
            aria-hidden
          />
          {/* Foreground label, fixed size, centered */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
            style={{ transition: "color 240ms linear", color: textColor }}
          >
            <p className="font-display text-3xl font-extrabold leading-none tracking-tight sm:text-5xl">
              {phase.label}
            </p>
            {running && (
              <p className="mt-1 font-mono text-sm tabular-nums sm:text-base">
                {Math.max(0, phase.seconds - elapsed).toFixed(1)}s
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-soft">
            {running ? (
              <>
                <span className="font-bold text-ink">{cycles}</span>{" "}
                cycle{cycles === 1 ? "" : "s"} · {pattern.name}
              </>
            ) : (
              <>{pattern.description}</>
            )}
          </div>
          <div className="flex gap-3">
            {running ? (
              <button
                type="button"
                onClick={stop}
                className="btn-chunk rounded-[var(--radius-button)] bg-cream px-6 py-3 font-display text-base font-extrabold"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={start}
                className="btn-chunk rounded-[var(--radius-button)] bg-blue px-7 py-3 font-display text-base font-extrabold text-cream"
              >
                Start
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Long, slow exhales activate the parasympathetic nervous system —
          that&rsquo;s the body&rsquo;s &ldquo;rest and digest&rdquo; mode.
          Even a minute helps.
        </p>
      </div>
    </ToolFrame>
  );
}

function computeScale(name: PhaseName, progress: number): number {
  // 0 = small, 1 = full. We ease the in/out phases so they feel breath-like.
  const eased = easeInOutSine(progress);
  switch (name) {
    case "in":
      return eased;
    case "hold-in":
      return 1;
    case "out":
      return 1 - eased;
    case "hold-out":
      return 0;
  }
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;
}
