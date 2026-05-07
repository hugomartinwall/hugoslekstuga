"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:coin:tally";

type Side = "heads" | "tails";
type Tally = { heads: number; tails: number; streak: number; streakSide?: Side };

const FLIP_MS = 1500;

function chime(ctx: AudioContext, freq: number, dur = 0.18, vol = 0.18) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.05);
}

function clack(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.25));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export default function CoinPage() {
  const tool = findTool("coin")!;
  const [tally, setTally] = useState<Tally>({ heads: 0, tails: 0, streak: 0 });
  const [hydrated, setHydrated] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<Side>("heads");
  const [rotations, setRotations] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);
  const lastTilt = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Tally;
        if (typeof parsed.heads === "number" && typeof parsed.tails === "number") {
          setTally(parsed);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tally));
    } catch {}
  }, [tally, hydrated]);

  const ensureAudio = () => {
    if (!audioRef.current) {
      try {
        audioRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {}
    }
    return audioRef.current;
  };

  const flip = useCallback(() => {
    if (flipping) return;
    const next: Side = Math.random() < 0.5 ? "heads" : "tails";
    const halfRotations = 7 + Math.floor(Math.random() * 6); // 7..12
    // Land on right face: heads = 0 mod 2, tails = 1 mod 2 (with current orientation)
    const targetParity = next === "heads" ? 0 : 1;
    const adjusted = halfRotations + ((halfRotations % 2) !== targetParity ? 1 : 0);
    lastTilt.current = (Math.random() - 0.5) * 30;
    setRotations(adjusted);
    setResult(next);
    setFlipping(true);
    const ctx = ensureAudio();
    if (ctx) chime(ctx, 700, 0.12, 0.16);
    window.setTimeout(() => {
      setFlipping(false);
      setTally((t) => {
        const heads = next === "heads" ? t.heads + 1 : t.heads;
        const tails = next === "tails" ? t.tails + 1 : t.tails;
        const streakSame = t.streakSide === next;
        return {
          heads,
          tails,
          streak: streakSame ? t.streak + 1 : 1,
          streakSide: next,
        };
      });
      const ctx2 = ensureAudio();
      if (ctx2) {
        clack(ctx2);
        chime(ctx2, next === "heads" ? 880 : 660, 0.16, 0.12);
      }
    }, FLIP_MS);
  }, [flipping]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="card-chunk relative flex h-72 w-full items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-yellow-soft sm:h-80">
          <div
            style={{
              perspective: 800,
            }}
          >
            <div
              style={{
                transformStyle: "preserve-3d",
                transition: flipping
                  ? `transform ${FLIP_MS}ms cubic-bezier(0.18, 0.8, 0.34, 1.02)`
                  : "transform 200ms ease",
                transform: `rotateX(${rotations * 180}deg) rotateZ(${flipping ? lastTilt.current : 0}deg)`,
                width: 180,
                height: 180,
                position: "relative",
              }}
            >
              <CoinFace side="heads" />
              <CoinFace side="tails" back />
            </div>
          </div>
          {!flipping && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Tap the coin to flip · spacebar works too
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={flip}
          disabled={flipping}
          className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-yellow px-7 py-3 font-display text-lg font-extrabold disabled:cursor-progress disabled:opacity-80"
        >
          {flipping ? "…flipping…" : "Flip"}
        </button>

        <div className="card-chunk grid grid-cols-3 gap-2 rounded-[var(--radius-card)] bg-cream p-4 text-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Heads
            </p>
            <p className="font-display text-2xl font-extrabold tabular-nums">
              {tally.heads}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Tails
            </p>
            <p className="font-display text-2xl font-extrabold tabular-nums">
              {tally.tails}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Streak
            </p>
            <p className="font-display text-2xl font-extrabold tabular-nums">
              {tally.streak}
              <span className="ml-1 text-xs font-semibold text-ink-muted">
                {tally.streakSide === "heads"
                  ? "H"
                  : tally.streakSide === "tails"
                  ? "T"
                  : ""}
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setTally({ heads: 0, tails: 0, streak: 0 })}
          className="text-center text-xs font-semibold text-ink-muted hover:text-ink"
        >
          reset count
        </button>
      </div>

      <SpaceFlip onFlip={flip} disabled={flipping} />
    </ToolFrame>
  );
}

function SpaceFlip({ onFlip, disabled }: { onFlip: () => void; disabled: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return;
      if ((e.code === "Space" || e.key === " ") && !disabled) {
        e.preventDefault();
        onFlip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFlip, disabled]);
  return null;
}

function CoinFace({ side, back }: { side: "heads" | "tails"; back?: boolean }) {
  const transform = back ? "rotateX(180deg)" : undefined;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backfaceVisibility: "hidden",
        transform,
        background: side === "heads" ? "#ffc233" : "#f5ecdb",
        border: "4px solid #1a1812",
        boxShadow: "0 4px 0 0 #1a1812",
        borderRadius: "50%",
      }}
    >
      <span className="font-display text-5xl font-extrabold tracking-tight">
        {side === "heads" ? "H" : "T"}
      </span>
    </div>
  );
}
