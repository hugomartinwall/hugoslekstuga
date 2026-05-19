"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const BEST_KEY = "hugoslekstuga:typing:best";
const RECENT_KEY = "hugoslekstuga:typing:recent";

const PASSAGES: string[] = [
  "The good thing about small projects is that you can finish them. The bad thing about big projects is that you have to. Most great work is a series of small projects, finished with the same hands and the same patience.",
  "She watched the harbour fill with light, slowly at first, then all at once. The boats woke up. The gulls woke up. The town remembered itself. By the time the bread arrived she was already on her second coffee, half a list ahead.",
  "If a tool feels good to use, you reach for it. If it feels bad, you avoid it, even if it would help. The friction is the design. So is the lack of it. Everything is a choice, and most choices are about what you remove.",
  "He asked the same question three times before realising she was answering a different one. They laughed. They went outside. The afternoon was longer than they expected, in the good way that afternoons sometimes are.",
  "There is something honest about a thing that runs in your browser. No one is watching. No one is monetising. The page just does what the page promises, then forgets you the moment you close the tab.",
  "Old maps are full of mistakes that are nicer than the truth. A coastline that bends the wrong way. A city in the wrong country. The cartographer was guessing, and the guess became canon for two hundred years.",
  "There is a kind of song you do not so much choose as recognise. You hear three notes and you already know how it ends. The ending is the point. You wait for it the way you wait for the train you missed yesterday.",
  "She read at the speed of a slow walker. Other people would finish the same novel in a weekend. She would take a month and remember everything — the cover, the smell of the bookshop, what she had for lunch the Tuesday she was halfway through.",
  "The road got narrower the further north they drove. By the third hour the radio was static and the trees were taller than the cabin. Nobody minded. They had food. They had each other. They had a thermos that was still, miraculously, hot.",
  "Bad sleep makes you a worse version of yourself. You know this. Everyone knows this. And yet the same people who would never skip lunch will skip an hour of sleep and act surprised by the consequences. The body keeps a different ledger than the calendar, and it always collects, and the interest is steep.",
  "The first attempt looked like a failure. The second looked like a different failure. By the fourth he was certain he was getting somewhere, though he could not have said where. That is the trick: looking certain to yourself, even when you are not.",
  "The storm came in from the west, the way it always does in this valley. By six the rain had started. By seven the lights were out. They lit candles and sat in the kitchen and pretended the storm was a guest who would be gone by morning.",
];

type Status = "idle" | "running" | "done";

type Stats = {
  wpm: number;
  acc: number;
  correct: number;
  errors: number;
  seconds: number;
};

const SECONDS_OPTIONS = [15, 30, 60, 120];
const RECENT_LIMIT = 5;

// Keys we render on the heatmap — all letters, the two most common
// punctuation marks in prose, and space. Other punctuation (apostrophe,
// em-dash, semicolon, etc.) appears too rarely to earn a slot, but
// errors on them are still counted in the overall error stat.
const HEAT_ROW_1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const HEAT_ROW_2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const HEAT_ROW_3 = ["z", "x", "c", "v", "b", "n", "m", ",", "."];

function pickPassage(exclude?: string): string {
  if (PASSAGES.length === 1) return PASSAGES[0];
  let p: string;
  do {
    p = PASSAGES[Math.floor(Math.random() * PASSAGES.length)];
  } while (p === exclude);
  return p;
}

