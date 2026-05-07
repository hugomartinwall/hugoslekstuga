"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

type Phase = "setup" | "running" | "paused" | "done";

const PRESETS_MIN = [15, 25, 45];
const STORAGE_KEY_INTENTION = "hugoslekstuga:focus:intention";
const STORAGE_KEY_DURATION = "hugoslekstuga:focus:duration";

// Minimal subset of the WakeLock API to avoid relying on lib.dom typings that
// aren't always present in build environments.
type WakeLockSentinelLike = { release: () => Promise<void> };

export default function FocusPage() {
  const tool = findTool("focus")!;
  const [intention, setIntention] = useLocalStorageState<string>(STORAGE_KEY_INTENTION, "");
  const [durationSec, setDurationSec] = useLocalStorageState<number>(STORAGE_KEY_DURATION, 25 * 60);
  const [remainingSec, setRemainingSec] = useState(durationSec);
  const [phase, setPhase] = useState<Phase>("setup");
  const startedAtRef = useRef<number | null>(null);
  const baseRemainingRef = useRef<number>(durationSec);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Page title reflects countdown so it's visible in the tab.
  useEffect(() => {
    if (phase === "running" || phase === "paused") {
      document.title = `${formatClock(remainingSec)} — Focus`;
    } else if (phase === "done") {
      document.title = "Done! — Focus";
    } else {
      document.title = "Focus — hugoslekstuga";
    }
  }, [phase, remainingSec]);

  // Countdown loop while running.
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      const next = Math.max(0, baseRemainingRef.current - elapsed);
      setRemainingSec(next);
      if (next <= 0) {
        setPhase("done");
        playChime();
        notifyDone(intention);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase, intention]);

  // Wake lock while running.
  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;
    (async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock?.request) {
          const lock = await nav.wakeLock.request("screen");
          if (cancelled) {
            lock.release().catch(() => {});
          } else {
            wakeLockRef.current = lock;
          }
        }
      } catch {
        // ignore; not all browsers support this
      }
    })();
    return () => {
      cancelled = true;
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      lock?.release().catch(() => {});
    };
  }, [phase]);

  const start = useCallback(() => {
    baseRemainingRef.current = durationSec;
    setRemainingSec(durationSec);
    startedAtRef.current = Date.now();
    setPhase("running");
    requestNotificationPermission();
  }, [durationSec]);

  const pause = useCallback(() => {
    const startedAt = startedAtRef.current;
    if (startedAt !== null) {
      const elapsed = (Date.now() - startedAt) / 1000;
      baseRemainingRef.current = Math.max(0, baseRemainingRef.current - elapsed);
    }
    startedAtRef.current = null;
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    startedAtRef.current = Date.now();
    setPhase("running");
  }, []);

  const reset = useCallback(() => {
    startedAtRef.current = null;
    baseRemainingRef.current = durationSec;
    setRemainingSec(durationSec);
    setPhase("setup");
  }, [durationSec]);

  const progress = useMemo(() => {
    if (durationSec <= 0) return 0;
    return 1 - remainingSec / durationSec;
  }, [remainingSec, durationSec]);

  return (
    <ToolFrame tool={tool}>
      {phase === "setup" && (
        <Setup
          intention={intention}
          setIntention={setIntention}
          durationSec={durationSec}
          setDurationSec={setDurationSec}
          onStart={start}
        />
      )}

      {(phase === "running" || phase === "paused") && (
        <Running
          intention={intention}
          remainingSec={remainingSec}
          progress={progress}
          paused={phase === "paused"}
          onPause={pause}
          onResume={resume}
          onReset={reset}
        />
      )}

      {phase === "done" && (
        <Done intention={intention} onReset={reset} />
      )}
    </ToolFrame>
  );
}

