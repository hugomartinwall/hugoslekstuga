"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { localISODate } from "@/lib/dates";
import { hugoMoodEvent } from "@/lib/hugo-state";
import CustomMinutes from "@/components/CustomMinutes";

type Phase = "setup" | "running" | "paused" | "done";

const PRESETS_MIN = [15, 25, 45];
const STORAGE_KEY_INTENTION = "hugoslekstuga:focus:intention";
const STORAGE_KEY_DURATION = "hugoslekstuga:focus:duration";
const STORAGE_KEY_AMBIENT = "hugoslekstuga:focus:ambient";
const STORAGE_KEY_SESSIONS = "hugoslekstuga:focus:sessions";

type SessionState = { date: string; count: number };
const SESSIONS_DEFAULT: SessionState = { date: "", count: 0 };

// Minimal subset of the WakeLock API to avoid relying on lib.dom typings that
// aren't always present in build environments.
type WakeLockSentinelLike = { release: () => Promise<void> };

/** Brown noise: integrated white, normalised. The most universally
 *  non-distracting ambient — pleasant for long sittings, easy on the
 *  ears. Generated live so we never download an audio file. */
function makeBrownBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 6;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

const AMBIENT_VOLUME = 0.4;
const AMBIENT_FADE_IN = 1.5;
const AMBIENT_FADE_OUT = 1.0;
const AMBIENT_MUTE_RAMP = 0.3;

export default function FocusPage() {
  const tool = findTool("focus")!;
  const [intention, setIntention] = useLocalStorageState<string>(STORAGE_KEY_INTENTION, "");
  const [durationSec, setDurationSec] = useLocalStorageState<number>(STORAGE_KEY_DURATION, 25 * 60);
  const [ambient, setAmbient] = useLocalStorageState<boolean>(STORAGE_KEY_AMBIENT, false);
  const [sessions, setSessions] = useLocalStorageState<SessionState>(STORAGE_KEY_SESSIONS, SESSIONS_DEFAULT);
  const [remainingSec, setRemainingSec] = useState(durationSec);
  const [phase, setPhase] = useState<Phase>("setup");
  const startedAtRef = useRef<number | null>(null);
  const baseRemainingRef = useRef<number>(durationSec);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const today = useMemo(() => localISODate(new Date()), []);
  const todayCount = sessions.date === today ? sessions.count : 0;

  // Hugo settles to calm on this page. Route-change fires `navigated` which
  // sets him excited; the calm-down lands right after so by the time you
  // type an intention he's reading the room. Re-fires on mount only.
  useEffect(() => {
    hugoMoodEvent("calm-down");
  }, []);

  // ---------- ambient audio orchestration ----------
  // The session's ambient AudioContext lives across pause/resume so we
  // don't pay a startup click each time. It tears down only when the
  // session actually ends (done or stop).
  const ambientCtxRef = useRef<AudioContext | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);
  const ambientSrcRef = useRef<AudioBufferSourceNode | null>(null);

  const startAmbient = useCallback(() => {
    if (ambientCtxRef.current) return; // already running
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const buf = makeBrownBuffer(ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(gain).connect(ctx.destination);
      src.start();
      gain.gain.exponentialRampToValueAtTime(
        AMBIENT_VOLUME,
        ctx.currentTime + AMBIENT_FADE_IN,
      );
      ambientCtxRef.current = ctx;
      ambientGainRef.current = gain;
      ambientSrcRef.current = src;
    } catch {
      // Audio unsupported / blocked — silently skip.
    }
  }, []);

  const stopAmbient = useCallback(() => {
    const ctx = ambientCtxRef.current;
    const gain = ambientGainRef.current;
    const src = ambientSrcRef.current;
    if (!ctx) return;
    if (gain) {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + AMBIENT_FADE_OUT,
        );
      } catch {}
    }
    window.setTimeout(
      () => {
        try {
          src?.stop();
        } catch {}
        try {
          ctx.close();
        } catch {}
        ambientCtxRef.current = null;
        ambientGainRef.current = null;
        ambientSrcRef.current = null;
      },
      AMBIENT_FADE_OUT * 1000 + 80,
    );
  }, []);

  const muteAmbient = useCallback(() => {
    const ctx = ambientCtxRef.current;
    const gain = ambientGainRef.current;
    if (!ctx || !gain) return;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + AMBIENT_MUTE_RAMP,
      );
    } catch {}
  }, []);

  const unmuteAmbient = useCallback(() => {
    const ctx = ambientCtxRef.current;
    const gain = ambientGainRef.current;
    if (!ctx || !gain) return;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        AMBIENT_VOLUME,
        ctx.currentTime + AMBIENT_MUTE_RAMP,
      );
    } catch {}
  }, []);

  const inSession = phase === "running" || phase === "paused";

  // Spin up / tear down the ambient audio graph on session boundaries.
  useEffect(() => {
    if (!inSession || !ambient) return;
    startAmbient();
    return () => stopAmbient();
  }, [inSession, ambient, startAmbient, stopAmbient]);

  // Mute / unmute on pause-resume (without rebuilding the graph).
  useEffect(() => {
    if (!ambient) return;
    if (phase === "paused") muteAmbient();
    else if (phase === "running") unmuteAmbient();
  }, [phase, ambient, muteAmbient, unmuteAmbient]);

  // ---------- title sync ----------
  useEffect(() => {
    if (phase === "running" || phase === "paused") {
      document.title = `${formatClock(remainingSec)} — Focus`;
    } else if (phase === "done") {
      document.title = "Done! — Focus";
    } else {
      document.title = "Focus — hugoslekstuga";
    }
  }, [phase, remainingSec]);

  // ---------- countdown ----------
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
        // Hugo notices the natural completion (not the bail-out via Stop).
        // BrandDot lights up with the sparkle puff; hugoMoodEvent("happy")
        // also feeds the inner state so the mood stays excited briefly.
        window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
        // Increment session count only on natural completion (not on Stop).
        setSessions((prev) =>
          prev.date === today
            ? { date: today, count: prev.count + 1 }
            : { date: today, count: 1 },
        );
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase, intention, today, setSessions]);

  // ---------- wake lock ----------
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
          ambient={ambient}
          setAmbient={setAmbient}
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
        <Done intention={intention} todayCount={todayCount} onReset={reset} />
      )}
    </ToolFrame>
  );
}

