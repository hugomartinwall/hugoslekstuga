"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Pair = { color: string; soft: string; symbol: string; label: string };

const PAIRS: Pair[] = [
  { color: "#ffc233", soft: "#ffeec2", symbol: "✶", label: "advice" },
  { color: "#ff7ab2", soft: "#ffd6e7", symbol: "❀", label: "feeling" },
  { color: "#4f66f2", soft: "#d6dcfc", symbol: "⇄", label: "convert" },
  { color: "#3fa66e", soft: "#cce8d8", symbol: "◴", label: "focus" },
  { color: "#ff5a3c", soft: "#ffd5cc", symbol: "▦", label: "qr" },
  { color: "#9333ea", soft: "#ead8fc", symbol: "¶", label: "read" },
  { color: "#f97316", soft: "#fed7aa", symbol: "◐", label: "roll" },
  { color: "#0d9488", soft: "#b8f0e7", symbol: "◍", label: "palette" },
];

type Card = { id: number; pairId: number };

const STORAGE_KEY = "hugoslekstuga:memory:best";

type Best = {
  moves: number;
  seconds: number;
};

export default function MemoryPage() {
  const tool = findTool("memory")!;
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [best, setBest] = useState<Best | null>(null);
  const flipBackTimer = useRef<number | null>(null);

  useEffect(() => {
    setCards(buildShuffledDeck());
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const b = JSON.parse(raw) as Best;
        if (typeof b.moves === "number" && typeof b.seconds === "number") {
          setBest(b);
        }
      }
    } catch {}
  }, []);

  // Tick timer while playing.
  useEffect(() => {
    if (startedAt === null) return;
    if (matched.size === PAIRS.length * 2) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [startedAt, matched.size]);

  // When 2 cards are flipped, evaluate.
  useEffect(() => {
    if (flipped.length !== 2) return;
    const [a, b] = flipped;
    const ca = cards[a];
    const cb = cards[b];
    if (!ca || !cb) return;
    if (ca.pairId === cb.pairId) {
      setMatched((prev) => {
        const next = new Set(prev);
        next.add(a);
        next.add(b);
        return next;
      });
      setFlipped([]);
    } else {
      flipBackTimer.current = window.setTimeout(() => {
        setFlipped([]);
        flipBackTimer.current = null;
      }, 800);
    }
  }, [flipped, cards]);

  // On win, record best.
  useEffect(() => {
    if (cards.length === 0) return;
    if (matched.size === PAIRS.length * 2 && startedAt !== null) {
      const seconds = Math.floor((now - startedAt) / 1000);
      const candidate: Best = { moves, seconds };
      if (
        !best ||
        candidate.moves < best.moves ||
        (candidate.moves === best.moves && candidate.seconds < best.seconds)
      ) {
        setBest(candidate);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
        } catch {}
      }
    }
  }, [matched, cards.length, moves, now, startedAt, best]);

  const flip = useCallback(
    (i: number) => {
      if (matched.has(i)) return;
      if (flipped.includes(i)) return;
      if (flipped.length === 2) return;
      if (flipBackTimer.current !== null) return;
      if (startedAt === null) setStartedAt(Date.now());
      const next = [...flipped, i];
      setFlipped(next);
      if (next.length === 2) setMoves((m) => m + 1);
    },
    [flipped, matched, startedAt],
  );

  const reset = useCallback(() => {
    if (flipBackTimer.current !== null) {
      window.clearTimeout(flipBackTimer.current);
      flipBackTimer.current = null;
    }
    setCards(buildShuffledDeck());
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setStartedAt(null);
    setNow(Date.now());
  }, []);

  const elapsedSec =
    startedAt === null
      ? 0
      : matched.size === PAIRS.length * 2
        ? Math.floor((now - startedAt) / 1000)
        : Math.floor((Date.now() - startedAt) / 1000);

  const won = matched.size === PAIRS.length * 2 && cards.length > 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <Stat label="Moves" value={String(moves)} />
            <Stat label="Time" value={formatSec(elapsedSec)} />
            {best && (
              <Stat
                label="Best"
                value={`${best.moves} moves · ${formatSec(best.seconds)}`}
              />
            )}
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-purple-soft"
          >
            New game
          </button>
        </div>

        {won && (
          <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-purple-soft p-5 text-center sm:p-6">
            <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Cleared in {moves} moves
            </p>
            <p className="text-sm text-ink-soft">
              Time: {formatSec(elapsedSec)}.{" "}
              {best && best.moves === moves && best.seconds === elapsedSec
                ? "A new personal best!"
                : "Try to beat it."}
            </p>
            <button
              type="button"
              onClick={reset}
              className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-purple px-6 py-2 font-display text-base font-extrabold text-cream"
            >
              Again
            </button>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {cards.map((card, i) => (
            <CardTile
              key={card.id}
              face={PAIRS[card.pairId]}
              flipped={flipped.includes(i) || matched.has(i)}
              matched={matched.has(i)}
              onClick={() => flip(i)}
            />
          ))}
        </div>
      </div>
    </ToolFrame>
  );
}

function CardTile({
  face,
  flipped,
  matched,
  onClick,
}: {
  face: Pair;
  flipped: boolean;
  matched: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={matched}
      aria-label={matched ? `${face.label} matched` : flipped ? face.label : "card"}
      className={`relative aspect-square w-full rounded-[14px] border-2 border-ink transition-transform ${
        matched ? "opacity-90" : "hover:-translate-y-0.5"
      }`}
      style={{
        background: flipped ? face.soft : "#1a1812",
      }}
    >
      <span
        className="flex h-full w-full items-center justify-center font-display text-3xl font-extrabold sm:text-4xl"
        style={{ color: flipped ? face.color : "#fbf6ee" }}
      >
        {flipped ? face.symbol : "·"}
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="font-display text-base font-extrabold tabular-nums">
        {value}
      </span>
    </div>
  );
}

function buildShuffledDeck(): Card[] {
  const cards: Card[] = [];
  for (let p = 0; p < PAIRS.length; p++) {
    cards.push({ id: p * 2, pairId: p });
    cards.push({ id: p * 2 + 1, pairId: p });
  }
  // Fisher–Yates shuffle.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
