"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { generatePrompt, type Prompt } from "@/lib/idea";

export default function IdeaPage() {
  const tool = findTool("idea")!;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const spark = useCallback(() => {
    setPrompt((prev) => generatePrompt(prev ?? undefined));
    setAnimKey((k) => k + 1);
  }, []);

  // Spacebar sparks a new prompt.
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
      spark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spark]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-stretch gap-7">
        {prompt === null ? (
          <p className="text-center font-display text-xl font-medium leading-snug text-ink-soft sm:text-2xl">
            A short prompt to get the page moving.{" "}
            <span className="text-pink">Press Spark.</span>
          </p>
        ) : (
          <div
            key={animKey}
            className="fade-rise card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-pink-soft p-5 sm:p-7"
          >
            <Line label="Character" value={prompt.character} />
            <Line label="Setting" value={prompt.setting} />
            <Line label="Twist" value={prompt.twist} />
            <Line label="Tone" value={prompt.tone} />
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={spark}
            className="btn-chunk rounded-[var(--radius-button)] bg-pink px-7 py-3 font-display text-lg font-extrabold"
          >
            {prompt === null ? "Spark a prompt" : "Spark another"}
          </button>
          <span className="hidden text-xs text-ink-muted sm:inline-flex sm:items-center sm:gap-1">
            or press
            <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
              Space
            </kbd>
          </span>
        </div>

        <p className="text-xs text-ink-muted">
          The pieces are randomly recombined from curated lists. Use what
          sparks something; ignore the rest.
        </p>
      </div>
    </ToolFrame>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="font-display text-xl font-extrabold leading-snug tracking-tight sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
