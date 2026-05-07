"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  toCamel,
  toConstant,
  toKebab,
  toLower,
  toPascal,
  toSentence,
  toSlug,
  toSnake,
  toTitle,
  toUpper,
} from "@/lib/slug";

const STORAGE_KEY = "hugoslekstuga:slug:input";

const SAMPLES = [
  "My Big Important Doc!",
  "Annual Report — 2026 Q2 (final)",
  "ÅsaSkrivetGodaNyheter 2026/05/07",
];

type Row = {
  label: string;
  description: string;
  fn: (s: string) => string;
};

const ROWS: Row[] = [
  { label: "URL slug", description: "Lowercase, hyphens, ASCII-safe.", fn: toSlug },
  { label: "kebab-case", description: "Same as the slug.", fn: toKebab },
  { label: "snake_case", description: "Lowercase with underscores.", fn: toSnake },
  { label: "camelCase", description: "First word lower, rest capitalised.", fn: toCamel },
  { label: "PascalCase", description: "All words capitalised, no separator.", fn: toPascal },
  { label: "CONSTANT_CASE", description: "All caps with underscores.", fn: toConstant },
  { label: "Title Case", description: "Each word capitalised, with spaces.", fn: toTitle },
  { label: "Sentence case", description: "First word capitalised only.", fn: toSentence },
  { label: "lowercase", description: "All lowercase, with spaces.", fn: toLower },
  { label: "UPPERCASE", description: "All uppercase, with spaces.", fn: toUpper },
];

export default function SlugPage() {
  const tool = findTool("slug")!;
  const [input, setInput] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setInput(saved);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input) localStorage.setItem(STORAGE_KEY, input);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [input, hydrated]);

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {}
  }, []);

  const sample = useMemo(() => SAMPLES[Math.floor(Math.random() * SAMPLES.length)], []);

  const isEmpty = input.trim().length === 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="slug-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Type or paste anything
            </label>
            {isEmpty ? (
              <button
                type="button"
                onClick={() => setInput(sample)}
                className="text-xs font-semibold text-tomato underline-offset-2 hover:underline"
              >
                try a sample
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setInput("")}
                className="text-xs font-semibold text-ink-muted hover:text-ink"
              >
                clear
              </button>
            )}
          </div>
          <input
            id="slug-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="My Big Important Doc!"
            className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-xl font-bold tracking-tight focus:outline-none"
            autoFocus
          />
        </div>

        {isEmpty ? (
          <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-center text-sm text-ink-soft">
            All formats appear here as you type.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {ROWS.map((r) => {
              const out = r.fn(input);
              const isCopied = copied === r.label;
              return (
                <li key={r.label}>
                  <button
                    type="button"
                    onClick={() => copy(out, r.label)}
                    className="card-chunk group flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-cream p-3 text-left transition-colors hover:bg-tomato-soft sm:p-4"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        {r.label}
                      </p>
                      <p className="break-all font-mono text-sm sm:text-base">
                        {out || <span className="text-ink-muted">—</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {r.description}
                      </p>
                    </div>
                    <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors group-hover:bg-tomato group-hover:text-cream">
                      {isCopied ? "copied!" : "copy"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </ToolFrame>
  );
}