function Setup({
  intention,
  setIntention,
  durationSec,
  setDurationSec,
  onStart,
}: {
  intention: string;
  setIntention: (s: string) => void;
  durationSec: number;
  setDurationSec: (n: number) => void;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="intention"
          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          What are you focusing on?
        </label>
        <input
          id="intention"
          type="text"
          value={intention}
          onChange={(e) => setIntention(e.target.value)}
          placeholder="Write the email, sketch the page, read chapter three…"
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-lg font-medium text-ink placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-ink-muted focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          For how long?
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS_MIN.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDurationSec(m * 60)}
              className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${
                durationSec === m * 60
                  ? "bg-green text-cream"
                  : "bg-cream hover:bg-green-soft"
              }`}
            >
              {m} min
            </button>
          ))}
          <CustomMinutes
            currentSec={durationSec}
            onChange={(min) => setDurationSec(min * 60)}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={durationSec < 60}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-lg font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start focus
      </button>

      <p className="text-xs text-ink-muted">
        While focusing, your screen stays awake and you&rsquo;ll get a chime
        plus a browser notification when time&rsquo;s up.
      </p>
    </div>
  );
}

function CustomMinutes({
  currentSec,
  onChange,
}: {
  currentSec: number;
  onChange: (min: number) => void;
}) {
  const isPreset = PRESETS_MIN.includes(currentSec / 60);
  const [val, setVal] = useState<string>(isPreset ? "" : String(currentSec / 60));

  return (
    <label
      className={`flex items-center gap-2 rounded-full border-2 border-ink px-3 py-2 text-sm font-bold transition-colors ${
        !isPreset && val ? "bg-green text-cream" : "bg-cream"
      }`}
    >
      <span>Custom</span>
      <input
        type="number"
        min={1}
        max={180}
        value={val}
        onChange={(e) => {
          const v = e.target.value;
          setVal(v);
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1) onChange(n);
        }}
        className="w-12 bg-transparent text-center outline-none"
        placeholder="0"
      />
      <span>min</span>
    </label>
  );
}

function Running({
  intention,
  remainingSec,
  progress,
  paused,
  onPause,
  onResume,
  onReset,
}: {
  intention: string;
  remainingSec: number;
  progress: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-8 py-4 text-center">
      <p className="max-w-md text-sm font-semibold uppercase tracking-wide text-ink-muted">
        {intention.trim() ? "Focusing on" : "Focusing"}
      </p>
      {intention.trim() && (
        <p className="max-w-2xl font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          {intention}
        </p>
      )}

      <div className="card-chunk relative w-full max-w-md overflow-hidden rounded-[var(--radius-card)] bg-cream p-10">
        <div
          className="absolute left-0 top-0 h-full bg-green-soft transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          aria-hidden
        />
        <p className="relative z-10 font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums sm:text-7xl">
          {formatClock(remainingSec)}
        </p>
      </div>

      <div className="flex gap-3">
        {paused ? (
          <button
            type="button"
            onClick={onResume}
            className="btn-chunk rounded-[var(--radius-button)] bg-green px-6 py-3 font-display text-base font-extrabold text-cream"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-6 py-3 font-display text-base font-extrabold"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border-2 border-ink bg-cream px-4 py-3 text-sm font-semibold transition-colors hover:bg-cream-deep"
        >
          End early
        </button>
      </div>
    </div>
  );
}

function Done({
  intention,
  onReset,
}: {
  intention: string;
  onReset: () => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-5 rounded-[var(--radius-card)] bg-green-soft p-8 text-center">
      <p className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
        Time&rsquo;s up.
      </p>
      {intention.trim() && (
        <p className="text-base text-ink-soft">
          Nice work on{" "}
          <span className="font-bold text-ink">{intention}</span>.
        </p>
      )}
      <button
        type="button"
        onClick={onReset}
        className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-base font-extrabold text-cream"
      >
        Another round
      </button>
    </div>
  );
}

function formatClock(totalSec: number): string {
  const t = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.18);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // ignore audio errors
  }
}

function requestNotificationPermission() {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {}
}

function notifyDone(intention: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && !document.hidden) return;
    const body = intention.trim()
      ? `Nice work on ${intention.trim()}.`
      : "Your focus session is complete.";
    new Notification("Time's up — Focus", { body });
  } catch {}
}
