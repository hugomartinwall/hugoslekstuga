import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { isGameSlug } from "@/lib/clusters";
import { COLOR_HEX, CREAM_HEX, INK_HEX } from "@/lib/colors";
import { RESTING_PUPILS, SPRITE_ROWS, spriteColors } from "@/lib/hugo/sprite";
import { PIXEL_ICONS, iconForSlug, type PixelIconName } from "@/lib/pixel-icons";
import { findTool, type Tool } from "@/lib/tools";

/**
 * The share images, drawn the way the site is drawn: out of cells.
 *
 * `renderToolOG("<slug>")` is the per-page card; each
 * `app/{tools,games}/<slug>/opengraph-image.tsx` is a thin wrapper around
 * it, so the card is drawn in this file and not in thirteen. The
 * site-wide image (`app/opengraph-image.tsx`) lays out the same parts
 * its own way, so both set their words in one pixel face.
 *
 * One thing does have to change in the thirteen. An image's address
 * ends in a hash of its route file alone, which a change here does not
 * touch, and caches keyed on the address go on showing the old picture.
 * So each wrapper's first line carries the fingerprint of the picture
 * it draws, and test/site/share-image-address.test.ts fails when a
 * picture and its line part ways: it says the fingerprint to write. The
 * site image (app/opengraph-image.tsx) is held the same way.
 *
 * Why everything is a box: ImageResponse has no canvas, and it can only
 * set type from a font file it is handed — the repo ships none (the
 * live faces come from next/font). So nothing here is typeset. Words
 * are set in a hand-authored 5×7 face, the mascot is the canonical
 * 16×16 sprite and a page's mark is its 12×12 icon — the same rows the
 * site draws from — and all of it reaches the image as absolutely
 * placed boxes. No font files, no fetch.
 *
 * Two rules keep it crisp and cheap:
 *  - Every position and size is a whole pixel. Centring with flexbox
 *    parks an odd-width word on a half pixel and softens every edge of
 *    it, so the layouts do their own arithmetic.
 *  - A bitmap is cut into as few boxes as it takes (`bitmapRects`), not
 *    one per cell: a card is about three hundred elements, not
 *    thousands.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Phosphor: the text on the room dark. */
export const OG_INK = INK_HEX;
/** Room dark: the page surface. */
export const OG_ROOM = CREAM_HEX;
/** Muted phosphor. Mirrors --color-ink-muted in app/globals.css. */
export const OG_MUTED = "#8e97a8";

/** The hairline (--color-line, phosphor at 16%) flattened onto the room
 *  dark, so frame segments that overlap do not add up. */
const LINE = "#2e3136";
/** Coral, the mascot's default. The live one cycles through the eight
 *  accents; an image that gets cached needs one stable choice. */
const HUGO_ACCENT = COLOR_HEX.tomato;
/** The site's Bayer dither tile (--dither in app/globals.css) at 2×. A
 *  share card is mostly shown at about half size, where this is the
 *  same whisper the pages wear. */
const DITHER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 8 8'%3E%3Cpath d='M0 0h1v1H0zM2 0h1v1H2zM4 0h1v1H4zM2 2h1v1H2zM6 2h1v1H6zM0 4h1v1H0zM4 4h1v1H4zM6 4h1v1H6zM2 6h1v1H2zM6 6h1v1H6z' fill='%23E8F2E9' fill-opacity='0.045'/%3E%3C/svg%3E\")";

/* ── Bitmaps ──────────────────────────────────────────────────────── */

/** A filled box, in cells. */
type Rect = { x: number; y: number; w: number; h: number };

/**
 * The cells of `rows` that hold `lit`, as boxes. Each row is cut into
 * horizontal runs; a run sitting exactly under the same run in the row
 * above grows that box downward instead of starting a new one, so a
 * stem is one tall box and not seven short ones.
 */
function bitmapRects(
  rows: readonly string[],
  lit: string,
  dx = 0,
  dy = 0,
): Rect[] {
  const out: Rect[] = [];
  let above: Rect[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    const here: Rect[] = [];
    let x = 0;
    while (x < row.length) {
      if (row[x] !== lit) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === lit) w++;
      const grown = above.find((r) => r.x === x + dx && r.w === w);
      if (grown) {
        grown.h++;
        here.push(grown);
      } else {
        const rect = { x: x + dx, y: y + dy, w, h: 1 };
        out.push(rect);
        here.push(rect);
      }
      x += w;
    }
    above = here;
  }
  return out;
}

