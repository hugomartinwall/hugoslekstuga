"use client";

import { useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import HugoStage, { type HugoPose } from "@/components/hugo/HugoStage";
import Keycap from "@/components/ui/Keycap";
import { Chip } from "@/components/ui/Chip";
import PixelIcon from "@/components/PixelIcon";
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
 * today"), and if you treat him like a slot machine, he closes his
 * eyes for a while. The soul is calm sincerity with a wink; he never
 * speaks in bubbles, he just hands you the thing.
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
      const result = drawAdvice({
        memory,
        mood,
        dateKey: localISODate(new Date()),
      });
      setMemory(result.memory);
      saveAdviceMemory(result.memory);
      setCurrent(result);
      setPose("delivering");
      later(() => setPose("idle"), 950);
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
    : current.isDaily
      ? "Today's. Same line for everyone who asks him today."
      : current.isRepeat
        ? "He's told you this before. It's still true."
        : null;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-center gap-8 pb-4 text-center">
        {/* The character. Tap him — he's the other button. */}
        <HugoStage
          pose={declined ? "declining" : pose}
          size={120}
          onTap={draw}
          ariaLabel="Hugo. Tap him for one good advice."
        />

        {/* Tall enough for the longest line plus its subline (three lines
            of display type and the label, from a 360px phone up), so the
            key below stays put when a line lands. */}
        <div
          aria-live="polite"
          className="flex min-h-[10rem] w-full flex-col items-center justify-center md:min-h-[13rem]"
        >
          {current === null ? (
            <p className="max-w-md font-display text-2xl leading-snug text-balance text-ink-soft sm:text-3xl">
              Ask him.{" "}
              <span className="text-(--accent)">One advice at a time.</span>
            </p>
          ) : (
            <div
              key={current.memory.draws}
              className="fade-rise flex w-full flex-col items-center gap-3"
            >
              <p className="max-w-2xl font-display text-3xl leading-tight text-balance text-ink sm:text-4xl md:text-5xl">
                &ldquo;{current.entry.text}&rdquo;
              </p>
              {subline && <p className="label-pixel text-balance">{subline}</p>}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          {/* The one primary action. As wide as its longest label ("Give me
              one good advice" plus the key's padding), so swapping the
              words never changes its size. */}
          <Keycap
            tone="accent"
            size="lg"
            onClick={draw}
            disabled={declined || memory === null}
            className="w-full max-w-[calc(23ch+3rem)] whitespace-nowrap disabled:cursor-wait"
          >
            {buttonLabel}
          </Keycap>
          {/* Tapping him is the only other way in on a touch screen, so
              that half shows at every width; the key legend is for
              keyboards. */}
          <p className="text-xs text-ink-muted">
            <span className="pointer-coarse:hidden">
              or press <kbd className="kbd-chunk">Space</kbd> —{" "}
            </span>
            or tap him
          </p>
        </div>

        {current !== null && !declined && (
          <div className="flex flex-col items-center gap-3">
            {/* Each chip is as wide as its longer label, so toggling
                does not shift the pair. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Chip onClick={copy} className="min-w-[calc(7ch+1.75rem)]">
                {copied ? "Copied!" : "Copy"}
              </Chip>
              <Chip
                pressed={currentKept}
                onClick={keep}
                className="min-w-[calc(13ch+1.75rem)]"
              >
                {currentKept ? "Kept ✶" : "Worth keeping"}
              </Chip>
            </div>
            <p className="text-sm text-balance text-ink-muted">
              Sometimes the smallest useful thing is enough.
            </p>
          </div>
        )}

        {kept.length > 0 && (
          <section className="mt-6 w-full max-w-xl text-left">
            <h2 className="label-pixel">Things he&rsquo;s told you</h2>
            <ul className="mt-2 flex flex-col">
              {kept.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-sm leading-relaxed text-ink-soft"
                >
                  <span className="text-pretty">&ldquo;{e.text}&rdquo;</span>
                  {/* One per row, so a neutral key with a coral mark, not
                      a solid coral key: a column of red would outshout
                      the lines it sits beside. */}
                  <Keycap
                    size="icon"
                    aria-label={`Forget "${e.text}"`}
                    onClick={() => {
                      if (!memory) return;
                      const next = toggleKept(memory, e.id);
                      setMemory(next);
                      saveAdviceMemory(next);
                    }}
                    className="shrink-0"
                  >
                    <PixelIcon name="close" size={12} className="text-tomato" />
                  </Keycap>
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
