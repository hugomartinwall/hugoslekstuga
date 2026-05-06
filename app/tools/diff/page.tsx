"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Granularity = "line" | "word" | "char";

type DiffPart = { value: string; added?: boolean; removed?: boolean };

const STORAGE_KEY = "hugoslekstuga:diff:state";

const SAMPLE_LEFT = `Built with care, in the open.
Each tool tries to do one thing well.
No accounts. No uploads. No tracking.`;

const SAMPLE_RIGHT = `Built with care, in the open.
Each tool tries to do one small thing well.
No accounts. No uploads. No trackers.
Open a tab, use the thing, close the tab.`;

export default function DiffPage() {
  const tool = findTool("diff")!;
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("word");
  const [parts, setParts] = useState<DiffPart[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as {
          left?: string;
          right?: string;
          granularity?: Granularity;
        };
        if (typeof s.left === "string") setLeft(s.left);
        if (typeof s.right === "string") setRight(s.right);
        if (s.granularity === "line" || s.granularity === "word" || s.granularity === "char") {
          setGranularity(s.granularity);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ left, right, granularity }),
      );
    } catch {}
  }, [left, right, granularity, hydrated]);

  // Compute diff lazily as inputs change.
  useEffect(() => {
    let cancelled = false;
    if (!left.trim() && !right.trim()) {
      setParts([]);
      return;
    }
    (async () => {
      const Diff = await import("diff");
      let result: DiffPart[] = [];
      if (granularity === "line") {
        result = Diff.diffLines(left, right);
      } else if (granularity === "word") {
        result = Diff.diffWords(left, right);
      } else {
        result = Diff.diffChars(left, right);
      }
      if (!cancelled) setParts(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [left, right, granularity]);

  const summary = useMemo(() => {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const p of parts) {
      const len = p.value.length;
      if (p.added) added += len;
      else if (p.removed) removed += len;
      else unchanged += len;
    }
    return { added, removed, unchanged };
  }, [parts]);

  const isEmpty = !left && !right;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Side
            label="Old version"
            value={left}
            onChange={setLeft}
            placeholder="Paste the old text…"
          />
          <Side
            label="New version"
            value={right}
            onChange={setRight}
            placeholder="…and the new text."
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["word", "line", "char"] as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                  granularity === g
                    ? "bg-orange text-cream"
                    : "bg-cream hover:bg-orange-soft"
                }`}
              >
                {g === "word" ? "By word" : g === "line" ? "By line" : "By character"}
              </button>
            ))}
          </div>
          {!isEmpty && (
            <button
              type="button"
              onClick={() => {
                setLeft("");
                setRight("");
              }}
              className="text-xs font-semibold text-ink-muted hover:text-ink"
            >
              clear
            </button>
          )}
          {isEmpty && (
            <button
              type="button"
              onClick={() => {
                setLeft(SAMPLE_LEFT);
                setRight(SAMPLE_RIGHT);
              }}
              className="text-xs font-semibold text-orange underline-offset-2 hover:underline"
            >
              try a sample
            </button>
          )}
        </div>

        <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Diff
            </p>
            {parts.length > 0 && (
              <p className="text-xs text-ink-soft">
                <span className="font-bold text-green">+{summary.added}</span>{" "}
                <span className="font-bold text-tomato">−{summary.removed}</span>{" "}
                <span className="text-ink-muted">{summary.unchanged} unchanged</span>
              </p>
            )}
          </div>
          <div className="rounded-[12px] border-2 border-ink bg-cream-deep p-3 font-mono text-sm leading-relaxed">
            {parts.length === 0 ? (
              <p className="text-ink-muted">
                Drop two texts above and you&rsquo;ll see what changed.
              </p>
            ) : (
              <pre className="whitespace-pre-wrap break-words">
                {parts.map((p, i) =>
                  p.added ? (
                    <span
                      key={i}
                      className="rounded bg-green-soft px-0.5 text-ink"
                    >
                      {p.value}
                    </span>
                  ) : p.removed ? (
                    <span
                      key={i}
                      className="rounded bg-tomato-soft px-0.5 text-ink line-through decoration-tomato/60"
                    >
                      {p.value}
                    </span>
                  ) : (
                    <span key={i} className="text-ink-soft">
                      {p.value}
                    </span>
                  ),
                )}
              </pre>
            )}
          </div>
        </div>
      </div>
    </ToolFrame>
  );
}

function Side({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        spellCheck={false}
        className="card-chunk min-h-[12rem] rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm leading-relaxed focus:outline-none"
      />
    </div>
  );
}