/** Boxes as absolutely placed divs, `cell` px per unit. Whatever holds
 *  them must be `display: flex` (ImageResponse insists, for any element
 *  with more than one child). */
function boxes(
  rects: readonly Rect[],
  cell: number,
  color: string,
  key: string,
): ReactElement[] {
  return rects.map((r, i) => (
    <div
      key={`${key}${i}`}
      style={{
        position: "absolute",
        left: r.x * cell,
        top: r.y * cell,
        width: r.w * cell,
        height: r.h * cell,
        backgroundColor: color,
      }}
    />
  ));
}

/** An absolutely placed box to hold boxes. */
function Layer({
  x,
  y,
  w,
  h,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        display: "flex",
      }}
    >
      {children}
    </div>
  );
}

/* ── The pixel face ───────────────────────────────────────────────── */

/**
 * 5×7 pixel capitals. The ten letters of the wordmark are the ones the
 * site image has always worn; the rest are drawn to match (one-cell
 * stems, clipped corners). Widths are proportional: a glyph is as wide
 * as its rows.
 *
 * Row 0 is the cap line and row 6 stands on the baseline. A glyph with
 * more rows than that hangs below (the comma's tail); one listed in
 * GLYPH_RISE starts that many rows above the cap line (the dots on Ö).
 * A row is `X` for a lit cell and `.` for a dark one, and the rows of a
 * glyph are all as wide; test/site/share-image-words.test.ts holds every
 * glyph to that, because any other character is a cell that is quietly
 * not drawn.
 */
