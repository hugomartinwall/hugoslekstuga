"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PixelIcon from "@/components/PixelIcon";
import Dialog from "@/components/ui/Dialog";
import Keycap from "@/components/ui/Keycap";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { accentVars } from "@/lib/colors";
import { iconForSlug } from "@/lib/pixel-icons";
import { tools, type Tool } from "@/lib/tools";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };

const SearchCtx = createContext<Ctx | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl-K to toggle; "/" to open, unless you are typing in a field.
  // Escape is not handled here: while the palette is open its Dialog owns
  // that key and stops the press there, so one press closes it once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
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

  // External openers — the homepage's anchored Search dot dispatches
  // `hugoslekstuga:open-search` instead of taking the ⌘K route, so it
  // works even when the user's hands aren't on the keyboard. Any
  // other surface can do the same.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("hugoslekstuga:open-search", onOpen);
    return () =>
      window.removeEventListener("hugoslekstuga:open-search", onOpen);
  }, []);

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

/**
 * The panel's size. Up to 36rem wide and 80vh tall, as it always was —
 * but 80vh is rarely a whole number, and a panel centred in an odd
 * leftover width starts on a half pixel; either one smears every hairline
 * inside at 1x. Where round() exists, the height is floored to a pixel
 * and the width gives up one pixel when that makes the leftover even.
 * The same rule keeps the panel on a short screen (a phone on its side),
 * where 80vh below the top gap would run off the bottom.
 */
const PANEL_SIZE = [
  "flex w-full max-w-xl flex-col max-h-[80vh]",
  "supports-[width:round(up,1px,1px)]:max-h-[round(down,min(80vh,100dvh-7rem),1px)]",
  "supports-[width:round(up,1px,1px)]:w-[calc(100%-2*round(up,max(0px,(100%-36rem)/2),1px))]",
].join(" ");

/**
 * The ⌘K palette. The kit's Dialog is the overlay: the flat dark scrim,
 * role=dialog, the focus trap, Escape, the scroll lock and handing focus
 * back to wherever it was.
 */
export function SearchPalette() {
  const { open, setOpen } = useSearch();
  const close = () => setOpen(false);
  return (
    <Dialog
      open={open}
      onClose={close}
      label="Search"
      placement="top"
      className={PANEL_SIZE}
    >
      {/* Mounted per opening, so every opening starts from an empty
          query with the first row active. */}
      {open ? <Palette onClose={close} /> : null}
    </Dialog>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const tokens = tokenize(query);
  const results = filterTools(tokens);

  const select = (idx: number) => {
    const t = results[idx];
    if (!t) return;
    onClose();
    router.push(pathFor(t.slug));
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(activeIdx);
    }
  };

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
        <div className="field-chunk min-w-0 flex-1">
          <span aria-hidden className="pl-3.5 text-ink-muted">
            <PixelIcon name="search" size={12} />
          </span>
          <input
            data-autofocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Search tools by name, tagline, or description…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="pl-3 text-ellipsis"
          />
          {/* Keyboard legends are for keyboards: a finger gets a key to press. */}
          <kbd className="kbd-chunk mr-3 w-9 justify-center pointer-coarse:hidden">
            esc
          </kbd>
        </div>
        <span className="hidden pointer-coarse:flex">
          <Keycap size="icon" aria-label="Close" onClick={onClose}>
            <PixelIcon name="close" size={12} />
          </Keycap>
        </span>
      </div>

      <ul
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2.5"
      >
        {results.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-ink-muted">
            No tool matches that. Try a different word.
          </li>
        ) : (
          results.map((t, i) => (
            // The gap between rows is padding on the <li>, the element that
            // is scrolled into view: the active row keeps a sliver of air
            // from the list's edge, and that sliver belongs to no row, so
            // a pointer resting in it cannot pick the next row and walk the
            // list away.
            <li key={t.slug} data-idx={i} className="py-0.5">
              {/* A row is a chip laid out as a row: flat at rest, the tool's
                  soft fill and a hairline in its accent when active. The
                  chip's own stepped ring stays in charge of keyboard focus. */}
              <button
                type="button"
                // Move, not enter: a pointer that is merely resting over
                // the list gets "entered" by every row that scrolls under
                // it, which used to drag the selection back while arrowing
                // and made the end of the list unreachable by keyboard.
                onMouseMove={() => {
                  if (activeIdx !== i) setActiveIdx(i);
                }}
                onClick={() => select(i)}
                style={accentVars(t.color)}
                className={`chip-chunk w-full justify-start gap-3 px-2 py-2 text-left font-normal ${
                  activeIdx === i
                    ? "bg-(--accent-soft) not-focus-visible:[--ring-c:var(--accent)]"
                    : "bg-transparent not-focus-visible:[--ring-c:transparent]"
                }`}
              >
                <span
                  aria-hidden
                  className="notch-sm flex h-9 w-9 shrink-0 items-center justify-center bg-(--accent) text-cream"
                >
                  <PixelIcon
                    name={iconForSlug(t.slug, isGameSlug(t.slug))}
                    size={24}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-display text-2xl leading-none text-ink">
                    <Highlight text={t.title} tokens={tokens} />
                  </span>
                  <span className="truncate text-sm text-ink-soft">
                    <Highlight text={t.tagline} tokens={tokens} />
                  </span>
                </span>
                <span className="hidden text-xs text-ink-muted sm:inline">
                  <Highlight text={`/${t.slug}`} tokens={tokens} />
                </span>
              </button>
            </li>
          ))
        )}
      </ul>

      {/* On a phone both halves are hidden (no keyboard, no room), so the
          strip goes with them. */}
      <div className="flex items-center justify-between gap-3 border-t border-line bg-cream-deep px-5 py-2.5 pointer-coarse:max-sm:hidden">
        <div className="label-pixel flex items-center gap-4 pointer-coarse:hidden">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd-chunk">
              <KeyGlyph rows={GLYPH_UP_DOWN} text="↑↓" />
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd-chunk">
              <KeyGlyph rows={GLYPH_RETURN} text="↵" />
            </kbd>
            open
          </span>
        </div>
        <span className="label-pixel ml-auto hidden sm:inline">
          {results.length} of {tools.length} tools
        </span>
      </div>
    </>
  );
}

