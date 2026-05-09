"use client";

import { useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { feelings, type Feeling } from "@/lib/feelings";
import { bgSoftClass, bgSoftHoverClass, fillClasses } from "@/lib/colors";

export default function FeelingPage() {
  const tool = findTool("feeling")!;
  const [active, setActive] = useState<Feeling | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && active !== null) setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <ToolFrame tool={tool}>
      {active === null ? (
        <FeelingPicker onPick={setActive} />
      ) : (
        <FeelingTips feeling={active} onBack={() => setActive(null)} />
      )}
    </ToolFrame>
  );
}

function FeelingPicker({ onPick }: { onPick: (f: Feeling) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-2xl font-bold leading-snug sm:text-3xl">
        What are you feeling right now?
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
        {feelings.map((f) => (
          <button
            key={f.slug}
            type="button"
            onClick={() => onPick(f)}
            className={`btn-chunk group flex flex-col items-start gap-2 rounded-[var(--radius-card)] p-4 text-left transition-colors ${bgSoftHoverClass(f.color)}`}
          >
            <span className="text-2xl" aria-hidden>
              {f.emoji}
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              {f.label}
            </span>
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-muted">
        These tips are short, evidence-based, and not a substitute for
        professional support. If you&rsquo;re in crisis, please reach out to
        someone who can help.
      </p>
    </div>
  );
}

function FeelingTips({
  feeling,
  onBack,
}: {
  feeling: Feeling;
  onBack: () => void;
}) {
  return (
    <div className="fade-rise flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
      >
        <span>← Pick another feeling</span>
        <kbd className="hidden rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[10px] uppercase sm:inline">
          Esc
        </kbd>
      </button>

      <div
        className={`card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] p-5 sm:p-6 ${bgSoftClass(feeling.color)}`}
      >
        <span className="text-4xl" aria-hidden>
          {feeling.emoji}
        </span>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {feeling.label}
        </h2>
        <p className="text-base text-ink-soft sm:text-lg">{feeling.blurb}</p>
      </div>

      <ol className="flex flex-col gap-4">
        {feeling.tips.map((tip, i) => (
          <li
            key={i}
            className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-5 sm:p-6"
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-sm font-extrabold ${fillClasses(feeling.color)}`}
                aria-hidden
              >
                {i + 1}
              </span>
              <h3 className="font-display text-lg font-bold leading-tight tracking-tight sm:text-xl">
                {tip.title}
              </h3>
            </div>
            <p className="pl-11 text-sm leading-relaxed text-ink-soft sm:text-base">
              {tip.body}
            </p>
            {tip.source && (
              <p className="pl-11 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {tip.source}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
