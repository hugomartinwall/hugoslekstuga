"use client";

import { useEffect, useRef } from "react";
import { INK_HEX } from "@/lib/colors";
import { readAccent, subscribeAccent, withAlpha } from "@/lib/hugo/sprite";
import { setWordmark, type WordmarkLetter } from "@/lib/wordmark-bridge";
import { clamp } from "@/lib/math";

/**
 * The marquee — "HUGOS LEKSTUGA" as an arcade attract-screen logo,
 * centred in the swarm.
 *
 * The wordmark is not typeset in the DOM: Jersey 15 is rendered once
 * to an offscreen canvas, sampled into a coarse grid, and every "on"
 * cell becomes a phosphor pixel — the same quantized language as
 * sprite-Hugo. The pixels then behave like an old sign:
 *
 *   - after the CRT power-on, letters ignite left to right
 *   - at rest they shimmer, and every few seconds one letter does a
 *     tired-neon flicker
 *   - pixels near the cursor get shoved off their spot and spring
 *     back, but always render snapped to the grid — they jump
 *     tracks, they don't flow
 *   - clicking a letter blips it (flash + one-cell hop + sparkles)
 *
 * The canvas is pointer-transparent; interaction listens on window
 * and hit-tests itself, so the swarm underneath keeps every drag and
 * click. Base cell positions never animate — they're published to
 * lib/wordmark-bridge so ToolMap can drift orbs around the title and
 * the parkour can stand on the letters without the floor jittering.
 *
 * Reduced motion: one static, fully-lit draw. No loop.
 */

const WORDS = ["HUGOS", "LEKSTUGA"] as const;
/** Font px for the offscreen sample render. */
const SAMPLE_SIZE = 48;
/** Grid rows ≈ SAMPLE_SIZE / SAMPLE_Q_DIV — ~14 keeps sprite chunkiness. */
const SAMPLE_Q_DIV = 14;
/** Stack the two words below this viewport width. */
const STACK_BELOW_W = 520;
/** Beat between the CRT flash settling and the first letter igniting. */
const IGNITE_DELAY = 600;
/** Per-letter stagger during ignition. */
const IGNITE_STAGGER = 70;
/** Accent flash at the moment a letter ignites. */
const IGNITE_FLASH = 120;
const FLICKER_MIN_WAIT = 4000;
const FLICKER_EXTRA_WAIT = 5000;
/** Hard-stepped alpha ladder of the tired-neon flicker, 64ms a rung. */
const FLICKER_STEPS = [1, 0.25, 0.7, 0.15, 1] as const;
const FLICKER_STEP_MS = 64;
/** Cursor influence radius and max shove (in cells). */
const PUSH_RADIUS = 70;
const PUSH_CELLS = 2.5;
const BLIP_MS = 220;

type WordSample = {
  cols: number;
  rows: number;
  /** Grid cells, trimmed to the glyph bounds, tagged with the index
   *  of the letter they belong to (global across both words). */
  cells: { col: number; row: number; letter: number }[];
};

type Cell = {
  /** Base canvas position — never animated, published to the bridge. */
  x: number;
  y: number;
  letter: number;
  hash: number;
  /** Cursor-displacement spring state (rendered snapped to the grid). */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};

type Layout = {
  /** Cell size in CSS px. */
  c: number;
  cells: Cell[];
  letterRects: WordmarkLetter[];
  block: { x: number; y: number; w: number; h: number };
};

type Sparkle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

/** `ctx.font` can't resolve CSS variables — read the concrete
 *  next/font family off a probe element wearing the utility class. */
function resolveDisplayFamily(): string {
  const probe = document.createElement("span");
  probe.className = "font-display";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "monospace";
}