function Setup({
  intention,
  setIntention,
  durationSec,
  setDurationSec,
  ambient,
  setAmbient,
  onStart,
}: {
  intention: string;
  setIntention: (s: string) => void;
  durationSec: number;
  setDurationSec: (n: number) => void;
  ambient: boolean;
  setAmbient: (b: boolean) => void;
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
            presets={PRESETS_MIN}
            onChange={(min) => setDurationSec(min * 60)}
            color="green"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Ambient sound
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAmbient(false)}
            className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${
              !ambient ? "bg-green text-cream" : "bg-cream hover:bg-green-soft"
            }`}
          >
            Silent
          </button>
          <button
            type="button"
            onClick={() => setAmbient(true)}
            className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${
              ambient ? "bg-green text-cream" : "bg-cream hover:bg-green-soft"
            }`}
          >
            Brown noise
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          {ambient
            ? "Soft brown noise during the session. Like ocean far away — non-distracting, pleasant for long sittings."
            : "No background sound."}
        </p>
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

      <div className="flex flex-wrap justify-center gap-3">
        {paused ? (
          <button
            type="button"
            onClick={onResume}
            className="btn-chunk rounded-[var(--radius-button)] bg-green px-7 py-4 font-display text-base font-extrabold text-cream sm:px-6 sm:py-3"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-7 py-4 font-display text-base font-extrabold sm:px-6 sm:py-3"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-7 py-4 font-display text-base font-extrabold sm:px-6 sm:py-3"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

function Done({
  intention,
  todayCount,
  onReset,
}: {
  intention: string;
  todayCount: number;
  onReset: () => void;
}) {
  const countLine =
    todayCount === 1
      ? "First session today."
      : `${todayCount} sessions today.`;
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
      {todayCount > 0 && (
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {countLine}
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