export const GLYPHS: Record<string, readonly string[]> = {
  A: [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  C: [".XXX.", "X...X", "X....", "X....", "X....", "X...X", ".XXX."],
  D: ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  F: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "X...."],
  G: [".XXX.", "X...X", "X....", "X.XXX", "X...X", "X...X", ".XXXX"],
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  I: ["XXX", ".X.", ".X.", ".X.", ".X.", ".X.", "XXX"],
  J: ["....X", "....X", "....X", "....X", "....X", "X...X", ".XXX."],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  L: ["X....", "X....", "X....", "X....", "X....", "X....", "XXXXX"],
  M: ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
  N: ["X...X", "X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X"],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  P: ["XXXX.", "X...X", "X...X", "XXXX.", "X....", "X....", "X...."],
  Q: [".XXX.", "X...X", "X...X", "X...X", "X.X.X", "X..X.", ".XX.X"],
  R: ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
  U: ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  V: ["X...X", "X...X", "X...X", "X...X", "X...X", ".X.X.", "..X.."],
  W: ["X...X", "X...X", "X...X", "X.X.X", "X.X.X", "X.X.X", ".X.X."],
  X: ["X...X", "X...X", ".X.X.", "..X..", ".X.X.", "X...X", "X...X"],
  Y: ["X...X", "X...X", "X...X", ".X.X.", "..X..", "..X..", "..X.."],
  Z: ["XXXXX", "....X", "...X.", "..X..", ".X...", "X....", "XXXXX"],
  // Å Ä Ö keep the whole letter and wear the mark above the cap line.
  Å: ["..X..", ".X.X.", "..X..", ".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  Ä: [".X.X.", ".....", ".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  Ö: [".X.X.", ".....", ".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  "0": [".XXX.", "X...X", "X..XX", "X.X.X", "XX..X", "X...X", ".XXX."],
  "1": [".X.", "XX.", ".X.", ".X.", ".X.", ".X.", "XXX"],
  "2": [".XXX.", "X...X", "....X", "...X.", "..X..", ".X...", "XXXXX"],
  "3": [".XXX.", "X...X", "....X", "..XX.", "....X", "X...X", ".XXX."],
  "4": ["...X.", "..XX.", ".X.X.", "X..X.", "XXXXX", "...X.", "...X."],
  "5": ["XXXXX", "X....", "XXXX.", "....X", "....X", "X...X", ".XXX."],
  "6": ["..XX.", ".X...", "X....", "XXXX.", "X...X", "X...X", ".XXX."],
  "7": ["XXXXX", "....X", "...X.", "..X..", ".X...", ".X...", ".X..."],
  "8": [".XXX.", "X...X", "X...X", ".XXX.", "X...X", "X...X", ".XXX."],
  "9": [".XXX.", "X...X", "X...X", ".XXXX", "....X", "...X.", ".XX.."],
  ".": ["..", "..", "..", "..", "..", "XX", "XX"],
  ",": ["..", "..", "..", "..", "..", "XX", ".X", "X."],
  "'": ["XX", ".X", "X.", "..", "..", "..", ".."],
  "?": [".XXX.", "X...X", "....X", "...X.", "..X..", ".....", "..X.."],
  "!": ["X", "X", "X", "X", "X", ".", "X"],
  "-": ["...", "...", "...", "XXX", "...", "...", "..."],
  // The same hand as the marks above: one-cell strokes, dots the size
  // of the full stop's, the plus on the dash's row, and the ampersand
  // ends in the Q's tail.
  "&": [".XX..", "X..X.", "X.X..", ".X...", "X.X.X", "X..X.", ".XX.X"],
  ":": ["..", "XX", "XX", "..", "..", "XX", "XX"],
  "/": ["..X", "..X", ".X.", ".X.", ".X.", "X..", "X.."],
  "(": ["..X", ".X.", "X..", "X..", "X..", ".X.", "..X"],
  ")": ["X..", ".X.", "..X", "..X", "..X", ".X.", "X.."],
  "+": [".....", "..X..", "..X..", "XXXXX", "..X..", "..X..", "....."],
};

export const GLYPH_RISE: Record<string, number> = { Å: 3, Ä: 2, Ö: 2 };

/** What a character with no glyph is drawn as: a solid block. It was an
 *  empty box, the sign a font shows for a missing letter, and among
 *  these capitals that read as an O or a zero ("ROCK & ROLL: 100%" came
 *  out as "ROCK O ROLLO 1000"). A block is no letter. */
const NO_GLYPH = ["XXXXX", "XXXXX", "XXXXX", "XXXXX", "XXXXX", "XXXXX", "XXXXX"];
/** Characters already reported missing, so each is said once. */
const warned = new Set<string>();

type Glyph = { rows: readonly string[]; rise: number };

/** The face's glyph for one character, if it has one. An accented
 *  letter the face has not drawn falls back to its plain letter (É sets
 *  as E). */
function findGlyph(ch: string): Glyph | null {
  const own = GLYPHS[ch];
  if (own) return { rows: own, rise: GLYPH_RISE[ch] ?? 0 };
  const plain = GLYPHS[ch.normalize("NFD")[0]];
  return plain ? { rows: plain, rise: 0 } : null;
}

/**
 * The glyph one character is drawn with. A character the face does not
 * have is the block, and says so in the server log, where a build shows
 * it.
 */
function glyphFor(ch: string): Glyph {
  const found = findGlyph(ch);
  if (found) return found;
  if (!warned.has(ch)) {
    warned.add(ch);
    console.warn(
      `[og] no pixel glyph for ${JSON.stringify(ch)}: drawn as a solid block. Add it to GLYPHS in lib/og.tsx.`,
    );
  }
  return { rows: NO_GLYPH, rise: 0 };
}

/** The face is capitals only, with one apostrophe and one dash: curly
 *  quotes, en and em dashes and the ellipsis are set as their plain
 *  cousins. */
function pixelChars(text: string): string[] {
  return Array.from(
    text
      .normalize("NFC")
      .toUpperCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "..."),
  );
}

/**
 * The characters of `text` the face has not drawn. Each would come out
 * wrong on an image: an accented letter as its plain one (Ö as O), any
 * other as the block. test/site/share-image-words.test.ts puts every
 * word the images set through this, so a new word with a new character
 * fails there and not in somebody's link preview.
 */
export function missingGlyphs(text: string): string[] {
  return [...new Set(pixelChars(text))].filter(
    (ch) => ch !== " " && !GLYPHS[ch],
  );
}

/** How a line is set: the gap between glyphs, and how wide a space is. */
type Spacing = { tracking?: number; space?: number };

type TextLayout = {
  rects: Rect[];
  /** Cells across. */
  width: number;
  /** Cells that stand above the cap line (the dots on an Ö). */
  rise: number;
};

/**
 * Set `text` on the cell grid. A space is one cell by default, which
 * with the gap either side makes the three-cell word space the wordmark
 * has always had; a sentence reads better with two.
 */
function layoutText(
  text: string,
  { tracking = 1, space = 1 }: Spacing = {},
): TextLayout {
  const rects: Rect[] = [];
  let x = 0;
  let rise = 0;
  for (const ch of pixelChars(text)) {
    if (ch === " ") {
      x += space + tracking;
      continue;
    }
    const glyph = glyphFor(ch);
    rise = Math.max(rise, glyph.rise);
    rects.push(...bitmapRects(glyph.rows, "X", x, -glyph.rise));
    x += glyph.rows[0].length + tracking;
  }
  return { rects, width: Math.max(0, x - tracking), rise };
}

/** How `text` sets, in cells. Its cap height is always 7. */
export function measurePixelText(
  text: string,
  spacing?: Spacing,
): { width: number; rise: number } {
  const { width, rise } = layoutText(text, spacing);
  return { width, rise };
}

/** The biggest whole cell, at most `max`, at which `text` fits in `width` px. */
function fitCell(
  text: string,
  width: number,
  max: number,
  spacing?: Spacing,
): number {
  const cells = Math.max(1, layoutText(text, spacing).width);
  return Math.max(1, Math.min(max, Math.floor(width / cells)));
}

/** Break `text` at its spaces into lines of at most `max` cells. A word
 *  wider than that gets a line to itself, and overflows it. */
function wrapText(text: string, max: number, spacing?: Spacing): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const longer = line ? `${line} ${word}` : word;
    if (line && layoutText(longer, spacing).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type Placement = {
  /** The left edge, the middle or the right edge of the line, by `align`. */
  x: number;
  /** The cap line. */
  y: number;
  /** Px per cell: the line is 7 of these tall. */
  cell: number;
  color: string;
  align?: "left" | "center" | "right";
};

/** A line of pixel capitals. */
export function PixelText({
  text,
  x,
  y,
  cell,
  color,
  align = "left",
  tracking,
  space,
}: Placement & Spacing & { text: string }): ReactElement {
  const { rects, width } = layoutText(text, { tracking, space });
  const w = width * cell;
  const left =
    align === "left" ? x : align === "right" ? x - w : Math.round(x - w / 2);
  return (
    <Layer x={left} y={y} w={w} h={7 * cell}>
      {boxes(rects, cell, color, "t")}
    </Layer>
  );
}

/** The site's name, set the way the marquee sets it. */
export function Wordmark(at: Placement): ReactElement {
  return <PixelText text="HUGOS LEKSTUGA" {...at} />;
}

/* ── The mascot ───────────────────────────────────────────────────── */

/** The part of the 16×16 sprite grid that Hugo actually fills. */
const HUGO_BOX = (() => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  SPRITE_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  });
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
})();

