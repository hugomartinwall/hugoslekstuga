"use client";

import { useMemo } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const PATTERN_KEY = "hugoslekstuga:regex:pattern";
const FLAGS_KEY = "hugoslekstuga:regex:flags";
const TEXT_KEY = "hugoslekstuga:regex:text";

const SAMPLE = {
  pattern: "\\b(\\w+)@([\\w.-]+\\.\\w+)\\b",
  flags: "g",
  text: `Email me at hugo@oogywawa.se or noreply@example.com.
Avoid notreal@. Send invoices to billing@hugos-lekstuga.se for now.`,
};

const CHEATS: { token: string; meaning: string }[] = [
  { token: ".", meaning: "any character (except newline)" },
  { token: "\\d", meaning: "digit (0-9)" },
  { token: "\\D", meaning: "non-digit" },
  { token: "\\w", meaning: "word char (a-z A-Z 0-9 _)" },
  { token: "\\W", meaning: "non-word char" },
  { token: "\\s", meaning: "whitespace" },
  { token: "\\S", meaning: "non-whitespace" },
  { token: "\\b", meaning: "word boundary" },
  { token: "^", meaning: "start of line" },
  { token: "$", meaning: "end of line" },
  { token: "*", meaning: "zero or more" },
  { token: "+", meaning: "one or more" },
  { token: "?", meaning: "zero or one (or lazy)" },
  { token: "{n,m}", meaning: "between n and m repeats" },
  { token: "[abc]", meaning: "any of a, b, c" },
  { token: "[^abc]", meaning: "not a, b, or c" },
  { token: "(...)", meaning: "capture group" },
  { token: "(?:...)", meaning: "non-capturing group" },
  { token: "a|b", meaning: "a or b" },
];

const FLAGS: { letter: string; label: string }[] = [
  { letter: "g", label: "global" },
  { letter: "i", label: "case-insensitive" },
  { letter: "m", label: "multiline" },
  { letter: "s", label: "dotall" },
  { letter: "u", label: "unicode" },
  { letter: "y", label: "sticky" },
  { letter: "d", label: "hasIndices" },
];

type Match = {
  index: number;
  end: number;
  match: string;
  groups: string[];
};

function runRegex(pattern: string, flags: string, text: string): {
  ok: boolean;
  error?: string;
  matches: Match[];
} {
  if (!pattern) return { ok: true, matches: [] };
  try {
    // Honour the user's flags exactly. If they leave `g` off, return only
    // the first match — that's what their pattern means in JS, and a
    // regex tester that secretly behaves like `g` lies to its user.
    const re = new RegExp(pattern, flags);
    const out: Match[] = [];
    if (flags.includes("g")) {
      let m: RegExpExecArray | null;
      let safety = 0;
      while ((m = re.exec(text)) !== null) {
        if (safety++ > 1000) break;
        out.push({
          index: m.index,
          end: m.index + m[0].length,
          match: m[0],
          groups: m.slice(1),
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      const m = re.exec(text);
      if (m) {
        out.push({
          index: m.index,
          end: m.index + m[0].length,
          match: m[0],
          groups: m.slice(1),
        });
      }
    }
    return { ok: true, matches: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid regex", matches: [] };
  }
}

export default function RegexPage() {
  const tool = findTool("regex")!;
  const [pattern, setPattern] = useLocalStorageState<string>(PATTERN_KEY, "");
  const [flags, setFlags] = useLocalStorageState<string>(FLAGS_KEY, "g");
  const [text, setText] = useLocalStorageState<string>(TEXT_KEY, "");

  const result = useMemo(() => runRegex(pattern, flags, text), [pattern, flags, text]);

  // Render text with highlighted matches
  const rendered = useMemo(() => {
    if (!result.matches.length) return [<span key="all">{text}</span>];
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < result.matches.length; i++) {
      const m = result.matches[i];
      if (m.index > cursor) parts.push(<span key={`p-${i}`}>{text.slice(cursor, m.index)}</span>);
      parts.push(
        <mark
          key={`m-${i}`}
          className="rounded-sm bg-teal-soft px-0.5"
          title={`Match #${i + 1}`}
        >
          {text.slice(m.index, m.end)}
        </mark>,
      );
      cursor = m.end;
    }
    if (cursor < text.length) parts.push(<span key="end">{text.slice(cursor)}</span>);
    return parts;
  }, [text, result]);

  const useSample = () => {
    setPattern(SAMPLE.pattern);
    setFlags(SAMPLE.flags);
    setText(SAMPLE.text);
  };

  const toggleFlag = (letter: string) => {
    setFlags((f) =>
      f.includes(letter)
        ? f.split("").filter((c) => c !== letter).join("")
        : f + letter,
    );
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="regex-pattern"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Pattern
            </label>
            {!pattern && !text ? (
              <button
                type="button"
                onClick={useSample}
                className="text-xs font-semibold text-teal underline-offset-2 hover:underline"
              >
                try a sample
              </button>
            ) : null}
          </div>
          <div className="card-chunk flex items-center gap-2 rounded-[var(--radius-card)] bg-cream p-2">
            <span className="font-mono text-base text-ink-muted">/</span>
            <input
              id="regex-pattern"
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              spellCheck={false}
              placeholder="\b\w+@\w+\.\w+\b"
              className="flex-1 bg-transparent font-mono text-base focus:outline-none"
            />
            <span className="font-mono text-base text-ink-muted">/</span>
            <input
              type="text"
              value={flags}
              onChange={(e) => setFlags(e.target.value.replace(/[^gimsuyd]/g, ""))}
              spellCheck={false}
              placeholder="gimsu"
              className="w-16 bg-transparent font-mono text-base focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {FLAGS.map((f) => (
              <button
                key={f.letter}
                type="button"
                onClick={() => toggleFlag(f.letter)}
                className={`rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-bold transition-colors ${
                  flags.includes(f.letter)
                    ? "bg-teal text-cream"
                    : "bg-cream hover:bg-teal-soft"
                }`}
                title={f.label}
              >
                {f.letter}
              </button>
            ))}
          </div>
          {!result.ok && (
            <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-2 font-mono text-xs">
              {result.error}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="regex-text"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            Text to search
          </label>
          <textarea
            id="regex-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste anything here…"
            rows={6}
            spellCheck={false}
            className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-3 font-mono text-sm focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Highlighted matches{" "}
            <span className="text-ink">
              ({result.matches.length})
            </span>
          </p>
          <pre className="card-chunk min-h-[80px] overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-card)] bg-cream-deep p-4 font-mono text-sm">
            {rendered}
          </pre>
        </div>

        {result.matches.length > 0 && result.matches[0].groups.length > 0 && (
          <div className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Capture groups (first match)
            </p>
            <ul className="flex flex-col gap-1">
              {result.matches[0].groups.map((g, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="rounded-md border-2 border-ink bg-teal-soft px-2 py-0.5 font-mono text-xs">
                    ${i + 1}
                  </span>
                  <span className="font-mono">{g ?? <span className="text-ink-muted">(none)</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="card-chunk rounded-[var(--radius-card)] bg-cream p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Cheatsheet
          </summary>
          <ul className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {CHEATS.map((c) => (
              <li key={c.token} className="flex items-center gap-2">
                <code className="rounded-md border-2 border-ink bg-cream-deep px-2 py-0.5 font-mono text-xs">
                  {c.token}
                </code>
                <span className="text-ink-soft">{c.meaning}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </ToolFrame>
  );
}
