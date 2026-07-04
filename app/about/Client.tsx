"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { COLOR_HEX, INK_HEX } from "@/lib/colors";
import { withAlpha } from "@/lib/hugo/sprite";
import type { ToolColor } from "@/lib/tools";
import { tools } from "@/lib/tools";

/**
 * The about page — a dictionary entry, then the shelf.
 *
 * The hero defines the word "lekstuga" (which simultaneously explains
 * the site's name and IS the about). Below it, "things you won't find
 * here" is a toy shelf of dust silhouettes: dashed pixel outlines of
 * the things that were never put on it. Hover one and it dimly tries
 * to materialize in the colour it would have had, then dissolves.
 *
 * The silhouette glyphs are page art, authored here as string grids —
 * they're not Hugo, so they don't belong in lib/hugo/sprite.ts.
 */

type Absent = {
  label: string;
  note: string;
  /** The accent this thing would have had, had it been let in. */
  color: ToolColor;
  /** '#' = outline/detail (drawn dashed at rest), 'o' = interior
   *  (only appears during the materialize attempt), '.' = empty. */
  glyph: string[];
};

const ABSENT: Absent[] = [
  {
    label: "newsletters",
    note: "never installed",
    color: "yellow",
    glyph: [
      "###############",
      "##ooooooooooo##",
      "#o#ooooooooo#o#",
      "#oo#ooooooo#oo#",
      "#ooo#ooooo#ooo#",
      "#oooo#####oooo#",
      "#ooooooooooooo#",
      "#ooooooooooooo#",
      "###############",
    ],
  },
  {
    label: "venture capital",
    note: "didn't fit through the door",
    color: "green",
    glyph: [
      "...##.##...",
      "....###....",
      "...#ooo#...",
      "..#ooooo#..",
      ".#ooooooo#.",
      ".#ooo#ooo#.",
      ".#oo###oo#.",
      ".#ooo#ooo#.",
      "..#ooooo#..",
      "...#####...",
    ],
  },
  {
    label: "your data",
    note: "not in the back room either",
    color: "blue",
    glyph: [
      ".#########.",
      "#ooooooooo#",
      "###########",
      "#ooooooooo#",
      "###########",
      "#ooooooooo#",
      ".#########.",
    ],
  },
  {
    label: "cookie banner",
    note: "nothing to consent to",
    color: "orange",
    glyph: [
      "...######...",
      "..#oooooo#..",
      ".#oo#ooooo#.",
      "#ooooooo#oo#",
      "#oo#ooooooo#",
      "#ooooo#oooo#",
      "#o#oooooo#o#",
      "#oooo#ooooo#",
      ".#oo#ooooo#.",
      "..#oooooo#..",
      "...######...",
    ],
  },
  {
    label: "the algorithm",
    note: "it never learned anything",
    color: "purple",
    glyph: [
      "......#......",
      "......#......",
      "..#########..",
      ".#ooooooooo#.",
      ".#o##ooo##o#.",
      ".#o##ooo##o#.",
      ".#ooooooooo#.",
      ".#o#######o#.",
      ".#ooooooooo#.",
      "..#########..",
    ],
  },
  {
    label: "five-year plan",
    note: "out of order since 2021",
    color: "teal",
    glyph: [
      "#...........",
      "#.......##..",
      "#.......##..",
      "#....##.##..",
      "#....##.##..",
      "#.##.##.##..",
      "#.##.##.##..",
      "#.##.##.##..",
      "############",
    ],
  },
  {
    label: "accounts",
    note: "the door doesn't lock",
    color: "tomato",
    glyph: [
      ".####........",
      "#oooo#.......",
      "#o##o########",
      "#oooo#..#.#.#",
      ".####........",
    ],
  },
  {
    label: "the love of your life",
    note: "try the door near the ceiling",
    color: "pink",
    glyph: [
      "..###...###..",
      ".#ooo#.#ooo#.",
      "#ooooo#ooooo#",
      "#ooooooooooo#",
      "#ooooooooooo#",
      ".#ooooooooo#.",
      "..#ooooooo#..",
      "...#ooooo#...",
      "....#ooo#....",
      ".....#o#.....",
      "......#......",
    ],
  },
];

