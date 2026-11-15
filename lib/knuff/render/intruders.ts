/**
 * The intruders, the love heart's tile and their telegraphs (§5.1, §5.4,
 * §9.5, §10). Kind is told by outline first; colour only confirms it:
 *
 *   - a dust bunny is a fuzzy ash ball with two eyes; its tufts stir as it
 *     walks, and stop when it is dazed;
 *   - a runaway token is an acid ring with a hole, its rim notches turning
 *     as it rolls;
 *   - gum is a flat, wide magenta bar with a bitten edge and no eyes, lying
 *     on the floor; with one hit left it is split across;
 *   - a battery is a tall amber cell with a terminal and a bolt, flashing;
 *   - an envelope is a wide paper-white rectangle with its flap;
 *   - the money bag is a big mint sack with a knot and a dollar sign, and a
 *     row of squares across it counting its hits;
 *   - the love heart is a coral heart on a square tile with a phosphor
 *     frame, like every tile: square, never round.
 *
 * Each is a bitmap from render/sprites.ts, baked once (render/bake.ts) and
 * stamped. A thing only announced is a broken outline of its footprint in
 * its kind's colour (a token's with three squares the way it will roll).
 * None wears a ring: only he ever wears a white one.
 */
import { KINDS } from "../content/kinds";
import type { AimLine } from "../sim/aim";
import type { State, Thing, Tune } from "../sim/types";
import { bitmapWidth, outlineOf, type Bitmap, type Palette } from "./bake";
import { DAZE_MARKS } from "./layout";
import { C, mix, rgba } from "./palette";
import type { Paint } from "./renderer";
import { BAG_TOP, BATTERY, BUNNY, BUNNY_DAZED, DAZE_MARK, ENVELOPE, GUM, GUM_SPLIT, HEART_ICON, TOKEN, bagBitmap, tileBitmap } from "./sprites";

/** An envelope, in units (§5.1): a wide rectangle; it collides as a circle of radius 9. */
const ENV_W = 20;
const ENV_H = 14;
/** Gum's box and a battery's cell, in units (§5.1). The battery collides as a circle of radius 10. */
const GUM_W = 28;
const GUM_H = 12;
const CELL_W = 14;
const CELL_H = 22;
/** The terminal on top of the cell, u. */
const NUB_H = 3;
/** The love heart's tile, u (decision 9): square, so it is never taken for an intruder. */
const HEART_TILE = 28;

/** A colour moved toward phosphor: the thing the aim line ends on. */
const lit = (c: string) => mix(c, C.ink, 0.45);
/** The palette moved toward phosphor, but for the dark cells named in `keep` (eyes, bands, signs). */
function lighter(pal: Palette, keep = ""): Palette {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pal)) out[k] = keep.includes(k) ? v : lit(v);
  return out;
}

const PAL_BUNNY: Palette = { a: C.ash, l: mix(C.ash, C.ink, 0.45), d: mix(C.ash, C.page, 0.35), e: C.page };
const PAL_TOKEN: Palette = { k: C.acid, l: mix(C.acid, C.ink, 0.55), d: mix(C.acid, C.page, 0.3), n: mix(C.acid, C.page, 0.55) };
const PAL_GUM: Palette = { m: C.magenta, l: mix(C.magenta, C.ink, 0.4), d: mix(C.magenta, C.page, 0.35) };
const PAL_BATTERY: Palette = { b: C.amber, l: mix(C.amber, C.ink, 0.5), d: mix(C.amber, C.page, 0.3), k: mix(C.amber, C.page, 0.75) };
/** The battery's flash: the whole cell phosphor. */
const PAL_BATTERY_FLASH: Palette = { b: C.ink, l: C.ink, d: mix(C.ink, C.page, 0.2), k: mix(C.amber, C.page, 0.6) };
const PAL_ENVELOPE: Palette = { p: C.paper, f: mix(C.paper, C.page, 0.5), s: mix(C.paper, C.page, 0.25) };
const PAL_BAG: Palette = { g: C.mint, l: mix(C.mint, C.ink, 0.5), d: mix(C.mint, C.page, 0.3), k: mix(C.mint, C.page, 0.6) };
const PAL_MARK: Palette = { d: C.page, p: C.ink };
const PAL_HEART: Palette = { f: C.ink, i: C.page, x: C.coral };

const HEART_TILE_ROWS = tileBitmap(HEART_TILE, 2, HEART_ICON, 2);
const GUM_EDGE = outlineOf(GUM, "m");
const GUM_SPLIT_EDGE = outlineOf(GUM_SPLIT, "m");

/** Stamp a bitmap centred on (cx, cy), in units. */
function stampAt(p: Paint, key: string, rows: Bitmap, pal: Palette, cx: number, cy: number): void {
  p.stamp(key, rows, pal, cx - bitmapWidth(rows) / 2, cy - rows.length / 2);
}

