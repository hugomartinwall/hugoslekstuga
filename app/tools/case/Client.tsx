"use client";

import { useCallback, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:case:input";

const SAMPLES = [
  "Hello World",
  "The quick brown fox jumps over the lazy dog",
  "A wild idea on a rainy Tuesday",
];

// `case` is the *playful* sibling of the `slug` tool. slug covers the
// serious cases (lower/upper/title/camel/snake/kebab/etc.); this one is
// for the wonky transformations — mocking, alternating, reverse, invert,
// leet, clap, redacted. Keeping them split avoids the two tools
// disagreeing about what camelCase means and lets `case` lean into fun.

const toMocking = (s: string) => {
  // Toggle case on letters only — non-letters don't move the alternation
  // pointer, so spaces and punctuation no longer flip the rhythm.
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
const toClap = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" 👏 ");
const toRedacted = (s: string) =>
  s
    .split("")
    .map((c) => (/[a-zA-Z0-9]/.test(c) ? "█" : c))
    .join("");
const toSpaced = (s: string) =>
  s.split("").join(" ").toUpperCase();
const toRot13 = (s: string) =>
  s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

type Row = { label: string; description: string; fn: (s: string) => string };

const ROWS: Row[] = [
  {
    label: "sNaRkY",
    description: "Mocking case — letters alternate, punctuation is left alone.",
    fn: toMocking,
  },
  {
    label: "esreveR",
    description: "Read it backwards.",
    fn: toReverse,
  },
  {
    label: "iNVERTED",
    description: "Swap upper and lower for every letter.",
    fn: toInvert,
  },
  {
    label: "l33t 5p34k",
    description: "Numbers stand in for letters.",
    fn: toLeet,
  },
  {
    label: "clap👏case",
    description: "A clap between every word.",
    fn: toClap,
  },
  {
    label: "S P A C E D",
    description: "Each character separated by a space, all caps.",
    fn: toSpaced,
  },
  {
    label: "redacted",
    description: "Letters and digits replaced with a black bar.",
    fn: toRedacted,
  },
  {
    label: "rot13",
    description: "Each letter rotated 13 places — apply twice to undo.",
    fn: toRot13,
  },
];

export default function CasePage() {
  const tool = findTool("case")!;
  const [input, setInput] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [copied, setCopied] = useState<string | null>(null);

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
