"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:count:input";

type Stats = {
  words: number;
  chars: number;
  charsNoSpace: number;
  sentences: number;
  paragraphs: number;
  readingMs: number;
  topWords: { word: string; count: number }[];
};

const STOPWORDS = new Set(
  "a an the and or but if then so of for to in on at by from with as is are was were be been being have has had do does did this that these those it its i you he she we they me my your his her our their".split(
    " ",
  ),
);

function compute(text: string): Stats {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      words: 0,
      chars: 0,
      charsNoSpace: 0,
      sentences: 0,
      paragraphs: 0,
      readingMs: 0,
      topWords: [],
    };
  }
  const wordList = trimmed.split(/\s+/).filter(Boolean);
  const words = wordList.length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s+/g, "").length;
  const sentences = (trimmed.match(/[.!?]+(?=\s|$)/g) ?? []).length || 1;
  const paragraphs = trimmed.split(/\n\s*\n/).filter(Boolean).length || 1;
  const readingMs = Math.round((words / 230) * 60_000); // 230 wpm

  const freq = new Map<string, number>();
  for (const raw of wordList) {
    const w = raw.toLowerCase().replace(/[^a-zåäöéèêüñ']/gi, "");
    if (!w || STOPWORDS.has(w) || w.length < 3) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const topWords = [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { words, chars, charsNoSpace, sentences, paragraphs, readingMs, topWords };
}

const MILESTONES = [
  { at: 100, label: "100 words", note: "A solid paragraph." },
  { at: 280, label: "280 chars", note: "One tweet." },
  { at: 1000, label: "1k words", note: "A short essay." },
  { at: 5000, label: "5k words", note: "A short story." },
];

function readingTimeText(ms: number): string {
  if (ms < 1000) return "under a second";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r === 0 ? `${m} min` : `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export default function CountPage() {
  const tool = findTool("count")!;
  const [input, setInput] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const [crossed, setCrossed] = useState<string | null>(null);
  const lastReachedRef = useRef<Set<string>>(new Set());

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

  const stats = useMemo(() => compute(input), [input]);

  // Milestone celebrations
  useEffect(() => {
    for (const m of MILESTONES) {
      const reached =
        m.label.includes("chars")
          ? stats.chars >= m.at
          : m.label.includes("words") || m.label.includes("k words")
          ? stats.words >= m.at
          : false;
      if (reached && !lastReachedRef.current.has(m.label)) {
        lastReachedRef.current.add(m.label);
        setCrossed(m.label);
        window.setTimeout(() => setCrossed((c) => (c === m.label ? null : c)), 2000);
      }
      if (!reached && lastReachedRef.current.has(m.label)) {
        // Allow re-celebration on next crossing
        lastReachedRef.current.delete(m.label);
      }
    }
  }, [stats.words, stats.chars]);

  const milestoneNote = MILESTONES.find((m) => m.label === crossed);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="count-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Type or paste your text
            </label>
            {input ? (
              <button
                type="button"
                onClick={() => setInput("")}
                className="text-xs font-semibold text-ink-muted hover:text-ink"
              >
                clear
              </button>
            ) : null}
          </div>
          <textarea
            id="count-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Start writing — the numbers update live."
            rows={10}
            className="card-chunk min-h-[180px] rounded-[var(--radius-card)] bg-cream p-4 font-mono text-base focus:outline-none"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Words" value={stats.words.toLocaleString()} accent />
          <Stat label="Characters" value={stats.chars.toLocaleString()} />
          <Stat label="Sentences" value={stats.sentences.toLocaleString()} />
          <Stat label="Paragraphs" value={stats.paragraphs.toLocaleString()} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border-2 border-ink bg-green-soft px-4 py-3 text-sm">
          <span className="font-semibold">Reading time</span>
          <span className="font-mono text-base font-bold">
            {readingTimeText(stats.readingMs)}
          </span>
        </div>

        {stats.topWords.length > 0 ? (
          <div className="card-chunk rounded-[var(--radius-card)] bg-cream p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Words you lean on
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {stats.topWords.map((w) => {
                const max = stats.topWords[0]?.count ?? 1;
                const pct = (w.count / max) * 100;
                return (
                  <li key={w.word} className="flex items-center gap-2">
                    <span className="w-24 truncate font-mono text-sm">{w.word}</span>
                    <span className="relative h-3 flex-1 rounded-full bg-cream-deep">
                      <span
                        className="absolute left-0 top-0 h-full rounded-full bg-green"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-8 text-right font-mono text-xs text-ink-muted">
                      {w.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-4 text-center text-sm text-ink-soft">
            The words you reach for most will show up here.
          </p>
        )}

        <p className="text-xs text-ink-muted">
          Counts characters with whitespace by default ({stats.charsNoSpace.toLocaleString()} without).
          Reading time uses 230 words per minute.
        </p>

        {/* Milestone celebration */}
        {crossed && milestoneNote && (
          <div className="pointer-events-none fixed bottom-8 left-1/2 z-30 -translate-x-1/2">
            <div className="fade-rise card-chunk rounded-[var(--radius-button)] bg-yellow px-5 py-3 font-display text-lg font-extrabold">
              {milestoneNote.label} — {milestoneNote.note}
            </div>
          </div>
        )}
      </div>
    </ToolFrame>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card-chunk flex flex-col gap-0.5 rounded-[var(--radius-card)] p-4 ${accent ? "bg-green-soft" : "bg-cream"}`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
        {value}
      </span>
    </div>
  );
}
