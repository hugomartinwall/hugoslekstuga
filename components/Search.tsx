"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool, type ToolColor } from "@/lib/tools";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };

const SearchCtx = createContext<Ctx | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl-K to toggle, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      } else if (e.key === "/" && !open) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <SearchCtx.Provider value={{ open, setOpen }}>
      {children}
    </SearchCtx.Provider>
  );
}

export function useSearch() {
  const ctx = useContext(SearchCtx);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}

export function SearchButton() {
  const { setOpen } = useSearch();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="hidden items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-sm font-medium transition-colors hover:bg-cream-deep sm:inline-flex"
      aria-label="Open search"
    >
      <SearchIcon />
      <span className="text-ink-soft">Search</span>
      <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-muted">
        ⌘K
      </kbd>
    </button>
  );
}

export function MobileSearchButton() {
  const { setOpen } = useSearch();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-cream transition-colors hover:bg-cream-deep sm:hidden"
      aria-label="Open search"
    >
      <SearchIcon />
    </button>
  );
}

const accentSoft: Record<ToolColor, string> = {
  tomato: "bg-tomato-soft",
  blue: "bg-blue-soft",
  yellow: "bg-yellow-soft",
  pink: "bg-pink-soft",
  green: "bg-green-soft",
  purple: "bg-purple-soft",
  orange: "bg-orange-soft",
  teal: "bg-teal-soft",
};
const accentBg: Record<ToolColor, string> = {
  tomato: "bg-tomato",
  blue: "bg-blue",
  yellow: "bg-yellow",
  pink: "bg-pink",
  green: "bg-green",
  purple: "bg-purple",
  orange: "bg-orange",
  teal: "bg-teal",
};

export function SearchPalette() {
  const { open, setOpen } = useSearch();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => filterTools(query), [query]);

  // Reset state when opening — `open` is driven by an external context
  // (button click or keyboard shortcut from anywhere on the site), so the
  // imperative DOM focus has to happen here in an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep activeIdx in bounds. activeIdx changes from arrow-key handlers
  // too, so derived-state via useMemo would lose user navigation.
  useEffect(() => {
    if (results.length === 0) {
      setActiveIdx(0);
      return;
    }
    if (activeIdx >= results.length) setActiveIdx(results.length - 1);
  }, [results.length, activeIdx]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const select = useCallback(
    (idx: number) => {
      const t = results[idx];
      if (!t) return;
      setOpen(false);
      router.push(`/tools/${t.slug}`);
    },
    [results, router, setOpen],
  );

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(activeIdx);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Scroll active item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLLIElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      className="fade-rise fixed inset-0 z-50 flex items-start justify-center bg-ink/50 px-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-cream shadow-chunk"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b-2 border-ink bg-cream px-4 py-3">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Search tools by name, tagline, or description…"
            className="flex-1 bg-transparent text-base focus:outline-none"
          />
          <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-muted">
            esc
          </kbd>
        </div>

        <ul ref={listRef} className="flex-1 overflow-y-auto py-2">
          {results.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-ink-muted">
              No tool matches that. Try a different word.
            </li>
          ) : (
            results.map((t, i) => (
              <li key={t.slug} data-idx={i} className="px-2">
                <button
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => select(i)}
                  className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors ${
                    activeIdx === i ? accentSoft[t.color] : "bg-transparent"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink ${accentBg[t.color]} text-base ${
                      t.color === "yellow" || t.color === "pink"
                        ? "text-ink"
                        : "text-cream"
                    }`}
                    aria-hidden
                  >
                    {t.emoji}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-display text-base font-extrabold leading-tight tracking-tight">
                      <Highlight text={t.title} query={query} />
                    </span>
                    <span className="truncate text-sm text-ink-soft">
                      <Highlight text={t.tagline} query={query} />
                    </span>
                  </div>
                  <span className="hidden text-xs text-ink-muted sm:inline">
                    /{t.slug}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t-2 border-ink bg-cream-deep px-4 py-2 text-[11px] text-ink-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-ink-muted bg-cream px-1 py-0.5 font-mono uppercase">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-ink-muted bg-cream px-1 py-0.5 font-mono uppercase">↵</kbd>
              open
            </span>
          </div>
          <span className="hidden sm:inline">{results.length} of {tools.length} tools</span>
        </div>
      </div>
    </div>
  );
}

function filterTools(query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  // Tokens — every token must match somewhere in title/tagline/description.
  const tokens = q.split(/\s+/).filter(Boolean);
  return tools.filter((t) => {
    const haystack = `${t.title} ${t.tagline} ${t.description}`.toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  // Highlight the first matching token.
  const tokens = q.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    const idx = lower.indexOf(tok.toLowerCase());
    if (idx >= 0) {
      return (
        <>
          {text.slice(0, idx)}
          <mark className="bg-yellow rounded px-0.5">{text.slice(idx, idx + tok.length)}</mark>
          {text.slice(idx + tok.length)}
        </>
      );
    }
  }
  return <>{text}</>;
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 11L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