/**
 * The arrow and return legends, drawn as pixels. The pixel face has no
 * arrows, so as characters they fell to whatever font the OS offered —
 * thin vector strokes inside a pixel keycap. The characters stay in the
 * markup for screen readers.
 */
const GLYPH_UP_DOWN = [
  "..#.....#..",
  ".###....#..",
  "#####...#..",
  "..#...#####",
  "..#....###.",
  "..#.....#..",
] as const;

const GLYPH_RETURN = [
  "......#",
  "..#...#",
  ".##...#",
  "#######",
  ".##....",
  "..#....",
] as const;

function KeyGlyph({ rows, text }: { rows: readonly string[]; text: string }) {
  const w = rows[0].length;
  const h = rows.length;
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
    }
  });
  return (
    <>
      <span className="sr-only">{text}</span>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        shapeRendering="crispEdges"
        fill="currentColor"
        aria-hidden
        focusable="false"
      >
        <path d={d} />
      </svg>
    </>
  );
}

/** Lower-case, and without diacritics: "Sjökort" reads as "sjokort". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function tokenize(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * What a query is matched against: the words on the card, plus the two
 * things people type that are not on it — the tool's address (`roll`
 * is "Spin the Wheel"; written the way the row shows it, so `/roll`
 * finds it too) and what kind of thing it is (in the plural, so both
 * `game` and `games` find the games).
 */
const HAYSTACKS = new Map<string, string>(
  tools.map((t) => [
    t.slug,
    fold(
      `${t.title} ${t.tagline} ${t.description} /${t.slug} ${
        isGameSlug(t.slug) ? "games" : "tools"
      }`,
    ),
  ]),
);

function filterTools(tokens: string[]): Tool[] {
  if (tokens.length === 0) return tools;
  // Every token must match somewhere.
  return tools.filter((t) => {
    const haystack = HAYSTACKS.get(t.slug) ?? "";
    return tokens.every((tok) => haystack.includes(tok));
  });
}

/**
 * Where `token` (already folded) sits in `text`, as a [start, end) range
 * in `text`'s own characters. The text is folded one character at a time
 * so each folded position remembers the character it came from — folding
 * can change a string's length, and the highlight must cut the original.
 */
function findFolded(text: string, token: string): [number, number] | null {
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let j = 0; j < f.length; j++) origin.push(i);
    folded += f;
  }
  const at = folded.indexOf(token);
  if (at < 0) return null;
  let end = origin[at + token.length - 1] + 1;
  // A letter keeps any combining marks written after it.
  while (end < text.length && fold(text[end]) === "") end++;
  return [origin[at], end];
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  // Highlight the first matching token.
  for (const tok of tokens) {
    const hit = findFolded(text, tok);
    if (hit) {
      return (
        <>
          {text.slice(0, hit[0])}
          <mark className="bg-yellow px-0.5 text-cream">
            {text.slice(hit[0], hit[1])}
          </mark>
          {text.slice(hit[1])}
        </>
      );
    }
  }
  return <>{text}</>;
}
