"use client";

import { useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:cleantext:input";

const SAMPLE = `“Hello,” she said — softly. Then​ she added… nothing.﻿The   message  was  full of  noise.`;

type Issue = {
  id: string;
  label: string;
  match: RegExp;
  replace: string | ((s: string) => string);
};

const ISSUES: Issue[] = [
  {
    id: "smart-quotes",
    label: "Smart quotes",
    match: /[‘’“”]/g,
    replace: (s) =>
      s
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"'),
  },
  {
    id: "em-dash",
    label: "Em / en dashes",
    match: /[–—]/g,
    replace: "-",
  },
  {
    id: "ellipsis",
    label: "Ellipsis (…)",
    match: /…/g,
    replace: "...",
  },
  {
    id: "bom",
    label: "BOM markers",
    match: /﻿/g,
    replace: "",
  },
  {
    id: "zero-width",
    label: "Zero-width chars",
    match: /[​‌‍⁠]/g,
    replace: "",
  },
  {
    id: "nbsp",
    label: "Non-breaking spaces",
    match: / /g,
    replace: " ",
  },
  {
    id: "multi-space",
    label: "Multiple spaces",
    match: /[ \t]{2,}/g,
    replace: " ",
  },
  {
    id: "multi-newline",
    label: "Stacked newlines",
    match: /\n{3,}/g,
    replace: "\n\n",
  },
  {
    id: "trailing",
    label: "Trailing whitespace",
    match: /[ \t]+(?=\n|$)/g,
    replace: "",
  },
];

function clean(input: string): string {
  let out = input;
  for (const issue of ISSUES) {
    if (typeof issue.replace === "function") {
      out = issue.replace(out);
    } else {
      out = out.replace(issue.match, issue.replace);
    }
  }
  return out;
}

function detect(input: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of ISSUES) {
    const matches = input.match(issue.match);
    counts[issue.id] = matches ? matches.length : 0;
  }
  return counts;
}

export default function CleantextPage() {
  const tool = findTool("cleantext")!;
  const [input, setInput] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [copied, setCopied] = useState(false);

  const counts = useMemo(() => detect(input), [input]);
  const cleaned = useMemo(() => clean(input), [input]);
  const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);
  const isEmpty = input.length === 0;

  const apply = () => {
    setInput(cleaned);
  };

  const copy = async () => {
    if (!cleaned) return;
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="cleantext-input"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Paste your messy text
            </label>
            {isEmpty ? (
              <button
                type="button"
                onClick={() => setInput(SAMPLE)}
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
          <textarea
            id="cleantext-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste anything that looks too clean to be true."
            rows={6}
            className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-4 font-mono text-sm focus:outline-none"
          />
        </div>

        <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {totalIssues > 0 ? `${totalIssues} thing${totalIssues === 1 ? "" : "s"} to fix` : "Looks clean"}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={apply}
                disabled={totalIssues === 0}
                className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-4 py-1.5 font-display text-sm font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clean ↯
              </button>
              <button
                type="button"
                onClick={copy}
                disabled={isEmpty}
                className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-1.5 font-display text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copied ? "Copied!" : "Copy clean"}
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ISSUES.map((issue) => {
              const n = counts[issue.id] ?? 0;
              return (
                <li
                  key={issue.id}
                  className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${
                    n > 0 ? "bg-tomato-soft" : "bg-cream-deep text-ink-muted"
                  }`}
                >
                  <span className={n > 0 ? "font-semibold" : ""}>
                    {issue.label}
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {n > 0 ? `× ${n}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {!isEmpty && cleaned !== input && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Preview after cleaning
            </p>
            <pre className="card-chunk overflow-x-auto rounded-[var(--radius-card)] bg-cream-deep p-4 font-mono text-sm whitespace-pre-wrap">
              {cleaned}
            </pre>
          </div>
        )}
      </div>
    </ToolFrame>
  );
}