function sampleWord(
  family: string,
  word: string,
  letterOffset: number,
): WordSample {
  const S = SAMPLE_SIZE;
  const pad = 4;
  const font = `400 ${S}px ${family}`;
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = font;
  const w = Math.ceil(meas.measureText(word).width) + pad * 2;
  const h = Math.ceil(S * 1.5);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(word, pad, h / 2);

  // Letter boundaries in sample px — prefix widths attribute each
  // cell to the letter whose column span contains its centre.
  const bounds: number[] = [];
  for (let i = 0; i <= word.length; i++) {
    bounds.push(pad + meas.measureText(word.slice(0, i)).width);
  }

  const q = Math.max(2, Math.round(S / SAMPLE_Q_DIV));
  const gridCols = Math.ceil(w / q);
  const gridRows = Math.ceil(h / q);
  const data = ctx.getImageData(0, 0, w, h).data;
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3];

  const raw: { col: number; row: number; letter: number }[] = [];
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cx = col * q + q / 2;
      const cy = row * q + q / 2;
      // Majority vote over centre + four inset corners so a cell
      // needs real coverage, not a grazing anti-aliased edge.
      const d = q * 0.3;
      let on = 0;
      if (alphaAt(Math.round(cx), Math.round(cy)) > 127) on++;
      if (alphaAt(Math.round(cx - d), Math.round(cy - d)) > 127) on++;
      if (alphaAt(Math.round(cx + d), Math.round(cy - d)) > 127) on++;
      if (alphaAt(Math.round(cx - d), Math.round(cy + d)) > 127) on++;
      if (alphaAt(Math.round(cx + d), Math.round(cy + d)) > 127) on++;
      if (on < 3) continue;
      let letter = word.length - 1;
      for (let i = 1; i <= word.length; i++) {
        if (cx < bounds[i]) {
          letter = i - 1;
          break;
        }
      }
      raw.push({ col, row, letter: letter + letterOffset });
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
      if (row < minR) minR = row;
      if (row > maxR) maxR = row;
    }
  }
  if (raw.length === 0) return { cols: 1, rows: 1, cells: [] };
  return {
    cols: maxC - minC + 1,
    rows: maxR - minR + 1,
    cells: raw.map((cell) => ({
      col: cell.col - minC,
      row: cell.row - minR,
      letter: cell.letter,
    })),
  };
}

