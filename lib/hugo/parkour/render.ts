/**
 * Hugo's parkour — canvas painters.
 *
 * Pure draw functions; the component owns the canvas, the camera, and
 * the loop. Everything here paints in world coordinates and assumes
 * the caller has already applied any world→screen transform.
 */

import { COLOR_HEX } from "@/lib/colors";
import { drawCabinet, withAlpha } from "@/lib/hugo/sprite";
import { moverPos, type Level } from "./level";

/** Label ink for canvas captions — matches the map labels. */
export const INKISH = "#e8f2e9";

export const DOOR_W = 26;
export const DOOR_H = 34;
export const BEAM_STEPS = 26;

/** The goal door: magenta frame, dark glass, mint knob, phosphor halo. */
export function drawDoor(
  ctx: CanvasRenderingContext2D,
  doorX: number,
  doorY: number,
): void {
  const doorGlow = ctx.createRadialGradient(
    doorX,
    doorY + DOOR_H / 2,
    2,
    doorX,
    doorY + DOOR_H / 2,
    70,
  );
  doorGlow.addColorStop(0, withAlpha(COLOR_HEX.pink, 0.35));
  doorGlow.addColorStop(1, withAlpha(COLOR_HEX.pink, 0));
  ctx.fillStyle = doorGlow;
  ctx.fillRect(doorX - 70, doorY + DOOR_H / 2 - 70, 140, 140);
  ctx.fillStyle = COLOR_HEX.pink;
  ctx.fillRect(doorX - DOOR_W / 2, doorY, DOOR_W, DOOR_H);
  ctx.fillStyle = "#07080f";
  ctx.fillRect(doorX - DOOR_W / 2 + 4, doorY + 4, DOOR_W - 8, DOOR_H - 8);
  ctx.fillStyle = COLOR_HEX.green;
  ctx.fillRect(doorX + DOOR_W / 2 - 9, doorY + DOOR_H / 2 - 2, 4, 4);
  ctx.fillStyle = INKISH;
  ctx.font = "9px var(--font-pixel), monospace";
  ctx.textAlign = "center";
  ctx.fillText("THE EXIT", doorX, doorY + DOOR_H + 14);
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
