"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

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

type DiffStored = { left: string; right: string; granularity: Granularity };
const DIFF_DEFAULT: DiffStored = { left: "", right: "", granularity: "word" };

export default function DiffPage() {
  const tool = findTool("diff")!;
  const [stored, setStored] = useLocalStorageState<DiffStored>(STORAGE_KEY, DIFF_DEFAULT);
  const left = typeof stored.left === "string" ? stored.left : "";
  const right = typeof stored.right === "string" ? stored.right : "";
  const granularity: Granularity =
    stored.granularity === "line" ||
    stored.granularity === "word" ||
    stored.granularity === "char"
      ? stored.granularity
      : "word";
  const setLeft = (v: string | ((prev: string) => string)) =>
    setStored((s) => ({ ...s, left: typeof v === "function" ? v(s.left) : v }));
  const setRight = (v: string | ((prev: string) => string)) =>
    setStored((s) => ({ ...s, right: typeof v === "function" ? v(s.right) : v }));
  const setGranularity = (g: Granularity) =>
    setStored((s) => ({ ...s, granularity: g }));
  const [parts, setParts] = useState<DiffPart[]>([]);

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
