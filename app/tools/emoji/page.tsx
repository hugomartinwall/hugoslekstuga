"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  CATEGORIES,
  searchEmojis,
  type Category,
  type EmojiEntry,
} from "@/lib/emoji";

export default function EmojiPage() {
  const tool = findTool("emoji")!;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [recent, setRecent] = useState<EmojiEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  // Hydrate recent
  useEffect(() => {
    try {
      const raw = localStorage.getItem("hugoslekstuga:emoji:recent");
      if (raw) {
        const arr = JSON.parse(raw) as EmojiEntry[];
        if (Array.isArray(arr)) setRecent(arr.slice(0, 18));
      }
    } catch {}
  }, []);

  const results = useMemo(
    () => searchEmojis(query, category),
    [query, category],
  );

  const copy = async (e: EmojiEntry) => {
    try {
      await navigator.clipboard.writeText(e.char);
      setCopied(e.char);
      window.setTimeout(() => setCopied(null), 1200);
      setRecent((prev) => {
        const next = [e, ...prev.filter((p) => p.char !== e.char)].slice(0, 18);
        try {
          localStorage.setItem(
            "hugoslekstuga:emoji:recent",
            JSON.stringify(next),
          );
        } catch {}
        return next;
      });
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — happy, fire, taco, heart…"
            className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 text-base focus:outline-none"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                category === "all"
                  ? "bg-yellow text-ink"
                  : "bg-cream hover:bg-yellow-soft"
              }`}
            >
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                  category === c.id
                    ? "bg-yellow text-ink"
                    : "bg-cream hover:bg-yellow-soft"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {recent.length > 0 && !query && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Recently used
            </p>
            <Grid items={recent} onPick={copy} copied={copied} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {query.trim()
              ? `Results · ${results.length}`
              : category === "all"
                ? "All"
                : CATEGORIES.find((c) => c.id === category)?.label}
          </p>
          {results.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-center text-sm text-ink-soft">
              No emoji matches that. Try a different word.
            </p>
          ) : (
            <Grid items={results} onPick={copy} copied={copied} />
          )}
        </div>
      </div>
    </ToolFrame>
  );
}

function Grid({
  items,
  onPick,
  copied,
}: {
  items: EmojiEntry[];
  onPick: (e: EmojiEntry) => void;
  copied: string | null;
}) {
  return (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10">
      {items.map((e) => (
        <button
          key={`${e.char}-${e.name}`}
          type="button"
          onClick={() => onPick(e)}
          title={e.name}
          className="group relative flex aspect-square items-center justify-center rounded-[10px] border-2 border-ink bg-cream text-2xl transition-transform hover:-translate-y-0.5 hover:bg-yellow-soft"
        >
          <span aria-label={e.name}>{e.char}</span>
          {copied === e.char && (
            <span className="pointer-events-none absolute inset-x-0 -bottom-7 rounded-full border-2 border-ink bg-yellow px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
              copied
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
