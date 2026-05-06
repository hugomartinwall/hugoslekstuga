"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:markdown:text";

const SAMPLE = `# Welcome

A small playhouse for **tools we built together**.

## What's good
- It does one thing
- No tracking, no upload
- Lives in your browser

> Even small useful things matter.

\`\`\`js
const greet = (name) => \`Hello, \${name}\`;
\`\`\`

[Back to home](/)
`;

export default function MarkdownPage() {
  const tool = findTool("markdown")!;
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState<"html" | "md" | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setText(saved);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (text) localStorage.setItem(STORAGE_KEY, text);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [text, hydrated]);

  // Render markdown when text changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!text.trim()) {
        if (!cancelled) setHtml("");
        return;
      }
      try {
        const { marked } = await import("marked");
        const out = await marked.parse(text, { gfm: true, breaks: false });
        if (!cancelled) setHtml(typeof out === "string" ? out : "");
      } catch {
        if (!cancelled) setHtml("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  const isEmpty = useMemo(() => text.trim().length === 0, [text]);

  const copy = async (which: "html" | "md") => {
    try {
      await navigator.clipboard.writeText(which === "html" ? html : text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Markdown editor
          </p>
          <div className="flex items-center gap-3 text-xs">
            {!isEmpty && (
              <>
                <button
                  type="button"
                  onClick={() => setText("")}
                  className="font-semibold text-ink-muted hover:text-ink"
                >
                  clear
                </button>
                <button
                  type="button"
                  onClick={() => copy("md")}
                  className="font-semibold text-tomato underline-offset-2 hover:underline"
                >
                  {copied === "md" ? "copied!" : "copy markdown"}
                </button>
                <button
                  type="button"
                  onClick={() => copy("html")}
                  className="font-semibold text-tomato underline-offset-2 hover:underline"
                >
                  {copied === "html" ? "copied!" : "copy html"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="font-semibold text-tomato underline-offset-2 hover:underline"
            >
              try a sample
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="# Start typing markdown…"
            rows={20}
            className="card-chunk min-h-[20rem] rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
            spellCheck={false}
          />
          <div
            className="card-chunk min-h-[20rem] rounded-[var(--radius-card)] bg-tomato-soft px-4 py-3 text-base leading-relaxed text-ink"
          >
            {isEmpty ? (
              <p className="text-sm text-ink-muted">
                Preview will appear here as you type.
              </p>
            ) : (
              <article
                className="md-preview"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>
        </div>

        <style jsx global>{`
          .md-preview h1 {
            font-family: var(--font-display);
            font-size: 1.6rem;
            font-weight: 800;
            margin: 0.5rem 0 0.75rem;
            letter-spacing: -0.01em;
          }
          .md-preview h2 {
            font-family: var(--font-display);
            font-size: 1.3rem;
            font-weight: 800;
            margin: 1rem 0 0.5rem;
          }
          .md-preview h3 {
            font-family: var(--font-display);
            font-size: 1.1rem;
            font-weight: 700;
            margin: 0.75rem 0 0.4rem;
          }
          .md-preview p { margin: 0.5rem 0; }
          .md-preview ul, .md-preview ol {
            margin: 0.5rem 0 0.5rem 1.5rem;
            padding: 0;
          }
          .md-preview li { margin: 0.25rem 0; }
          .md-preview a {
            color: #ff5a3c;
            text-decoration: underline;
          }
          .md-preview blockquote {
            border-left: 3px solid #1a1812;
            padding: 0.25rem 0.75rem;
            margin: 0.75rem 0;
            color: #4a463d;
            background: rgba(255, 255, 255, 0.4);
            border-radius: 4px;
          }
          .md-preview code {
            background: #fbf6ee;
            padding: 0.1rem 0.35rem;
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.9em;
          }
          .md-preview pre {
            background: #fbf6ee;
            border: 2px solid #1a1812;
            border-radius: 10px;
            padding: 0.75rem 1rem;
            overflow-x: auto;
            margin: 0.75rem 0;
          }
          .md-preview pre code {
            background: transparent;
            padding: 0;
          }
          .md-preview hr {
            border: 0;
            border-top: 2px solid #1a1812;
            margin: 1rem 0;
          }
          .md-preview table {
            border-collapse: collapse;
            margin: 0.75rem 0;
          }
          .md-preview th, .md-preview td {
            border: 2px solid #1a1812;
            padding: 0.4rem 0.6rem;
          }
        `}</style>
      </div>
    </ToolFrame>
  );
}
