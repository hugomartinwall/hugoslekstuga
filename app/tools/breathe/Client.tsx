"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { hugoMoodEvent } from "@/lib/hugo-state";
import { CREAM_HEX, INK_HEX } from "@/lib/colors";

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

const PATTERN_KEY = "hugoslekstuga:breathe:pattern";
const SETTINGS_KEY = "hugoslekstuga:breathe:settings";

type EndMode = "free" | "minutes" | "cycles";

type Settings = {
  audio: boolean;
  endMode: EndMode;
  endMinutes: number;
  endCycles: number;
  dim: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  audio: false,
  endMode: "free",
  endMinutes: 5,
  endCycles: 8,
  dim: false,
};

const MINUTE_PRESETS = [1, 3, 5, 10];
const CYCLE_PRESETS = [3, 5, 8, 12];

// Phase tone parameters. Sine sweep 220 → 330 Hz on inhale, mirror on
// exhale, silent on holds. Volume gentle and roughly the same as the
// existing chime; users can close their eyes.
const TONE_LOW = 220;
const TONE_HIGH = 330;
const TONE_GAIN = 0.06;
const TONE_RAMP = 0.25;

export default function BreathePage() {
  const tool = findTool("breathe")!;
  const [patternId, setPatternId] = useLocalStorageState<Pattern["id"]>(PATTERN_KEY, "box");
  const [settings, setSettings] = useLocalStorageState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);

  const safePatternId = PATTERNS.some((p) => p.id === patternId) ? patternId : "box";
  const pattern = PATTERNS.find((p) => p.id === safePatternId)!;

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cycles, setCycles] = useState(0);
  const phaseStartRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const [reduceMotion, setReduceMotion] = useState(false);

  // Audio refs — context lives across phase changes during a single
  // session so we don't pay a startup click for each phase.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const phase = pattern.phases[phaseIndex] ?? pattern.phases[0];
  const phaseProgress = Math.min(1, elapsed / phase.seconds);

  const finishSession = useCallback(() => {
    setRunning(false);
    setDone(true);
    endChime();
  }, []);

  // Hugo joins the calm — fires once on mount so the navigated-excited
  // mood from the route change settles immediately. No win celebration
  // for breathing — the right note is quiet completion, not confetti.
  useEffect(() => {
    hugoMoodEvent("calm-down");
  }, []);

  // ----- prefers-reduced-motion -----
  // System-state subscription: setState is the right shape (we render
  // based on reduceMotion). Disable the lint rule for this pattern.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ----- audio lifecycle -----
  useEffect(() => {
    if (!running || !settings.audio) return;
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let g: GainNode | null = null;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = TONE_LOW;
      g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(ctx.destination);
      osc.start();
      audioCtxRef.current = ctx;
      oscRef.current = osc;
      gainRef.current = g;
    } catch {
      // Audio unsupported — silently skip.
    }
    return () => {
      const _ctx = ctx;
      const _osc = osc;
      const _g = g;
      if (_g && _ctx) {
        try {
          _g.gain.cancelScheduledValues(_ctx.currentTime);
          _g.gain.setValueAtTime(_g.gain.value, _ctx.currentTime);
          _g.gain.linearRampToValueAtTime(0, _ctx.currentTime + 0.2);
        } catch {}
      }
      window.setTimeout(() => {
        try {
          _osc?.stop();
        } catch {}
        try {
          _ctx?.close();
        } catch {}
      }, 250);
      audioCtxRef.current = null;
      oscRef.current = null;
      gainRef.current = null;
    };
  }, [running, settings.audio]);

  // ----- schedule tone for current phase -----
  useEffect(() => {
    if (!running || !settings.audio) return;
    const ctx = audioCtxRef.current;
    const osc = oscRef.current;
    const g = gainRef.current;
    if (!ctx || !osc || !g) return;
    const now = ctx.currentTime;
    try {
      if (phase.name === "in") {
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(TONE_LOW, now);
        osc.frequency.linearRampToValueAtTime(TONE_HIGH, now + phase.seconds);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(TONE_GAIN, now + TONE_RAMP);
      } else if (phase.name === "out") {
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(TONE_HIGH, now);
        osc.frequency.linearRampToValueAtTime(TONE_LOW, now + phase.seconds);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(TONE_GAIN, now + TONE_RAMP);
      } else {
        // Hold — silence
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + TONE_RAMP);
      }
    } catch {}
  }, [phaseIndex, phase.name, phase.seconds, running, settings.audio]);

  // ----- animation / phase advancement -----
  /* eslint-disable react-hooks/set-state-in-effect */
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
        const sStart = sessionStartRef.current;
        const sessionMs =
          sStart !== null ? performance.now() - sStart : 0;
        setPhaseIndex((idx) => {
          const next = (idx + 1) % pattern.phases.length;
          if (next === 0) {
            const nextCycles = cycles + 1;
            setCycles(nextCycles);
            // End-by-cycles check
            if (
              settings.endMode === "cycles" &&
              nextCycles >= settings.endCycles
            ) {
              finishSession();
              return idx;
            }
          }
          return next;
        });
        // End-by-minutes check (independent of phase boundary)
        if (
          settings.endMode === "minutes" &&
          sessionMs >= settings.endMinutes * 60_000
        ) {
          finishSession();
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase.seconds, pattern.phases.length, cycles, settings.endMode, settings.endMinutes, settings.endCycles]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const start = useCallback(() => {
    setPhaseIndex(0);
    setElapsed(0);
    setCycles(0);
    setDone(false);
    sessionStartRef.current = performance.now();
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    setDone(false);
    setPhaseIndex(0);
    setElapsed(0);
  }, []);

  // Visual scale for the breathing circle. Reduced-motion fixes scale at
  // 1 (full size, no pulse) and the label still updates per phase.
  const scale = reduceMotion
    ? 1
    : computeScale(phase.name, phaseProgress);
  const circleScale = reduceMotion ? 1 : 0.5 + scale * 0.5;
  const textOnDark = reduceMotion || circleScale > 0.7;
  const textColor = textOnDark ? CREAM_HEX : INK_HEX;

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <ToolFrame tool={tool}>
      {running && settings.dim && (
        <div
          className="fixed inset-0 z-30 bg-ink/60"
          aria-hidden
          style={{ pointerEvents: "none" }}
        />
      )}

      <div
        className={`flex flex-col gap-7 ${
          running && settings.dim ? "relative z-40" : ""
        }`}
      >
        {!running && (
          <div className="flex flex-col gap-6">
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
                      safePatternId === p.id
                        ? "bg-blue-soft"
                        : "bg-cream hover:bg-blue-soft"
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

            <SettingsPanel settings={settings} onChange={updateSetting} />
          </div>
        )}

        <div className="card-chunk relative aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-blue-soft">
          {!reduceMotion && (
            <div
              className="absolute left-1/2 top-1/2 aspect-square rounded-full bg-blue/15"
              style={{
                width: "92%",
                transform: `translate(-50%, -50%) scale(${circleScale})`,
                transition: "transform 200ms linear",
              }}
              aria-hidden
            />
          )}
          <div
            className="absolute left-1/2 top-1/2 aspect-square rounded-full border-2 border-ink bg-blue"
            style={{
              width: "70%",
              transform: `translate(-50%, -50%) scale(${circleScale})`,
              transition: reduceMotion
                ? "none"
                : "transform 200ms linear",
            }}
            aria-hidden
          />
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
                {settings.endMode === "minutes" && (
                  <span className="ml-2 text-ink-muted">
                    · ending after {settings.endMinutes} min
                  </span>
                )}
                {settings.endMode === "cycles" && (
                  <span className="ml-2 text-ink-muted">
                    · {settings.endCycles - cycles} to go
                  </span>
                )}
              </>
            ) : done ? (
              <>
                <span className="font-bold text-ink">Nice.</span>{" "}
                {cycles} cycle{cycles === 1 ? "" : "s"} of {pattern.name}.
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
                {done ? "Again" : "Start"}
              </button>
            )}
          </div>
        </div>

        {!running && (
          <p className="text-xs text-ink-muted">
            Long, slow exhales activate the parasympathetic nervous system —
            that&rsquo;s the body&rsquo;s &ldquo;rest and digest&rdquo; mode.
            Even a minute helps.
          </p>
        )}
      </div>
    </ToolFrame>
  );
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-4 sm:p-5">
      {/* Audio */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Sound
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange("audio", false)}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              !settings.audio ? "bg-blue text-cream" : "bg-cream hover:bg-blue-soft"
            }`}
          >
            Silent
          </button>
          <button
            type="button"
            onClick={() => onChange("audio", true)}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              settings.audio ? "bg-blue text-cream" : "bg-cream hover:bg-blue-soft"
            }`}
          >
            Tone
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          {settings.audio
            ? "A soft sine rises on inhale and falls on exhale. Silent on holds. Lets you close your eyes."
            : "No sound — follow the visual."}
        </p>
      </div>

      {/* End mode */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          End after
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange("endMode", "free")}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              settings.endMode === "free"
                ? "bg-blue text-cream"
                : "bg-cream hover:bg-blue-soft"
            }`}
          >
            Open-ended
          </button>
          <button
            type="button"
            onClick={() => onChange("endMode", "minutes")}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              settings.endMode === "minutes"
                ? "bg-blue text-cream"
                : "bg-cream hover:bg-blue-soft"
            }`}
          >
            {settings.endMinutes} min
          </button>
          <button
            type="button"
            onClick={() => onChange("endMode", "cycles")}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              settings.endMode === "cycles"
                ? "bg-blue text-cream"
                : "bg-cream hover:bg-blue-soft"
            }`}
          >
            {settings.endCycles} cycles
          </button>
        </div>
        {settings.endMode === "minutes" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">minutes:</span>
            {MINUTE_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange("endMinutes", m)}
                className={`rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold transition-colors ${
                  settings.endMinutes === m
                    ? "bg-blue text-cream"
                    : "bg-cream hover:bg-blue-soft"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {settings.endMode === "cycles" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">cycles:</span>
            {CYCLE_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange("endCycles", c)}
                className={`rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold transition-colors ${
                  settings.endCycles === c
                    ? "bg-blue text-cream"
                    : "bg-cream hover:bg-blue-soft"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dim */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Dim the rest of the page
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange("dim", false)}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              !settings.dim ? "bg-blue text-cream" : "bg-cream hover:bg-blue-soft"
            }`}
          >
            Off
          </button>
          <button
            type="button"
            onClick={() => onChange("dim", true)}
            className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
              settings.dim ? "bg-blue text-cream" : "bg-cream hover:bg-blue-soft"
            }`}
          >
            Dim
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          {settings.dim
            ? "The page fades dark while you breathe; only the circle stays lit."
            : "Page stays as-is. Only the circle holds the focus."}
        </p>
      </div>
    </div>
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

function endChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
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