/** How much room Hugo takes at `cell` px per cell. */
export function hugoSize(cell: number): { width: number; height: number } {
  return { width: HUGO_BOX.w * cell, height: HUGO_BOX.h * cell };
}

/**
 * Hugo: the canonical sprite (lib/hugo/sprite.ts) at rest — eyes open,
 * pupils where `drawHugoSprite` puts them. `x`/`y` are the top-left of
 * his body, not of the sprite's mostly empty grid.
 */
export function Hugo({
  x,
  y,
  cell,
  accent = HUGO_ACCENT,
}: {
  x: number;
  y: number;
  cell: number;
  accent?: string;
}): ReactElement {
  const c = spriteColors(accent);
  const size = SPRITE_ROWS.length * cell;
  return (
    <Layer x={x - HUGO_BOX.x * cell} y={y - HUGO_BOX.y * cell} w={size} h={size}>
      {boxes(bitmapRects(SPRITE_ROWS, "b"), cell, c.body, "b")}
      {boxes(bitmapRects(SPRITE_ROWS, "s"), cell, c.shade, "s")}
      {boxes(bitmapRects(SPRITE_ROWS, "h"), cell, c.highlight, "h")}
      {boxes(bitmapRects(SPRITE_ROWS, "w"), cell, c.white, "w")}
      {boxes(RESTING_PUPILS, cell, c.pupil, "p")}
    </Layer>
  );
}

/* ── Stepped shapes ───────────────────────────────────────────────── */

type Stepped = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Px per step. A corner is two of them, as in the kit's notches. */
  step: number;
  color: string;
};

/** A filled box with stepped corners: three boxes that overlap, so
 *  `color` has to be opaque. */
function SteppedFill({ x, y, w, h, step: s, color }: Stepped): ReactElement {
  return (
    <Layer x={x} y={y} w={w} h={h}>
      {boxes(
        [
          { x: 2 * s, y: 0, w: w - 4 * s, h },
          { x: s, y: s, w: w - 2 * s, h: h - 2 * s },
          { x: 0, y: 2 * s, w, h: h - 4 * s },
        ],
        1,
        color,
        "f",
      )}
    </Layer>
  );
}

