"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { findTool } from "@/lib/tools";
import {
  getEnergyHistory,
  type HugoMood,
  useHugoState,
} from "@/lib/hugo-state";

/**
 * Hugo's room — a small modal that peeks into the brand dot's inner
 * state. Opened by shift+click on the nav dot. Shows live readouts
 * (BPM, mood) and persisted memory (streak, visits, naps, tantrums,
 * somersaults, favourite tool, first-seen date), plus a 60-minute
 * energy chart sampled once per minute by the state tick.
 *
 * Pure visualisation — nothing is editable. The brand rule "Hugo
 * never appears in user copy" is bent here only inside the room
 * itself, where the metaphor is the point.
 */

const MOOD_LABEL: Record<HugoMood, string> = {
  sleepy: "Sleepy",
  calm: "Calm",
  curious: "Curious",
  excited: "Excited",
  grumpy: "Grumpy",
};

const MOOD_TINT: Record<HugoMood, string> = {
  sleepy: "var(--color-blue-soft)",
  calm: "var(--color-cream-deep)",
  curious: "var(--color-yellow-soft)",
  excited: "var(--color-pink-soft)",
  grumpy: "var(--color-tomato-soft)",
};

function formatDate(epoch: number): string {
  if (!epoch) return "—";
  const d = new Date(epoch);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function HugoRoom({ onClose }: { onClose: () => void }) {
  const bpm = useHugoState((s) => s.bpm);
  const mood = useHugoState((s) => s.mood);
  const energy = useHugoState((s) => s.energy);
  const memory = useHugoState((s) => s.memory);

  // Pull energy history when the modal opens (and on each state tick
  // while open) so the chart stays current as the buffer fills.
  const [history, setHistory] = useState<{ t: number; energy: number }[]>(
    [],
  );
  useEffect(() => {
    // Initial pull (the buffer is module-scope and already populated
    // by the state tick before the modal opens). One-shot setState in
    // an effect for transient mount state is the right pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(getEnergyHistory());
    const id = window.setInterval(
      () => setHistory(getEnergyHistory()),
      30_000,
    );
    return () => window.clearInterval(id);
  }, []);

  // Close on Esc; ignore other keys so the konami code etc. still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Favourite tool — look up the display title from the registry.
  const favSlug = memory.favoriteToolSlug;
  const favTool = favSlug ? findTool(favSlug) : null;

  // Capture "now" once at modal open via useState's lazy initializer
  // (the React 19 purity rule blocks Date.now() during render).
  const [openedAt] = useState(() => Date.now());
  const ageDays = memory.firstSeen
    ? Math.max(1, Math.floor((openedAt - memory.firstSeen) / 86_400_000))
    : 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label="Hugo's room"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 24, 18, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        zIndex: 70,
        animation: "fade-rise 240ms ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-chunk"
        style={{
          background: MOOD_TINT[mood],
          borderRadius: "var(--radius-card)",
          padding: "28px 32px",
          width: "100%",
          maxWidth: "440px",
          color: "var(--color-ink)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: "1.5rem",
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              Hugo&rsquo;s room
            </p>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--color-ink-soft)",
                marginTop: "4px",
              }}
            >
              Press Esc or click outside to close.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-chunk"
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9999px",
              background: "var(--color-cream)",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "1rem",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </header>

        {/* Live readouts */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px",
            marginBottom: "18px",
          }}
        >
          <Stat label="Heart" value={`${Math.round(bpm)}`} unit="BPM" />
          <Stat label="Mood" value={MOOD_LABEL[mood]} />
          <Stat label="Energy" value={`${Math.round(energy)}`} unit="%" />
        </section>

        {/* Energy chart */}
        <section style={{ marginBottom: "18px" }}>
          <p
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "var(--color-ink-soft)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "6px",
            }}
          >
            Energy — last hour
          </p>
          <EnergyChart history={history} />
        </section>

        {/* Memory counters */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "10px 16px",
            marginBottom: "18px",
            fontSize: "0.85rem",
          }}
        >
          <Pair label="Day streak" value={`${memory.streakDays}`} />
          <Pair label="Total visits" value={`${memory.visitCount}`} />
          <Pair label="Naps" value={`${memory.naps}`} />
          <Pair label="Tantrums" value={`${memory.tantrums}`} />
          <Pair label="Somersaults" value={`${memory.flips}`} />
          <Pair
            label="Favourite tool"
            value={favTool ? favTool.title : "—"}
          />
        </section>

        <footer
          style={{
            fontSize: "0.75rem",
            color: "var(--color-ink-soft)",
            borderTop: "2px solid var(--color-ink)",
            paddingTop: "12px",
          }}
        >
          Hugo since {formatDate(memory.firstSeen)} (
          {ageDays} day{ageDays === 1 ? "" : "s"})
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-cream)",
        border: "2px solid var(--color-ink)",
        borderRadius: "12px",
        padding: "10px 12px",
      }}
    >
      <p
        style={{
          fontSize: "0.65rem",
          fontWeight: 700,
          color: "var(--color-ink-soft)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: "1.4rem",
          lineHeight: 1.1,
          marginTop: "2px",
        }}
      >
        {value}
        {unit ? (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-ink-soft)",
              marginLeft: "3px",
            }}
          >
            {unit}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "8px",
      }}
    >
      <span style={{ color: "var(--color-ink-soft)" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function EnergyChart({
  history,
}: {
  history: { t: number; energy: number }[];
}) {
  // Always render a fixed-aspect SVG. Pad data so the first/last
  // points anchor at the edges. If there are fewer than 2 samples,
  // render a flat baseline so the chart doesn't collapse.
  const W = 360;
  const H = 64;
  const padX = 4;
  const padY = 6;

  let pts: { x: number; y: number }[];
  if (history.length < 2) {
    pts = [
      { x: padX, y: H / 2 },
      { x: W - padX, y: H / 2 },
    ];
  } else {
    pts = history.map((s, i) => {
      const x = padX + ((W - padX * 2) * i) / (history.length - 1);
      const y = padY + ((H - padY * 2) * (100 - s.energy)) / 100;
      return { x, y };
    });
  }
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const area =
    `${d} L ${W - padX} ${H - padY} L ${padX} ${H - padY} Z`;

  return (
    <div
      style={{
        background: "var(--color-cream)",
        border: "2px solid var(--color-ink)",
        borderRadius: "12px",
        padding: "6px 8px",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Hugo's energy over the past hour"
      >
        <path d={area} fill="var(--color-tomato-soft)" opacity="0.55" />
        <path
          d={d}
          fill="none"
          stroke="var(--color-tomato)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