async function sampleWordmark(): Promise<WordSample[]> {
  const family = resolveDisplayFamily();
  const spec = `400 ${SAMPLE_SIZE}px ${family}`;
  // Jersey 15 is preloaded by next/font, so this normally resolves
  // instantly — the race is insurance against a slow cold cache. If
  // the face still isn't in, wait for the whole font set once; only
  // then sample, so the fallback face never gets quantized.
  try {
    await Promise.race([
      document.fonts.load(spec, WORDS.join(" ")),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (!document.fonts.check(spec)) {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
  } catch {
    // FontFaceSet quirks — sample with whatever is available.
  }
  let offset = 0;
  return WORDS.map((word) => {
    const s = sampleWord(family, word, offset);
    offset += word.length;
    return s;
  });
}

function buildLayout(words: WordSample[], w: number, h: number): Layout {
  const [a, b] = words;
  const avail = w * 0.86;
  const spaceCols = 4;
  const oneLineCols = a.cols + spaceCols + b.cols;
  const stacked = w < STACK_BELOW_W;
  const c = stacked
    ? clamp(Math.floor(avail / Math.max(a.cols, b.cols)), 3, 8)
    : clamp(Math.floor(avail / oneLineCols), 3, 8);

  // Word placements in grid space (cols/rows from the block origin).
  let blockCols: number;
  let blockRows: number;
  let placements: { word: WordSample; colOff: number; rowOff: number }[];
  if (stacked) {
    blockCols = Math.max(a.cols, b.cols);
    const gapRows = 1;
    blockRows = a.rows + gapRows + b.rows;
    placements = [
      { word: a, colOff: Math.round((blockCols - a.cols) / 2), rowOff: 0 },
      {
        word: b,
        colOff: Math.round((blockCols - b.cols) / 2),
        rowOff: a.rows + gapRows,
      },
    ];
  } else {
    blockCols = oneLineCols;
    blockRows = Math.max(a.rows, b.rows);
    // Bottom-align the two words — closest to sharing a baseline.
    placements = [
      { word: a, colOff: 0, rowOff: blockRows - a.rows },
      { word: b, colOff: a.cols + spaceCols, rowOff: blockRows - b.rows },
    ];
  }

  const blockW = blockCols * c;
  const blockH = blockRows * c;
  const blockX = Math.round((w - blockW) / 2);
  // Centred vertically; the top clamp keeps short viewports from
  // pushing the title into the door/anchor band along the ceiling.
  const blockY = Math.round(Math.max(150, h / 2 - blockH / 2));

  const cells: Cell[] = [];
  const letterBounds = new Map<
    number,
    { minX: number; minY: number; maxX: number; maxY: number }
  >();
  for (const p of placements) {
    for (const cell of p.word.cells) {
      const x = blockX + (p.colOff + cell.col) * c;
      const y = blockY + (p.rowOff + cell.row) * c;
      cells.push({
        x,
        y,
        letter: cell.letter,
        // Pseudo-random per cell — a regular modulo hash reads as a
        // woven texture once the shimmer runs.
        hash:
          Math.abs(
            Math.sin((cell.col + 1) * 127.1 + (cell.row + 1) * 311.7) *
              43758.5453,
          ) % 1,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
      });
      const lb = letterBounds.get(cell.letter);
      if (!lb) {
        letterBounds.set(cell.letter, {
          minX: x,
          minY: y,
          maxX: x + c,
          maxY: y + c,
        });
      } else {
        if (x < lb.minX) lb.minX = x;
        if (y < lb.minY) lb.minY = y;
        if (x + c > lb.maxX) lb.maxX = x + c;
        if (y + c > lb.maxY) lb.maxY = y + c;
      }
    }
  }
  const letterRects: WordmarkLetter[] = [...letterBounds.entries()]
    .sort(([i], [j]) => i - j)
    .map(([index, lb]) => ({
      index,
      x: lb.minX,
      y: lb.minY,
      w: lb.maxX - lb.minX,
      h: lb.maxY - lb.minY,
    }));

  return { c, cells, letterRects, block: { x: blockX, y: blockY, w: blockW, h: blockH } };
}

/** Cells of padding around the glow canvas — must match the draw-time
 *  inflation so the bloom maps 1:1 onto the block. */
const GLOW_PAD_CELLS = 4;

/** Soft bloom behind the pixels — the whole block stamped tiny (one
 *  canvas px per cell, padding baked in), blurred once, upscaled with
 *  smoothing on at draw time. Regenerated only on relayout/accent
 *  change; per-frame cost is one drawImage. */
function buildGlow(layout: Layout, accent: string): HTMLCanvasElement {
  const { c, cells, block } = layout;
  const cols = Math.ceil(block.w / c) + GLOW_PAD_CELLS * 2;
  const rows = Math.ceil(block.h / c) + GLOW_PAD_CELLS * 2;
  const stamp = document.createElement("canvas");
  stamp.width = Math.max(1, cols);
  stamp.height = Math.max(1, rows);
  const sctx = stamp.getContext("2d")!;
  sctx.fillStyle = withAlpha(accent, 0.5);
  for (const cell of cells) {
    sctx.fillRect(
      (cell.x - block.x) / c + GLOW_PAD_CELLS,
      (cell.y - block.y) / c + GLOW_PAD_CELLS,
      1,
      1,
    );
  }
  // Blur pass — where unsupported, ctx.filter is ignored and the
  // bilinear upscale alone still reads as a (tighter) halo.
  const cv = document.createElement("canvas");
  cv.width = stamp.width;
  cv.height = stamp.height;
  const ctx = cv.getContext("2d")!;
  ctx.filter = "blur(1.4px)";
  ctx.drawImage(stamp, 0, 0);
  return cv;
}

export default function PixelWordmark({ powerOn }: { powerOn: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** null = already lit (repeat visit / reduced motion); a timestamp
   *  = the moment the first letter ignites. */
  const igniteAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!powerOn) return;
    igniteAtRef.current = performance.now() + IGNITE_DELAY;
  }, [powerOn]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!container || !canvas || !ctx) return;

    let disposed = false;
    let raf = 0;
    let words: WordSample[] | null = null;
    let layout: Layout | null = null;
    let glow: HTMLCanvasElement | null = null;
    let size = { w: 0, h: 0 };
    let accent = readAccent();
    let cursor: { x: number; y: number } | null = null;
    const blips = new Map<number, number>();
    const sparkles: Sparkle[] = [];
    const flicker = {
      letter: -1,
      start: 0,
      nextAt: performance.now() + FLICKER_MIN_WAIT,
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;

    const totalLetters = WORDS.join("").length;

    /** Ignition state of a letter at `now`: 0 = dark, 1 = flash, 2 = lit. */
    const letterPhase = (letter: number, now: number): 0 | 1 | 2 => {
      const at = igniteAtRef.current;
      if (at === null) return 2;
      const t = now - (at + letter * IGNITE_STAGGER);
      if (t < 0) return 0;
      if (t < IGNITE_FLASH) return 1;
      return 2;
    };

    const draw = (now: number) => {
      if (!layout) return;
      const { c, cells, block } = layout;
      ctx.clearRect(0, 0, size.w, size.h);

      // Bloom, scaled by how much of the sign is lit so the glow
      // warms up with the ignition.
      if (glow) {
        let litFrac = 1;
        const at = igniteAtRef.current;
        if (at !== null) {
          litFrac = clamp(
            (now - at) / (totalLetters * IGNITE_STAGGER + IGNITE_FLASH),
            0,
            1,
          );
        }
        if (litFrac > 0) {
          const pad = c * GLOW_PAD_CELLS;
          ctx.globalAlpha = 0.45 * litFrac;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            glow,
            block.x - pad,
            block.y - pad,
            block.w + pad * 2,
            block.h + pad * 2,
          );
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = 1;
        }
      }

      // Tired-neon flicker scheduling — only once fully ignited.
      let flickerAlpha = 1;
      if (!reduced) {
        if (flicker.letter >= 0) {
          const elapsed = now - flicker.start;
          const step = Math.floor(elapsed / FLICKER_STEP_MS);
          if (step >= FLICKER_STEPS.length) {
            flicker.letter = -1;
            flicker.nextAt =
              now + FLICKER_MIN_WAIT + Math.random() * FLICKER_EXTRA_WAIT;
          } else {
            flickerAlpha = FLICKER_STEPS[step];
          }
        } else if (
          now > flicker.nextAt &&
          letterPhase(totalLetters - 1, now) === 2
        ) {
          flicker.letter = Math.floor(Math.random() * totalLetters);
          flicker.start = now;
        }
      }

      for (const cell of cells) {
        const phase = letterPhase(cell.letter, now);
        if (phase === 0) {
          // Unlit phosphor — the sign's glass, barely there.
          ctx.fillStyle = withAlpha(INK_HEX, 0.07);
          ctx.fillRect(cell.x, cell.y, c, c);
          continue;
        }

        // Cursor shove — spring toward a pushed-away target, render
        // snapped to whole cells so pixels jump tracks.
        if (!reduced) {
          let tx = 0;
          let ty = 0;
          if (cursor) {
            const dx = cell.x + c / 2 - cursor.x;
            const dy = cell.y + c / 2 - cursor.y;
            const d = Math.hypot(dx, dy);
            if (d < PUSH_RADIUS && d > 0.01) {
              const f = ((PUSH_RADIUS - d) / PUSH_RADIUS) * PUSH_CELLS * c;
              tx = (dx / d) * f;
              ty = (dy / d) * f;
            }
          }
          cell.vx += (tx - cell.ox) * 0.18;
          cell.vy += (ty - cell.oy) * 0.18;
          cell.vx *= 0.72;
          cell.vy *= 0.72;
          cell.ox += cell.vx;
          cell.oy += cell.vy;
        }
        const sx = cell.x + Math.round(cell.ox / c) * c;
        let sy = cell.y + Math.round(cell.oy / c) * c;

        // Click blip — flash + one-cell hop.
        let blipFlash = false;
        const blipStart = blips.get(cell.letter);
        if (blipStart !== undefined) {
          const bt = now - blipStart;
          if (bt >= BLIP_MS) {
            blips.delete(cell.letter);
          } else {
            if (bt < 80) blipFlash = true;
            if (bt > 40 && bt < 180) sy -= c;
          }
        }

        if (phase === 1 || blipFlash) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = 1;
        } else {
          const shimmer = reduced
            ? 1
            : 0.91 +
              0.09 * Math.sin(now * 0.0011 + cell.hash * Math.PI * 2);
          ctx.fillStyle = INK_HEX;
          ctx.globalAlpha =
            shimmer * (flicker.letter === cell.letter ? flickerAlpha : 1);
        }
        ctx.fillRect(sx, sy, c, c);
        ctx.globalAlpha = 1;
      }

      // Sparkles from blips.
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.04;
        s.life -= 0.045;
        if (s.life <= 0) {
          sparkles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x, s.y, 3, 3);
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      draw(performance.now());
      raf = requestAnimationFrame(loop);
    };

    const startOrRedrawStatic = () => {
      cancelAnimationFrame(raf);
      if (reduced) {
        draw(performance.now());
      } else {
        raf = requestAnimationFrame(loop);
      }
    };

    const relayout = () => {
      if (!words || size.w === 0) return;
      layout = buildLayout(words, size.w, size.h);
      glow = buildGlow(layout, accent);
      setWordmark(layout.block, layout.letterRects);
      // HomeShell parks the attract hint just under the marquee.
      window.dispatchEvent(
        new CustomEvent("hugoslekstuga:wordmark-layout", {
          detail: { bottom: layout.block.y + layout.block.h },
        }),
      );
      startOrRedrawStatic();
    };

    const measure = () => {
      // offsetWidth/Height, never gBCR — the CRT power-on scales an
      // ancestor right as the first ResizeObserver callback lands.
      size = { w: container.offsetWidth, h: container.offsetHeight };
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      relayout();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    measure();

    sampleWordmark().then((sampled) => {
      if (disposed) return;
      words = sampled;
      relayout();
    });

    const onMqChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced) igniteAtRef.current = null;
      startOrRedrawStatic();
    };
    mq.addEventListener("change", onMqChange);

    const unsubAccent = subscribeAccent(() => {
      accent = readAccent();
      if (layout) glow = buildGlow(layout, accent);
      if (reduced) draw(performance.now());
    });

    const onPointerMove = (e: PointerEvent) => {
      cursor = { x: e.clientX, y: e.clientY };
    };
    const onPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) cursor = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!layout) return;
      for (const l of layout.letterRects) {
        if (
          e.clientX >= l.x - 6 &&
          e.clientX <= l.x + l.w + 6 &&
          e.clientY >= l.y - 6 &&
          e.clientY <= l.y + l.h + 6
        ) {
          if (reduced) return;
          blips.set(l.index, performance.now());
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 0.8 + Math.random() * 1.4;
            sparkles.push({
              x: l.x + l.w / 2,
              y: l.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp - 1,
              life: 0.9,
              color: Math.random() < 0.5 ? accent : INK_HEX,
            });
          }
          break;
        }
      }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", onMqChange);
      unsubAccent();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointerdown", onPointerDown);
      setWordmark(null);
      window.dispatchEvent(
        new CustomEvent("hugoslekstuga:wordmark-layout", { detail: null }),
      );
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[5]"
      data-name="hugos-marquee"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
