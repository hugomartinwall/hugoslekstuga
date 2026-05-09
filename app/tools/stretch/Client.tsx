"use client";

import { useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { localISODate } from "@/lib/dates";

type StretchStep = {
  name: string;
  cue: string;
  seconds: number;
};

type Routine = {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  steps: StretchStep[];
};

/* ------------------------------------------------------------------ */
/* Routines — pick the right length for the moment                    */
/* ------------------------------------------------------------------ */

const ROUTINES: Routine[] = [
  {
    slug: "eyes",
    name: "Quick eyes",
    emoji: "◉",
    description: "Eighty seconds. For after a long screen run.",
    steps: [
      {
        name: "Look far away",
        cue: "Find the furthest thing you can see — out the window, down the hall. Soften the gaze. Let the focus rest there.",
        seconds: 30,
      },
      {
        name: "Palm the eyes",
        cue: "Cup your hands over closed eyes. Block all the light. Don't press — just rest.",
        seconds: 20,
      },
      {
        name: "Slow circles",
        cue: "Eyes closed. Roll the eyeballs in slow circles, both directions. Lazy, not athletic.",
        seconds: 15,
      },
      {
        name: "Slow blinks",
        cue: "Fifteen full blinks. All the way closed, all the way open. Re-wets the eyes properly.",
        seconds: 15,
      },
    ],
  },
  {
    slug: "desk",
    name: "Desk reset",
    emoji: "❄",
    description: "About three minutes. The classic — works seated.",
    steps: [
      {
        name: "Neck rolls",
        cue: "Slow circles, both directions. Drop the shoulders away from the ears.",
        seconds: 30,
      },
      {
        name: "Shoulder rolls",
        cue: "Roll the shoulders back, up, forward, down. Big circles, slow tempo.",
        seconds: 30,
      },
      {
        name: "Wrist rotations",
        cue: "Make fists, rotate at the wrists. Open wide, stretch every finger out.",
        seconds: 25,
      },
      {
        name: "Side reach",
        cue: "One arm overhead, lean to the opposite side. Feel the stretch down the ribs. Switch halfway.",
        seconds: 30,
      },
      {
        name: "Seated spine twist",
        cue: "Sit tall. Twist gently to one side, hold, breathe in, breathe out. Then the other.",
        seconds: 30,
      },
      {
        name: "Hip flexor stretch",
        cue: "Stand. Step one foot back, square the hips, sink low. Switch sides halfway.",
        seconds: 30,
      },
      {
        name: "Eye reset",
        cue: "Look six metres away. Soften the gaze. Slow blinks.",
        seconds: 20,
      },
    ],
  },
  {
    slug: "neck",
    name: "Neck & shoulders",
    emoji: "◐",
    description: "Two and a half minutes. For tension that's been there all day.",
    steps: [
      {
        name: "Neck rolls",
        cue: "Slow circles. Both directions. Don't power through any cracks.",
        seconds: 30,
      },
      {
        name: "Ear to shoulder",
        cue: "Drop one ear toward the shoulder. Hand on the side of the head adds gentle weight, never pull. Switch halfway.",
        seconds: 40,
      },
      {
        name: "Chin tucks",
        cue: "Pull the chin straight back, like a turtle into its shell. Strange-looking, brilliantly effective.",
        seconds: 25,
      },
      {
        name: "Shoulder rolls",
        cue: "Big slow circles backward, then forward. Feel the shoulder blades move.",
        seconds: 30,
      },
      {
        name: "Doorway chest stretch",
        cue: "Forearm on a doorframe, step the same-side foot through. Open the chest. Switch sides.",
        seconds: 30,
      },
    ],
  },
  {
    slug: "full",
    name: "Full body",
    emoji: "✦",
    description: "Five and a half minutes. For coming back to your body after a long sit.",
    steps: [
      {
        name: "Neck rolls",
        cue: "Slow circles, both directions. Settle in.",
        seconds: 30,
      },
      {
        name: "Shoulder rolls",
        cue: "Big circles back, then forward. Slow as you can stand.",
        seconds: 30,
      },
      {
        name: "Side reach",
        cue: "One arm overhead, lean to the opposite side. Switch sides. Feel the ribs open.",
        seconds: 40,
      },
      {
        name: "Standing forward fold",
        cue: "Hinge from the hips, let the head hang heavy. Bend the knees as much as you need. The point is the back, not the toes.",
        seconds: 40,
      },
      {
        name: "Standing spine twist",
        cue: "Feet planted, hips forward. Twist gently from the waist. Switch sides.",
        seconds: 40,
      },
      {
        name: "Hip flexor lunge",
        cue: "Step one foot back into a lunge, square the hips, sink low. Hold. Switch sides halfway.",
        seconds: 50,
      },
      {
        name: "Hamstring reach",
        cue: "One leg straight in front, heel down, toes up. Hinge forward over that leg. Switch sides.",
        seconds: 40,
      },
      {
        name: "Calf stretch",
        cue: "One foot forward, one back. Press the back heel into the floor. Switch sides.",
        seconds: 40,
      },
      {
        name: "Eye reset",
        cue: "Look six metres away. Soften the gaze. Slow blinks.",
        seconds: 20,
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Persistence — completion counter + chosen routine                   */
/* ------------------------------------------------------------------ */

const STATE_KEY = "hugoslekstuga:stretch:state";

type StretchState = {
  /** Slug of the most-recently-picked routine. */
  routine: string;
  /** ISO date (YYYY-MM-DD) of the day we last counted on. */
  lastDate: string;
  /** Completions on `lastDate`. Resets when the day changes. */
  todayCount: number;
  /** All-time completions. */
  totalCount: number;
};

const DEFAULT_STATE: StretchState = {
  routine: "desk",
  lastDate: "",
  todayCount: 0,
  totalCount: 0,
};

function todayIso(): string {
  return localISODate(new Date());
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function StretchPage() {
  const tool = findTool("stretch")!;
  const [state, setState] = useLocalStorageState<StretchState>(
    STATE_KEY,
    DEFAULT_STATE,
  );
  const routine =
    ROUTINES.find((r) => r.slug === state.routine) ?? ROUTINES[1];

  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [remaining, setRemaining] = useState(routine.steps[0].seconds);
  const [done, setDone] = useState(false);
  const stepStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const totalSec = routine.steps.reduce((a, s) => a + s.seconds, 0);

  // Animation loop drives remaining + step advancement. setState-in-effect
  // is the standard pattern for wiring rAF into React state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!running) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stepStartRef.current = null;
      return;
    }
    stepStartRef.current = performance.now();
    setRemaining(routine.steps[stepIdx].seconds);

    const tick = () => {
      const start = stepStartRef.current;
      if (start === null) return;
      const elapsed = (performance.now() - start) / 1000;
      const left = routine.steps[stepIdx].seconds - elapsed;
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        if (stepIdx < routine.steps.length - 1) {
          setStepIdx((i) => i + 1);
          stepStartRef.current = performance.now();
        } else {
          setRunning(false);
          setDone(true);
          chime();
          // Increment counters. Reset today's count if the date changed.
          setState((s) => {
            const today = todayIso();
            const sameDay = s.lastDate === today;
            return {
              ...s,
              lastDate: today,
              todayCount: sameDay ? s.todayCount + 1 : 1,
              totalCount: s.totalCount + 1,
            };
          });
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [running, stepIdx, routine.steps, setState]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const start = () => {
    setStepIdx(0);
    setRemaining(routine.steps[0].seconds);
    setDone(false);
    setRunning(true);
  };

  const stop = () => {
    setRunning(false);
    setStepIdx(0);
    setDone(false);
  };

  const skip = () => {
    if (!running) return;
    if (stepIdx < routine.steps.length - 1) {
      setStepIdx((i) => i + 1);
      stepStartRef.current = performance.now();
    } else {
      setRunning(false);
      setDone(true);
    }
  };

  const pickRoutine = (slug: string) => {
    setState((s) => ({ ...s, routine: slug }));
    setStepIdx(0);
    const r = ROUTINES.find((x) => x.slug === slug);
    if (r) setRemaining(r.steps[0].seconds);
  };

  const step = routine.steps[stepIdx];
  const progress = 1 - remaining / step.seconds;

  // Show today's count fresh — if the stored date isn't today, today is 0.
  const today = todayIso();
  const todayCount = state.lastDate === today ? state.todayCount : 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        {!running && !done && (
          <Idle
            routine={routine}
            totalSec={totalSec}
            onStart={start}
            onPickRoutine={pickRoutine}
            todayCount={todayCount}
            totalCount={state.totalCount}
          />
        )}

        {running && (
          <Active
            routine={routine}
            step={step}
            stepIdx={stepIdx}
            remaining={remaining}
            progress={progress}
            onStop={stop}
            onSkip={skip}
          />
        )}

        {done && (
          <Done
            onAgain={start}
            onPickAnother={() => {
              setDone(false);
              setStepIdx(0);
            }}
            todayCount={todayCount}
            totalCount={state.totalCount}
          />
        )}

        {!running && !done && (
          <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-4 text-sm">
            <summary className="cursor-pointer font-display text-base font-bold">
              The {routine.name.toLowerCase()} routine
              {" "}
              <span className="font-normal text-ink-muted">
                · {routine.steps.length} stretches · {Math.round(totalSec / 60)} min
              </span>
            </summary>
            <ol className="mt-3 flex flex-col gap-2 pl-4 text-ink-soft">
              {routine.steps.map((s, i) => (
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

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Idle({
  routine,
  totalSec,
  onStart,
  onPickRoutine,
  todayCount,
  totalCount,
}: {
  routine: Routine;
  totalSec: number;
  onStart: () => void;
  onPickRoutine: (slug: string) => void;
  todayCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Pick a routine
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ROUTINES.map((r) => {
            const isActive = r.slug === routine.slug;
            const total = r.steps.reduce((a, s) => a + s.seconds, 0);
            return (
              <button
                key={r.slug}
                type="button"
                onClick={() => onPickRoutine(r.slug)}
                className={`btn-chunk flex flex-col items-start gap-1 rounded-[var(--radius-card)] p-4 text-left transition-colors ${
                  isActive
                    ? "bg-green text-cream"
                    : "bg-cream hover:bg-green-soft"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xl" aria-hidden>
                    {r.emoji}
                  </span>
                  <span className="font-display text-lg font-extrabold">
                    {r.name}
                  </span>
                  <span
                    className={`text-xs font-semibold ${isActive ? "text-cream/80" : "text-ink-muted"}`}
                  >
                    · {Math.round(total / 60)} min
                  </span>
                </div>
                <p className={`text-sm ${isActive ? "text-cream/90" : "text-ink-soft"}`}>
                  {r.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-green-soft p-6 text-center sm:p-8">
        <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          {routine.name} · {Math.round(totalSec / 60)} min
        </p>
        <p className="text-base text-ink-soft">{routine.description}</p>
        <button
          type="button"
          onClick={onStart}
          className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-lg font-extrabold text-cream"
        >
          Start
        </button>
      </div>

      {(todayCount > 0 || totalCount > 0) && (
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {todayCount > 0 && (
            <>
              {todayCount} done today
              {totalCount > 0 && " · "}
            </>
          )}
          {totalCount > 0 && <>{totalCount} all-time</>}
        </p>
      )}
    </div>
  );
}

function Active({
  routine,
  step,
  stepIdx,
  remaining,
  progress,
  onStop,
  onSkip,
}: {
  routine: Routine;
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
          {routine.name} · stretch {stepIdx + 1} of {routine.steps.length}
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

function Done({
  onAgain,
  onPickAnother,
  todayCount,
  totalCount,
}: {
  onAgain: () => void;
  onPickAnother: () => void;
  todayCount: number;
  totalCount: number;
}) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-green-soft p-8 text-center">
      <p className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
        Nice.
      </p>
      <p className="text-base text-ink-soft">
        Your shoulders thank you. Your eyes thank you. Get back to it.
      </p>
      {(todayCount > 0 || totalCount > 0) && (
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {todayCount} done today · {totalCount} all-time
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onAgain}
          className="btn-chunk rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-base font-extrabold text-cream"
        >
          Run it again
        </button>
        <button
          type="button"
          onClick={onPickAnother}
          className="rounded-full border-2 border-ink bg-cream px-5 py-2 text-sm font-semibold transition-colors hover:bg-cream-deep"
        >
          Pick another
        </button>
      </div>
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