/**
 * Draw with the floor as the clip: a blast's ring of 70 u round a battery
 * by a cushion would otherwise spill over the rail and out of the room,
 * where nothing can be reached.
 */
export function onFloor(p: Paint, s: State, draw: () => void): void {
  const x0 = Math.round(p.X(s.room.left));
  const y0 = Math.round(p.Y(s.room.top));
  p.ctx.save();
  p.ctx.beginPath();
  p.ctx.rect(x0, y0, Math.round(p.X(s.room.right)) - x0, Math.round(p.Y(s.room.bottom)) - y0);
  p.ctx.clip();
  draw();
  p.ctx.restore();
}

/** A rectangle in units, snapped to device pixels. */
function rect(p: Paint, x: number, y: number, w: number, h: number, color: string): void {
  const x0 = Math.round(p.X(x));
  const y0 = Math.round(p.Y(y));
  p.ctx.fillStyle = color;
  p.ctx.fillRect(x0, y0, Math.round(p.X(x + w)) - x0, Math.round(p.Y(y + h)) - y0);
}

/** A broken outline of a box centred on (cx, cy), in units: runs of 3 u with gaps of 2 u, 2 u thick. */
function brokenBox(p: Paint, cx: number, cy: number, w: number, h: number, color: string): void {
  const t = 2;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  for (let a = 0; a < w; a += 5) {
    const run = Math.min(3, w - a);
    rect(p, x0 + a, y0, run, t, color);
    rect(p, x0 + a, y0 + h - t, run, t, color);
  }
  for (let a = 0; a < h; a += 5) {
    const run = Math.min(3, h - a);
    rect(p, x0, y0 + a, t, run, color);
    rect(p, x0 + w - t, y0 + a, t, run, color);
  }
}

/** Three squares stepping off a token's body along (vx, vy), smaller as they go: the way it rolls. */
export function rollMarks(p: Paint, x: number, y: number, vx: number, vy: number, color: string): void {
  const v = Math.hypot(vx, vy);
  if (v <= 0) return;
  const dr = KINDS.token.radius;
  p.ctx.fillStyle = color;
  for (let i = 1; i <= 3; i++) {
    const q = Math.max(2, Math.round(p.S * (3.4 - i * 0.6)));
    const reach = dr + 1 + i * 5;
    p.ctx.fillRect(Math.round(p.X(x + (vx / v) * reach) - q / 2), Math.round(p.Y(y + (vy / v) * reach) - q / 2), q, q);
  }
}

/**
 * What is announced: the broken outline of what will land there, full
 * bright and steady (§3.3), in its kind's colour. A token's carries three
 * squares the way it will roll.
 */
export function drawTelegraph(p: Paint, d: Thing): void {
  const w = Math.max(2, Math.round(p.S * 2));
  switch (d.kind) {
    case "gum":
      brokenBox(p, d.x, d.y, GUM_W, GUM_H, C.magenta);
      return;
    case "battery":
      brokenBox(p, d.x, d.y + NUB_H / 2, CELL_W, CELL_H, C.amber);
      return;
    case "envelope":
      brokenBox(p, d.x, d.y, ENV_W, ENV_H, C.paper);
      return;
    case "heart":
      brokenBox(p, d.x, d.y, HEART_TILE, HEART_TILE, C.coral);
      return;
    case "bag":
      p.ring(p.X(d.x), p.Y(d.y), KINDS.bag.radius * p.S, C.mint, w);
      return;
    case "token":
      p.ring(p.X(d.x), p.Y(d.y), KINDS.token.radius * p.S, C.acid, w);
      rollMarks(p, d.x, d.y, d.vx, d.vy, C.acid);
      return;
    case "bunny":
      p.ring(p.X(d.x), p.Y(d.y), KINDS.bunny.radius * p.S, C.ash, w);
      return;
    default:
      return;
  }
}

/** The love heart, on the floor with the tiles: a coral heart on a square tile with a phosphor frame, and under it how long it stays. */
export function drawHeart(p: Paint, s: State, heartLife: number): void {
  for (const d of s.things) {
    if (d.kind !== "heart" || d.hp <= 0 || s.tick < d.landTick) continue;
    stampAt(p, "heart-tile", HEART_TILE_ROWS, PAL_HEART, d.x, d.y);
    // The time it has left, as a bar under the tile that empties: steady, never blinking.
    if (d.goneTick >= 0 && heartLife > 0) {
      const left = Math.max(0, Math.min(1, (d.goneTick - s.tick) / heartLife));
      const x0 = d.x - HEART_TILE / 2;
      rect(p, x0, d.y + HEART_TILE / 2 + 2, HEART_TILE, 2, rgba(C.ink, 0.22));
      rect(p, x0, d.y + HEART_TILE / 2 + 2, HEART_TILE * left, 2, C.coral);
    }
  }
}