/**
 * The hairline of a stepped frame, as a ring that follows the steps —
 * the kit's rule (a border would stop at the corners). Here it is
 * straight segments: four edges, and four short ones in each corner.
 * They overlap where they meet, so `color` has to be opaque.
 */
function SteppedRing({
  x,
  y,
  w,
  h,
  step: s,
  color,
  line: t,
}: Stepped & { line: number }): ReactElement {
  // The top-left corner, walking from the top edge down to the left one.
  const corner: Rect[] = [
    { x: 2 * s, y: 0, w: t, h: s + t },
    { x: s, y: s, w: s + t, h: t },
    { x: s, y: s, w: t, h: s + t },
    { x: 0, y: 2 * s, w: s + t, h: t },
  ];
  const rects: Rect[] = [
    { x: 2 * s, y: 0, w: w - 4 * s, h: t },
    { x: 2 * s, y: h - t, w: w - 4 * s, h: t },
    { x: 0, y: 2 * s, w: t, h: h - 4 * s },
    { x: w - t, y: 2 * s, w: t, h: h - 4 * s },
  ];
  for (const right of [false, true]) {
    for (const bottom of [false, true]) {
      for (const r of corner) {
        rects.push({
          x: right ? w - r.x - r.w : r.x,
          y: bottom ? h - r.y - r.h : r.y,
          w: r.w,
          h: r.h,
        });
      }
    }
  }
  return (
    <Layer x={x} y={y} w={w} h={h}>
      {boxes(rects, 1, color, "r")}
    </Layer>
  );
}

/* ── The per-page card ────────────────────────────────────────────── */

const W = OG_SIZE.width;
const H = OG_SIZE.height;

/** The frame: a hairline with stepped corners, a little in from the
 *  edge (link previews round their corners and would bite a flush one).
 *  At half size it is the kit's card frame: 4px steps, a 1px line. */
const FRAME_INSET = 28;
const FRAME_STEP = 8;
const FRAME_LINE = 2;

/** Hugo keeps the corner he keeps on every page: top left. */
const BRAND_X = 64;
const BRAND_Y = 60;
const BRAND_HUGO_CELL = 4;
const BRAND_TEXT_CELL = 3;

/** The tile is components/ui/IconTile.tsx in boxes, at its proportions:
 *  18 icon cells across, the icon's 12 in the middle, corners stepped
 *  by one cell. */
const TILE_CELLS = 18;
const ICON_INSET = 3;
const ICON_CELL = 11;

/** The widest a line of text may run. */
const TEXT_WIDTH = 1040;
const TITLE_MAX_CELL = 18;
const TAGLINE_MAX_CELL = 5;
const TAGLINE_MIN_CELL = 4;
const TAGLINE_SPACING = { space: 2 } as const;
/** Cells between two lines of tagline. */
const TAGLINE_LEADING = 4;
/** Tile to title, and the least air above a title's diacritic. */
const TITLE_GAP = 52;
const TITLE_CLEARANCE = 32;
const TAGLINE_GAP = 36;

/** The room-dark sheet a card is drawn on: the dither and the frame. */
function Sheet({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: W,
        height: H,
        backgroundColor: OG_ROOM,
        backgroundImage: DITHER,
        backgroundSize: "16px 16px",
        backgroundRepeat: "repeat",
      }}
    >
      <SteppedRing
        x={FRAME_INSET}
        y={FRAME_INSET}
        w={W - 2 * FRAME_INSET}
        h={H - 2 * FRAME_INSET}
        step={FRAME_STEP}
        line={FRAME_LINE}
        color={LINE}
      />
      {children}
    </div>
  );
}

/** Hugo and the site's name, small. */
function Brand({ x, y }: { x: number; y: number }): ReactElement {
  const hugo = hugoSize(BRAND_HUGO_CELL);
  return (
    <Layer x={x} y={y} w={W - x} h={hugo.height}>
      <Hugo x={0} y={0} cell={BRAND_HUGO_CELL} />
      <Wordmark
        x={hugo.width + 4 * BRAND_HUGO_CELL}
        y={Math.ceil((hugo.height - 7 * BRAND_TEXT_CELL) / 2)}
        cell={BRAND_TEXT_CELL}
        color={OG_INK}
      />
    </Layer>
  );
}