/** Uniform canvas grid — glyphs centre inside, plank + dust below. */
const GRID_COLS = 17;
const GRID_ROWS = 15;
const CELL = 7;
const CANVAS_W = GRID_COLS * CELL;
const CANVAS_H = GRID_ROWS * CELL;
/** Row the shelf plank sits on (glyphs rest just above it). */
const PLANK_ROW = 12;

type GlyphCell = { x: number; y: number; interior: boolean; hash: number };

function parseGlyph(glyph: string[]): GlyphCell[] {
  const rows = glyph.length;
  const cols = Math.max(...glyph.map((r) => r.length));
  const offX = Math.floor((GRID_COLS - cols) / 2);
  const offY = PLANK_ROW - rows; // sit on the plank
  const cells: GlyphCell[] = [];
  glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== "#" && ch !== "o") continue;
      cells.push({
        x: offX + x,
        y: offY + y,
        interior: ch === "o",
        hash: Math.abs(Math.sin((x + 1) * 127.1 + (y + 1) * 311.7) * 43758.5453) % 1,
      });
    }
  });
  return cells;
}

/** One frame of the materialize attempt: which fraction of cells is
 *  visible, at what alpha, in accent or ink — then how long to hold. */
type Frame = { keep: number; alpha: number; accent: boolean; ms: number };
const MATERIALIZE: Frame[] = [
  { keep: 1, alpha: 0.5, accent: true, ms: 110 }, // it appears...
  { keep: 1, alpha: 0.85, accent: true, ms: 140 }, // ...almost solid...
  { keep: 0, alpha: 0, accent: true, ms: 70 }, // ...blinks out...
  { keep: 1, alpha: 0.55, accent: true, ms: 90 }, // ...one more try...
  { keep: 0.7, alpha: 0.45, accent: true, ms: 70 }, // ...and dissolves
  { keep: 0.45, alpha: 0.35, accent: true, ms: 70 },
  { keep: 0.2, alpha: 0.25, accent: true, ms: 70 },
];

