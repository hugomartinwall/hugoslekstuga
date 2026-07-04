/**
 * Hugo's parkour — canvas painters.
 *
 * Pure draw functions; the component owns the canvas, the camera, and
 * the loop. Everything here paints in world coordinates and assumes
 * the caller has already applied any world→screen transform.
 */

import { COLOR_HEX, CREAM_HEX } from "@/lib/colors";
import { drawCabinet, pixelDisc, withAlpha } from "@/lib/hugo/sprite";
import { moverPos, type Level } from "./level";

/** Label ink for canvas captions — matches the map labels. */
export const INKISH = "#e8f2e9";

export const BEAM_STEPS = 26;

/** A goal monument: a humming neon sign the marquee out front would
 *  respect. Reads its words and colour from the level's goal (LIVE
 *  FOREVER in mint at the true ending; NEXT LEVEL in magenta at a
 *  level boundary). Glow pulses slowly (static under reduced
 *  motion), stray sparkle pixels drift off the top. */
export function drawGoal(
  ctx: CanvasRenderingContext2D,
  goal: {
    x: number;
    y: number;
    w: number;
    h: number;
    big: string;
    small: string;
    color: keyof typeof COLOR_HEX;
  },
  tick: number,
  animate: boolean,
): void {
  const hex = COLOR_HEX[goal.color];
  const cx = goal.x + goal.w / 2;
  const cy = goal.y + goal.h / 2 - 8;
  const pulse = animate ? 0.3 + 0.1 * Math.sin(tick / 24) : 0.35;

  // Halo.
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 130);
  glow.addColorStop(0, withAlpha(hex, pulse));
  glow.addColorStop(1, withAlpha(hex, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 130, cy - 130, 260, 260);

  // Plinth — it stands on the roof like furniture, not UI.
  ctx.fillStyle = "#10131f";
  ctx.fillRect(cx - 22, goal.y + goal.h - 26, 44, 26);
  ctx.fillStyle = withAlpha(INKISH, 0.2);
  ctx.fillRect(cx - 22, goal.y + goal.h - 26, 44, 2);

  // Sign panel: dark glass in an accent frame.
  const pw = goal.w;
  const ph = goal.h - 26;
  ctx.fillStyle = hex;
  ctx.fillRect(goal.x, goal.y, pw, ph);
  ctx.fillStyle = "#07080f";
  ctx.fillRect(goal.x + 4, goal.y + 4, pw - 8, ph - 8);

  // The words, quantized phosphor. Big on top, small wide beneath.
  const flick = animate && (tick >> 2) % 32 === 0 ? 0.55 : 1;
  const bigW = pixelTextWidth(goal.big, 5);
  const smallW = pixelTextWidth(goal.small, 3);
  pixelText(ctx, goal.big, cx - bigW / 2, goal.y + 14, 5, withAlpha(hex, flick));
  pixelText(ctx, goal.small, cx - smallW / 2, goal.y + 46, 3, withAlpha(hex, 0.85 * flick));

  // Stray sparkles drifting off the sign.
  if (animate) {
    ctx.fillStyle = withAlpha(hex, 0.7);
    for (let i = 0; i < 3; i++) {
      const t = (tick / 3 + i * 47) % 90;
      const sx = cx - 40 + ((i * 53 + 13) % 80);
      const sy = goal.y - 6 - t * 0.6;
      if (t < 60) ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
    }
  }
}

/* ── pixel text ─────────────────────────────────────────────────────
 * A hand-rolled 3×5 cap font drawn as rects, so canvas labels match
 * the marquee's quantised-phosphor look without touching ctx.font
 * (which can't read the CSS font variables anyway). */

const GLYPHS: Record<string, number[]> = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  "2": [0b110, 0b001, 0b010, 0b100, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b011],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  " ": [0, 0, 0, 0, 0],
};

/** Width in px of pixelText at a given cell size. */
export function pixelTextWidth(text: string, cell: number): number {
  return text.length * 4 * cell - cell;
}

/** Draw 3×5 pixel caps, top-left anchored. Unknown chars are blank. */
export function pixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  cell: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const rows = GLYPHS[text[i].toUpperCase()] ?? GLYPHS[" "];
    const gx = x + i * 4 * cell;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (rows[r] & (0b100 >> c)) {
          ctx.fillRect(gx + c * cell, y + r * cell, cell, cell);
        }
      }
    }
  }
}

