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

/** Parse `#rrggbb` or `rgb(r, g, b)` — flight code lerps into rgb() strings. */
export function hexRgb(color: string): [number, number, number] {
  if (color.startsWith("rgb")) {
    const m = color.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return [255, 110, 94];
  }
  const n = parseInt(color.slice(1), 16);
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

/**
 * A mini arcade cabinet — how the games appear on the homepage map
 * (tools are orbs; games are machines you walk up to).
 * 19×21 cells, centred on (cx, cy). Ported from the lab prototype.
 */
export function drawCabinet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  accent: string,
) {
  const s = cell;
  const cw = 19 * s;
  const ch = 21 * s;
  const x = cx - cw / 2;
  const y = cy - ch / 2;
  // Body + right bezel shadow
  ctx.fillStyle = "#1e2136";
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = "#12141f";
  ctx.fillRect(x + cw - 2 * s, y, 2 * s, ch);
  // Marquee strip in the game's accent
  ctx.fillStyle = accent;
  ctx.fillRect(x + s, y + s, cw - 2 * s, 2 * s);
  // Screen: dark glass, accent glow, two "player" pixels
  ctx.fillStyle = "#07080f";
  ctx.fillRect(x + 2 * s, y + 4 * s, cw - 4 * s, 8 * s);
  ctx.fillStyle = withAlpha(accent, 0.2);
  ctx.fillRect(x + 3 * s, y + 5 * s, cw - 6 * s, 6 * s);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 5 * s, y + 7 * s, 2 * s, 2 * s);
  ctx.fillRect(x + 11 * s, y + 8 * s, 2 * s, 2 * s);
  // Control deck + two button LEDs
  ctx.fillStyle = "#262b47";
  ctx.fillRect(x + s, y + 13 * s, cw - 2 * s, 2 * s);
  ctx.fillStyle = "#ff4fd8";
  ctx.fillRect(x + 4 * s, y + 13 * s + 1, s, s);
  ctx.fillStyle = "#35e0ff";
  ctx.fillRect(x + 7 * s, y + 13 * s + 1, s, s);
}

/** Paints a cabinet's screen: `put` takes cells of the 30×16 screen grid. */
export type CabinetScreenPainter = (
  put: (x: number, y: number, w: number, h: number, color: string) => void,
) => void;

/** The big cabinet's grid, in units: 38 wide, 42 tall; the glass is the
 *  30×16 block at (4, 11). Mirrors CABINET_GRID_* in lib/home-layout.ts. */
const BIG_W = 38;
const BIG_H = 42;
const GLASS_X = 4;
const GLASS_Y = 11;
const GLASS_W = 30;
const GLASS_H = 16;

/**
 * The homepage's full-size arcade cabinet — the same machine as
 * `drawCabinet`, drawn on a finer 38×42 grid so it can carry a marquee
 * bevel, a bezel, a joystick and a coin door, and a screen that shows
 * its own game (`screen` paints into a 30×16 grid; see
 * lib/hugo/cabinet-screens.ts).
 *
 * Centred on (cx, cy); `unit` is canvas px per grid unit (3 → 114×126).
 * `lit` brightens the marquee for hover/focus. Pure.
 */
export function drawArcadeCabinet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  unit: number,
  accent: string,
  screen?: CabinetScreenPainter,
  lit = false,
) {
  const u = unit;
  const x0 = Math.round(cx - (BIG_W * u) / 2);
  const y0 = Math.round(cy - (BIG_H * u) / 2);
  const R = (gx: number, gy: number, gw: number, gh: number, color: string) => {
    ctx.fillStyle = color;
    // Edges are rounded to whole pixels so a fractional unit never
    // leaves a seam between neighbouring blocks.
    const x = Math.round(x0 + gx * u);
    const y = Math.round(y0 + gy * u);
    ctx.fillRect(
      x,
      y,
      Math.round(x0 + (gx + gw) * u) - x,
      Math.round(y0 + (gy + gh) * u) - y,
    );
  };
  // Body, with a lit left edge and a shaded right side.
  R(0, 0, BIG_W, BIG_H, "#1e2136");
  R(0, 0, 1, BIG_H, "#2a2f4d");
  R(BIG_W - 4, 0, 4, BIG_H, "#12141f");
  R(0, 0, BIG_W, 1, "#2a2f4d");
  // Marquee: the game family's colour, with a highlight along the top.
  R(2, 2, BIG_W - 6, 6, accent);
  R(2, 2, BIG_W - 6, 1, mixHex(accent, [255, 255, 255], lit ? 0.6 : 0.3));
  R(2, 7, BIG_W - 6, 1, mixHex(accent, [0, 0, 0], 0.35));
  // Bezel and glass.
  R(3, 10, GLASS_W + 2, GLASS_H + 2, "#0d0f1a");
  R(GLASS_X, GLASS_Y, GLASS_W, GLASS_H, "#07080f");
  if (screen) {
    screen((sx, sy, sw, sh, color) => {
      // Clip to the glass.
      const ax = Math.max(0, sx);
      const ay = Math.max(0, sy);
      const bx = Math.min(GLASS_W, sx + sw);
      const by = Math.min(GLASS_H, sy + sh);
      if (bx <= ax || by <= ay) return;
      R(GLASS_X + ax, GLASS_Y + ay, bx - ax, by - ay, color);
    });
  } else {
    R(GLASS_X + 1, GLASS_Y + 1, GLASS_W - 2, GLASS_H - 2, withAlpha(accent, 0.2));
    R(GLASS_X + 6, GLASS_Y + 5, 4, 4, accent);
    R(GLASS_X + 18, GLASS_Y + 7, 4, 4, accent);
  }
  // A sheen across the glass's top-left corner.
  R(GLASS_X, GLASS_Y, 9, 1, "rgba(232,242,233,0.10)");
  R(GLASS_X, GLASS_Y + 1, 5, 1, "rgba(232,242,233,0.07)");
  // Control deck: joystick, two buttons.
  R(1, 29, BIG_W - 5, 7, "#262b47");
  R(1, 29, BIG_W - 5, 1, "#343a5c");
  R(8, 31, 2, 3, "#e8f2e9");
  R(7, 30, 4, 2, "#ff6e5e");
  R(20, 32, 4, 2, "#ff4fd8");
  R(26, 32, 4, 2, "#35e0ff");
  // Coin door.
  R(13, 37, 9, 4, "#12141f");
  R(17, 38, 1, 2, "#d8ff3d");
}