export default function TypingPage() {
  const tool = findTool("typing")!;
  const [seconds, setSeconds] = useState(60);
  // Pick the initial passage in the lazy initialiser so it's stable across
  // renders without needing an effect.
  const [passage, setPassage] = useState<string>(() => pickPassage());
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [remaining, setRemaining] = useState(60);
  const [lastStats, setLastStats] = useState<Stats | null>(null);
  const [best, setBest] = useLocalStorageState<Stats | null>(BEST_KEY, null);
  const [recent, setRecent] = useLocalStorageState<number[]>(RECENT_KEY, []);
  const startedRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the remaining-time display when the user picks a different
  // duration. Standard "external prop change resets state" — not pure
  // derivation because remaining ticks down independently while running.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const finish = useCallback(() => {
    const elapsed = startedRef.current
      ? Math.min(seconds, (performance.now() - startedRef.current) / 1000)
      : seconds;
    const correct = Array.from(typed).filter(
      (c, i) => c === passage[i],
    ).length;
    const errorsAtFinish = typed.length - correct;
    const wpm = elapsed > 0 ? Math.round((correct / 5) / (elapsed / 60)) : 0;
    const acc =
      typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
    const stats: Stats = {
      wpm,
      acc,
      correct,
      errors: errorsAtFinish,
      seconds: Math.round(elapsed),
    };
    setLastStats(stats);
    setStatus("done");
    // Only record runs where the user actually typed something. A timer
    // that ran out on an empty passage shouldn't pollute the trend.
    if (typed.length > 0) {
      setRecent((arr) => [wpm, ...arr].slice(0, RECENT_LIMIT));
      if (!best || wpm > best.wpm) {
        setBest(stats);
        // Personal best — Hugo notices. Stays quiet on ordinary finishes
        // so the celebration means something.
        window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
      }
    }
  }, [typed, passage, best, seconds, setBest, setRecent]);

  // Timer tick — uses a ref to call the latest `finish` without retriggering the effect.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  useEffect(() => {
    if (status !== "running") {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
      return;
    }
    const tick = () => {
      if (startedRef.current === null) return;
      const elapsed = (performance.now() - startedRef.current) / 1000;
      const r = Math.max(0, seconds - elapsed);
      setRemaining(r);
      if (r <= 0) {
        finishRef.current();
        return;
      }
      tickRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = requestAnimationFrame(tick);
    return () => {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current);
    };
  }, [status, seconds]);

  const start = useCallback(() => {
    setTyped("");
    setStatus("running");
    startedRef.current = performance.now();
    setRemaining(seconds);
    inputRef.current?.focus();
  }, [seconds]);

  // Reset state for a fresh attempt. Used by both the restart-while-running
  // button and the post-done buttons.
  const resetState = useCallback(() => {
    setTyped("");
    setRemaining(seconds);
    setStatus("idle");
    setLastStats(null);
    startedRef.current = null;
  }, [seconds]);

  const replay = useCallback(() => {
    // Same passage, fresh attempt.
    resetState();
  }, [resetState]);

  const newPassage = useCallback(() => {
    setPassage(pickPassage(passage));
    resetState();
  }, [passage, resetState]);

  const onChange = (next: string) => {
    if (status === "done") return;
    if (status === "idle" && next.length > 0) {
      // First keypress starts the test
      setStatus("running");
      startedRef.current = performance.now();
    }
    // Cap typed length at passage length
    const sliced = next.slice(0, passage.length);
    setTyped(sliced);
    if (sliced.length === passage.length) {
      finish();
    }
  };

  const correctSoFar = useMemo(
    () => Array.from(typed).filter((c, i) => c === passage[i]).length,
    [typed, passage],
  );
  const liveWpm = useMemo(() => {
    if (status === "idle") return 0;
    // Derive elapsed from existing ticking state — keeps the memo pure.
    const elapsed = Math.max(0, seconds - remaining);
    if (elapsed < 1) return 0;
    return Math.round((correctSoFar / 5) / (elapsed / 60));
  }, [correctSoFar, status, remaining, seconds]);
  const liveAcc =
    typed.length > 0
      ? Math.round((correctSoFar / typed.length) * 100)
      : 100;

  // Per-key error counts, used for the heatmap. Keyed by the *expected*
  // character (lower-cased) at each error position — i.e. the key the
  // user kept missing, not the wrong key they pressed.
  const keyErrors = useMemo(() => {
    if (status !== "done") return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] !== passage[i] && passage[i] !== undefined) {
        const k = passage[i].toLowerCase();
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return counts;
  }, [status, typed, passage]);

  const totalKeyErrors = Object.values(keyErrors).reduce((a, b) => a + b, 0);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {SECONDS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeconds(s)}
                disabled={status === "running"}
                className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                  seconds === s
                    ? "bg-green text-cream"
                    : "bg-cream hover:bg-green-soft"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {s}s
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Pill label="time" value={`${remaining.toFixed(1)}s`} />
            <Pill label="wpm" value={String(liveWpm)} accent />
            <Pill label="acc" value={`${liveAcc}%`} />
          </div>
        </div>

        <div
          onClick={() => inputRef.current?.focus()}
          className="card-chunk relative cursor-text rounded-[var(--radius-card)] bg-cream p-5 font-mono text-lg leading-relaxed sm:text-xl"
        >
          {passage.split("").map((ch, i) => {
            const typedCh = typed[i];
            const isCurrent = i === typed.length;
            const cls =
              typedCh === undefined
                ? "text-ink-muted"
                : typedCh === ch
                ? "text-ink"
                : "bg-tomato-soft text-tomato";
            return (
              <span
                key={i}
                className={`${cls} ${isCurrent ? "border-l-2 border-ink" : ""}`}
              >
                {ch}
              </span>
            );
          })}
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            disabled={status === "done"}
            autoFocus
            aria-label="Type the passage"
            className="absolute left-0 top-0 h-full w-full opacity-0"
          />
        </div>

        {status === "done" && lastStats ? (
          <>
            <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-green-soft p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Result
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="WPM" value={String(lastStats.wpm)} big />
                <Stat label="Accuracy" value={`${lastStats.acc}%`} />
                <Stat label="Errors" value={String(lastStats.errors)} />
                <Stat label="Seconds" value={String(lastStats.seconds)} />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={replay}
                  className="btn-chunk rounded-[var(--radius-button)] bg-green px-5 py-2 font-display text-base font-extrabold text-cream"
                >
                  Replay
                </button>
                <button
                  type="button"
                  onClick={newPassage}
                  className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-base font-extrabold"
                >
                  New passage
                </button>
              </div>
            </div>

            <div className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Heatmap
              </p>
              <div className="flex flex-col items-center gap-1">
                <KeyRow keys={HEAT_ROW_1} errors={keyErrors} />
                <KeyRow keys={HEAT_ROW_2} errors={keyErrors} offset={0.5} />
                <KeyRow keys={HEAT_ROW_3} errors={keyErrors} offset={1} />
                <SpaceKey count={keyErrors[" "] ?? 0} />
              </div>
              <p className="text-[11px] text-ink-muted">
                {totalKeyErrors === 0
                  ? "no errors to map — clean run"
                  : "deeper red = more misses. focus practice on the hot keys."}
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={status === "running" ? newPassage : start}
              className="btn-chunk rounded-[var(--radius-button)] bg-green px-6 py-2 font-display text-base font-extrabold text-cream"
            >
              {status === "running" ? "Restart" : "Start (or just type)"}
            </button>
            {best && (
              <span className="text-xs text-ink-muted">
                best: <span className="font-bold text-ink">{best.wpm} wpm</span>{" "}
                ({best.acc}%)
              </span>
            )}
          </div>
        )}

        {recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="uppercase tracking-wide">recent</span>
            {recent.map((r, i) => (
              <span
                key={i}
                className="rounded-full border-2 border-ink-soft bg-cream px-2 py-0.5 font-mono font-bold tabular-nums text-ink"
              >
                {r}
              </span>
            ))}
            <span className="opacity-60">wpm</span>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Counts five characters as one word, the standard CPM/5 measure. The
          test ends after the timer runs out or the passage is finished.
        </p>
      </div>
    </ToolFrame>
  );
}

