"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:bionic:input";
const STRENGTH_KEY = "hugoslekstuga:bionic:strength";

const SAMPLE = `Bionic reading is a way of guiding your eyes through text by emphasising the first part of each word. The idea is that your brain fills in the rest, so you read faster — and stay on the page longer. Try pasting an article you've been putting off and see if it lands differently.`;

type Strength = "light" | "medium" | "strong";

const STRENGTHS: Record<Strength, { label: string; pct: number }> = {
  light: { label: "Light", pct: 0.35 },
  medium: { label: "Medium", pct: 0.5 },
  strong: { label: "Strong", pct: 0.7 },
};

function bionicWord(word: string, pct: number): { bold: string; rest: string } {
  if (word.length <= 1) return { bold: word, rest: "" };
  const cut = Math.max(1, Math.ceil(word.length * pct));
  return { bold: word.slice(0, cut), rest: word.slice(cut) };
}

export default function BionicPage() {
  const tool = findTool("bionic")!;
  const [input, setInput] = useState<string>("");
  const [strength, setStrength] = useState<Strength>("medium");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setInput(saved);
      const s = localStorage.getItem(STRENGTH_KEY) as Strength | null;
      if (s && (s === "light" || s === "medium" || s === "strong")) {
        setStrength(s);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input) localStorage.setItem(STORAGE_KEY, input);
      else localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STRENGTH_KEY, strength);
    } catch {}
  }, [input, strength, hydrated]);

  const rendered = useMemo(() => {
    if (!input) return null;
    const pct = STRENGTHS[strength].pct;
    // Split preserving whitespace + newlines
    const tokens = input.split(/(\s+)/);
    return tokens.map((tok, i) => {
      if (/^\s+$/.test(tok)) {
        return tok.includes("\n") ? <br key={i} /> : <span key={i}>{tok}</span>;
      }
      // Word with potential leading/trailing punctuation
      const m = tok.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'-]+)([^\p{L}\p{N}]*)$/u);
      if (!m) return <span key={i}>{tok}</span>;
      const [, pre, word, post] = m;
      const { bold, rest } = bionicWord(word, pct);
      return (
        <span key={i}>
          {pre}
          <strong className="text-ink">{bold}</strong>
          <span className="text-ink-soft">{rest}</span>
          {post}
        </span>
      );
    });
  }, [input, strength]);

  const isEmpty = input.trim().length === 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="bionic-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Paste anything you want to skim
            </label>
            {isEmpty ? (
              <button
                type="button"
                onClick={() => setInput(SAMPLE)}
                className="text-xs font-semibold text-pink underline-offset-2 hover:underline"
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
          <textarea
            id="bionic-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste an article, a chapter, an email — anything you'd rather skim than slog through."
            rows={6}
            className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-4 font-mono text-sm focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Fixation
          </span>
          {(Object.keys(STRENGTHS) as Strength[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStrength(s)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                strength === s ? "bg-pink text-cream" : "bg-cream hover:bg-pink-soft"
              }`}
            >
              {STRENGTHS[s].label}
            </button>
          ))}
        </div>

        <article
          className={`card-chunk min-h-[180px] rounded-[var(--radius-card)] p-5 text-lg leading-relaxed sm:p-7 sm:text-xl ${isEmpty ? "bg-cream-deep" : "bg-cream"}`}
        >
          {isEmpty ? (
            <p className="text-center text-sm text-ink-muted">
              The bionic version of your text appears here.
            </p>
          ) : (
            <p>{rendered}</p>
          )}
        </article>

        <p className="text-xs text-ink-muted">
          Bionic reading bolds the first part of each word so your eyes can
          anchor and your brain can fill the rest in. Works best on long-form
          text you&rsquo;d otherwise skip.
        </p>
      </div>
    </ToolFrame>
  );
}