/** A page's icon, room-dark, on a stepped tile of its accent. */
function IconTile({
  x,
  y,
  name,
  color,
}: {
  x: number;
  y: number;
  name: PixelIconName;
  color: string;
}): ReactElement {
  const size = TILE_CELLS * ICON_CELL;
  return (
    <Layer x={x} y={y} w={size} h={size}>
      <SteppedFill x={0} y={0} w={size} h={size} step={ICON_CELL} color={color} />
      {boxes(
        bitmapRects(PIXEL_ICONS[name], "#", ICON_INSET, ICON_INSET),
        ICON_CELL,
        OG_ROOM,
        "i",
      )}
    </Layer>
  );
}

/**
 * How the tagline is set. Every tagline in the registry fits on one
 * line at the biggest cell. A longer one drops a size; longer still, it
 * wraps onto a second line instead of shrinking until nobody can read
 * it. (A title never wraps: it is a name, and takes a smaller cell.)
 */
function fitTagline(text: string): { lines: string[]; cell: number } {
  const oneLine = fitCell(text, TEXT_WIDTH, TAGLINE_MAX_CELL, TAGLINE_SPACING);
  if (oneLine >= TAGLINE_MIN_CELL) return { lines: [text], cell: oneLine };
  for (let cell = TAGLINE_MAX_CELL; cell > oneLine; cell--) {
    const max = Math.floor(TEXT_WIDTH / cell);
    const lines = wrapText(text, max, TAGLINE_SPACING);
    const fits = lines.every(
      (line) => layoutText(line, TAGLINE_SPACING).width <= max,
    );
    if (fits && lines.length <= 2) return { lines, cell };
  }
  return { lines: [text], cell: oneLine };
}

/**
 * Tile, title, tagline: one centred stack, and Hugo in his corner. The
 * title takes the biggest cell that fits the line, so a short name is
 * set larger than a long one.
 */
function ToolCard({ tool }: { tool: Tool }): ReactElement {
  const titleCell = fitCell(tool.title, TEXT_WIDTH, TITLE_MAX_CELL);
  const tagline = fitTagline(tool.tagline);
  const taglinePitch = (7 + TAGLINE_LEADING) * tagline.cell;
  const taglineHeight =
    (tagline.lines.length - 1) * taglinePitch + 7 * tagline.cell;
  const tile = TILE_CELLS * ICON_CELL;
  // A title with a diacritic stands taller than its cap line: give the
  // dots their air under the tile.
  const rise = measurePixelText(tool.title).rise * titleCell;
  const titleGap = Math.max(TITLE_GAP, rise + TITLE_CLEARANCE);
  const stack = tile + titleGap + 7 * titleCell + TAGLINE_GAP + taglineHeight;
  const top = Math.round((H - stack) / 2);
  const titleY = top + tile + titleGap;
  const taglineY = titleY + 7 * titleCell + TAGLINE_GAP;
  return (
    <Sheet>
      <Brand x={BRAND_X} y={BRAND_Y} />
      <IconTile
        x={Math.round((W - tile) / 2)}
        y={top}
        name={iconForSlug(tool.slug, isGameSlug(tool.slug))}
        color={COLOR_HEX[tool.color]}
      />
      <PixelText
        text={tool.title}
        x={W / 2}
        y={titleY}
        cell={titleCell}
        color={OG_INK}
        align="center"
      />
      {tagline.lines.map((line, i) => (
        <PixelText
          key={i}
          text={line}
          x={W / 2}
          y={taglineY + i * taglinePitch}
          cell={tagline.cell}
          color={OG_MUTED}
          align="center"
          {...TAGLINE_SPACING}
        />
      ))}
    </Sheet>
  );
}

/** No such slug: the sheet with the site's name on it. */
function NameCard(): ReactElement {
  const cell = 13;
  return (
    <Sheet>
      <Wordmark
        x={W / 2}
        y={Math.round((H - 7 * cell) / 2)}
        cell={cell}
        color={OG_INK}
        align="center"
      />
    </Sheet>
  );
}

export function renderToolOG(slug: string): ImageResponse {
  const tool = findTool(slug);
  // The name card should never be reached at runtime — per-route
  // wrappers hard-code their own slug — but the function stays total so
  // a typo doesn't crash the Vercel build.
  return new ImageResponse(tool ? <ToolCard tool={tool} /> : <NameCard />, {
    ...OG_SIZE,
  });
}