/* ── the backdrop + screen-0 replicas ───────────────────────────────
 * The game canvas floats transparently over the homepage DOM. As Hugo
 * nears screen 0's right edge, the canvas fades in an opaque
 * room-dark backdrop and paints replicas of the orbs/letters at the
 * SAME coordinates the collision uses — the room hands itself over to
 * the canvas with no visible seam, and then the camera is free. */

/** The Bayer dither from globals.css `--dither`, as a canvas pattern:
 *  8×8 tile, ink pixels at 4.5%. Built once per run. */
export function makeDither(
  ctx: CanvasRenderingContext2D,
): CanvasPattern | null {
  const tile = document.createElement("canvas");
  tile.width = 8;
  tile.height = 8;
  const tc = tile.getContext("2d");
  if (!tc) return null;
  tc.fillStyle = withAlpha(INKISH, 0.045);
  const dots: [number, number][] = [
    [0, 0], [2, 0], [4, 0], [2, 2], [6, 2],
    [0, 4], [4, 4], [6, 4], [2, 6], [6, 6],
  ];
  for (const [x, y] of dots) tc.fillRect(x, y, 1, 1);
  return ctx.createPattern(tile, "repeat");
}

/** Room-dark cover over the whole viewport (screen space — call it
 *  BEFORE the world transform), with the site's dither whisper and a
 *  faint phosphor floor line so the ground reads through the fade. */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  alpha: number,
  w: number,
  h: number,
  floorY: number,
  dither: CanvasPattern | null,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = CREAM_HEX;
  ctx.fillRect(0, 0, w, h);
  if (dither) {
    ctx.fillStyle = dither;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = withAlpha(INKISH, 0.16);
  ctx.fillRect(0, floorY, w, 2);
  ctx.restore();
}

export type OrbSnapshot = { slug: string; x: number; y: number; r: number };
export type LetterSnapshot = { x: number; y: number; w: number; h: number };

/** Canvas stand-ins for the homepage terrain while the backdrop hides
 *  the real DOM. Same coordinates as the collision surfaces, drawn as
 *  dim phosphor — the room going to sleep behind you. */
export function drawHomeReplicas(
  ctx: CanvasRenderingContext2D,
  alpha: number,
  orbs: OrbSnapshot[],
  letters: LetterSnapshot[],
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const o of orbs) {
    if (o.slug === "munch" || o.slug === "noodle") {
      drawCabinet(ctx, o.x, o.y, (o.r * 2) / 21, withAlpha(COLOR_HEX.pink, 0.55));
    } else {
      pixelDisc(ctx, o.x, o.y, o.r, withAlpha(INKISH, 0.28));
    }
  }
  ctx.fillStyle = withAlpha(INKISH, 0.22);
  for (const l of letters) {
    ctx.fillRect(l.x, l.y, l.w, l.h);
  }
  ctx.restore();
}

/* ── terrain ──────────────────────────────────────────────────────── */

const PANEL = "#10131f";
const PANEL_EDGE = "#1c2133";

/** One platform slab: dark panel, hairline sides, phosphor top lip. */
function slab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lip = 0.28,
): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PANEL_EDGE;
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = withAlpha(INKISH, lip);
  ctx.fillRect(x, y, w, 2);
}

