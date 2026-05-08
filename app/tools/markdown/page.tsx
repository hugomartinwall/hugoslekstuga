"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:markdown:text";
const VIEW_KEY = "hugoslekstuga:markdown:view";

/* ------------------------------------------------------------------ */
/* Templates — a thoughtful pre-fill beats a blank page                */
/* ------------------------------------------------------------------ */

type Template = { slug: string; name: string; emoji: string; content: string };

const TEMPLATES: Template[] = [
  {
    slug: "readme",
    name: "README",
    emoji: "▤",
    content: `# Project name

One sentence on what this is and who it's for.

## Quick start

\`\`\`sh
npm install
npm run dev
\`\`\`

## How it works

Two or three sentences. The minimum a stranger needs to read your code with the right model in their head.

## Roadmap

- [x] First milestone
- [ ] Next thing
- [ ] After that

## License

MIT
`,
  },
  {
    slug: "blog",
    name: "Blog post",
    emoji: "✎",
    content: `# Title

A first sentence that earns the rest of the read.

## The thing I want to say

The argument, plainly. One paragraph.

## Why I think it

Evidence, story, reasoning. Stay specific.

## What it means for you

The takeaway. Short. Memorable. End on it.
`,
  },
  {
    slug: "meeting",
    name: "Meeting note",
    emoji: "▦",
    content: `# Meeting · ${new Date().toISOString().slice(0, 10)}

**Who:** —
**Why:** —

## Decisions

-

## Open questions

-

## Action items

- [ ] Owner — what — by when
`,
  },
  {
    slug: "journal",
    name: "Journal",
    emoji: "✦",
    content: `# ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}

## Three good things

1.
2.
3.

## What's on my mind

>

## One thing for tomorrow

-
`,
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type View = "split" | "edit" | "preview";

export default function MarkdownPage() {
  const tool = findTool("markdown")!;
  const [text, setText] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [view, setView] = useLocalStorageState<View>(VIEW_KEY, "split");
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState<"html" | "md" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Render markdown when text changes. The output goes through DOMPurify
  // before reaching dangerouslySetInnerHTML — marked stopped sanitizing in
  // v5, so without this a user pasting `<img onerror=...>` would execute
  // JS in their own session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!text.trim()) {
        if (!cancelled) setHtml("");
        return;
      }
      try {
        const [{ marked }, DOMPurifyModule] = await Promise.all([
          import("marked"),
          import("dompurify"),
        ]);
        const raw = await marked.parse(text, { gfm: true, breaks: false });
        const DOMPurify = DOMPurifyModule.default;
        const safe = DOMPurify.sanitize(typeof raw === "string" ? raw : "", {
          USE_PROFILES: { html: true },
        });
        if (!cancelled) setHtml(safe);
      } catch {
        if (!cancelled) setHtml("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  const isEmpty = useMemo(() => text.trim().length === 0, [text]);

  const stats = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return { words: 0, chars: 0, readMin: 0 };
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const readMin = Math.max(1, Math.round(words / 220));
    return { words, chars: text.length, readMin };
  }, [text]);

  const outline = useMemo(() => parseOutline(text), [text]);

  const copy = async (which: "html" | "md") => {
    try {
      await navigator.clipboard.writeText(which === "html" ? html : text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const applyTemplate = (t: Template) => {
    setText(t.content);
    // Focus the editor so the user can immediately customise.
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    const wrap = (left: string, right: string = left) => {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const sel = ta.value.slice(start, end);
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const next = `${before}${left}${sel}${right}${after}`;
      setText(next);
      // Restore selection inside the wrappers on the next tick.
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start + left.length, end + left.length);
      }, 0);
    };

    if (e.key === "b" || e.key === "B") wrap("**");
    else if (e.key === "i" || e.key === "I") wrap("*");
    else if (e.key === "e" || e.key === "E") wrap("`");
    else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const sel = ta.value.slice(start, end) || "link text";
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const next = `${before}[${sel}](url)${after}`;
      setText(next);
      // Select the "url" placeholder so the user can paste/type immediately.
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const urlStart = start + 1 + sel.length + 2;
        el.setSelectionRange(urlStart, urlStart + 3);
      }, 0);
    }
  };

  const jumpToHeading = (lineIdx: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = text.split("\n");
    let pos = 0;
    for (let i = 0; i < lineIdx && i < lines.length; i++) {
      pos += lines[i].length + 1; // +1 for the newline
    }
    ta.focus();
    ta.setSelectionRange(pos, pos);
    // Scroll the line into view.
    const before = text.slice(0, pos);
    const beforeLines = before.split("\n").length;
    ta.scrollTop = (beforeLines - 2) * 22;
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <p className="font-semibold uppercase tracking-wide text-ink-muted">
              Markdown editor
            </p>
            {!isEmpty && (
              <span className="font-semibold tabular-nums text-ink-muted">
                {stats.words} words · {stats.readMin} min read
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <ViewToggle view={view} setView={setView} />
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
          </div>
        </div>

        {/* Templates row — always visible, more prominent when empty */}
        <div
          className={`flex flex-wrap gap-2 ${isEmpty ? "" : "opacity-70 hover:opacity-100"}`}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted self-center">
            Templates:
          </span>
          {TEMPLATES.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => applyTemplate(t)}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-semibold transition-colors hover:bg-tomato-soft"
            >
              <span aria-hidden className="mr-1">
                {t.emoji}
              </span>
              {t.name}
            </button>
          ))}
        </div>

        {/* Editor + preview + outline */}
        <div
          className={`grid gap-3 ${
            view === "split"
              ? "grid-cols-1 md:grid-cols-[1fr_1fr]"
              : "grid-cols-1"
          }`}
        >
          {(view === "split" || view === "edit") && (
            <div className="flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="# Start typing markdown…"
                rows={20}
                className="card-chunk min-h-[20rem] w-full rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
                spellCheck={false}
              />
              <p className="text-xs text-ink-muted">
                <kbd className="rounded border border-ink-muted bg-cream-deep px-1 font-mono text-[10px]">
                  ⌘B
                </kbd>{" "}
                bold ·{" "}
                <kbd className="rounded border border-ink-muted bg-cream-deep px-1 font-mono text-[10px]">
                  ⌘I
                </kbd>{" "}
                italic ·{" "}
                <kbd className="rounded border border-ink-muted bg-cream-deep px-1 font-mono text-[10px]">
                  ⌘E
                </kbd>{" "}
                code ·{" "}
                <kbd className="rounded border border-ink-muted bg-cream-deep px-1 font-mono text-[10px]">
                  ⌘K
                </kbd>{" "}
                link
              </p>
            </div>
          )}

          {(view === "split" || view === "preview") && (
            <div className="card-chunk min-h-[20rem] w-full overflow-auto rounded-[var(--radius-card)] bg-tomato-soft px-4 py-3 text-base leading-relaxed text-ink">
              {isEmpty ? (
                <p className="text-sm text-ink-muted">
                  Preview will appear here as you type. Pick a template above
                  if you want a head start.
                </p>
              ) : (
                <article
                  className="md-preview"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}
            </div>
          )}
        </div>

        {/* Outline (only when there are headings) */}
        {outline.length > 0 && (
          <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep px-4 py-3 text-sm">
            <summary className="cursor-pointer font-display text-base font-bold">
              Outline{" "}
              <span className="font-normal text-ink-muted">
                · {outline.length} heading{outline.length === 1 ? "" : "s"}
              </span>
            </summary>
            <ul className="mt-2 flex flex-col">
              {outline.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => jumpToHeading(h.line)}
                    className="block w-full rounded px-2 py-1 text-left text-sm transition-colors hover:bg-tomato-soft"
                    style={{ paddingLeft: `${0.5 + (h.level - 1) * 1}rem` }}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

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
          .md-preview input[type="checkbox"] {
            margin-right: 0.4rem;
          }
        `}</style>
      </div>
    </ToolFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components + helpers                                            */
/* ------------------------------------------------------------------ */

function ViewToggle({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const opts: { v: View; label: string }[] = [
    { v: "split", label: "Split" },
    { v: "edit", label: "Edit" },
    { v: "preview", label: "Preview" },
  ];
  return (
    <div className="flex overflow-hidden rounded-full border-2 border-ink bg-cream">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => setView(o.v)}
          className={`px-3 py-1 text-xs font-semibold transition-colors ${
            view === o.v ? "bg-tomato text-cream" : "hover:bg-tomato-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Heading = { level: number; text: string; line: number };

function parseOutline(text: string): Heading[] {
  const out: Heading[] = [];
  const lines = text.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip code fences so a `# foo` inside a code block isn't treated as a heading.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      out.push({ level: m[1].length, text: m[2], line: i });
    }
  }
  return out;
}
