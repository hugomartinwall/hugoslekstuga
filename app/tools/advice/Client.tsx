"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { advice } from "@/lib/advice";

// Avoid drawing any of the last N items so the user doesn't see "send the
// message you're avoiding" three times in a row even with a list of 80.
const RECENT_WINDOW = 12;

export default function AdvicePage() {
  const tool = findTool("advice")!;
  const [current, setCurrent] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const recentRef = useRef<string[]>([]);

  const draw = useCallback(() => {
    if (advice.length === 0) return;
    setCopied(false);
    const cap = Math.min(RECENT_WINDOW, Math.max(0, advice.length - 1));
    let next = advice[Math.floor(Math.random() * advice.length)];
    let attempts = 0;
    while (recentRef.current.includes(next) && attempts < 24) {
      next = advice[Math.floor(Math.random() * advice.length)];
      attempts++;
    }
    recentRef.current = [next, ...recentRef.current].slice(0, cap);
    setCurrent(next);
    setAnimKey((k) => k + 1);
  }, []);

  const copy = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard write can fail in some sandboxed contexts; fall back silently.
    }
  }, [current]);

  // Spacebar draws a new advice (when not focused on an input).
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
  }, [draw]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-center gap-10 py-6 text-center">
        <div
          key={animKey}
          className="fade-rise flex min-h-[10rem] w-full items-center justify-center"
        >
          {current === null ? (
            <p className="max-w-md font-display text-2xl font-medium leading-snug text-ink-soft sm:text-3xl">
              Press the button.{" "}
              <span className="text-yellow-700">One advice at a time.</span>
            </p>
          ) : (
            <p className="max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl md:text-5xl">
              &ldquo;{current}&rdquo;
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={draw}
          className="btn-chunk rounded-[var(--radius-button)] bg-yellow px-8 py-4 font-display text-lg font-extrabold tracking-tight sm:text-xl"
        >
          {current === null ? "Give me one good advice" : "Give me another"}
        </button>

        {current !== null && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copy}
                className="rounded-full border-2 border-ink bg-cream px-4 py-1.5 text-sm font-bold transition-colors hover:bg-yellow-soft"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <span className="hidden items-center gap-1 text-xs text-ink-muted sm:inline-flex">
                or press
                <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
                  Space
                </kbd>
                for another
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              Sometimes the smallest useful thing is enough.
            </p>
          </div>
        )}
      </div>
    </ToolFrame>
  );
}