/** The authored world's static terrain + dressing, in world coords.
 *  `viewX`/`viewW` clip drawing to the visible slice. */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  level: Level,
  tick: number,
  viewX: number,
  viewW: number,
  viewH: number,
  animate: boolean,
): void {
  const visible = (x: number, w: number) =>
    x + w > viewX - 40 && x < viewX + viewW + 40;

  // Dressing first — it all sits behind the platforms.
  for (const d of level.decos) {
    switch (d.kind) {
      case "girderline": {
        if (!visible(d.wx, d.w)) break;
        ctx.fillStyle = withAlpha(INKISH, 0.07);
        ctx.fillRect(d.wx, d.wy, d.w, 3);
        for (let x = d.wx; x < d.wx + d.w; x += 90) {
          ctx.fillRect(x, d.wy, 3, 26);
        }
        break;
      }
      case "signback": {
        if (!visible(d.wx, 620)) break;
        // The marquee seen from behind — mirrored, unlit, strutted.
        ctx.save();
        ctx.translate(d.wx + 310, 0);
        ctx.scale(-1, 1);
        pixelText(ctx, "HUGOS LEKSTUGA", -310, d.wy, 5, withAlpha(INKISH, 0.1));
        ctx.restore();
        ctx.fillStyle = withAlpha(INKISH, 0.06);
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(d.wx + 40 + i * 130, d.wy - 40, 4, 120);
        }
        break;
      }
      case "duct": {
        if (!visible(d.wx, d.w)) break;
        // Vent duct band along the ceiling line with slats.
        ctx.fillStyle = withAlpha("#2a3050", 0.35);
        ctx.fillRect(d.wx, d.wy, d.w, 26);
        ctx.fillStyle = withAlpha(INKISH, 0.05);
        for (let x = d.wx + 12; x < d.wx + d.w; x += 46) {
          ctx.fillRect(x, d.wy + 5, 24, 3);
          ctx.fillRect(x, d.wy + 13, 24, 3);
        }
        break;
      }
      case "fan": {
        if (!visible(d.wx - d.r, d.r * 2)) break;
        // A big idle exhaust fan down in the pit — dressing, not a
        // touch hazard (the pit itself is the danger).
        const spin = animate ? (tick / 24) % (Math.PI * 2) : 0.6;
        ctx.save();
        ctx.translate(d.wx, d.wy);
        ctx.rotate(spin);
        ctx.fillStyle = withAlpha("#5b657f", 0.5);
        for (let b = 0; b < 4; b++) {
          ctx.rotate(Math.PI / 2);
          ctx.fillRect(3, -4, d.r, 8);
        }
        ctx.restore();
        ctx.fillStyle = "#5b657f";
        ctx.fillRect(d.wx - 5, d.wy - 5, 10, 10);
        break;
      }
      case "skyline": {
        if (!visible(d.wx, d.w)) break;
        // Phosphor city, static — blocks with a few lit windows.
        const seed = 7;
        let x = d.wx;
        let i = 0;
        while (x < d.wx + d.w) {
          const bw = 70 + ((i * 37 + seed) % 60);
          const bh = 120 + ((i * 83 + seed * 13) % 180);
          ctx.fillStyle = "#0e1019";
          ctx.fillRect(x, viewH - 10 - bh, bw, bh);
          ctx.fillStyle = withAlpha(COLOR_HEX.yellow, 0.25);
          for (let wy = 0; wy < 3; wy++) {
            for (let wx2 = 0; wx2 < 2; wx2++) {
              if ((i + wy + wx2) % 3 === 0) {
                ctx.fillRect(
                  x + 14 + wx2 * 26,
                  viewH - 10 - bh + 18 + wy * 34,
                  6,
                  8,
                );
              }
            }
          }
          x += bw + 26;
          i += 1;
        }
        break;
      }
      case "deadcab": {
        if (!visible(d.wx - 40, 80)) break;
        // A dead cabinet slumped in the trench — dim, unclimbable.
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawCabinet(ctx, d.wx, d.wy - (21 * d.cell) / 2, d.cell, "#3a4060");
        ctx.restore();
        pixelText(
          ctx,
          d.slug,
          d.wx - pixelTextWidth(d.slug, 2) / 2,
          d.wy + 8,
          2,
          withAlpha(INKISH, 0.18),
        );
        break;
      }
      case "label": {
        if (!visible(d.wx, 120)) break;
        pixelText(
          ctx,
          d.text,
          d.wx - pixelTextWidth(d.text, 2) / 2,
          d.wy,
          2,
          withAlpha(COLOR_HEX[d.color], 0.5),
        );
        break;
      }
      case "streetlight": {
        if (!visible(d.wx - 90, 180)) break;
        // Pole, head, and a soft cone of acid light onto the street.
        const top = d.wy - 150;
        const pool = ctx.createRadialGradient(d.wx, d.wy, 4, d.wx, d.wy, 90);
        pool.addColorStop(0, withAlpha(COLOR_HEX.yellow, 0.09));
        pool.addColorStop(1, withAlpha(COLOR_HEX.yellow, 0));
        ctx.fillStyle = pool;
        ctx.fillRect(d.wx - 90, d.wy - 90, 180, 90);
        ctx.fillStyle = "#1c2133";
        ctx.fillRect(d.wx - 2, top, 4, 150);
        ctx.fillRect(d.wx - 2, top, 16, 4);
        ctx.fillStyle = withAlpha(COLOR_HEX.yellow, 0.85);
        ctx.fillRect(d.wx + 10, top + 4, 6, 4);
        break;
      }
      case "parkedcar": {
        if (!visible(d.wx - 50, 100)) break;
        // A sleeping car: dark slab, stepped roof, two dim windows.
        ctx.fillStyle = "#12141f";
        ctx.fillRect(d.wx - 46, d.wy - 22, 92, 22);
        ctx.fillRect(d.wx - 30, d.wy - 34, 56, 12);
        ctx.fillStyle = withAlpha(INKISH, 0.08);
        ctx.fillRect(d.wx - 24, d.wy - 31, 20, 8);
        ctx.fillRect(d.wx + 2, d.wy - 31, 18, 8);
        ctx.fillStyle = "#1e2136";
        ctx.fillRect(d.wx - 34, d.wy - 6, 12, 6);
        ctx.fillRect(d.wx + 22, d.wy - 6, 12, 6);
        break;
      }
      case "water": {
        if (!visible(d.wx, d.w)) break;
        // Black water in the pit: two rows of drifting wave dashes.
        const drift = animate ? (tick / 6) % 28 : 0;
        ctx.fillStyle = withAlpha(COLOR_HEX.blue, 0.22);
        for (let row = 0; row < 2; row++) {
          const wy = d.wy + 26 + row * 16;
          for (
            let x = d.wx - 28 + drift + row * 9;
            x < d.wx + d.w;
            x += 28
          ) {
            const seg = Math.min(12, d.wx + d.w - x);
            if (x >= d.wx && seg > 2) ctx.fillRect(x, wy, seg, 2);
          }
        }
        break;
      }
    }
  }

  // Ramps — pixel-staircase wedges with a phosphor lip along the
  // slope. Drawn with the floors (they're street furniture).
  for (const r of level.ramps) {
    if (!visible(r.wx, r.w)) continue;
    const steps = Math.max(3, Math.round(r.rise / 8));
    ctx.fillStyle = PANEL;
    for (let i = 1; i <= steps; i++) {
      const sw = (r.w / steps) * i;
      const sh = (r.rise / steps) * i;
      ctx.fillRect(r.wx + r.w - sw, r.baseY - sh, sw, sh);
    }
    ctx.fillStyle = withAlpha(COLOR_HEX.orange, 0.6);
    for (let i = 0; i < steps; i++) {
      ctx.fillRect(
        r.wx + (r.w / steps) * i,
        r.baseY - (r.rise / steps) * (i + 1),
        r.w / steps,
        2,
      );
    }
  }

  // Floor slabs — drop to the bottom of the view; the gaps between
  // them are the pits.
  for (const f of level.floorSpans) {
    if (!visible(f.x, f.w)) continue;
    slab(ctx, f.x, level.floorY, f.w, viewH - level.floorY + 4, 0.22);
  }

  // Static ledges/platforms (skip floors + cabinet tops — drawn
  // separately).
  for (const s of level.surfaces) {
    if (s.kind !== "rect") continue;
    if (s.id.startsWith("floor:") || s.id.startsWith("cab-")) continue;
    if (!visible(s.x, s.w)) continue;
    slab(ctx, s.x, s.y, s.w, 14);
  }

  // The graveyard climbing wall — stacks of retired cabinets, dark
  // screens flickering their old slugs.
  for (const c of level.cabinets) {
    const cw = 19 * CAB_DRAW_CELL;
    const ch = 21 * CAB_DRAW_CELL;
    if (!visible(c.wx - cw / 2, cw)) continue;
    for (let i = 0; i < c.stack; i++) {
      const cy = c.topY + ch / 2 + i * ch;
      drawCabinet(ctx, c.wx, cy, CAB_DRAW_CELL, "#4a5170");
      const slug = c.slugs[i] ?? "";
      const flicker = animate ? Math.sin(tick / 30 + c.wx + i * 7) > -0.6 : true;
      if (slug && flicker) {
        pixelText(
          ctx,
          slug,
          c.wx - pixelTextWidth(slug, 2) / 2,
          cy - 8,
          2,
          withAlpha(COLOR_HEX.purple, 0.5),
        );
      }
    }
    ctx.fillStyle = withAlpha(INKISH, 0.25);
    ctx.fillRect(c.wx - cw / 2, c.topY, cw, 2);
  }

  // Movers — same slab, amber lip, plus their rigging.
  for (const m of level.movers) {
    const p = moverPos(m, tick);
    if (!visible(p.x - m.w / 2, m.w)) continue;
    if (m.axis === "y") {
      // Cable / grate riggings hang from above.
      ctx.fillStyle = withAlpha(INKISH, 0.14);
      ctx.fillRect(p.x - 1, 0, 2, p.y);
    }
    slab(ctx, p.x - m.w / 2, p.y, m.w, 12, 0);
    ctx.fillStyle = withAlpha(COLOR_HEX.orange, 0.75);
    ctx.fillRect(p.x - m.w / 2, p.y, m.w, 2);
  }
}

