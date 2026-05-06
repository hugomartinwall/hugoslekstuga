"use client";

import { useState, useCallback } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { advice } from "@/lib/advice";

export default function AdvicePage() {
  const tool = findTool("advice")!;
  const [current, setCurrent] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const draw = useCallback(() => {
    if (advice.length === 0) return;
    let next = advice[Math.floor(Math.random() * advice.length)];
    if (advice.length > 1) {
      let attempts = 0;
      while (next === current && attempts < 8) {
        next = advice[Math.floor(Math.random() * advice.length)];
        attempts++;
      }
    }
    setCurrent(next);
    setAnimKey((k) => k + 1);
  }, [current]);

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
          <p className="text-sm text-ink-muted">
            Sometimes the smallest useful thing is enough.
          </p>
        )}
      </div>
    </ToolFrame>
  );
}
