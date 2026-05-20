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

// `minutes` is the total focused time today, summed across sessions. Optional
// for backward compatibility — older localStorage entries (pre-Today's-minutes
// pass) only have date + count.
type SessionState = { date: string; count: number; minutes?: number };
const SESSIONS_DEFAULT: SessionState = { date: "", count: 0, minutes: 0 };

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
  // The duration of the *current* session, in seconds. Diverges from
  // `durationSec` (the user's chosen preference) when they hit "+5 min" on
  // the Done screen — that extension is a one-off 5-min session. Reset on
  // each start() and extend() so progress math always relates to the
  // session actually in flight, not whatever pref persists in localStorage.
  const [sessionDurationSec, setSessionDurationSec] = useState(durationSec);
  const startedAtRef = useRef<number | null>(null);
  const baseRemainingRef = useRef<number>(durationSec);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const today = useMemo(() => localISODate(new Date()), []);
  const todayCount = sessions.date === today ? sessions.count : 0;
  const todayMinutes = sessions.date === today ? (sessions.minutes ?? 0) : 0;

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

  // Separate, short-lived AudioContext for the Setup-screen preview.
  // Lives long enough for a 2.2s fade-in / hold / fade-out, then tears
  // itself down. A new click cancels the previous preview so repeated
  // taps don't pile contexts up.
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  const previewAmbient = useCallback(() => {
    // Cancel any in-flight preview so a re-click doesn't layer noise.
    if (previewCtxRef.current) {
      try {
        previewCtxRef.current.close();
      } catch {}
      previewCtxRef.current = null;
    }
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
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
      src.loop = false;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(gain).connect(ctx.destination);
      src.start();
      const now = ctx.currentTime;
      // Quick ramp up, brief hold, ramp down. Short enough to feel like
      // a sample, long enough to recognise the texture.
      gain.gain.exponentialRampToValueAtTime(AMBIENT_VOLUME, now + 0.4);
      gain.gain.setValueAtTime(AMBIENT_VOLUME, now + 1.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      previewCtxRef.current = ctx;
      previewTimerRef.current = window.setTimeout(() => {
        try {
          src.stop();
        } catch {}
        try {
          ctx.close();
        } catch {}
        previewCtxRef.current = null;
        previewTimerRef.current = null;
      }, 2400);
    } catch {
      // Audio unsupported / blocked — silently skip.
    }
  }, []);

  // Clean up any leftover preview on unmount.
  useEffect(
    () => () => {
      if (previewCtxRef.current) {
        try {
          previewCtxRef.current.close();
        } catch {}
        previewCtxRef.current = null;
      }
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    },
    [],
  );

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
        // Increment session count + minutes only on natural completion (not
        // on Stop). Minutes is the source of truth for "today's focused time"
        // on the Setup screen — count is kept for the "N sessions today" line
        // on the Done screen, since 3×5min reads differently from 1×15min.
        const minutesDone = sessionDurationSec / 60;
        setSessions((prev) =>
          prev.date === today
            ? {
                date: today,
                count: prev.count + 1,
                minutes: (prev.minutes ?? 0) + minutesDone,
              }
            : { date: today, count: 1, minutes: minutesDone },
        );
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase, intention, today, setSessions, sessionDurationSec]);

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
    setSessionDurationSec(durationSec);
    baseRemainingRef.current = durationSec;
    setRemainingSec(durationSec);
    startedAtRef.current = Date.now();
    setPhase("running");
    requestNotificationPermission();
  }, [durationSec]);

  // Extend by N minutes from the Done screen. Starts a fresh session at
  // the new duration without touching the user's stored durationSec — when
  // they come back to Setup, their original preference is intact.
  const extend = useCallback((mins: number) => {
    const sec = mins * 60;
    setSessionDurationSec(sec);
    baseRemainingRef.current = sec;
    setRemainingSec(sec);
    startedAtRef.current = Date.now();
    setPhase("running");
  }, []);

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
    if (sessionDurationSec <= 0) return 0;
    return 1 - remainingSec / sessionDurationSec;
  }, [remainingSec, sessionDurationSec]);
  const elapsedSec = Math.max(0, sessionDurationSec - remainingSec);

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
          todayMinutes={todayMinutes}
          onPreviewAmbient={previewAmbient}
          onStart={start}
        />
      )}

      {(phase === "running" || phase === "paused") && (
        <Running
          intention={intention}
          remainingSec={remainingSec}
          elapsedSec={elapsedSec}
          progress={progress}
          paused={phase === "paused"}
          onPause={pause}
          onResume={resume}
          onReset={reset}
        />
      )}

      {phase === "done" && (
        <Done
          intention={intention}
          todayCount={todayCount}
          onReset={reset}
          onExtend={extend}
        />
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
  todayMinutes,
  onPreviewAmbient,
  onStart,
}: {
  intention: string;
  setIntention: (s: string) => void;
  durationSec: number;
  setDurationSec: (n: number) => void;
  ambient: boolean;
  setAmbient: (b: boolean) => void;
  todayMinutes: number;
  onPreviewAmbient: () => void;
  onStart: () => void;
}) {
  // Round to whole minutes for display — the underlying number may have
  // half-minute artifacts from a future custom-seconds path, but the
  // surface should always read clean.
  const roundedMinutes = Math.round(todayMinutes);
  return (
    <div className="flex flex-col gap-7">
      {roundedMinutes > 0 && (
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {roundedMinutes === 1
            ? "1 minute focused today"
            : `${roundedMinutes} minutes focused today`}
        </p>
      )}
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
        <div className="flex flex-wrap items-center gap-2">
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
          {/* Preview sits beside the toggle pair, intentionally lighter
              weight — it isn't a selection, just a 2-second taste so you
              know what you're committing to. Always present so you can
              hear it before deciding either way. */}
          <button
            type="button"
            onClick={onPreviewAmbient}
            aria-label="Preview brown noise"
            className="rounded-full border-2 border-ink bg-cream px-3 py-2 text-xs font-semibold transition-colors hover:bg-green-soft"
          >
            ▸ hear it
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

// Geometry for the circular progress ring. viewBox is 0..100, stroke
// sits centered at radius 46 so a ~3-unit stroke clears the chunky ink
// border at the outer edge. Computed once, not on every render.
const RING_RADIUS = 46;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

// Stop guard threshold. Past this much elapsed time, the Stop button
// becomes two-tap to avoid losing a real session to a stray click. Under
// the threshold, Stop is one-tap — early in a session the lost cost is
// trivially small.
const STOP_GUARD_THRESHOLD_SEC = 5 * 60;
// Window after the first tap during which a second tap actually stops.
// Long enough to read "tap again to stop" and reach the button; short
// enough that an accidental first tap times out before the second.
const STOP_GUARD_WINDOW_MS = 2000;

function Running({
  intention,
  remainingSec,
  elapsedSec,
  progress,
  paused,
  onPause,
  onResume,
  onReset,
}: {
  intention: string;
  remainingSec: number;
  elapsedSec: number;
  progress: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}) {
  // Last-minute breathe: ≤60s remaining, not paused. A 3s scale wave that
  // says "almost done" without alarm. Stops the moment the timer reaches
  // zero (Running unmounts and Done takes over).
  const breathing = !paused && remainingSec > 0 && remainingSec <= 60;
  // Clamp progress for the dashoffset math — drift past 1 would produce
  // a tiny negative offset that some browsers render as a stray dot.
  const clamped = Math.min(1, Math.max(0, progress));

  // Two-tap stop guard. First tap arms; second tap (within the window)
  // actually stops. Below the threshold of elapsed time, stop is one-tap.
  const [stopArmed, setStopArmed] = useState(false);
  const stopTimerRef = useRef<number | null>(null);
  // Cleanup on unmount so a pending timer doesn't leak. (The session
  // could end naturally while the user has Stop armed.)
  useEffect(
    () => () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    },
    [],
  );
  const handleStopClick = () => {
    const needsGuard = elapsedSec > STOP_GUARD_THRESHOLD_SEC;
    if (needsGuard && !stopArmed) {
      setStopArmed(true);
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
      stopTimerRef.current = window.setTimeout(() => {
        setStopArmed(false);
        stopTimerRef.current = null;
      }, STOP_GUARD_WINDOW_MS);
      return;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    setStopArmed(false);
    onReset();
  };
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

      <div className="flex flex-col items-center gap-3">
        <div
          className={`card-chunk relative rounded-full bg-cream transition-opacity ${
            paused ? "opacity-60" : ""
          } ${breathing ? "focus-breathe" : ""}`}
          style={{ width: "min(80vw, 320px)", aspectRatio: "1" }}
        >
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full -rotate-90"
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={RING_CIRC * (1 - clamped)}
              style={{ stroke: "var(--color-green)" }}
              className="transition-[stroke-dashoffset] duration-200 ease-linear"
            />
          </svg>
          <p className="absolute inset-0 flex items-center justify-center font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums sm:text-7xl">
            {formatClock(remainingSec)}
          </p>
        </div>
        {paused && (
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            paused
          </p>
        )}
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
          onClick={handleStopClick}
          className={`btn-chunk rounded-[var(--radius-button)] px-7 py-4 font-display text-base font-extrabold transition-colors sm:px-6 sm:py-3 ${
            stopArmed ? "bg-pink text-ink" : "bg-cream"
          }`}
        >
          {stopArmed ? "Tap again to stop" : "Stop"}
        </button>
      </div>
    </div>
  );
}

function Done({
  intention,
  todayCount,
  onReset,
  onExtend,
}: {
  intention: string;
  todayCount: number;
  onReset: () => void;
  onExtend: (mins: number) => void;
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
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => onExtend(5)}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-6 py-3 font-display text-base font-extrabold"
        >
          +5 min
        </button>
        <button
          type="button"
          onClick={onReset}
          className="btn-chunk rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-base font-extrabold text-cream"
        >
          Another round
        </button>
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