const CAB_DRAW_CELL = 5; // must match level.ts CAB_CELL

/** The between-levels card: black overlay + "LEVEL 2 / THE RIDE
 *  HOME" in quantized phosphor, with the marquee's tired-neon
 *  flicker. Screen space — call it after the world transform is
 *  restored. `overlay` is the black alpha; `showCard` gates the
 *  words. */
export function drawLevelCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  overlay: number,
  showCard: boolean,
  tick: number,
  animate: boolean,
): void {
  if (overlay <= 0) return;
  ctx.save();
  ctx.globalAlpha = overlay;
  ctx.fillStyle = "#07080f";
  ctx.fillRect(0, 0, w, h);
  if (showCard) {
    const flick = animate && (tick >> 1) % 24 === 0 ? 0.5 : 1;
    const big = "LEVEL 2";
    const small = "THE RIDE HOME";
    const bigW = pixelTextWidth(big, 6);
    const smallW = pixelTextWidth(small, 3);
    pixelText(
      ctx,
      big,
      (w - bigW) / 2,
      h / 2 - 34,
      6,
      withAlpha(COLOR_HEX.green, flick),
    );
    pixelText(
      ctx,
      small,
      (w - smallW) / 2,
      h / 2 + 14,
      3,
      withAlpha(INKISH, 0.55 * flick),
    );
  }
  ctx.restore();
}