/** Gum, on the floor under everything that moves (§9.9). */
export function drawGum(p: Paint, s: State, willHit: number): void {
  for (const d of s.things) {
    if (d.kind !== "gum" || d.hp <= 0 || s.tick < d.landTick) continue;
    const split = d.hp === 1;
    const hit = d.id === willHit;
    stampAt(p, `gum${split ? "-split" : ""}${hit ? "-hit" : ""}`, split ? GUM_SPLIT : GUM, hit ? lighter(PAL_GUM) : PAL_GUM, d.x, d.y);
  }
}

/**
 * Gum under a bunch shows only as two magenta stubs (the play check of
 * steps 4 and 5): where a body that is drawn over it overlaps it, its
 * bitten outline is drawn again over the bodies, so the bar is still read
 * under them. Its fill stays under them: 9.9 puts gum on the floor.
 */
export function drawGumEdges(p: Paint, s: State, bodies: readonly Thing[]): void {
  for (const g of s.things) {
    if (g.kind !== "gum" || g.hp <= 0 || s.tick < g.landTick) continue;
    let covered = false;
    for (const d of bodies) {
      const r = KINDS[d.kind].radius;
      if (Math.abs(d.x - g.x) < GUM_W / 2 + r && Math.abs(d.y - g.y) < GUM_H / 2 + r) {
        covered = true;
        break;
      }
    }
    if (!covered) continue;
    const split = g.hp === 1;
    stampAt(p, `gum-edge${split ? "-split" : ""}`, split ? GUM_SPLIT_EDGE : GUM_EDGE, { m: C.magenta }, g.x, g.y);
  }
}

/** Is a battery showing phosphor rather than amber on this tick? Every 20 ticks at first, every 6 in its last 120. */
export function flashOn(s: State, d: Thing, reduced: boolean): boolean {
  if (reduced || d.fuseTick < 0) return false;
  const left = d.fuseTick - s.tick;
  const period = left <= 120 ? 6 : 20;
  return Math.floor(left / period) % 2 === 1;
}

/**
 * One body in the room, at (x, y) as drawn between two ticks. `willHit`:
 * the aim line ends on it, and it is drawn a shade toward phosphor. Gum,
 * tiles and the love heart are floor, drawn elsewhere.
 */
export function drawBody(p: Paint, s: State, d: Thing, x: number, y: number, willHit: boolean, reduced: boolean, tune: Tune): void {
  const dazed = s.tick < d.dazedUntil;
  switch (d.kind) {
    case "bunny": {
      // Its tufts stir as it walks; still while dazed, and with reduced motion.
      const f = dazed || reduced ? 0 : Math.floor((s.tick + d.id * 7) / 10) % 2;
      const rows = dazed ? BUNNY_DAZED : BUNNY[f];
      stampAt(p, `bunny${dazed ? "-z" : f}${willHit ? "-hit" : ""}`, rows, willHit ? lighter(PAL_BUNNY, "e") : PAL_BUNNY, x, y);
      return;
    }
    case "token": {
      // Its rim notches turn as it rolls.
      const moving = !dazed && !reduced && (d.vx !== 0 || d.vy !== 0);
      const f = moving ? Math.floor((s.tick + d.id * 3) / 5) % 2 : 0;
      stampAt(p, `token${f}${willHit ? "-hit" : ""}`, TOKEN[f], willHit ? lighter(PAL_TOKEN) : PAL_TOKEN, x, y);
      return;
    }
    case "envelope":
      stampAt(p, `envelope${willHit ? "-hit" : ""}`, ENVELOPE, willHit ? lighter(PAL_ENVELOPE) : PAL_ENVELOPE, x, y);
      return;
    case "battery": {
      const flash = flashOn(s, d, reduced);
      const base = flash ? PAL_BATTERY_FLASH : PAL_BATTERY;
      // The cell and its terminal, 25 u tall, centred where its circle is.
      stampAt(p, `battery${flash ? "-on" : ""}${willHit ? "-hit" : ""}`, BATTERY, willHit ? lighter(base, "k") : base, x, y);
      return;
    }
    case "bag":
      drawBag(p, s, d, x, y, tune.bagHits, willHit);
      return;
    default:
      return;
  }
}

/**
 * The money bag: the sack, and across it, under its middle row (the daze
 * marks are on that row), a row of eight squares that counts its hits:
 * solid for each one left, hollow for each taken off.
 */
