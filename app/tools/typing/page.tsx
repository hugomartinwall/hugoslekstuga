"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const BEST_KEY = "hugoslekstuga:typing:best";

const PASSAGES: string[] = [
  "The good thing about small projects is that you can finish them. The bad thing about big projects is that you have to. Most great work is a series of small projects, finished with the same hands and the same patience.",
  "She watched the harbour fill with light, slowly at first, then all at once. The boats woke up. The gulls woke up. The town remembered itself. By the time the bread arrived she was already on her second coffee, half a list ahead.",
  "If a tool feels good to use, you reach for it. If it feels bad, you avoid it, even if it would help. The friction is the design. So is the lack of it. Everything is a choice, and most choices are about what you remove.",
  "He asked the same question three times before realising she was answering a different one. They laughed. They went outside. The afternoon was longer than they expected, in the good way that afternoons sometimes are.",
  "There is something honest about a thing that runs in your browser. No one is watching. No one is monetising. The page just does what the page promises, then forgets you the moment you close the tab.",
  "Old maps are full of mistakes that are nicer than the truth. A coastline that bends the wrong way. A city in the wrong country. The cartographer was guessing, and the guess became canon for two hundred years.",
];

type Status = "idle" | "running" | "done";

type Stats = {
  wpm: number;
  acc: number;
  correct: number;
  errors: number;
  seconds: number;
};

const SECONDS_OPTIONS = [30, 60];

function pickPassage(): string {
  return PASSAGES[Math.floor(Math.random() * PASSAGES.length)];
}

export default function TypingPage() {
  const tool = findTool("typing")!;
  const [seconds, setSeconds] = useState(60);
  const [passage, setPassage] = useState<string>("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [remaining, setRemaining] = useState(60);
  const [errors, setErrors] = useState(0);
  const [best, setBest] = useState<Stats | null>(null);
  const startedRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mount: pick passage and load best
  useEffect(() => {
    setPassage(pickPassage());
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stats;
        if (typeof parsed.wpm === "number") setBest(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  const finish = useCallback(() => {
    const elapsed = startedRef.current
      ? Math.min(seconds, (performance.now() - startedRef.current) / 1000)
      : seconds;
    const correct = Array.from(typed).filter(
      (c, i) => c === passage[i],
    ).length;
    const wpm = elapsed > 0 ? Math.round((correct / 5) / (elapsed / 60)) : 0;
    const acc =
      typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
    const stats: Stats = {
      wpm,
      acc,
      correct,
      errors,
      seconds: Math.round(elapsed),
    };
    setStatus("done");
    if (!best || wpm > best.wpm) {
      setBest(stats);
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(stats));
      } catch {}
    }
  }, [typed, passage, errors, best, seconds]);

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
    setErrors(0);
    setStatus("running");
    startedRef.current = performance.now();
    setRemaining(seconds);
    inputRef.current?.focus();
  }, [seconds]);

  const restart = useCallback(() => {
    setPassage(pickPassage());
    setTyped("");
    setErrors(0);
    setRemaining(seconds);
    setStatus("idle");
    startedRef.current = null;
  }, [seconds]);

  const onChange = (next: string) => {
    if (status === "done") return;
    if (status === "idle" && next.length > 0) {
      // First keypress starts the test
      setStatus("running");
      startedRef.current = performance.now();
    }
    // Cap typed length at passage length
    const sliced = next.slice(0, passage.length);
    // Count new errors
    const prevLen = typed.length;
    if (sliced.length > prevLen) {
      const ch = sliced[sliced.length - 1];
      if (ch !== passage[sliced.length - 1]) {
        setErrors((e) => e + 1);
      }
    }
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

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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

        {status === "done" ? (
          <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-green-soft p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Result
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="WPM" value={String(liveWpm)} big />
              <Stat label="Accuracy" value={`${liveAcc}%`} />
              <Stat label="Errors" value={String(errors)} />
              <Stat label="Seconds" value={String(seconds - Math.round(remaining))} />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={restart}
                className="btn-chunk rounded-[var(--radius-button)] bg-green px-5 py-2 font-display text-base font-extrabold text-cream"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={status === "running" ? restart : start}
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