/** The moped's headlight — a soft wedge thrown forward onto the dark
 *  street, longer at speed so velocity is readable at a glance.
 *  World lighting, not part of the sprite. Under reduced motion the
 *  caller passes a fixed mid speed so the length doesn't animate. */
export function drawHeadlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  speed: number,
): void {
  const len = (120 + 22 * Math.abs(speed)) * facing;
  const grad = ctx.createLinearGradient(x, y, x + len, y);
  grad.addColorStop(0, withAlpha(COLOR_HEX.yellow, 0.12));
  grad.addColorStop(1, withAlpha(COLOR_HEX.yellow, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x + len, y - 16);
  ctx.lineTo(x + len, y + 22);
  ctx.lineTo(x, y + 5);
  ctx.closePath();
  ctx.fill();
}

/** Spawn beam — Hugo is beamed in: a thin phosphor column over the
 *  spawn point that flickers and fades while he drops out of it. The
 *  caller gates it on tick count and reduced motion. */
export function drawBeam(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  accent: string,
  tick: number,
): void {
  const fade = 1 - tick / BEAM_STEPS;
  const flicker = tick % 4 < 2 ? 1 : 0.55;
  const a = 0.4 * fade * flicker;
  ctx.fillStyle = withAlpha(accent, a);
  ctx.fillRect(x - 3, 0, 6, bottom);
  ctx.fillStyle = withAlpha(accent, a * 0.4);
  ctx.fillRect(x - 7, 0, 4, bottom);
  ctx.fillRect(x + 3, 0, 4, bottom);
}