function DustSilhouette({ item, index }: { item: Absent; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellsRef = useRef<GlyphCell[] | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const paint = (frame: Frame | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!cellsRef.current) cellsRef.current = parseGlyph(item.glyph);
    const cells = cellsRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== CANVAS_W * dpr) {
      canvas.width = CANVAS_W * dpr;
      canvas.height = CANVAS_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // The shelf plank + a little dust that settled where a toy never
    // stood. Speckle positions are deterministic per shelf spot.
    ctx.fillStyle = "#262b47";
    ctx.fillRect(CELL, PLANK_ROW * CELL, CANVAS_W - 2 * CELL, CELL);
    ctx.fillStyle = "#12141f";
    ctx.fillRect(CELL, (PLANK_ROW + 1) * CELL, CANVAS_W - 2 * CELL, 3);
    ctx.fillStyle = withAlpha(INK_HEX, 0.14);
    for (let d = 0; d < 5; d++) {
      const h = Math.abs(Math.sin((index + 1) * 91.7 + d * 47.3) * 1000) % 1;
      const dx = 2 + Math.floor(h * (GRID_COLS - 4));
      ctx.fillRect(dx * CELL + 2, PLANK_ROW * CELL - 3, 3, 3);
    }

    if (frame === null) {
      // At rest: the dashed outline — roughly two of every three
      // outline cells, so small shapes stay readable through the dust.
      ctx.fillStyle = withAlpha(INK_HEX, 0.38);
      for (const c of cells) {
        if (c.interior) continue;
        if ((c.x * 3 + c.y * 5) % 3 === 0) continue;
        ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
      }
      return;
    }

    // Mid-materialize: outline + interior, thinned by keep-fraction.
    const color = frame.accent ? COLOR_HEX[item.color] : INK_HEX;
    ctx.fillStyle = withAlpha(color, frame.alpha);
    for (const c of cells) {
      if (c.hash > frame.keep) continue;
      ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
    }
  };

  useEffect(() => {
    paint(null);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const materialize = () => {
    if (busyRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    busyRef.current = true;
    let i = 0;
    const step = () => {
      if (i >= MATERIALIZE.length) {
        paint(null);
        busyRef.current = false;
        return;
      }
      const f = MATERIALIZE[i];
      paint(f);
      i += 1;
      timerRef.current = window.setTimeout(step, f.ms);
    };
    step();
  };

  return (
    <li
      className="card-chunk notch flex flex-col items-center gap-3 bg-cream-deep px-3 pb-4 pt-4 text-center"
      onPointerEnter={materialize}
      onPointerDown={materialize}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        width={CANVAS_W}
        height={CANVAS_H}
        className="h-auto w-full max-w-[119px]"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="font-pixel text-[10px] uppercase tracking-[0.14em] text-ink-soft">
        {item.label}
      </p>
      {/* The taped-on note — a slight alternating lean, like it was
          stuck on by hand. */}
      <p
        className="notch-sm border border-line bg-cream px-2 py-1 font-mono text-[11px] lowercase text-ink-muted"
        style={{ transform: `rotate(${(index % 2 === 0 ? -1 : 1) * 1.6}deg)` }}
      >
        {item.note}
      </p>
    </li>
  );
}

/** The adverbs Hugo is willing to stand behind, in rotation. */
const HEDGES = [
  "potentially",
  "occasionally",
  "technically",
  "allegedly",
  "theoretically",
  "barely",
];

/**
 * "potentially useful." — the site's whole pitch, as hardware.
 * "potentially" is an arcade keycap: press it and the word blips
 * (a CRT scanline collapse, the site's own power idiom) into the
 * next hedge Hugo would also sign off on. "useful." never moves.
 */
function PotentiallyUseful() {
  const [hedge, setHedge] = useState(0);
  const [blip, setBlip] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const cycle = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setHedge((n) => (n + 1) % HEDGES.length);
      return;
    }
    if (blip) return;
    setBlip(true);
    timerRef.current = window.setTimeout(() => {
      setHedge((n) => (n + 1) % HEDGES.length);
      setBlip(false);
    }, 100);
  };

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 font-display text-2xl sm:text-3xl">
      <button
        type="button"
        onClick={cycle}
        aria-label="try another adverb"
        title="press it"
        className="btn-chunk bg-cream-deep px-3 py-1 text-ink"
      >
        <span
          aria-hidden={blip}
          className="inline-block transition-transform duration-100"
          style={{
            transform: blip ? "scaleY(0.08)" : "scaleY(1)",
            transformOrigin: "center",
          }}
        >
          {HEDGES[hedge]}
        </span>
      </button>
      <span className="text-glow">
        useful<span className="text-tomato">.</span>
      </span>
    </p>
  );
}

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <Link
        href="/"
        className="group mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        <span
          aria-hidden
          className="inline-block transition-transform duration-200 group-hover:-translate-x-1"
        >
          ←
        </span>
        Back to playhouse
      </Link>

      {/* The dictionary entry — defining the word is the about. */}
      <header className="flex flex-col gap-3">
        <p className="font-pixel text-[10px] uppercase tracking-[0.3em] text-ink-muted">
          about
        </p>
        <h1 className="text-glow font-display text-6xl leading-none sm:text-7xl">
          lekstuga
        </h1>
        <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          noun · swedish · [lek·stoo·ga]
        </p>
        <PotentiallyUseful />
      </header>

      {/* The shelf */}
      <section className="mt-14">
        <h2 className="font-display text-2xl sm:text-3xl">
          Things you won&rsquo;t find here
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {ABSENT.map((item, i) => (
            <DustSilhouette key={item.label} item={item} index={i} />
          ))}
        </ul>
        <p className="mt-8 text-sm text-ink-muted">
          The shelf space went to the {tools.length} toys out front{" "}
          <Link
            href="/"
            className="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-tomato"
          >
            →
          </Link>
        </p>
      </section>
    </div>
  );
}
