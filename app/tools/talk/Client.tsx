"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import CustomMinutes from "@/components/CustomMinutes";

const STORAGE_KEY = "hugoslekstuga:talk:duration";

const PRESETS_MIN = [3, 5, 10, 15, 20, 30, 45, 60];

const MILESTONES = [0.25, 0.5, 0.75, 0.9, 1] as const;

export default function TalkPage() {
  const tool = findTool("talk")!;
  const [durationSec, setDurationSec] = useLocalStorageState<number>(STORAGE_KEY, 10 * 60);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState<number>(0);
  const [hitMilestones, setHitMilestones] = useState<Set<number>>(() => new Set());
  // These were refs; lifting to state lets `remainingSec` and `overByMs`
  // be derived purely (no ref reads during render).
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [baseRemaining, setBaseRemaining] = useState<number>(0);

  // Tick
  useEffect(() => {
    if (!running || paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, paused]);

  const remainingSec = useMemo(() => {
    if (!running) return durationSec;
    if (paused) return baseRemaining;
    if (startedAt === null) return baseRemaining;
    const elapsed = (now - startedAt) / 1000;
    return Math.max(0, baseRemaining - elapsed);
  }, [running, paused, now, durationSec, baseRemaining, startedAt]);

  const progress = 1 - remainingSec / durationSec;

  // Watch for crossed milestones to chime + flash. The chime is an
  // imperative side effect that needs to happen exactly once per crossing,
  // and the new milestone must persist as state — useMemo can't replace
  // this effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!running || paused) return;
    for (const m of MILESTONES) {
      if (progress >= m && !hitMilestones.has(m)) {
        setHitMilestones((prev) => new Set(prev).add(m));
        chime(m === 1 ? "end" : "milestone");
      }
    }
  }, [progress, hitMilestones, running, paused]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Title reflects countdown
  useEffect(() => {
    if (running) {
      document.title = `${formatClock(remainingSec)} — Talk`;
    } else {
      document.title = "Talk — hugoslekstuga";
    }
  }, [running, remainingSec]);

  const start = useCallback(() => {
    setBaseRemaining(durationSec);
    setStartedAt(Date.now());
    setNow(Date.now());
    setRunning(true);
    setPaused(false);
    setHitMilestones(new Set());
  }, [durationSec]);

  const pause = useCallback(() => {
    if (startedAt !== null) {
      const elapsed = (Date.now() - startedAt) / 1000;
      setBaseRemaining((prev) => Math.max(0, prev - elapsed));
    }
    setStartedAt(null);
    setPaused(true);
  }, [startedAt]);

  const resume = useCallback(() => {
    setStartedAt(Date.now());
    setNow(Date.now());
    setPaused(false);
  }, []);

  const reset = useCallback(() => {
    setStartedAt(null);
    setBaseRemaining(0);
    setRunning(false);
    setPaused(false);
    setHitMilestones(new Set());
    setNow(0);
  }, []);

  const ended = running && remainingSec <= 0;
  // Pure derivation — startedAt is now state, no ref reads at render time.
  const overByMs = ended ? now - (startedAt ?? now) - durationSec * 1000 : 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        {!running ? (
          <Setup
            durationSec={durationSec}
            setDurationSec={setDurationSec}
            onStart={start}
          />
        ) : (
          <Live
            durationSec={durationSec}
            remainingSec={remainingSec}
            progress={progress}
            paused={paused}
            ended={ended}
            overByMs={overByMs}
            milestones={hitMilestones}
            onPause={pause}
            onResume={resume}
            onReset={reset}
          />
        )}

        {!running && (
          <p className="text-xs text-ink-muted">
            Visual milestones at 25 / 50 / 75 / 90% and a chime at the end.
            Set the title in your tab so you can keep it on a second screen.
          </p>
        )}
      </div>
    </ToolFrame>
  );
}

function Setup({
  durationSec,
  setDurationSec,
  onStart,
}: {
  durationSec: number;
  setDurationSec: (n: number) => void;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          How long is your talk?
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS_MIN.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDurationSec(m * 60)}
              className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                durationSec === m * 60
                  ? "bg-pink text-ink"
                  : "bg-cream hover:bg-pink-soft"
              }`}
            >
              {m} min
            </button>
          ))}
          <CustomMinutes
            currentSec={durationSec}
            presets={PRESETS_MIN}
            onChange={(min) => setDurationSec(min * 60)}
            color="pink"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={durationSec < 30}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-pink px-7 py-3 font-display text-lg font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start talk
      </button>
    </div>
  );
}

function Live({
  durationSec,
  remainingSec,
  progress,
  paused,
  ended,
  overByMs,
  milestones,
  onPause,
  onResume,
  onReset,
}: {
  durationSec: number;
  remainingSec: number;
  progress: number;
  paused: boolean;
  ended: boolean;
  overByMs: number;
  milestones: Set<number>;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}) {
  const overSec = Math.max(0, Math.floor(overByMs / 1000));
  const tone = remainingSec > durationSec * 0.5
    ? "bg-pink-soft"
    : remainingSec > durationSec * 0.25
      ? "bg-yellow-soft"
      : remainingSec > 0
        ? "bg-orange-soft"
        : "bg-tomato-soft";
  return (
    <div className="flex flex-col gap-5">
      <div className={`card-chunk relative overflow-hidden rounded-[var(--radius-card)] ${tone} p-8 text-center`}>
        <div
          className="absolute left-0 top-0 h-full bg-pink"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%`, transition: "width 100ms linear" }}
          aria-hidden
        />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {ended ? "Time's up — wrap it up" : paused ? "Paused" : "Time remaining"}
          </p>
          <p className="font-display text-7xl font-extrabold leading-none tracking-tight tabular-nums sm:text-8xl">
            {ended ? `+${formatClock(overSec)}` : formatClock(remainingSec)}
          </p>
          <p className="text-sm text-ink-soft">
            of {formatClock(durationSec)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {paused ? (
          <button
            type="button"
            onClick={onResume}
            className="btn-chunk rounded-[var(--radius-button)] bg-pink px-6 py-3 font-display text-base font-extrabold"
          >
            Resume
          </button>
        ) : !ended ? (
          <button
            type="button"
            onClick={onPause}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-6 py-3 font-display text-base font-extrabold"
          >
            Pause
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border-2 border-ink bg-cream px-4 py-3 text-sm font-semibold transition-colors hover:bg-cream-deep"
        >
          End
        </button>
        <div className="ml-auto flex gap-2 text-xs">
          {[0.25, 0.5, 0.75, 0.9].map((m) => (
            <span
              key={m}
              className={`rounded-full border-2 border-ink px-2 py-1 font-bold ${
                milestones.has(m) ? "bg-pink text-ink" : "bg-cream text-ink-muted"
              }`}
            >
              {m * 100}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatClock(totalSec: number): string {
  const t = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function chime(kind: "milestone" | "end") {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = kind === "end" ? [660, 880, 1100] : [880];
    tones.forEach((freq, i) => {
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
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}
