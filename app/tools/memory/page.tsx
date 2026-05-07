"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Pair = { color: string; soft: string; symbol: string; label: string };

const ALL_PAIRS: Pair[] = [
  { color: "#ffc233", soft: "#ffeec2", symbol: "✶", label: "advice" },
  { color: "#ff7ab2", soft: "#ffd6e7", symbol: "❀", label: "feeling" },
  { color: "#4f66f2", soft: "#d6dcfc", symbol: "⇄", label: "convert" },
  { color: "#3fa66e", soft: "#cce8d8", symbol: "◴", label: "focus" },
  { color: "#ff5a3c", soft: "#ffd5cc", symbol: "▦", label: "qr" },
  { color: "#9333ea", soft: "#ead8fc", symbol: "¶", label: "read" },
  { color: "#f97316", soft: "#fed7aa", symbol: "◐", label: "roll" },
  { color: "#0d9488", soft: "#b8f0e7", symbol: "◍", label: "palette" },
  { color: "#3fa66e", soft: "#cce8d8", symbol: "✿", label: "three" },
  { color: "#4f66f2", soft: "#d6dcfc", symbol: "⊚", label: "breathe" },
  { color: "#ffc233", soft: "#ffeec2", symbol: "⊕", label: "tip" },
  { color: "#9333ea", soft: "#ead8fc", symbol: "◷", label: "until" },
];

type Card = { id: number; pairId: number };

type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTY_PAIRS: Record<Difficulty, number> = {
  easy: 6,
  medium: 8,
  hard: 12,
};

const DIFFICULTY_COLS: Record<Difficulty, number> = {
  easy: 4, // 6 pairs = 12 cards in a 4×3 grid
  medium: 4, // 8 pairs = 16 cards in a 4×4 grid
  hard: 6, // 12 pairs = 24 cards in a 6×4 grid
};

const STORAGE_KEY_BEST = "hugoslekstuga:memory:best";
const STORAGE_KEY_DIFF = "hugoslekstuga:memory:difficulty";

type Best = {
  moves: number;
  seconds: number;
};

export default function MemoryPage() {
  const tool = findTool("memory")!;
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [hydrated, setHydrated] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [bests, setBests] = useState<Record<Difficulty, Best | null>>({
    easy: null,
    medium: null,
    hard: null,
  });
  const flipBackTimer = useRef<number | null>(null);

  // Hydrate.
  useEffect(() => {
    let savedDiff: Difficulty = "medium";
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DIFF);
      if (raw === "easy" || raw === "medium" || raw === "hard") {
        savedDiff = raw;
      }
    } catch {}
    setDifficulty(savedDiff);

    try {
      const raw = localStorage.getItem(STORAGE_KEY_BEST);
      if (raw) {
        const b = JSON.parse(raw) as Record<Difficulty, Best | null>;
        if (b && typeof b === "object") {
          setBests({
            easy: b.easy ?? null,
            medium: b.medium ?? null,
            hard: b.hard ?? null,
          });
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Persist difficulty.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_DIFF, difficulty);
    } catch {}
  }, [difficulty, hydrated]);

  // Build a deck whenever difficulty changes (and after hydration).
  useEffect(() => {
    if (!hydrated) return;
    setCards(buildShuffledDeck(difficulty));
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setStartedAt(null);
    setNow(Date.now());
    if (flipBackTimer.current !== null) {
      window.clearTimeout(flipBackTimer.current);
      flipBackTimer.current = null;
    }
  }, [difficulty, hydrated]);

  // Tick timer while playing.
  useEffect(() => {
    if (startedAt === null) return;
    const totalCards = DIFFICULTY_PAIRS[difficulty] * 2;
    if (matched.size === totalCards) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [startedAt, matched.size, difficulty]);

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
    const totalCards = DIFFICULTY_PAIRS[difficulty] * 2;
    if (matched.size === totalCards && startedAt !== null) {
      const seconds = Math.floor((now - startedAt) / 1000);
      const candidate: Best = { moves, seconds };
      const existing = bests[difficulty];
      if (
        !existing ||
        candidate.moves < existing.moves ||
        (candidate.moves === existing.moves && candidate.seconds < existing.seconds)
      ) {
        const nextBests = { ...bests, [difficulty]: candidate };
        setBests(nextBests);
        try {
          localStorage.setItem(STORAGE_KEY_BEST, JSON.stringify(nextBests));
        } catch {}
      }
    }
  }, [matched, cards.length, moves, now, startedAt, difficulty, bests]);

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
    setCards(buildShuffledDeck(difficulty));
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setStartedAt(null);
    setNow(Date.now());
  }, [difficulty]);

  const elapsedSec =
    startedAt === null
      ? 0
      : matched.size === cards.length && cards.length > 0
        ? Math.floor((now - startedAt) / 1000)
        : Math.floor((Date.now() - startedAt) / 1000);

  const totalCards = DIFFICULTY_PAIRS[difficulty] * 2;
  const won = matched.size === totalCards && cards.length > 0;
  const cols = DIFFICULTY_COLS[difficulty];
  const best = bests[difficulty];

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                difficulty === d
                  ? "bg-purple text-cream"
                  : "bg-cream hover:bg-purple-soft"
              }`}
            >
              {d === "easy" ? "Easy · 6 pairs" : d === "medium" ? "Medium · 8 pairs" : "Hard · 12 pairs"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <Stat label="Moves" value={String(moves)} />
            <Stat label="Time" value={formatSec(elapsedSec)} />
            {best && (
              <Stat
                label={`Best (${difficulty})`}
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
                ? `A new ${difficulty} personal best!`
                : `Try ${difficulty === "hard" ? "again" : difficulty === "easy" ? "Medium" : "Hard"} next.`}
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

        <div
          className="grid gap-2 sm:gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {cards.map((card, i) => (
            <CardTile
              key={card.id}
              face={ALL_PAIRS[card.pairId]}
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
        className="flex h-full w-full items-center justify-center font-display text-2xl font-extrabold sm:text-3xl"
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

function buildShuffledDeck(difficulty: Difficulty): Card[] {
  const pairCount = DIFFICULTY_PAIRS[difficulty];
  const cards: Card[] = [];
  for (let p = 0; p < pairCount; p++) {
    cards.push({ id: p * 2, pairId: p });
    cards.push({ id: p * 2 + 1, pairId: p });
  }
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
