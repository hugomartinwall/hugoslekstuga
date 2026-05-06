"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type StretchStep = {
  name: string;
  cue: string;
  seconds: number;
};

const ROUTINE: StretchStep[] = [
  {
    name: "Neck rolls",
    cue: "Slow circles, both directions. Drop the shoulders.",
    seconds: 30,
  },
  {
    name: "Shoulder rolls",
    cue: "Roll the shoulders back, up, forward, down. Big circles.",
    seconds: 30,
  },
  {
    name: "Wrist rotations",
    cue: "Make fists, rotate at the wrist. Open, stretch the fingers.",
    seconds: 25,
  },
  {
    name: "Side reach",
    cue: "Reach one arm overhead, lean to the opposite side. Switch.",
    seconds: 30,
  },
  {
    name: "Seated spine twist",
    cue: "Sit tall, twist gently to one side, hold, then the other.",
    seconds: 30,
  },
  {
    name: "Hip flexor stretch",
    cue: "Stand. Step one foot back, square the hips, sink. Switch sides.",
    seconds: 30,
  },
  {
    name: "Eye reset",
    cue: "Look 6 metres away. Soften the gaze. Blink slowly.",
    seconds: 20,
  },
];

export default function StretchPage() {
  const tool = findTool("stretch")!;
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [remaining, setRemaining] = useState(ROUTINE[0].seconds);
  const [done, setDone] = useState(false);
  const stepStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const totalSec = ROUTINE.reduce((a, s) => a + s.seconds, 0);

  // Animation loop drives remaining + step advancement.
  useEffect(() => {
    if (!running) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stepStartRef.current = null;
      return;
    }
    stepStartRef.current = performance.now();
    setRemaining(ROUTINE[stepIdx].seconds);

    const tick = () => {
      const start = stepStartRef.current;
      if (start === null) return;
      const elapsed = (performance.now() - start) / 1000;
      const left = ROUTINE[stepIdx].seconds - elapsed;
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        if (stepIdx < ROUTINE.length - 1) {
          setStepIdx((i) => i + 1);
          stepStartRef.current = performance.now();
        } else {
          setRunning(false);
          setDone(true);
          chime();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [running, stepIdx]);

  const start = useCallback(() => {
    setStepIdx(0);
    setRemaining(ROUTINE[0].seconds);
    setDone(false);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    setStepIdx(0);
    setDone(false);
  }, []);

  const skip = useCallback(() => {
    if (!running) return;
    if (stepIdx < ROUTINE.length - 1) {
      setStepIdx((i) => i + 1);
      stepStartRef.current = performance.now();
    } else {
      setRunning(false);
      setDone(true);
    }
  }, [running, stepIdx]);

  const step = ROUTINE[stepIdx];
  const progress = 1 - remaining / step.seconds;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        {!running && !done && (
          <Idle onStart={start} totalSec={totalSec} />
        )}

        {running && (
          <Active
            step={step}
            stepIdx={stepIdx}
            remaining={remaining}
            progress={progress}
            onStop={stop}
            onSkip={skip}
          />
        )}

        {done && <Done onAgain={start} />}

        {!running && (
          <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-4 text-sm">
            <summary className="cursor-pointer font-display text-base font-bold">
              The routine ({ROUTINE.length} stretches · {Math.round(totalSec / 60)} min)
            </summary>
            <ol className="mt-3 flex flex-col gap-2 pl-4 text-ink-soft">
              {ROUTINE.map((s, i) => (
                <li key={i} className="leading-relaxed">
                  <span className="font-bold text-ink">{s.name}</span>{" "}
                  <span className="text-xs text-ink-muted">· {s.seconds}s</span>
                  <br />
                  <span className="text-xs">{s.cue}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </ToolFrame>
  );
}

function Idle({
  onStart,
  totalSec,
}: {
  onStart: () => void;
  totalSec: number;
}) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-green-soft p-6 text-center sm:p-10">
      <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        Three minutes away from your screen.
      </p>
      <p className="text-base text-ink-soft">
        Seven gentle stretches, ~{Math.round(totalSec / 60)} minutes total.
        Stay seated for most of it.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-lg font-extrabold text-cream"
      >
        Start
      </button>
    </div>
  );
}

function Active({
  step,
  stepIdx,
  remaining,
  progress,
  onStop,
  onSkip,
}: {
  step: StretchStep;
  stepIdx: number;
  remaining: number;
  progress: number;
  onStop: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="card-chunk relative flex flex-col gap-4 overflow-hidden rounded-[var(--radius-card)] bg-cream p-6 sm:p-8">
      <div
        className="absolute left-0 top-0 h-full bg-green-soft transition-[width] duration-100 ease-linear"
        style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        aria-hidden
      />
      <div className="relative z-10 flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Stretch {stepIdx + 1} of {ROUTINE.length}
        </p>
        <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {step.name}
        </h2>
        <p className="max-w-md text-base text-ink-soft sm:text-lg">{step.cue}</p>
        <p className="font-display text-5xl font-extrabold tabular-nums sm:text-6xl">
          {Math.ceil(remaining)}s
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-semibold transition-colors hover:bg-cream-deep"
          >
            Skip ahead
          </button>
          <button
            type="button"
            onClick={onStop}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-semibold transition-colors hover:bg-tomato-soft"
          >
            End early
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({ onAgain }: { onAgain: () => void }) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-green-soft p-8 text-center">
      <p className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
        Nice.
      </p>
      <p className="text-base text-ink-soft">
        Your shoulders thank you. Your eyes thank you. Get back to it.
      </p>
      <button
        type="button"
        onClick={onAgain}
        className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-base font-extrabold text-cream"
      >
        Run it again
      </button>
    </div>
  );
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.18);
      g.gain.linearRampToValueAtTime(0.16, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.55);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}
