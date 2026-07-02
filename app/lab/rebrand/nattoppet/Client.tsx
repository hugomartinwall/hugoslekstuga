"use client";

/**
 * NATTÖPPET — "phosphor arcade" rebrand prototype (direction 02 of 03).
 *
 * The lekstuga after dark: a tiny neighborhood arcade open all night.
 * Playdate hardware charm, PICO-8 discipline, Game Boy Color confidence —
 * explicitly not a terminal portfolio. Warm glowing machine in a dark room.
 *
 * Everything is scoped under `.skin-arc`: tokens, type, shape and shadow all
 * come from the inline skin CSS below, so the direction stands on its own
 * and borrows nothing from the house cream. Tailwind is used for pure
 * layout (flex/grid/gap/padding) only.
 *
 * SSR safety: all canvas/rAF/matchMedia work starts inside useEffect; the
 * one seeded RNG (mulberry32, fixed seed) keeps the attract-mode
 * composition deterministic.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Tokens (mirrored in the skin CSS below)                             */
/* ------------------------------------------------------------------ */

type Accent = { name: string; hex: string };

const ACCENTS: Accent[] = [
  { name: "mint", hex: "#3DF08A" },
  { name: "magenta", hex: "#FF4FD8" },
  { name: "cyan", hex: "#35E0FF" },
  { name: "amber", hex: "#FFB13D" },
  { name: "acid", hex: "#D8FF3D" },
  { name: "coral", hex: "#FF6E5E" },
  { name: "violet", hex: "#A78BFF" },
  { name: "ice", hex: "#8AF0FF" },
];

const SCREEN_BG = "#07080F";

/** Deterministic PRNG — fixed seeds keep server/client + reload stable. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mixHex(hex: string, to: [number, number, number], t: number): string {
  const f = hexRgb(hex);
  const c = f.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const keyVars = (name: string): CSSProperties =>
  ({
    "--ka": `var(--arc-${name})`,
    "--kg": `var(--arc-${name}-glow)`,
  }) as CSSProperties;

/* ------------------------------------------------------------------ */
/* Hugo the sprite — 16×16 palette-index art                           */
/* ------------------------------------------------------------------ */

// . transparent · b body · s shade · h highlight · w eye white
// Eyes: 2×3 blocks at cols 5–6 and 9–10, rows 6–8 (pupils drawn on top).
// SPRITE-BEGIN
const SPRITE = [
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
// SPRITE-END

type SpriteOpts = {
  blink: boolean;
  pupil: { x: 0 | 1; y: 0 | 1 };
  feet: 0 | 1 | null;
};

function drawSprite(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  s: number,
  accent: Accent,
  o: SpriteOpts,
) {
  const colors: Record<string, string> = {
    b: accent.hex,
    s: mixHex(accent.hex, [10, 11, 20], 0.52),
    h: mixHex(accent.hex, [232, 242, 233], 0.55),
    w: "#E8F2E9",
  };
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const ch = SPRITE[r][c];
      if (ch === ".") continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(px + c * s, py + r * s, s, s);
    }
  }
  if (o.blink) {
    // lids: body over the whites, a shade seam on the bottom row
    for (const ex of [5, 9]) {
      ctx.fillStyle = colors.b;
      ctx.fillRect(px + ex * s, py + 6 * s, 2 * s, 3 * s);
      ctx.fillStyle = colors.s;
      ctx.fillRect(px + ex * s, py + 8 * s, 2 * s, s);
    }
  } else {
    ctx.fillStyle = "#0B0C14";
    for (const ex of [5, 9]) {
      ctx.fillRect(px + (ex + o.pupil.x) * s, py + (6 + o.pupil.y) * s, s, 2 * s);
    }
  }
  if (o.feet !== null) {
    ctx.fillStyle = colors.s;
    for (const fx of o.feet === 0 ? [4, 10] : [6, 9]) {
      ctx.fillRect(px + fx * s, py + 15 * s, 2 * s, s);
    }
  }
}

