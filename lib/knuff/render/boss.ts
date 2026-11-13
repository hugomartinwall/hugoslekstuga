/**
 * Drawing the polisher (§8), as grey boxes: the art comes with step 6.
 * What must hold already is that a phone at arm's length can read the
 * fight: where the machine is, which end hurts, when the plug can be hit,
 * how many hits are left, and where it goes next.
 *
 *   - Announced: a broken phosphor outline of the box where it will land,
 *     and an arrow the way it will head.
 *   - The casing: a grey box with a hairline frame.
 *   - The pad, its whole leading end: coral while it moves along a lane and
 *     hurts; the casing's grey while it is off.
 *   - The plug, the middle 24 u of the trailing end: phosphor while it can
 *     be hit; dark while it cannot (stalled, changing lane, beaten).
 *   - Its hits left: a row of squares along its middle, filled for each.
 *   - Stalled at a wall: an arrow to the next lane.
 *
 * Nothing blinks: a state is a colour, held as long as it is true.
 */
import { BOSS_TELEGRAPH, boxOf, live, nextLane, solid, type Box } from "../sim/boss";
import type { State, Tune } from "../sim/types";
import { C } from "./palette";
import type { Paint } from "./renderer";

/** How deep the pad and the plug are drawn into the box, u. */
const END_U = 7;
/** The hit marks: squares this big, this far apart, u. */
const MARK_U = 4;
const MARK_GAP_U = 4;

/** A rectangle in units, snapped to whole device pixels. */
function fillU(p: Paint, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const l = Math.round(p.X(x0));
  const t = Math.round(p.Y(y0));
  const r = Math.round(p.X(x1));
  const b = Math.round(p.Y(y1));
  if (r <= l || b <= t) return;
  p.ctx.fillStyle = color;
  p.ctx.fillRect(l, t, r - l, b - t);
}

/** A hairline frame round a box in units. */
function frameU(p: Paint, b: Box, color: string, w: number): void {
  const l = Math.round(p.X(b.x0));
  const t = Math.round(p.Y(b.y0));
  const r = Math.round(p.X(b.x1));
  const bt = Math.round(p.Y(b.y1));
  p.ctx.fillStyle = color;
  p.ctx.fillRect(l, t, r - l, w);
  p.ctx.fillRect(l, bt - w, r - l, w);
  p.ctx.fillRect(l, t, w, bt - t);
  p.ctx.fillRect(r - w, t, w, bt - t);
}

/** An arrow of 4 u squares centred on (x, y), pointing along (dx, dy), a unit step on one axis: a shaft of five and a head two squares wide each side. */
function arrowU(p: Paint, x: number, y: number, dx: number, dy: number, color: string): void {
  const q = 4;
  const sq = (u: number, v: number) => fillU(p, u - q / 2, v - q / 2, u + q / 2, v + q / 2, color);
  for (let i = -2; i <= 2; i++) sq(x + dx * i * q, y + dy * i * q);
  // The head: from the tip, back one and two squares, out one and two to each side.
  const tipX = x + dx * 2 * q;
  const tipY = y + dy * 2 * q;
  for (const k of [1, 2]) {
    for (const side of [-1, 1]) sq(tipX - dx * k * q - dy * side * k * q, tipY - dy * k * q + dx * side * k * q);
  }
}

/** The box at the picture's moment, between its last two ticks. */
function boxAt(s: State, alpha: number): Box {
  const b = s.boss;
  const x = b.px + (b.x - b.px) * alpha;
  const y = b.py + (b.y - b.py) * alpha;
  const half = boxOf(b);
  const hx = (half.x1 - half.x0) / 2;
  const hy = (half.y1 - half.y0) / 2;
  return { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy };
}

/**
 * The telegraph: a broken outline of the machine where it will land, and
 * an arrow the way it will head. Drawn with the other telegraph outlines.
 */