export function drawBag(p: Paint, s: State, d: Thing, x: number, y: number, hits: number, willHit: boolean): void {
  const rows = bagBitmap();
  const R = KINDS.bag.radius;
  p.stamp(`bag${willHit ? "-hit" : ""}`, rows, willHit ? lighter(PAL_BAG, "k") : PAL_BAG, x - R, y - R - BAG_TOP);
  const n = Math.max(1, hits);
  const w = n * 4 + (n - 1) * 2;
  const qx0 = Math.round(x - w / 2);
  const qy = Math.round(y + 8);
  const dark = C.page;
  for (let i = 0; i < n; i++) {
    const qx = qx0 + i * 6;
    if (i < d.hp) rect(p, qx, qy, 4, 4, dark);
    else {
      rect(p, qx, qy, 4, 1, dark);
      rect(p, qx, qy + 3, 4, 1, dark);
      rect(p, qx, qy, 1, 4, dark);
      rect(p, qx + 3, qy, 1, 4, dark);
    }
  }
}

/**
 * A dazed thing's marks (§9.5): two 3 × 3 u phosphor squares, 3 u apart,
 * on its middle row, where a dust bunny's eyes are. Each sits in a 1 u
 * room-dark frame, so it reads on every body: phosphor alone measured 1:1
 * against a token's acid (the step-1 check) and vanished on an envelope's
 * paper white.
 */
export function drawDazeMarks(p: Paint, x: number, y: number): void {
  for (const m of DAZE_MARKS) p.stamp("daze-mark", DAZE_MARK, PAL_MARK, x + m.x - 1, y + m.y - 1);
}

/** A token the money bag let out, gone: its ring, fading where it stood. */
export function drawTokenGhost(p: Paint, x: number, y: number, alpha: number): void {
  p.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  stampAt(p, "token0", TOKEN[0], PAL_TOKEN, x, y);
  p.ctx.globalAlpha = 1;
}

/**
 * Its blast's reach: drawn for its last 60 ticks, and from the moment he
 * knocks it. Amber where the blast cannot hurt him (his, or dazed: rule 9);
 * coral where it can, the colour its burst and the pad use for a heart, and
 * with squares twice the size while he stands landed inside it. A plain
 * amber ring read as an area, like the thump's, not as a danger (the play
 * check of steps 4 and 5). The ring is its timer: its gaps close as the
 * fuse runs down, and it is whole on the tick it goes off.
 */
export function drawBlastRings(p: Paint, s: State, tune: Tune, alpha: number): void {
  const w = Math.max(2, Math.round(p.S * 2));
  const h = s.him;
  onFloor(p, s, () => {
    for (const d of s.things) {
      if (d.kind !== "battery" || d.hp <= 0 || s.tick < d.landTick) continue;
      if (d.knockTick < 0 && d.fuseTick - s.tick > 60) continue;
      const x = d.px + (d.x - d.px) * alpha;
      const y = d.py + (d.y - d.py) * alpha;
      const harms = !d.mine && s.tick >= d.dazedUntil;
      const inside = harms && !h.hot && Math.hypot(h.x - d.x, h.y - d.y) <= tune.blastRadius;
      // From a quarter of the ring left out, 60 ticks (or a knock's 48) before, to none.
      const span = d.knockTick >= 0 ? tune.batteryKnockTicks : 60;
      const left = Math.max(0, Math.min(1, (d.fuseTick - s.tick) / Math.max(1, span)));
      p.ring(p.X(x), p.Y(y), tune.blastRadius * p.S, harms ? C.coral : rgba(C.amber, 0.8), inside ? w * 2 : w, 0.25 * left);
    }
  });
}

/** The battery's second line on the aim line (§4.2): its path from the knock, dotted, and the broken ring of its blast where it bursts. */
export function drawBatteryLine(p: Paint, s: State, line: AimLine, tune: Tune, col: string): void {
  const pts = line.battery;
  if (pts.length < 2) return;
  const q = Math.max(2, Math.round(p.dpr * 2.6));
  const gap = 7;
  let along = 0;
  let total = 0;
  p.ctx.fillStyle = col === C.ink ? C.amber : col;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const ay = pts[i - 1];
    const len = Math.hypot(pts[i] - ax, pts[i + 1] - ay);
    while (along <= total + len && len > 0) {
      const k = (along - total) / len;
      p.ctx.fillRect(Math.round(p.X(ax + (pts[i] - ax) * k) - q / 2), Math.round(p.Y(ay + (pts[i + 1] - ay) * k) - q / 2), q, q);
      along += gap;
    }
    total += len;
  }
  if (line.burst.length === 2) {
    const w = Math.max(2, Math.round(p.S * 2));
    onFloor(p, s, () => p.ring(p.X(line.burst[0]), p.Y(line.burst[1]), tune.blastRadius * p.S, col === C.ink ? C.amber : col, w));
  }
}