/** Chunky pixel-stepped disc for the attract-mode orbs. */
function pixelDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  hex: string,
) {
  const cell = 3;
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

/** Tiny cabinet in the attract-mode corner, mini-Hugo idling on top. */
function drawMiniCabinet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bob: 0 | 1,
) {
  const s = 2;
  const cw = 19 * s;
  const ch = 21 * s;
  const x = w - cw - 22;
  const y = h - ch - 18;
  ctx.fillStyle = "#1E2136";
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = "#12141F";
  ctx.fillRect(x + cw - 2 * s, y, 2 * s, ch);
  ctx.fillStyle = "#FFB13D";
  ctx.fillRect(x + s, y + s, cw - 2 * s, 2 * s);
  ctx.fillStyle = SCREEN_BG;
  ctx.fillRect(x + 2 * s, y + 4 * s, cw - 4 * s, 8 * s);
  ctx.fillStyle = "rgba(61,240,138,0.2)";
  ctx.fillRect(x + 3 * s, y + 5 * s, cw - 6 * s, 6 * s);
  ctx.fillStyle = "#3DF08A";
  ctx.fillRect(x + 5 * s, y + 7 * s, 2 * s, 2 * s);
  ctx.fillRect(x + 11 * s, y + 8 * s, 2 * s, 2 * s);
  ctx.fillStyle = "#262B47";
  ctx.fillRect(x + s, y + 13 * s, cw - 2 * s, 2 * s);
  ctx.fillStyle = "#FF4FD8";
  ctx.fillRect(x + 4 * s, y + 13 * s + 1, s, s);
  ctx.fillStyle = "#35E0FF";
  ctx.fillRect(x + 7 * s, y + 13 * s + 1, s, s);
  drawSprite(ctx, x + Math.round((cw - 32) / 2), y - 30 + bob * 2, 2, ACCENTS[0], {
    blink: false,
    pupil: { x: 0, y: 1 },
    feet: null,
  });
}

/* ------------------------------------------------------------------ */
/* Skin CSS — every selector prefixed .skin-arc, keyframes arc-*        */
/* ------------------------------------------------------------------ */

