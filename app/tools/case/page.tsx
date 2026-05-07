"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:case:input";

const SAMPLES = [
  "Hello World",
  "The quick brown fox jumps over the lazy dog",
  "A wild idea on a rainy Tuesday",
];

// --- transformations ---
function words(input: string): string[] {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const toLower = (s: string) => s.toLowerCase();
const toUpper = (s: string) => s.toUpperCase();
const toTitle = (s: string) =>
  words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
const toSentence = (s: string) => {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};
const toCamel = (s: string) =>
  words(s)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
const toSnake = (s: string) =>
  words(s)
    .map((w) => w.toLowerCase())
    .join("_");

const toMocking = (s: string) =>
  s
    .split("")
    .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
    .join("");
const toAlt = (s: string) => {
  let upper = false;
  return s
    .split("")
    .map((c) => {
      if (!/[a-zA-Z]/.test(c)) return c;
      upper = !upper;
      return upper ? c.toUpperCase() : c.toLowerCase();
    })
    .join("");
};
const toReverse = (s: string) => s.split("").reverse().join("");
const toInvert = (s: string) =>
  s
    .split("")
    .map((c) =>
      c === c.toUpperCase() && c !== c.toLowerCase()
        ? c.toLowerCase()
        : c.toUpperCase(),
    )
    .join("");
const toLeet = (s: string) => {
  const map: Record<string, string> = {
    a: "4",
    A: "4",
    e: "3",
    E: "3",
    i: "1",
    I: "1",
    o: "0",
    O: "0",
    s: "5",
    S: "5",
    t: "7",
    T: "7",
    g: "9",
    G: "9",
  };
  return s
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
};

type Row = { label: string; description: string; fn: (s: string) => string };

const ROWS: Row[] = [
  { label: "lowercase", description: "All small letters.", fn: toLower },
  { label: "UPPERCASE", description: "All caps.", fn: toUpper },
  { label: "Title Case", description: "Each word capitalised.", fn: toTitle },
  { label: "Sentence case", description: "Capital first letter only.", fn: toSentence },
  { label: "camelCase", description: "First word lower, rest capitalised.", fn: toCamel },
  { label: "snake_case", description: "Lowercase with underscores.", fn: toSnake },
  { label: "sNaRkY (mocking)", description: "Alternating per character.", fn: toMocking },
  { label: "AbCdEf (alternating)", description: "Alternating per letter only.", fn: toAlt },
  { label: "esreveR", description: "Read it backwards.", fn: toReverse },
  { label: "iNVERTED", description: "Swap upper and lower.", fn: toInvert },
  { label: "l33t 5p34k", description: "Numbers stand in for letters.", fn: toLeet },
];

export default function CasePage() {
  const tool = findTool("case")!;
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

  const isEmpty = input.trim().length === 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="case-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Type or paste any text
            </label>
            {isEmpty ? (
              <button
                type="button"
                onClick={() =>
                  setInput(SAMPLES[Math.floor(Math.random() * SAMPLES.length)])
                }
                className="text-xs font-semibold text-purple underline-offset-2 hover:underline"
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
            id="case-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Hello World"
            className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-xl font-bold tracking-tight focus:outline-none"
            autoFocus
          />
        </div>

        {isEmpty ? (
          <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-center text-sm text-ink-soft">
            Every case shows up here as you type.
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
                    className="card-chunk group flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-cream p-3 text-left transition-colors hover:bg-purple-soft sm:p-4"
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
                    <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors group-hover:bg-purple group-hover:text-cream">
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