export function drawBossTelegraph(p: Paint, s: State): void {
  const b = s.boss;
  if (!b.present || b.mode !== "arriving") return;
  const box = boxOf(b);
  const q = Math.max(2, Math.round(p.S * 3));
  const step = 9;
  p.ctx.fillStyle = C.ink;
  const dot = (u: number, v: number) => p.ctx.fillRect(Math.round(p.X(u) - q / 2), Math.round(p.Y(v) - q / 2), q, q);
  // Squares with gaps along the four sides, full bright and steady.
  for (let u = box.x0; u <= box.x1 + 0.01; u += step) {
    dot(u, box.y0);
    dot(u, box.y1);
  }
  for (let v = box.y0 + step; v < box.y1 - 0.01; v += step) {
    dot(box.x0, v);
    dot(box.x1, v);
  }
  arrowU(p, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, b.dir, 0, C.ink);
  // How long until it lands: a bar under the outline that empties.
  const left = Math.max(0, Math.min(1, (b.modeUntil - s.tick) / BOSS_TELEGRAPH));
  fillU(p, box.x0, box.y1 + 4, box.x0 + (box.x1 - box.x0) * left, box.y1 + 6, C.inkMuted);
}

/** The machine itself: casing, pad, plug, its hits left, and the arrow while it stalls at a wall. Drawn after the intruders. */
export function drawBoss(p: Paint, s: State, tune: Tune, alpha: number): void {
  const b = s.boss;
  if (!solid(b)) return;
  const box = boxAt(s, alpha);
  const hair = Math.max(1, Math.round(p.dpr));
  const on = live(b);
  const lead = b.dir > 0 ? box.x1 : box.x0;
  const trail = b.dir > 0 ? box.x0 : box.x1;
  const cy = (box.y0 + box.y1) / 2;

  // The casing.
  fillU(p, box.x0, box.y0, box.x1, box.y1, C.casing);
  // The pad: the whole leading end. Coral while it hurts.
  const padIn = lead - b.dir * END_U;
  fillU(p, Math.min(lead, padIn), box.y0, Math.max(lead, padIn), box.y1, on ? C.coral : C.casingDark);
  // The plug: the middle of the trailing end. Phosphor while it can be hit.
  const plugIn = trail + b.dir * END_U;
  const half = tune.plugWidth / 2;
  fillU(p, Math.min(trail, plugIn), cy - half, Math.max(trail, plugIn), cy + half, on ? C.ink : C.page);
  frameU(p, box, C.inkMuted, hair);

  // Its hits left, along its middle.
  const n = tune.bossHits;
  const width = n * MARK_U + (n - 1) * MARK_GAP_U;
  // On whole units, so every mark is drawn the same size.
  const x0 = Math.round((box.x0 + box.x1) / 2 - width / 2);
  const my = Math.round(cy);
  for (let i = 0; i < n; i++) {
    const mx = x0 + i * (MARK_U + MARK_GAP_U);
    const filled = i < b.hp;
    if (filled) fillU(p, mx, my - MARK_U / 2, mx + MARK_U, my + MARK_U / 2, C.ink);
    else {
      // A hit taken: the square's frame only.
      fillU(p, mx, my - MARK_U / 2, mx + MARK_U, my - MARK_U / 2 + 1, C.inkMuted);
      fillU(p, mx, my + MARK_U / 2 - 1, mx + MARK_U, my + MARK_U / 2, C.inkMuted);
      fillU(p, mx, my - MARK_U / 2, mx + 1, my + MARK_U / 2, C.inkMuted);
      fillU(p, mx + MARK_U - 1, my - MARK_U / 2, mx + MARK_U, my + MARK_U / 2, C.inkMuted);
    }
  }

  // Stalled at a wall, and changing lane: an arrow to the lane it goes to.
  if (b.mode === "wallStall" || b.mode === "laneMove") {
    const down = nextLane(b) > b.lane;
    const ax = (box.x0 + box.x1) / 2 + (b.dir > 0 ? 38 : -38);
    arrowU(p, ax, cy, 0, down ? 1 : -1, C.ink);
  }
}
