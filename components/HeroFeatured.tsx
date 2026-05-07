"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tools, type Tool, type ToolColor } from "@/lib/tools";

const COLOR_BG: Record<ToolColor, string> = {
  tomato: "bg-tomato",
  blue: "bg-blue",
  yellow: "bg-yellow",
  pink: "bg-pink",
  green: "bg-green",
  purple: "bg-purple",
  orange: "bg-orange",
  teal: "bg-teal",
};

const COLOR_TEXT: Record<ToolColor, string> = {
  tomato: "text-cream",
  blue: "text-cream",
  yellow: "text-ink",
  pink: "text-ink",
  green: "text-cream",
  purple: "text-cream",
  orange: "text-cream",
  teal: "text-cream",
};

const ROTATION_MS = 3800;

export default function HeroFeatured() {
  // Start at 0 on the server. After mount we jump to a random tool so
  // visitors don't always see the same one — but we avoid hydration
  // mismatches by deferring the randomisation to the client.
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setIdx(Math.floor(Math.random() * tools.length));
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % tools.length);
    }, ROTATION_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const t: Tool = tools[idx];
  const onPickPrev = () => setIdx((i) => (i - 1 + tools.length) % tools.length);
  const onPickNext = () => setIdx((i) => (i + 1) % tools.length);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="hidden lg:flex lg:flex-col lg:gap-3"
    >
      <Link
        href={`/tools/${t.slug}`}
        key={t.slug}
        className={`featured-in card-chunk relative flex aspect-square w-full max-w-sm flex-col justify-between overflow-hidden rounded-[var(--radius-card)] p-6 ${COLOR_BG[t.color]} ${COLOR_TEXT[t.color]}`}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink"
            aria-hidden
          >
            featured
          </span>
          <span
            className="text-5xl"
            aria-hidden
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t.emoji}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t.title}
          </p>
          <p className="text-sm font-medium opacity-90">{t.tagline}</p>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span>open →</span>
          <span className="text-xs opacity-70">
            {idx + 1} / {tools.length}
          </span>
        </div>
      </Link>

      {/* Tiny manual controls — discoverable but not in the way. */}
      <div className="flex items-center justify-end gap-2 pr-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onPickPrev();
          }}
          aria-label="Previous featured tool"
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-cream-deep"
        >
          ←
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onPickNext();
          }}
          aria-label="Next featured tool"
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-cream-deep"
        >
          →
        </button>
      </div>
    </div>
  );
}