const css = `
.skin-arc {
  /* room */
  --arc-room: #0B0C14;
  --arc-cab: #151726;
  --arc-panel: #1E2136;
  --arc-text: #E8F2E9;
  --arc-muted: #8E97A8;
  --arc-line: rgba(232, 242, 233, 0.16);

  /* accents + glow companions (same hue, ~20% alpha, bloom duty only) */
  --arc-mint: #3DF08A;    --arc-mint-glow: rgba(61, 240, 138, 0.2);
  --arc-magenta: #FF4FD8; --arc-magenta-glow: rgba(255, 79, 216, 0.2);
  --arc-cyan: #35E0FF;    --arc-cyan-glow: rgba(53, 224, 255, 0.2);
  --arc-amber: #FFB13D;   --arc-amber-glow: rgba(255, 177, 61, 0.2);
  --arc-acid: #D8FF3D;    --arc-acid-glow: rgba(216, 255, 61, 0.2);
  --arc-coral: #FF6E5E;   --arc-coral-glow: rgba(255, 110, 94, 0.2);
  --arc-violet: #A78BFF;  --arc-violet-glow: rgba(167, 139, 255, 0.2);
  --arc-ice: #8AF0FF;     --arc-ice-glow: rgba(138, 240, 255, 0.2);

  /* stepped pixel corners — no border-radius anywhere in this room */
  --arc-notch: polygon(0 8px, 4px 8px, 4px 4px, 8px 4px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 4px, calc(100% - 4px) 4px, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 4px) calc(100% - 8px), calc(100% - 4px) calc(100% - 4px), calc(100% - 8px) calc(100% - 4px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 4px), 4px calc(100% - 4px), 4px calc(100% - 8px), 0 calc(100% - 8px));
  --arc-notch-sm: polygon(0 4px, 2px 4px, 2px 2px, 4px 2px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 2px, calc(100% - 2px) 2px, calc(100% - 2px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 2px) calc(100% - 4px), calc(100% - 2px) calc(100% - 2px), calc(100% - 4px) calc(100% - 2px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 2px), 2px calc(100% - 2px), 2px calc(100% - 4px), 0 calc(100% - 4px));

  /* 8×8 Bayer-cut dither, tiled */
  --arc-dither: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 0h1v1H0zM2 0h1v1H2zM4 0h1v1H4zM2 2h1v1H2zM6 2h1v1H6zM0 4h1v1H0zM4 4h1v1H4zM6 4h1v1H6zM2 6h1v1H2zM6 6h1v1H6z' fill='%23E8F2E9' fill-opacity='0.045'/%3E%3C/svg%3E");

  position: relative;
  isolation: isolate;
  overflow-x: clip;
  background-color: var(--arc-room);
  background-image: var(--arc-dither);
  color: var(--arc-text);
  font-family: var(--font-arc-body), "Courier New", monospace;
}

/* whisper-subtle scanlines over the whole room */
.skin-arc::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 30;
  pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(232, 242, 233, 0.02) 0 1px, transparent 1px 3px);
}

.skin-arc ::selection { background: var(--arc-magenta); color: var(--arc-room); }
.skin-arc :focus-visible { outline: 1px solid var(--arc-cyan); outline-offset: 3px; }

/* --- type roles (pixel + smooth never share a line) ----------------- */
.skin-arc .arc-kicker {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--arc-muted);
}
.skin-arc .arc-h1 {
  font-family: var(--font-arc-display), monospace;
  font-weight: 400;
  font-size: clamp(64px, 15vw, 150px);
  line-height: 0.85;
  letter-spacing: 0.01em;
  color: var(--arc-mint);
  text-shadow: 0 0 6px var(--arc-mint-glow), 0 0 22px var(--arc-mint-glow), 0 0 60px var(--arc-mint-glow);
}
.skin-arc .arc-lede {
  font-size: 14px;
  line-height: 1.75;
  color: var(--arc-muted);
  max-width: 62ch;
}
.skin-arc .arc-display-xl {
  font-family: var(--font-arc-display), monospace;
  font-weight: 400;
  font-size: clamp(44px, 9vw, 88px);
  line-height: 0.88;
  color: var(--arc-text);
}
.skin-arc .arc-body {
  font-size: 14px;
  line-height: 1.75;
  color: var(--arc-text);
  max-width: 58ch;
}
.skin-arc .arc-body-dim { font-size: 13px; line-height: 1.7; color: var(--arc-muted); }
.skin-arc .arc-blurb { font-size: 13px; line-height: 1.7; color: var(--arc-muted); max-width: 56ch; }
.skin-arc .arc-label {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--arc-muted);
}
.skin-arc .arc-microcap {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--arc-muted);
}
.skin-arc .arc-sec-num {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--arc-muted);
}
.skin-arc .arc-sec-title {
  font-family: var(--font-arc-pixel), monospace;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--arc-text);
}
.skin-arc .arc-sec-line { height: 1px; background: var(--arc-line); }
.skin-arc .arc-card-title {
  font-family: var(--font-arc-display), monospace;
  font-weight: 400;
  font-size: 34px;
  line-height: 0.9;
  color: var(--arc-text);
}
.skin-arc .arc-card-title-xl {
  font-family: var(--font-arc-display), monospace;
  font-weight: 400;
  font-size: 58px;
  line-height: 0.85;
  color: var(--arc-text);
}
.skin-arc .arc-footline {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 9px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--arc-muted);
  text-align: center;
}

/* --- header trims ---------------------------------------------------- */
.skin-arc .arc-chip-open {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-arc-pixel), monospace;
  font-size: 9px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--arc-mint);
  background: var(--arc-cab);
  padding: 6px 10px;
  clip-path: var(--arc-notch-sm);
  box-shadow: inset 0 0 0 1px rgba(61, 240, 138, 0.28);
}
.skin-arc .arc-led { width: 6px; height: 6px; background: var(--arc-mint); }

/* --- accent chips ----------------------------------------------------- */
.skin-arc .arc-chip {
  --ca: var(--arc-mint);
  --cg: var(--arc-mint-glow);
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--arc-cab);
  padding: 10px 12px;
  clip-path: var(--arc-notch-sm);
  font-family: var(--font-arc-pixel), monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.skin-arc .arc-chip-swatch { width: 14px; height: 14px; flex: none; background: var(--ca); }
.skin-arc .arc-chip-name { color: var(--arc-text); }
.skin-arc .arc-chip-hex { color: var(--arc-muted); margin-left: auto; }
.skin-arc .arc-chip:hover .arc-chip-swatch {
  filter: drop-shadow(0 0 5px var(--cg)) drop-shadow(0 0 12px var(--cg));
}
.skin-arc .arc-chip:hover .arc-chip-name { color: var(--ca); }

/* --- keycaps ---------------------------------------------------------- */
.skin-arc .arc-key {
  --ka: var(--arc-mint);
  --kg: var(--arc-mint-glow);
  display: inline-block;
  border: 0;
  cursor: pointer;
  user-select: none;
  text-align: center;
  font-family: var(--font-arc-pixel), monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--arc-text);
  background: #262B47;
  padding: 11px 16px 15px;
  clip-path: var(--arc-notch-sm);
  box-shadow:
    inset 0 -4px 0 #0C0E1A,
    inset 0 2px 0 rgba(232, 242, 233, 0.09),
    inset 2px 0 0 rgba(232, 242, 233, 0.04),
    inset -2px 0 0 rgba(0, 0, 0, 0.35);
}
.skin-arc .arc-key:hover { color: var(--ka); }
.skin-arc .arc-key-hover { color: var(--ka); transform: translateY(-2px); }
.skin-arc .arc-key:active,
.skin-arc .arc-key-pressed {
  transform: translateY(2px);
  background: var(--ka);
  color: var(--arc-room);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35), inset 0 0 12px rgba(255, 255, 255, 0.28);
  filter: drop-shadow(0 0 8px var(--kg)) drop-shadow(0 0 20px var(--kg));
}
.skin-arc .arc-key-sm { font-size: 10px; padding: 9px 12px 12px; }
.skin-arc .arc-key-lg { font-size: 13px; padding: 14px 26px 18px; }
.skin-arc .arc-key-dim { color: var(--arc-muted); }
.skin-arc .arc-key-primary {
  color: var(--ka);
  box-shadow:
    inset 0 -4px 0 #0C0E1A,
    inset 0 2px 0 rgba(232, 242, 233, 0.09),
    inset 0 0 0 1px var(--ka);
}

/* --- input wells ------------------------------------------------------ */
.skin-arc .arc-well {
  display: block;
  width: 100%;
  border: 0;
  background-color: ${SCREEN_BG};
  color: var(--arc-text);
  font-family: var(--font-arc-pixel), monospace;
  font-size: 12px;
  letter-spacing: 0.1em;
  padding: 13px 14px;
  clip-path: var(--arc-notch-sm);
  box-shadow:
    inset 0 3px 0 rgba(0, 0, 0, 0.7),
    inset 0 0 18px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(232, 242, 233, 0.07);
  caret-color: var(--arc-mint);
}
.skin-arc .arc-well::placeholder { color: rgba(142, 151, 168, 0.55); text-transform: uppercase; }
.skin-arc .arc-well:focus {
  outline: none;
  box-shadow:
    inset 0 3px 0 rgba(0, 0, 0, 0.7),
    inset 0 0 18px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px var(--arc-cyan);
  background-image: repeating-linear-gradient(to bottom, var(--arc-cyan-glow) 0 1px, transparent 1px 3px);
}
.skin-arc .arc-entry {
  text-transform: uppercase;
  color: var(--arc-mint);
  letter-spacing: 0.16em;
  font-size: 13px;
}
.skin-arc .arc-caret {
  display: inline-block;
  width: 0.55em;
  height: 1em;
  margin-left: 7px;
  vertical-align: -0.12em;
  background: var(--arc-mint);
}

/* --- raised panels ------------------------------------------------------
   Two-layer pixel border: outer paints the 1px phosphor frame, inner
   paints the cabinet surface; both share the notched clip. Hover snaps
   the frame to the accent and blooms (drop-shadow follows the clip). */
.skin-arc .arc-panel {
  --pa: var(--arc-mint);
  --pg: var(--arc-mint-glow);
  background: var(--arc-line);
  padding: 1px;
  clip-path: var(--arc-notch);
}
.skin-arc .arc-panel > .arc-panel-in {
  height: 100%;
  background-color: var(--arc-cab);
  background-image: var(--arc-dither);
  clip-path: var(--arc-notch);
  box-shadow: inset 0 0 34px var(--pg);
}
.skin-arc .arc-panel:hover {
  background: var(--pa);
  filter: drop-shadow(0 0 10px var(--pg));
}

/* --- focus cabinet ------------------------------------------------------ */
.skin-arc .arc-back {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--arc-muted);
}
.skin-arc .arc-timer {
  font-family: var(--font-arc-display), monospace;
  font-weight: 400;
  font-size: clamp(84px, 24vw, 132px);
  line-height: 0.85;
  letter-spacing: 0.03em;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--arc-mint);
  text-shadow: 0 0 8px var(--arc-mint-glow), 0 0 26px var(--arc-mint-glow), 0 0 64px var(--arc-mint-glow);
}
.skin-arc .arc-hiscore {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--arc-amber);
}
.skin-arc .arc-hiscore-row {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--arc-amber);
  border-top: 1px solid var(--arc-line);
  padding-top: 14px;
}

/* --- attract mode ------------------------------------------------------- */
.skin-arc .arc-screen {
  position: relative;
  height: min(60vh, 540px);
  background: ${SCREEN_BG};
  overflow: hidden;
  transform-origin: 50% 50%;
}
.skin-arc .arc-screen canvas { image-rendering: pixelated; }
.skin-arc .arc-labels { pointer-events: none; }
.skin-arc .arc-orb-label {
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(-300px, -300px);
  white-space: nowrap;
  will-change: transform;
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.skin-arc .arc-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-arc-pixel), monospace;
  font-size: 11px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--arc-text);
}

/* --- player character ----------------------------------------------------- */
.skin-arc .arc-stage {
  position: relative;
  display: block;
  cursor: pointer;
  background: ${SCREEN_BG};
}
.skin-arc .arc-stage-canvas {
  display: block;
  width: 100%;
  height: 176px;
  image-rendering: pixelated;
}
.skin-arc .arc-p1 {
  position: absolute;
  top: 10px;
  right: 12px;
  font-family: var(--font-arc-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--arc-muted);
}
.skin-arc .arc-stage:focus .arc-p1 {
  color: var(--arc-mint);
  text-shadow: 0 0 8px var(--arc-mint-glow);
}
.skin-arc .arc-suit {
  font-family: var(--font-arc-pixel), monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

/* --- motion: quantized, and only when welcome --------------------------- */
@media (prefers-reduced-motion: no-preference) {
  .skin-arc .arc-key:hover { animation: arc-hop 0.22s steps(2, jump-none) 1; }
  .skin-arc .arc-caret { animation: arc-blink 1s steps(1, end) infinite; }
  .skin-arc .arc-hint { animation: arc-blink 1.4s steps(1, end) infinite; }
  .skin-arc .arc-led { animation: arc-blink 2.2s steps(1, end) infinite; }
  .skin-arc .arc-well:focus { animation: arc-crawl 0.5s steps(3) infinite; }
  .skin-arc .arc-on { animation: arc-poweron 0.34s steps(5, jump-none) both; }
}
@keyframes arc-hop {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes arc-blink {
  0% { opacity: 1; }
  50% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes arc-crawl {
  to { background-position: 0 3px; }
}
@keyframes arc-poweron {
  0% { transform: scaleY(0.02); filter: brightness(4); }
  45% { transform: scaleY(0.02); filter: brightness(6); }
  65% { transform: scaleY(1); filter: brightness(1.6); }
  80% { transform: scaleY(1); filter: brightness(1); opacity: 0.35; }
  100% { transform: scaleY(1); filter: brightness(1); opacity: 1; }
}
`;

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                  */
/* ------------------------------------------------------------------ */

