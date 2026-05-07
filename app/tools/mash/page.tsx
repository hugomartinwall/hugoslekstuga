"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:mash:state";

type State = {
  left: string;
  right: string;
};

const SAMPLES: State[] = [
  {
    left: "moon\nember\nfox\nharbour\nivy\nlantern\nmarble",
    right: "studio\npress\nrecords\nlabs\nworks\nmade",
  },
  {
    left: "blue\nlazy\nslow\nsharp\nsweet\nbright",
    right: "river\ntower\nfern\nstreet\noven\nshadow",
  },
  {
    left: "Atlas\nNova\nOrbit\nVerve\nAura\nClover",
    right: "Co\nLab\nHQ\nWorks\n&Co\nClub",
  },
];

const STYLES = [
  { id: "space", label: "two words", join: " " },
  { id: "dash", label: "with-a-dash", join: "-" },
  { id: "concat", label: "smushed", join: "" },
  { id: "amp", label: "and-and", join: " & " },
] as const;

type StyleId = (typeof STYLES)[number]["id"];

function listOf(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function combine(a: string, b: string, joiner: string): string {
  if (joiner === "" && a && b) {
    // Smush: drop a trailing matching letter
    const last = a[a.length - 1].toLowerCase();
    const first = b[0].toLowerCase();
    if (last === first) return a + b.slice(1);
  }
  return a + joiner + b;
}

export default function MashPage() {
  const tool = findTool("mash")!;
  const [state, setState] = useState<State>({ left: "", right: "" });
  const [styleId, setStyleId] = useState<StyleId>("space");
  const [results, setResults] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (typeof parsed.left === "string") setState(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const left = useMemo(() => listOf(state.left), [state.left]);
  const right = useMemo(() => listOf(state.right), [state.right]);
  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];

  const generate = useCallback(() => {
    if (left.length === 0 || right.length === 0) return;
    const seen = new Set<string>();
    const out: string[] = [];
    let attempts = 0;
    while (out.length < 6 && attempts < 60) {
      const a = pick(left);
      const b = pick(right);
      const combo = combine(a, b, style.join);
      if (!seen.has(combo)) {
        seen.add(combo);
        out.push(combo);
      }
      attempts++;
    }
    setResults(out);
  }, [left, right, style.join]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {}
  };

  const isReady = left.length > 0 && right.length > 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="mash-left"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Pool A
            </label>
            <textarea
              id="mash-left"
              value={state.left}
              onChange={(e) => setState((s) => ({ ...s, left: e.target.value }))}
              placeholder={"moon\nember\nfox"}
              rows={6}
              className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-3 font-mono text-sm focus:outline-none"
            />
            <span className="text-[11px] text-ink-muted">
              {left.length} word{left.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="mash-right"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Pool B
            </label>
            <textarea
              id="mash-right"
              value={state.right}
              onChange={(e) => setState((s) => ({ ...s, right: e.target.value }))}
              placeholder={"studio\npress\nrecords"}
              rows={6}
              className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-3 font-mono text-sm focus:outline-none"
            />
            <span className="text-[11px] text-ink-muted">
              {right.length} word{right.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {!isReady && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-semibold text-ink-muted">
              Try a sample:
            </span>
            {SAMPLES.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setState(s)}
                className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-pink-soft"
              >
                {i === 0 ? "names" : i === 1 ? "phrases" : "brands"}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Style
          </span>
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStyleId(s.id)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                styleId === s.id ? "bg-pink text-cream" : "bg-cream hover:bg-pink-soft"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={!isReady}
          className="btn-chunk self-start rounded-[var(--radius-button)] bg-pink px-6 py-3 font-display text-base font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mash ↯
        </button>

        {results.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {results.map((r, i) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => copy(r)}
                  className="card-chunk fade-rise group flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] bg-cream p-3 text-left transition-colors hover:bg-pink-soft"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="font-display text-lg font-extrabold tracking-tight">
                    {r}
                  </span>
                  <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors group-hover:bg-pink group-hover:text-cream">
                    {copied === r ? "copied!" : "copy"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-center text-sm text-ink-soft">
            Hit mash to collide the two pools.
          </p>
        )}

        <p className="text-xs text-ink-muted">
          Useful for naming bands, projects, pets, products. The smushed
          style drops repeated letters at the seam — try it on words ending
          and beginning with the same vowel.
        </p>
      </div>
    </ToolFrame>
  );
}
