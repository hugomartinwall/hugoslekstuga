"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:noise:state";

type NoiseId = "white" | "pink" | "brown" | "drone";

type State = Record<NoiseId, number>;

type Channel = {
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
};

const DEFAULT: State = { white: 0, pink: 0.4, brown: 0, drone: 0 };

// Build a buffer of white-noise samples once.
function makeWhiteBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Paul Kellet's economy method, refined: feed white noise through a series of filters.
function makePinkBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 6;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    data[i] = pink;
  }
  return buffer;
}

// Brown noise: integrated white, normalised to ±1.
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

const COLORS: Record<NoiseId, string> = {
  white: "#bbb",
  pink: "#ff7ab2",
  brown: "#8a5a2b",
  drone: "#4f66f2",
};

const LABELS: Record<NoiseId, { name: string; hint: string }> = {
  white: { name: "White noise", hint: "Even across all frequencies. Crisp." },
  pink: { name: "Pink noise", hint: "Softer high end. Like rain on a roof." },
  brown: { name: "Brown noise", hint: "Deep and warm. Like ocean far away." },
  drone: { name: "Drone", hint: "A long, low note underneath." },
};

// Auto-stop options. The "off" option means "play forever".
const AUTO_STOP_MIN_OPTIONS = [0, 15, 30, 45, 60, 90] as const;
type AutoStopMin = (typeof AUTO_STOP_MIN_OPTIONS)[number];

const FADE_SECONDS = 0.25;
const MASTER_VOL = 0.7;

export default function NoisePage() {
  const tool = findTool("noise")!;
  const [state, setState] = useState<State>(DEFAULT);
  const [playing, setPlaying] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [autoStopMin, setAutoStopMin] = useState<AutoStopMin>(0);
  const [stopAt, setStopAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const ctxRef = useRef<AudioContext | null>(null);
  const channelsRef = useRef<Partial<Record<NoiseId, Channel>>>({});
  const masterRef = useRef<GainNode | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...DEFAULT, ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  // Sync gains while playing
  useEffect(() => {
    const channels = channelsRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !channels) return;
    (Object.keys(state) as NoiseId[]).forEach((id) => {
      const c = channels[id];
      if (c) {
        c.gain.gain.linearRampToValueAtTime(state[id], ctx.currentTime + 0.05);
      }
    });
  }, [state]);

  const start = useCallback(async () => {
    if (playing) return;
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    // Fade in from silence over FADE_SECONDS so users don't hear a click.
    master.gain.value = 0.0001;
    master.gain.exponentialRampToValueAtTime(MASTER_VOL, ctx.currentTime + FADE_SECONDS);
    master.connect(ctx.destination);
    masterRef.current = master;

    const whiteBuf = makeWhiteBuffer(ctx);
    const pinkBuf = makePinkBuffer(ctx);
    const brownBuf = makeBrownBuffer(ctx);

    const buildBuffer = (buf: AudioBuffer, vol: number): Channel => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(master);
      src.start();
      return { source: src, gain: g };
    };

    channelsRef.current.white = buildBuffer(whiteBuf, state.white);
    channelsRef.current.pink = buildBuffer(pinkBuf, state.pink);
    channelsRef.current.brown = buildBuffer(brownBuf, state.brown);

    // Drone — slow LFO modulating a low oscillator
    const droneOsc = ctx.createOscillator();
    droneOsc.type = "sine";
    droneOsc.frequency.value = 110;
    const droneGain = ctx.createGain();
    droneGain.gain.value = state.drone;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(droneOsc.frequency);
    droneOsc.connect(droneGain).connect(master);
    droneOsc.start();
    lfo.start();
    channelsRef.current.drone = { source: droneOsc, gain: droneGain };

    setPlaying(true);
    if (autoStopMin > 0) {
      setStopAt(Date.now() + autoStopMin * 60_000);
    } else {
      setStopAt(null);
    }
  }, [playing, state, autoStopMin]);

  const stop = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    const channels = channelsRef.current;
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (ctx && master) {
      // Fade master to silence over FADE_SECONDS, then close the context
      // so the user doesn't hear a hard click on stop. Source nodes get
      // stopped after the fade so the buffers don't get truncated mid-fade.
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + FADE_SECONDS);
      } catch {}
      window.setTimeout(() => {
        Object.values(channels).forEach((c) => {
          try {
            c?.source.stop();
          } catch {}
        });
        channelsRef.current = {};
        if (ctxRef.current) {
          try {
            ctxRef.current.close();
          } catch {}
          ctxRef.current = null;
        }
      }, FADE_SECONDS * 1000 + 30);
    } else {
      Object.values(channels).forEach((c) => {
        try {
          c?.source.stop();
        } catch {}
      });
      channelsRef.current = {};
    }
    setPlaying(false);
    setStopAt(null);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // Auto-stop ticker — checks every second once a stopAt is set.
  useEffect(() => {
    if (stopAt === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= stopAt) {
        stop();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [stopAt, stop]);

  const remainingMs = stopAt !== null ? Math.max(0, stopAt - now) : null;
  const remainingLabel =
    remainingMs === null
      ? null
      : (() => {
          const total = Math.ceil(remainingMs / 1000);
          const m = Math.floor(total / 60);
          const s = total % 60;
          return `${m}:${String(s).padStart(2, "0")}`;
        })();

  const ids: NoiseId[] = ["white", "pink", "brown", "drone"];

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={playing ? stop : start}
              className={`btn-chunk rounded-[var(--radius-button)] px-7 py-3 font-display text-base font-extrabold ${
                playing ? "bg-tomato text-cream" : "bg-blue text-cream"
              }`}
            >
              {playing ? "Stop" : "Play"}
            </button>
            {remainingLabel && (
              <span className="rounded-full border-2 border-ink bg-blue-soft px-3 py-1 font-mono text-sm font-bold tabular-nums">
                {remainingLabel} left
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setState(DEFAULT)}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-blue-soft"
          >
            reset mix
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Auto-stop
          </span>
          {AUTO_STOP_MIN_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setAutoStopMin(m)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                autoStopMin === m
                  ? "bg-blue text-cream"
                  : "bg-cream hover:bg-blue-soft"
              }`}
            >
              {m === 0 ? "off" : `${m} min`}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {ids.map((id) => (
            <div
              key={id}
              className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full border-2 border-ink"
                    style={{ background: COLORS[id] }}
                  />
                  <span className="font-display text-base font-extrabold tracking-tight">
                    {LABELS[id].name}
                  </span>
                </div>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {Math.round(state[id] * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state[id]}
                onChange={(e) =>
                  setState((s) => ({ ...s, [id]: Number(e.target.value) }))
                }
                className="w-full accent-blue"
                style={{ accentColor: COLORS[id] }}
              />
              <span className="text-xs text-ink-muted">{LABELS[id].hint}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-muted">
          Every sound is generated live in your browser — no audio files
          downloaded, no internet needed once the page loads. Try pink at
          ~40% with a hint of drone for a calm focus mix.
        </p>
      </div>
    </ToolFrame>
  );
}