function Pill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full border-2 border-ink px-3 py-1 text-xs font-bold ${accent ? "bg-green text-cream" : "bg-cream"}`}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border-2 border-ink bg-cream p-3">
      <span
        className={`font-display font-extrabold tabular-nums ${big ? "text-3xl sm:text-4xl" : "text-xl"}`}
      >
        {value}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
    </div>
  );
}

function tintClass(count: number): string {
  if (count === 0) return "bg-cream-deep text-ink-soft";
  if (count <= 2) return "bg-tomato-soft text-ink";
  return "bg-tomato text-cream";
}

function KeyCell({ char, count }: { char: string; count: number }) {
  return (
    <span
      title={count > 0 ? `${count} miss${count === 1 ? "" : "es"}` : undefined}
      className={`flex h-7 w-7 select-none items-center justify-center rounded border-2 border-ink font-mono text-xs font-bold ${tintClass(count)}`}
    >
      {char.toUpperCase()}
    </span>
  );
}

function KeyRow({
  keys,
  errors,
  offset = 0,
}: {
  keys: string[];
  errors: Record<string, number>;
  offset?: number;
}) {
  return (
    <div
      className="flex gap-1"
      style={{ marginLeft: `${offset * 1.75}rem` }}
    >
      {keys.map((k) => (
        <KeyCell key={k} char={k} count={errors[k] ?? 0} />
      ))}
    </div>
  );
}

function SpaceKey({ count }: { count: number }) {
  return (
    <span
      title={count > 0 ? `${count} miss${count === 1 ? "" : "es"} on space` : undefined}
      className={`mt-0.5 flex h-7 w-48 select-none items-center justify-center rounded border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest ${tintClass(count)}`}
    >
      space
    </span>
  );
}
