/**
 * The floor polisher (§8). What a phone at arm's length must read: where
 * the machine is, which end hurts, when the plug can be hit, how many hits
 * are left, and where it goes next.
 *
 *   - Announced: a broken phosphor outline of the box where it will land,
 *     an arrow the way it will head, and a bar that empties until it lands.
 *   - The casing: a steel-grey hood with stepped corners, a lit top edge, a
 *     seam round the hood, vents, and a shadow on the floor.
 *   - The pad, its whole leading end: a coral brush, its bristles turning
 *     while it moves along a lane and hurts. While it is off (stalled,
 *     changing lane), the end that will lead when it sets off is drawn as
 *     the pad to come: broken, coral and dark in turn. Pad and plug swap
 *     ends at the tick it sets off, so the ends are drawn the way it will
 *     go, never the way it came: after a hit, the end he hit is the one
 *     that is marked.
 *   - The plug, the middle 24 u of the trailing end: a phosphor socket with
 *     two pin holes while it can be hit; dark while it cannot (stalled,
 *     changing lane, beaten).
 *   - Its hits left: a row of squares in a dark window along its middle,
 *     filled for each.
 *   - Stalled at a wall, and changing lane: an arrow to the next lane.
 *   - Stalled after a hit: an arrow along the lane the way it will set
 *     off, and a bar under the hits that empties until it does.
 *   - Where it has been, the floor shines for a few seconds: the sheen,
 *     drawn only (it changes nothing, §8).
 *   - Beaten, it powers down: the hood dims, the pad and the plug go dark.
 *
 * Nothing blinks: a state is a colour, held as long as it is true. With
 * reduced motion the bristles and the glint on the hood hold still.
 */
import { BOSS_TELEGRAPH, boxOf, live, nextLane, solid, type Box } from "../sim/boss";
import type { State, Tune } from "../sim/types";
import type { Sheen } from "./effects";
import { C, mix, rgba } from "./palette";
import type { Paint } from "./renderer";

/** How deep the pad and the plug are drawn into the box, u. */
const END_U = 8;
/** The steps cut from the hood's corners, u. */
const STEP_U = 3;
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

/** The hood with its corners stepped: three rectangles. */
function hood(p: Paint, b: Box, color: string): void {
  fillU(p, b.x0 + STEP_U, b.y0, b.x1 - STEP_U, b.y1, color);
  fillU(p, b.x0 + 1, b.y0 + 1, b.x1 - 1, b.y1 - 1, color);
  fillU(p, b.x0, b.y0 + STEP_U, b.x1, b.y1 - STEP_U, color);
}

/** The sheen it leaves on the floor: where it has been in the last few seconds, fading. Drawn on the floor, under everything. */
export function drawSheen(p: Paint, sheen: readonly Sheen[], tickNow: number, life: number): void {
  for (const g of sheen) {
    const k = 1 - (tickNow - g.tick) / life;
    if (k <= 0) continue;
    fillU(p, g.x0, g.y0 + 3, g.x1, g.y1 - 3, rgba(C.ink, 0.035 * k));
    // Two streaks along the lane, where the pad's edge polished hardest.
    fillU(p, g.x0, g.y0 + 12, g.x1, g.y0 + 13, rgba(C.ink, 0.12 * k));
    fillU(p, g.x0, g.y1 - 14, g.x1, g.y1 - 13, rgba(C.ink, 0.09 * k));
  }
}