function SectionHead({
  n,
  title,
  blurb,
}: {
  n: string;
  title: string;
  blurb?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <span className="arc-sec-num">{n}</span>
        <h2 className="arc-sec-title">{title}</h2>
        <span className="arc-sec-line flex-1" aria-hidden />
      </div>
      {blurb ? <p className="arc-blurb">{blurb}</p> : null}
    </div>
  );
}

function Panel({
  accent,
  className = "",
  children,
}: {
  accent: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`arc-panel ${className}`}
      style={
        {
          "--pa": `var(--arc-${accent})`,
          "--pg": `var(--arc-${accent}-glow)`,
        } as CSSProperties
      }
    >
      <div className="arc-panel-in">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 01 — Specimen strip                                                  */
/* ------------------------------------------------------------------ */

function LiveKey() {
  const [lit, setLit] = useState(false);
  return (
    <button
      type="button"
      className={`arc-key${lit ? " arc-key-pressed" : ""}`}
      style={keyVars("magenta")}
      aria-pressed={lit}
      onClick={() => setLit((v) => !v)}
    >
      P1 start
    </button>
  );
}

function Specimen() {
  return (
    <section className="flex flex-col gap-10">
      <SectionHead
        n="01"
        title="Specimen"
        blurb="Tokens, type, and controls — the parts every tool would be rebuilt from."
      />

      <div className="flex flex-col gap-3">
        <span className="arc-label">Palette</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCENTS.map((a) => (
            <div
              key={a.name}
              className="arc-chip"
              style={
                {
                  "--ca": `var(--arc-${a.name})`,
                  "--cg": `var(--arc-${a.name}-glow)`,
                } as CSSProperties
              }
            >
              <span className="arc-chip-swatch" aria-hidden />
              <span className="arc-chip-name">{a.name}</span>
              <span className="arc-chip-hex">{a.hex}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="arc-label">Type</span>
        <p className="arc-display-xl">Open all night</p>
        <p className="arc-body">
          Chivo Mono carries the body copy: quiet, technical, comfortable in
          the dark. Jersey 15 does the shouting. Silkscreen handles the small
          print. The three never share a line — that is the rule that keeps
          the room calm.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="arc-label">Keycaps</span>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col items-center gap-2">
            <span className="arc-key">Insert coin</span>
            <span className="arc-microcap">default</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="arc-key arc-key-hover">Insert coin</span>
            <span className="arc-microcap">hover</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="arc-key arc-key-pressed">Insert coin</span>
            <span className="arc-microcap">pressed</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <LiveKey />
            <span className="arc-microcap">live</span>
          </div>
        </div>
        <p className="arc-microcap">the fourth one is real. press it.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="arc-label" htmlFor="arc-demo-well">
            Input well
          </label>
          <input
            id="arc-demo-well"
            className="arc-well"
            placeholder="focus me — the scanlines crawl"
          />
        </div>
        <div className="flex flex-col gap-3">
          <span className="arc-label">Panel</span>
          <Panel accent="cyan">
            <div className="flex flex-col gap-2 p-5">
              <span className="arc-microcap">Cabinet 07</span>
              <span className="arc-card-title">Sudoku</span>
              <p className="arc-body-dim">
                Nine boxes. No mercy. The machine remembers your best run.
              </p>
              <span className="arc-hiscore">Hi-score 001337</span>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 02 — Attract mode (mini-homepage vignette)                           */
/* ------------------------------------------------------------------ */

const VIGNETTE_TOOLS: { name: string; accent: Accent }[] = [
  { name: "Advice", accent: ACCENTS[3] },
  { name: "Focus", accent: ACCENTS[0] },
  { name: "Roll", accent: ACCENTS[1] },
  { name: "Breathe", accent: ACCENTS[2] },
  { name: "Sudoku", accent: ACCENTS[6] },
  { name: "Sjökort", accent: ACCENTS[7] },
];

function AttractMode() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas ? canvas.getContext("2d") : null;
    if (!frame || !canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rng = mulberry32(0x0a11ca7);
    const orbs = VIGNETTE_TOOLS.map((tool) => {
      const angle = rng() * Math.PI * 2;
      const speed = 1.6 + rng() * 1.8; // px per 15fps tick
      return {
        tool,
        fx: 0.1 + rng() * 0.8,
        fy: 0.12 + rng() * 0.5,
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 8 + Math.round(rng() * 5),
      };
    });

    let w = 0;
    let h = 0;
    let frameCount = 0;

    const place = () => {
      for (const o of orbs) {
        o.x = o.fx * w;
        o.y = o.fy * h;
      }
    };

    const size = () => {
      w = frame.clientWidth;
      h = frame.clientHeight;
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = SCREEN_BG;
      ctx.fillRect(0, 0, w, h);
    };

    const update = () => {
      frameCount++;
      for (const o of orbs) {
        // gentle wander: rotate the heading a touch each tick
        const turn = (rng() - 0.5) * 0.24;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const vx = o.vx * cos - o.vy * sin;
        const vy = o.vx * sin + o.vy * cos;
        o.vx = vx;
        o.vy = vy;
        o.x += o.vx;
        o.y += o.vy;
        const m = o.r + 12;
        if (o.x < m) { o.x = m; o.vx = Math.abs(o.vx); }
        if (o.x > w - m) { o.x = w - m; o.vx = -Math.abs(o.vx); }
        if (o.y < m + 6) { o.y = m + 6; o.vy = Math.abs(o.vy); }
        if (o.y > h - m - 44) { o.y = h - m - 44; o.vy = -Math.abs(o.vy); }
      }
    };

    // Phosphor persistence: paint a translucent dark rect instead of
    // clearing, so anything that moves leaves a decaying trail.
    const paint = (withDecay: boolean) => {
      ctx.fillStyle = withDecay ? "rgba(7,8,15,0.24)" : SCREEN_BG;
      ctx.fillRect(0, 0, w, h);
      for (const o of orbs) {
        const qx = Math.round(o.x / 2) * 2;
        const qy = Math.round(o.y / 2) * 2;
        const glowR = o.r * 3.4;
        const grad = ctx.createRadialGradient(qx, qy, 1, qx, qy, glowR);
        grad.addColorStop(0, withAlpha(o.tool.accent.hex, 0.3));
        grad.addColorStop(1, withAlpha(o.tool.accent.hex, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(qx - glowR, qy - glowR, glowR * 2, glowR * 2);
        pixelDisc(ctx, qx, qy, o.r, o.tool.accent.hex);
        ctx.fillStyle = "rgba(244,255,246,0.9)";
        ctx.fillRect(qx - 3, qy - 3, 3, 3);
      }
      drawMiniCabinet(ctx, w, h, (Math.floor(frameCount / 7) % 2) as 0 | 1);
      for (let i = 0; i < orbs.length; i++) {
        const el = labelRefs.current[i];
        const o = orbs[i];
        if (el) {
          el.style.transform = `translate(${Math.round(o.x)}px, ${Math.round(
            o.y + o.r + 9,
          )}px) translateX(-50%)`;
        }
      }
    };

    size();
    place();
    paint(false);

    let raf = 0;
    let last = 0;
    let acc = 0;
    const STEP = 1000 / 15;
    const loop = (now: number) => {
      if (last === 0) last = now;
      acc += now - last;
      last = now;
      if (acc > STEP * 5) acc = STEP; // tab was hidden — don't fast-forward
      let n = 0;
      while (acc >= STEP && n < 4) {
        acc -= STEP;
        n++;
        update();
      }
      if (n > 0) paint(true);
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      if (frame.clientWidth === w && frame.clientHeight === h) return;
      size();
      place();
      if (reduced) paint(false);
    });
    ro.observe(frame);

    // CRT power-on, once, when the vignette scrolls into view.
    let io: IntersectionObserver | null = null;
    if (!reduced && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            frame.classList.add("arc-on");
            io?.disconnect();
          }
        },
        { threshold: 0.25 },
      );
      io.observe(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
    };
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <SectionHead
        n="02"
        title="Attract mode"
        blurb="The homepage, idling. Six machines glow in the dark and wait for a player."
      />
      <Panel accent="ice" className="w-full">
        <div ref={frameRef} className="arc-screen">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="arc-labels absolute inset-0" aria-hidden>
            {VIGNETTE_TOOLS.map((t, i) => (
              <span
                key={t.name}
                ref={(el) => {
                  labelRefs.current[i] = el;
                }}
                className="arc-orb-label"
                style={{ color: `var(--arc-${t.accent.name})` }}
              >
                {t.name}
              </span>
            ))}
          </div>
          <span className="arc-hint">Press any tool</span>
        </div>
      </Panel>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 03 — Focus, skinned (static mock, exact content)                     */
/* ------------------------------------------------------------------ */

function FocusCabinet() {
  return (
    <section className="flex flex-col gap-6">
      <SectionHead
        n="03"
        title="Focus, skinned"
        blurb="Same Focus content as the other two directions. Only the shell changes."
      />
      <Panel accent="mint" className="mx-auto w-full max-w-md">
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <span className="arc-back">← playhouse</span>
          <div className="flex flex-col gap-2">
            <h3 className="arc-card-title-xl">Focus</h3>
            <p className="arc-body-dim">Set an intention. Start the timer.</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="arc-label" id="arc-intention-label">
              Intention
            </span>
            <div className="arc-well arc-entry" aria-labelledby="arc-intention-label">
              write the newsletter
              <span className="arc-caret" aria-hidden />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="arc-key arc-key-sm">15 min</span>
            <span className="arc-key arc-key-sm arc-key-pressed" style={keyVars("mint")}>
              25 min
            </span>
            <span className="arc-key arc-key-sm">45 min</span>
          </div>
          <div className="arc-timer" aria-label="12 minutes 34 seconds remaining">
            12:34
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="arc-key arc-key-lg arc-key-primary" style={keyVars("mint")}>
              Start
            </span>
            <span className="arc-key arc-key-dim" style={keyVars("violet")}>
              Brown noise — off
            </span>
          </div>
          <div className="arc-hiscore-row">Today: 3 sessions · 75 min</div>
        </div>
      </Panel>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 04 — Player character (live mini-Hugo)                               */
/* ------------------------------------------------------------------ */

function PlayerCharacter() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const suitRef = useRef(0);
  const [suit, setSuit] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas ? canvas.getContext("2d") : null;
    if (!stage || !canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const CH = 176;
    const floorY = CH - 22;
    let w = 0;
    const st = { x: 48, jy: 0, vy: 0, grounded: true };
    const keys = { left: false, right: false };
    let jumpQueued = false;
    let pointer: { x: number; y: number } | null = null;
    let frameCount = 0;
    let blinkTicks = 0;
    let nextBlink = performance.now() + 2600 + Math.random() * 4000;
    let walkParity: 0 | 1 = 0;

    const size = () => {
      w = Math.max(240, canvas.clientWidth || stage.clientWidth);
      canvas.width = w;
      canvas.height = CH;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = SCREEN_BG;
      ctx.fillRect(0, 0, w, CH);
      st.x = Math.min(st.x, w - 68);
    };

    const paint = (withDecay: boolean) => {
      // phosphor persistence: decay, don't clear
      ctx.fillStyle = withDecay ? "rgba(7,8,15,0.3)" : SCREEN_BG;
      ctx.fillRect(0, 0, w, CH);
      ctx.fillStyle = "rgba(232,242,233,0.14)";
      ctx.fillRect(0, floorY + 1, w, 1);

      const accent = ACCENTS[suitRef.current];
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const walking = dir !== 0;
      const qx = Math.round(st.x / 4) * 4; // snapped to the 4px grid
      const qjy = Math.round(st.jy / 4) * 4;
      const feet: 0 | 1 | null = !st.grounded ? 0 : walking ? walkParity : null;
      const bob =
        !walking && st.grounded && Math.floor(frameCount / 7) % 2 === 1 ? 4 : 0;
      const py = floorY - 64 + (feet === null ? 4 : 0) + qjy + bob;

      const hx = qx + 32;
      const hy = py + 36;
      const grad = ctx.createRadialGradient(hx, hy, 2, hx, hy, 52);
      grad.addColorStop(0, withAlpha(accent.hex, 0.14));
      grad.addColorStop(1, withAlpha(accent.hex, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(hx - 52, hy - 52, 104, 104);

      let pupil: { x: 0 | 1; y: 0 | 1 } = { x: 0, y: 1 };
      if (walking) pupil = { x: dir > 0 ? 1 : 0, y: 1 };
      else if (pointer)
        pupil = { x: pointer.x >= hx ? 1 : 0, y: pointer.y >= py + 40 ? 1 : 0 };

      drawSprite(ctx, qx, py, 4, accent, {
        blink: !reduced && blinkTicks > 0,
        pupil,
        feet,
      });
    };

    const update = (now: number) => {
      frameCount++;
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir !== 0) {
        st.x = Math.min(Math.max(st.x + dir * 8, 4), w - 68);
        walkParity = (Math.floor(frameCount / 2) % 2) as 0 | 1;
      }
      if (jumpQueued) {
        if (st.grounded) {
          st.vy = -34;
          st.grounded = false;
        }
        jumpQueued = false;
      }
      if (!st.grounded) {
        st.vy += 9;
        st.jy += st.vy;
        if (st.jy >= 0) {
          st.jy = 0;
          st.vy = 0;
          st.grounded = true;
        }
      }
      if (blinkTicks > 0) blinkTicks--;
      else if (now >= nextBlink) {
        blinkTicks = 2;
        nextBlink = now + 2600 + Math.random() * 5000;
      }
    };

    size();
    paint(false);

    let raf = 0;
    let last = 0;
    let acc = 0;
    const STEP = 1000 / 15;
    const loop = (now: number) => {
      if (last === 0) last = now;
      acc += now - last;
      last = now;
      if (acc > STEP * 5) acc = STEP;
      let n = 0;
      while (acc >= STEP && n < 4) {
        acc -= STEP;
        n++;
        update(now);
      }
      if (n > 0) paint(true);
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) raf = requestAnimationFrame(loop);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp")
        return;
      e.preventDefault();
      if (reduced) {
        // no animation — instant repositioning only
        if (e.key === "ArrowLeft") st.x = Math.max(4, st.x - 16);
        if (e.key === "ArrowRight") st.x = Math.min(w - 68, st.x + 16);
        paint(false);
        return;
      }
      if (e.key === "ArrowLeft") keys.left = true;
      if (e.key === "ArrowRight") keys.right = true;
      if (e.key === "ArrowUp") jumpQueued = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") keys.left = false;
      if (e.key === "ArrowRight") keys.right = false;
    };
    const onBlur = () => {
      keys.left = false;
      keys.right = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (reduced) paint(false);
    };
    const onPointerLeave = () => {
      pointer = null;
    };
    const onClick = () => {
      stage.focus();
      const next = (suitRef.current + 1) % ACCENTS.length;
      suitRef.current = next;
      setSuit(next);
      if (reduced) paint(false);
    };

    stage.addEventListener("keydown", onKeyDown);
    stage.addEventListener("keyup", onKeyUp);
    stage.addEventListener("blur", onBlur);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerleave", onPointerLeave);
    stage.addEventListener("click", onClick);

    const ro = new ResizeObserver(() => {
      if ((canvas.clientWidth || stage.clientWidth) === w) return;
      size();
      if (reduced) paint(false);
    });
    ro.observe(stage);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener("keydown", onKeyDown);
      stage.removeEventListener("keyup", onKeyUp);
      stage.removeEventListener("blur", onBlur);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      stage.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <SectionHead
        n="04"
        title="Player character"
        blurb="Hugo after dark: sixteen pixels a side, palette-swapped through all eight accents."
      />
      <Panel accent="violet" className="w-full">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div
            ref={stageRef}
            tabIndex={0}
            role="application"
            aria-label="Mini Hugo. Click to focus, arrow keys to walk, up arrow to jump, click again to change his colour."
            className="arc-stage"
          >
            <canvas ref={canvasRef} className="arc-stage-canvas" />
            <span className="arc-p1" aria-hidden>
              P1
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="arc-microcap">
              click to focus. arrows to walk. he&apos;s the player character.
            </p>
            <span
              className="arc-suit"
              style={{ color: `var(--arc-${ACCENTS[suit].name})` }}
            >
              Suit: {ACCENTS[suit].name}
            </span>
          </div>
        </div>
      </Panel>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function Client() {
  return (
    <div className="skin-arc">
      <style>{css}</style>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-20 px-5 py-16 sm:px-8 sm:py-24">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="arc-kicker">Direction 02 · lab prototype</span>
            <span className="arc-chip-open">
              <span className="arc-led" aria-hidden />
              Open all night
            </span>
          </div>
          <h1 className="arc-h1">NATTÖPPET</h1>
          <p className="arc-lede">
            The lekstuga after dark — a neighborhood arcade that never closes.
            Warm phosphor in a dark room, motion snapped to a 15-frame grid,
            one glow at a time.
          </p>
        </header>

        <Specimen />
        <AttractMode />
        <FocusCabinet />
        <PlayerCharacter />

        <footer className="arc-footline">
          Nattöppet · direction 02 of 03 · lab only
        </footer>
      </div>
    </div>
  );
}
