"use client";

import { useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import HugoStage, { type HugoPose } from "@/components/hugo/HugoStage";
import { findTool } from "@/lib/tools";
import { localISODate } from "@/lib/dates";
import { getHugoState, useHugoState, type HugoMood } from "@/lib/hugo-state";
import {
  drawAdvice,
  keptEntries,
  loadAdviceMemory,
  saveAdviceMemory,
  toggleKept,
  type AdviceMemory,
  type DrawResult,
} from "@/lib/advice-engine";

/**
 * Advice — Hugo's home.
 *
 * He stands center-stage (the corner dot yields while this page is
 * open) and hands you one line at a time. The character does the
 * delivering: a thinking beat whose length follows his mood, a glance
 * down at the line, then up at you. He remembers what he's told you
 * across visits, keeps one deterministic line per day ("one for
 * today"), holds a tiny rare pool for people who keep coming back —
 * and if you treat him like a slot machine, he closes his eyes for a
 * while. The soul is calm sincerity with a wink; he never speaks in
 * bubbles, he just hands you the thing.
 */

/** Thinking-beat length per mood — sleepy Hugo takes his time. */
const THINK_MS: Record<HugoMood, number> = {
  sleepy: 950,
  calm: 550,
  curious: 380,
  excited: 200,
  grumpy: 750,
};

const DECLINE_AFTER_DRAWS = 10;
const DECLINE_WINDOW_MS = 45_000;
const DECLINE_MS = 20_000;

export default function AdvicePage() {
  const tool = findTool("advice")!;
  const mood = useHugoState((s) => s.mood);

  const [memory, setMemory] = useState<AdviceMemory | null>(null);
  const [current, setCurrent] = useState<DrawResult | null>(null);
  const [pose, setPose] = useState<HugoPose>("idle");
  const [declined, setDeclined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [knownSince, setKnownSince] = useState<string | null>(null);

  const drawTimesRef = useRef<number[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // Deferred a tick: hydrating memory synchronously inside the effect
    // would cascade a render before paint (react-hooks/set-state-in-effect).
    const tid = window.setTimeout(() => {
      setMemory(loadAdviceMemory());
      const firstSeen = getHugoState().memory.firstSeen;
      if (firstSeen) {
        setKnownSince(
          new Date(firstSeen).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        );
      }
    }, 0);
    const timers = timersRef.current;
    return () => {
      window.clearTimeout(tid);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };

  const busy = pose === "thinking" || declined;

  const draw = () => {
    if (!memory || busy) return;
    setCopied(false);

    // The anti-slot-machine gesture: over-ask and he needs a moment.
    const now = Date.now();
    drawTimesRef.current = [
      now,
      ...drawTimesRef.current.filter((t) => now - t < DECLINE_WINDOW_MS),
    ];
    if (drawTimesRef.current.length >= DECLINE_AFTER_DRAWS) {
      drawTimesRef.current = [];
      setPose("declining");
      setDeclined(true);
      later(() => {
        setDeclined(false);
        setPose("idle");
      }, DECLINE_MS);
      return;
    }

    setPose("thinking");
    later(() => {
      const hugo = getHugoState();
      const result = drawAdvice({
        memory,
        mood,
        streakDays: hugo.memory.streakDays,
        visitCount: hugo.memory.visitCount,
        firstSeen: hugo.memory.firstSeen,
        dateKey: localISODate(new Date()),
      });
      setMemory(result.memory);
      saveAdviceMemory(result.memory);
      setCurrent(result);
      setPose(result.isRare ? "celebrating" : "delivering");
      later(() => setPose("idle"), result.isRare ? 1600 : 950);
    }, THINK_MS[mood]);
  };

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.entry.text);
      setCopied(true);
      later(() => setCopied(false), 1600);
    } catch {
      // Clipboard write can fail in sandboxed contexts; fall back silently.
    }
  };

  const keep = () => {
    if (!memory || !current) return;
    const next = toggleKept(memory, current.entry.id);
    setMemory(next);
    saveAdviceMemory(next);
  };

  // Spacebar draws (when not focused on an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      draw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, pose, declined, mood]);

  const todayKey = localISODate(new Date());
  const dailyPending = memory !== null && memory.lastDailyKey !== todayKey;
  const kept = memory ? keptEntries(memory) : [];
  const currentKept =
    memory && current ? memory.keptIds.includes(current.entry.id) : false;

  const buttonLabel = declined
    ? "(He needs a moment.)"
    : current === null
      ? dailyPending
        ? "One for today"
        : "Give me one good advice"
      : "Give me another";

  const subline = !current
    ? null
    : current.isRare
      ? "One of the rare ones. He doesn't hand these out often."
      : current.isDaily
        ? "Today's. Same line for everyone who asks him today."
        : current.isRepeat
          ? "He's told you this before. It's still true."
          : null;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-center gap-8 py-4 text-center">
        {/* The character. Tap him — he's the other button. */}
        <HugoStage
          pose={declined ? "declining" : pose}
          size={120}
          onTap={draw}
          ariaLabel="Hugo. Tap him for one good advice."
        />

        <div
          aria-live="polite"
          className="flex min-h-[9rem] w-full flex-col items-center justify-center gap-3"
        >
          {current === null ? (
            <p className="max-w-md font-display text-2xl leading-snug text-ink-soft sm:text-3xl">
              Ask him.{" "}
              <span className="text-yellow">One advice at a time.</span>
            </p>
          ) : (
            <div key={current.memory.draws} className="fade-rise contents">
              <p
                className={`max-w-2xl font-display text-3xl leading-tight text-ink sm:text-4xl md:text-5xl ${
                  current.isRare ? "text-glow text-yellow" : ""
                }`}
              >
                &ldquo;{current.entry.text}&rdquo;
              </p>
              {subline && (
                <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-ink-muted">
                  {subline}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={draw}
            disabled={declined || memory === null}
            className="btn-chunk rounded-[var(--radius-button)] bg-yellow px-8 py-4 font-display text-lg text-cream disabled:cursor-wait disabled:opacity-60 sm:text-xl"
          >
            {buttonLabel}
          </button>
          <span className="hidden items-center gap-1 text-xs text-ink-muted sm:inline-flex">
            or press
            <kbd className="rounded border border-line bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
              Space
            </kbd>
            — or tap him
          </span>
        </div>

        {current !== null && !declined && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copy}
                className="rounded-full border-2 border-ink bg-cream px-4 py-1.5 text-sm font-bold transition-colors hover:bg-yellow-soft"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={keep}
                aria-pressed={currentKept}
                className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold transition-colors ${
                  currentKept
                    ? "border-yellow bg-yellow-soft text-ink"
                    : "border-ink bg-cream hover:bg-yellow-soft"
                }`}
              >
                {currentKept ? "Kept ✶" : "Worth keeping"}
              </button>
            </div>
            <p className="text-sm text-ink-muted">
              Sometimes the smallest useful thing is enough.
            </p>
          </div>
        )}

        {kept.length > 0 && (
          <section className="mt-6 w-full max-w-xl text-left">
            <h2 className="font-pixel text-[10px] uppercase tracking-[0.25em] text-ink-muted">
              Things he&rsquo;s told you
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {kept.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-3 border-b border-line pb-2 text-sm leading-relaxed text-ink-soft"
                >
                  <span>&ldquo;{e.text}&rdquo;</span>
                  <button
                    type="button"
                    aria-label={`Forget "${e.text}"`}
                    onClick={() => {
                      if (!memory) return;
                      const next = toggleKept(memory, e.id);
                      setMemory(next);
                      saveAdviceMemory(next);
                    }}
                    className="text-ink-muted transition-colors hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {knownSince && (
          <p className="mt-4 text-xs text-ink-muted">
            He&rsquo;s known you since {knownSince}.
          </p>
        )}
      </div>
    </ToolFrame>
  );
}