/** The machine itself: casing, pad, plug, its hits left, and the arrows while it stalls. Drawn after the intruders. */
export function drawBoss(p: Paint, s: State, tune: Tune, alpha: number, tickNow: number, reduced: boolean): void {
  const b = s.boss;
  if (!solid(b)) return;
  const box = boxAt(s, alpha);
  const on = live(b);
  const down = b.mode === "down";
  // The way it heads: while it moves along a lane (or stands beaten), the way it goes; stalled or
  // changing lane, the way it will set off, for what trails now leads then.
  const coming = b.mode === "wallStall" || b.mode === "laneMove" || b.mode === "hitStall";
  const ahead = coming ? -b.dir : b.dir;
  const lead = ahead > 0 ? box.x1 : box.x0;
  const trail = ahead > 0 ? box.x0 : box.x1;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const casing = down ? mix(C.casing, C.page, 0.35) : C.casing;

  // Its shadow on the floor, down and to the right, kept on the floor.
  const x0 = Math.round(p.X(s.room.left));
  const y0 = Math.round(p.Y(s.room.top));
  p.ctx.save();
  p.ctx.beginPath();
  p.ctx.rect(x0, y0, Math.round(p.X(s.room.right)) - x0, Math.round(p.Y(s.room.bottom)) - y0);
  p.ctx.clip();
  hood(p, { x0: box.x0 + 2, y0: box.y0 + 3, x1: box.x1 + 2, y1: box.y1 + 3 }, rgba(C.page, 0.6));
  p.ctx.restore();

  // The hood: lit along its top edge, shaded along its bottom, a seam round it and vents either side of the window.
  hood(p, box, casing);
  fillU(p, box.x0 + STEP_U, box.y0 + 1, box.x1 - STEP_U, box.y0 + 3, mix(casing, C.ink, 0.28));
  fillU(p, box.x0 + STEP_U, box.y1 - 3, box.x1 - STEP_U, box.y1 - 1, C.casingDark);
  const seam = mix(casing, C.page, 0.45);
  const sx0 = box.x0 + END_U + 4;
  const sx1 = box.x1 - END_U - 4;
  fillU(p, sx0, box.y0 + 7, sx1, box.y0 + 8, seam);
  fillU(p, sx0, box.y1 - 8, sx1, box.y1 - 7, seam);
  fillU(p, sx0, box.y0 + 7, sx0 + 1, box.y1 - 7, seam);
  fillU(p, sx1 - 1, box.y0 + 7, sx1, box.y1 - 7, seam);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) fillU(p, cx + side * (30 + i * 4) - 1, cy - 9, cx + side * (30 + i * 4) + 1, cy + 9, seam);
  }

  // The glint: a bright band that sweeps across the hood while it moves.
  if (!reduced && !down && (b.mode === "lane" || b.mode === "laneMove")) {
    const period = 110;
    const gx = box.x0 - 30 + ((((tickNow - b.beganTick) % period) + period) % period) * (180 / period);
    p.ctx.save();
    p.ctx.beginPath();
    p.ctx.rect(Math.round(p.X(box.x0)), Math.round(p.Y(box.y0)), Math.round(p.X(box.x1)) - Math.round(p.X(box.x0)), Math.round(p.Y(box.y1)) - Math.round(p.Y(box.y0)));
    p.ctx.clip();
    const band = rgba(C.ink, 0.16);
    for (let i = 0; i < 4; i++) fillU(p, gx + i * 4, box.y0 + i * 15, gx + i * 4 + 5, box.y0 + (i + 1) * 15, band);
    p.ctx.restore();
  }

  // The pad: the whole leading end, a brush whose bristles turn while it hurts.
  const padIn = lead - ahead * END_U;
  const pl = Math.min(lead, padIn);
  const pr = Math.max(lead, padIn);
  const py0 = box.y0 + 1;
  const py1 = box.y1 - 1;
  if (on) {
    fillU(p, pl, py0, pr, py1, C.coral);
    const dark = mix(C.coral, C.page, 0.45);
    const turn = reduced ? 0 : Math.floor(tickNow / 2) % 4;
    for (let v = py0 + turn; v < py1 - 0.01; v += 4) fillU(p, pl + 1, v, pr - 1, Math.min(py1, v + 1), dark);
    fillU(p, ahead > 0 ? pr - 1 : pl, py0, ahead > 0 ? pr : pl + 1, py1, mix(C.coral, C.ink, 0.35));
  } else {
    fillU(p, pl, py0, pr, py1, C.casingDark);
    for (let v = py0; v < py1 - 0.01; v += 4) fillU(p, pl + 1, v, pr - 1, Math.min(py1, v + 1), mix(C.casingDark, C.page, 0.4));
  }
  if (coming) {
    // Broken: coral and dark in turn down the whole end, 5 u and 3 u. Whole, it hurts; broken, it will.
    for (let v = box.y0; v < box.y1 - 0.01; v += 8) fillU(p, pl, v, pr, Math.min(box.y1, v + 5), C.coral);
  }

  // The plug: a socket in the middle of the trailing end, phosphor with two pin holes while it can be hit.
  const plugIn = trail + ahead * END_U;
  const half = tune.plugWidth / 2;
  const ql = Math.min(trail, plugIn);
  const qr = Math.max(trail, plugIn);
  fillU(p, ql, cy - half, qr, cy + half, on ? C.ink : C.page);
  const pin = on ? C.casingDark : mix(C.casingDark, C.page, 0.5);
  fillU(p, ql + 2, cy - half + 5, qr - 2, cy - half + 8, pin);
  fillU(p, ql + 2, cy + half - 8, qr - 2, cy + half - 5, pin);

  // Its hits left, along its middle, in a dark window: filled for each.
  const n = tune.bossHits;
  const width = n * MARK_U + (n - 1) * MARK_GAP_U;
  // On whole units, so every mark is drawn the same size.
  const mx0 = Math.round(cx - width / 2);
  const my = Math.round(cy);
  fillU(p, mx0 - 3, my - MARK_U / 2 - 3, mx0 + width + 3, my + MARK_U / 2 + 3, C.page);
  for (let i = 0; i < n; i++) {
    const mx = mx0 + i * (MARK_U + MARK_GAP_U);
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

  // Stalled at a wall, and changing lane: an arrow to the lane it goes to, at the wall's end.
  if (b.mode === "wallStall" || b.mode === "laneMove") {
    const goingDown = nextLane(b) > b.lane;
    const ax = cx + (b.dir > 0 ? 38 : -38);
    arrowU(p, ax, cy, 0, goingDown ? 1 : -1, C.ink);
  }
  // Stalled after a hit: an arrow the way it will set off, at the end that will lead, and a bar that empties until it does.
  if (b.mode === "hitStall") {
    arrowU(p, cx + ahead * 38, cy, ahead, 0, C.ink);
    const left = Math.max(0, Math.min(1, (b.modeUntil - s.tick) / Math.max(1, tune.bossStallTicks)));
    fillU(p, mx0, my + MARK_U / 2 + 5, mx0 + width * left, my + MARK_U / 2 + 7, C.ink);
  }
}