export const ARCADE_CABINET_GLASS = {
  x: GLASS_X,
  y: GLASS_Y,
  w: GLASS_W,
  h: GLASS_H,
  gridW: BIG_W,
  gridH: BIG_H,
} as const;

export type MopedDrawOptions = {
  /** The player's centre (same anchor drawHugoSprite uses) — the
   *  moped hangs below it so the wheels meet the ground the physics
   *  stands on (centre + 8 cells). */
  x: number;
  y: number;
  /** Device pixels per cell — pass the same px as the rider. */
  px: number;
  accent: string;
  facing: 1 | -1;
  /** Alternating spoke frame while rolling. */
  wheelPhase: 0 | 1;
  /** -1 braking (nose dips), +1 accelerating (nose lifts). Integer
   *  cell offsets — never rotation, pixels stay crisp. */
  pitch: -1 | 0 | 1;
};

/**
 * Hugo's moped — level 2's ride. Dark frame with the rider's accent
 * as trim (same one-character rule as everything else: his colour
 * travels with him). Drawn facing right; `facing` mirrors.
 */
export function drawMoped(
  ctx: CanvasRenderingContext2D,
  o: MopedDrawOptions,
): void {
  const { x, y, px, accent, facing, wheelPhase, pitch } = o;
  const gy = y + 8 * px; // ground line under the player centre

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.translate(-x, -y);

  const tire = "#1e2136";
  const tireShade = "#12141f";
  const body = "#262b47";
  const lift = -pitch * px; // nose offset: +accel lifts, -brake dips

  const wheel = (cx: number, cy: number) => {
    // 6-cell pixel wheel: stepped rim + hub + one spoke pixel that
    // alternates with wheelPhase so rolling reads at a glance.
    ctx.fillStyle = tire;
    ctx.fillRect(cx - 3 * px, cy - 2 * px, 6 * px, 4 * px);
    ctx.fillRect(cx - 2 * px, cy - 3 * px, 4 * px, 6 * px);
    ctx.fillStyle = tireShade;
    ctx.fillRect(cx - 3 * px, cy + px, 6 * px, px);
    ctx.fillStyle = accent;
    ctx.fillRect(cx - px, cy - px, 2 * px, 2 * px); // hub
    ctx.fillStyle = "#e8f2e9";
    const s = wheelPhase === 0 ? [cx + px, cy - 2 * px] : [cx - 2 * px, cy + px];
    ctx.fillRect(s[0], s[1], px, px); // the spoke glint
  };

  // Rear wheel sits level; the front takes the pitch offset.
  wheel(x - 7 * px, gy - 3 * px);
  wheel(x + 7 * px, gy - 3 * px + lift);

  // Deck + engine block.
  const deckY = gy - 6 * px;
  ctx.fillStyle = body;
  ctx.fillRect(x - 6 * px, deckY, 12 * px, 2 * px);
  ctx.fillRect(x - 2 * px, deckY + 2 * px, 4 * px, 2 * px);
  ctx.fillStyle = accent;
  ctx.fillRect(x - 6 * px, deckY, 12 * px, px); // trim stripe

  // Seat (rear) — where Hugo sits.
  ctx.fillStyle = tire;
  ctx.fillRect(x - 5 * px, deckY - 2 * px, 4 * px, 2 * px);

  // Steering column + handlebar + headlight (front assembly, lifts
  // and dips with pitch).
  ctx.fillStyle = body;
  ctx.fillRect(x + 4 * px, deckY - px + lift, 2 * px, 3 * px);
  ctx.fillRect(x + 5 * px, deckY - 3 * px + lift, 2 * px, 3 * px);
  ctx.fillStyle = tire;
  ctx.fillRect(x + 4 * px, deckY - 4 * px + lift, 4 * px, px); // handlebar
  ctx.fillStyle = "#f6f1c5";
  ctx.fillRect(x + 7 * px, deckY - 3 * px + lift, px, px); // headlight

  ctx.restore();
}

/**
 * The composed rider: moped underneath, Hugo perched on the seat
 * (feet hidden — they're on the pegs). One entry point so the game
 * never assembles the pair by hand.
 */
export function drawMopedHugo(
  ctx: CanvasRenderingContext2D,
  o: MopedDrawOptions & Omit<SpriteDrawOptions, "x" | "y" | "px" | "accent">,
): void {
  drawMoped(ctx, o);
  drawHugoSprite(ctx, {
    x: o.x - 2 * o.px * o.facing,
    y: o.y - 4 * o.px + (o.pitch === 1 ? -o.px : 0),
    px: o.px,
    accent: o.accent,
    eye: o.eye,
    feet: null,
    scaleX: (o.scaleX ?? 1) * o.facing,
    scaleY: o.scaleY,
    sparklePhase: o.sparklePhase,
  });
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
