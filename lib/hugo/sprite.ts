import { COLOR_HEX, CREAM_HEX, INK_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";

/**
 * Hugo, the sprite — the canonical 16×16 pixel form of the character,
 * shared by every surface that draws him: the corner dot (BrandDot),
 * the flight renderer (TravelingDot), and page stages (HugoStage).
 * One sprite, one palette function, one draw call — so he is the same
 * creature at 36px in the corner and 120px on the Advice page.
 *
 * Ported from the winning Nattöppet lab prototype. The grid uses
 * palette indices: `.` transparent, `b` body (accent), `s` shade,
 * `h` highlight, `w` eye white. Eyes are 2-wide at cols 5–6 and 9–10,
 * rows 6–8; pupils are 1×2 drawn on top. Blinks are painted lids
 * (body colour over the whites with a shade seam), the authentic
 * sprite-sheet technique — no geometry changes.
 */

export const SPRITE_ROWS = [
  "................",
  "................",
  "................",
  "......bbbb......",
  "....bhhbbbbb....",
  "...bhbbbbbbbb...",
  "..bhbwwbbwwbbb..",
  ".bbbbwwbbwwbbbb.",
  ".bbbbwwbbwwbbss.",
  ".bbbbbbbbbbbbss.",
  ".bbbbbbssbbbbss.",
  ".bbbbbbbbbbbsss.",
  "..bbbbbbbbbbss..",
  "..sbbbbbbbbbbs..",
  "...ssssssssss...",
  "................",
];

export const SPRITE_SIZE = 16;

/** The nav dot's palette order — index-compatible with BrandDot's cycling. */
export const COLOR_ORDER: ToolColor[] = [
  "tomato",
  "blue",
  "yellow",
  "pink",
  "green",
  "purple",
  "orange",
  "teal",
];

const DOT_KEY = "hugoslekstuga:dot-color";

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(
  hex: string,
  to: [number, number, number],
  t: number,
): string {
  const f = hexRgb(hex);
  const c = f.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const ROOM_RGB = hexRgb(CREAM_HEX);
const INK_RGB = hexRgb(INK_HEX);

export type SpriteColors = {
  body: string;
  shade: string;
  highlight: string;
  white: string;
  pupil: string;
};

export function spriteColors(accent: string): SpriteColors {
  return {
    body: accent,
    shade: mixHex(accent, ROOM_RGB, 0.52),
    highlight: mixHex(accent, INK_RGB, 0.55),
    white: INK_HEX,
    pupil: CREAM_HEX,
  };
}

export type EyeState = {
  open: boolean;
  /** Widened eyes — an extra white row above (surprise/delight). */
  wide: boolean;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
};

export const DEFAULT_EYE_STATE: EyeState = {
  open: true,
  wide: false,
  dx: 0,
  dy: 0,
};

export type SpriteDrawOptions = {
  /** Centre of the sprite, in current ctx coordinates. */
  x: number;
  y: number;
  /** Device pixels per sprite cell. */
  px: number;
  accent: string;
  eye: EyeState;
  /** Alternating feet frame while walking; null hides feet. */
  feet?: 0 | 1 | null;
  /** Squash/stretch multipliers. Negative scaleX flips him. */
  scaleX?: number;
  scaleY?: number;
  /** Idle bob, in whole cells (0 or 1). */
  bobY?: number;
  /** When set, celebration pixels orbit the head (alternate by phase). */
  sparklePhase?: number | null;
};

/**
 * Draw Hugo. Pure — respects and restores the ctx transform. Callers
 * should have `imageSmoothingEnabled = false` on scaled canvases.
 */
export function drawHugoSprite(
  ctx: CanvasRenderingContext2D,
  o: SpriteDrawOptions,
) {
  const {
    x,
    y,
    px,
    accent,
    eye,
    feet = null,
    scaleX = 1,
    scaleY = 1,
    bobY = 0,
    sparklePhase = null,
  } = o;
  const colors = spriteColors(accent);
  const half = (SPRITE_SIZE / 2) * px;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-half, -half + bobY * px);

  // Body
  for (let r = 0; r < SPRITE_SIZE; r++) {
    const row = SPRITE_ROWS[r];
    for (let c = 0; c < SPRITE_SIZE; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      ctx.fillStyle =
        ch === "b"
          ? colors.body
          : ch === "s"
            ? colors.shade
            : ch === "h"
              ? colors.highlight
              : colors.white;
      ctx.fillRect(c * px, r * px, px, px);
    }
  }

  // Eyes — lids or pupils over the baked whites at cols 5/9, rows 6–8.
  if (!eye.open) {
    for (const ex of [5, 9]) {
      ctx.fillStyle = colors.body;
      ctx.fillRect(ex * px, 6 * px, 2 * px, 3 * px);
      ctx.fillStyle = colors.shade;
      ctx.fillRect(ex * px, 8 * px, 2 * px, px);
    }
  } else {
    if (eye.wide) {
      // One extra white row above each eye — the surprise take.
      ctx.fillStyle = colors.white;
      for (const ex of [5, 9]) {
        ctx.fillRect(ex * px, 5 * px, 2 * px, px);
      }
    }
    const pupilX = eye.dx === 1 ? 1 : 0;
    const pupilY = eye.dy === 1 ? 1 : 0;
    ctx.fillStyle = colors.pupil;
    for (const ex of [5, 9]) {
      ctx.fillRect((ex + pupilX) * px, (6 + pupilY) * px, px, 2 * px);
    }
  }

  // Feet — alternating shuffle while walking.
  if (feet !== null) {
    ctx.fillStyle = colors.shade;
    for (const fx of feet === 0 ? [4, 10] : [6, 9]) {
      ctx.fillRect(fx * px, 15 * px, 2 * px, px);
    }
  }

  // Celebration pixels orbiting the head.
  if (sparklePhase !== null) {
    ctx.fillStyle = colors.white;
    const spots =
      sparklePhase % 2 === 0
        ? [
            [2, 2],
            [13, 3],
            [1, 9],
            [14, 8],
          ]
        : [
            [3, 1],
            [12, 1],
            [0, 6],
            [15, 6],
          ];
    for (const [sx, sy] of spots) {
      ctx.fillRect(sx * px, sy * px, px, px);
    }
  }

  ctx.restore();
}

/** Chunky pixel-stepped disc for the attract-mode orbs (3px cells). */
export function pixelDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  hex: string,
  cell = 3,
) {
  ctx.fillStyle = hex;
  for (let yy = -r; yy < r; yy += cell) {
    const mid = yy + cell / 2;
    const d = r * r - mid * mid;
    if (d <= 0) continue;
    const half = Math.floor(Math.sqrt(d) / cell) * cell;
    if (half <= 0) continue;
    ctx.fillRect(cx - half, cy + yy, half * 2, cell);
  }
}

/** The persisted nav-dot colour — same character everywhere. */
export function readAccent(): string {
  try {
    const idx = Number(window.localStorage.getItem(DOT_KEY) ?? "0");
    const color =
      COLOR_ORDER[
        Number.isFinite(idx) && idx >= 0 && idx < COLOR_ORDER.length ? idx : 0
      ];
    return COLOR_HEX[color];
  } catch {
    return COLOR_HEX.tomato;
  }
}

/** Storage events double as cross-tab colour sync. */
export function subscribeAccent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Device-pixel canvas size for a target CSS size: a multiple of the
 * sprite grid so every cell lands on whole device pixels (crisp).
 */
export function spriteCanvasSize(cssSize: number, dpr: number): number {
  return Math.max(SPRITE_SIZE, Math.round((cssSize * dpr) / SPRITE_SIZE) * SPRITE_SIZE);
}
