/**
 * Gum and batteries on the canvas, drawn plainly (the art is step 6), and
 * told apart at a glance by outline: gum is a flat, wide magenta bar with a
 * striped edge and no eyes, lying on the floor; a battery is a tall amber
 * cell with a terminal on top. A thing only announced is a broken outline
 * of the same shape. Neither wears a ring: only he ever wears a white one.
 *
 * A battery flashes amber and phosphor, every 20 ticks at first and every
 * 6 in its last 120 (steady amber with reduced motion). Its blast is drawn
 * as a broken amber ring of `blastRadius` for its last 60 ticks, and from
 * the moment he knocks it.
 */
import type { AimLine } from "../sim/aim";
import type { State, Thing, Tune } from "../sim/types";
import type { Paint } from "./renderer";
import { C, mix, rgba } from "./palette";

/** Gum's box and a battery's cell, in units (§5.1). The battery collides as a circle of radius 10. */
const GUM_W = 28;
const GUM_H = 12;
const CELL_W = 14;
const CELL_H = 22;
/** The terminal on top of the cell, u. */
const NUB_W = 6;
const NUB_H = 3;

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

/** An announced piece of gum or battery: the broken outline of its footprint, full bright, steady. */
export function drawTelegraph(p: Paint, d: Thing): void {
  if (d.kind === "gum") brokenBox(p, d.x, d.y, GUM_W, GUM_H, C.magenta);
  else if (d.kind === "battery") brokenBox(p, d.x, d.y + NUB_H / 2, CELL_W, CELL_H, C.amber);
}

/**
 * Gum, on the floor under everything that moves. A magenta bar with
 * stepped ends and a striped edge (dark notches along its top and bottom).
 * With one hit left it is split in the middle: a dark gap across it.
 */
export function drawGum(p: Paint, s: State, willHit: number): void {
  for (const d of s.things) {
    if (d.kind !== "gum" || d.hp <= 0 || s.tick < d.landTick) continue;
    const body = d.id === willHit ? mix(C.magenta, C.ink, 0.45) : C.magenta;
    const x0 = d.x - GUM_W / 2;
    const y0 = d.y - GUM_H / 2;
    // Stepped ends: the corners are cut by 2 u.
    rect(p, x0 + 2, y0, GUM_W - 4, GUM_H, body);
    rect(p, x0, y0 + 2, GUM_W, GUM_H - 4, body);
    // The striped edge: notches 2 u wide, every 4 u, along both long sides.
    const dark = rgba(C.page, 0.85);
    for (let a = 4; a <= GUM_W - 6; a += 4) {
      rect(p, x0 + a, y0, 2, 2, dark);
      rect(p, x0 + a, y0 + GUM_H - 2, 2, 2, dark);
    }
    // One hit left: split across the middle.
    if (d.hp === 1) rect(p, d.x - 1.5, y0, 3, GUM_H, C.page);
  }
}

/** Is a battery showing phosphor rather than amber on this tick? Every 20 ticks at first, every 6 in its last 120. */
function flashOn(s: State, d: Thing, reduced: boolean): boolean {
  if (reduced || d.fuseTick < 0) return false;
  const left = d.fuseTick - s.tick;
  const period = left <= 120 ? 6 : 20;
  return Math.floor(left / period) % 2 === 1;
}

/** A battery: the tall cell with its terminal, flashing. `x`, `y` is its centre as drawn (between two ticks). */
export function drawBattery(p: Paint, s: State, d: Thing, x: number, y: number, willHit: boolean, reduced: boolean): void {
  const lit = flashOn(s, d, reduced);
  let body = lit ? C.ink : C.amber;
  if (willHit) body = mix(body, C.ink, 0.45);
  const x0 = x - CELL_W / 2;
  const y0 = y - CELL_H / 2 + NUB_H / 2;
  // The terminal, the cell, and a dark band across its top third.
  rect(p, x - NUB_W / 2, y0 - NUB_H, NUB_W, NUB_H, body);
  rect(p, x0 + 1, y0, CELL_W - 2, CELL_H, body);
  rect(p, x0, y0 + 1, CELL_W, CELL_H - 2, body);
  rect(p, x0 + 2, y0 + 5, CELL_W - 4, 2, rgba(C.page, 0.8));
}

/** Its blast's reach: drawn for its last 60 ticks, and from the moment he knocks it. */
export function drawBlastRings(p: Paint, s: State, tune: Tune, alpha: number): void {
  const w = Math.max(2, Math.round(p.S * 2));
  onFloor(p, s, () => {
    for (const d of s.things) {
      if (d.kind !== "battery" || d.hp <= 0 || s.tick < d.landTick) continue;
      if (d.knockTick < 0 && d.fuseTick - s.tick > 60) continue;
      const x = d.px + (d.x - d.px) * alpha;
      const y = d.py + (d.y - d.py) * alpha;
      p.ring(p.X(x), p.Y(y), tune.blastRadius * p.S, rgba(C.amber, 0.8), w);
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
