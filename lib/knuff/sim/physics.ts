/**
 * The feel toy's motion pieces, moved as they are: cushions, substeps,
 * drag, the launch, the pop impulse and the circle contacts.
 *
 * These were set by the owner's hands in the toy. Do not tidy the
 * arithmetic: test/knuff/feel-lock.test.ts runs the toy's own simulation
 * beside this one and asks for the same positions and speeds, bit for bit,
 * so even `j * (1 / m)` in place of `j / m` fails it.
 *
 * The one change from the toy: the room's edges come from the State, and a
 * radius or a mass is handed in instead of being read off the body.
 */
import type { Him, Launch, Room, Tune } from "./types";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

/** His mass. Everything else is weighed against it. */
export const HIM_MASS = 1;

/** Anything that moves: he, and every thing in the room. */
export type Body = { x: number; y: number; vx: number; vy: number };

/** The four cushions as bits, for what `collideWalls` returns. */
export const LEFT = 1;
export const RIGHT = 2;
export const TOP = 4;
export const BOTTOM = 8;

export function hotSpeed(tune: Tune): number {
  return tune.hotFrac * tune.maxSpeed;
}

/** Bounce a circle off the room's four cushions. Returns the ones it bounced off, as bits. */
export function collideWalls(b: Body, r: number, room: Room, restitution: number): number {
  let touched = 0;
  if (b.x < room.left + r) {
    b.x = room.left + r;
    if (b.vx < 0) {
      b.vx = -b.vx * restitution;
      touched |= LEFT;
    }
  } else if (b.x > room.right - r) {
    b.x = room.right - r;
    if (b.vx > 0) {
      b.vx = -b.vx * restitution;
      touched |= RIGHT;
    }
  }
  if (b.y < room.top + r) {
    b.y = room.top + r;
    if (b.vy < 0) {
      b.vy = -b.vy * restitution;
      touched |= TOP;
    }
  } else if (b.y > room.bottom - r) {
    b.y = room.bottom - r;
    if (b.vy > 0) {
      b.vy = -b.vy * restitution;
      touched |= BOTTOM;
    }
  }
  return touched;
}

/** Keep a circle inside the room after contacts have pushed it: no bounce, no event. */
export function contain(b: Body, r: number, room: Room): void {
  if (b.x < room.left + r) {
    b.x = room.left + r;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > room.right - r) {
    b.x = room.right - r;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < room.top + r) {
    b.y = room.top + r;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > room.bottom - r) {
    b.y = room.bottom - r;
    if (b.vy > 0) b.vy = 0;
  }
}

/** One tick of drag and friction. Returns the new speed. */
export function slow(b: Body, dragK: number, friction: number, restSpeed: number): number {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp === 0) return 0;
  let next = sp * Math.exp(-dragK * DT) - friction * DT;
  if (next < restSpeed) next = 0;
  const k = next / sp;
  b.vx *= k;
  b.vy *= k;
  return next;
}

/** How many substeps a tick takes so that the fastest mover cannot tunnel. */
export function substepsFor(speed: number, tune: Tune): number {
  const n = Math.ceil((speed * DT) / tune.maxSubstepTravel);
  return n < 1 ? 1 : n > tune.maxSubsteps ? tune.maxSubsteps : n;
}

/** Set his velocity from a release. Returns the power used, or 0 if the launch has no direction. */
export function applyLaunch(h: Him, l: Launch, tune: Tune): number {
  const len = Math.hypot(l.dx, l.dy);
  if (len === 0) return 0;
  const power = l.power < 0 ? 0 : l.power > 1 ? 1 : l.power;
  const sp = tune.maxSpeed * power;
  h.vx = (l.dx / len) * sp;
  h.vy = (l.dy / len) * sp;
  return power;
}

/**
 * What he feels when the thing he hit pops: the share `scale` of the knock
 * a body of mass `m` would have given him. `scale` is the toy's
 * `popImpulseScale`, times Heavy's and Wide's factors when he has them
 * (state.stats.popImpulse). `nx, ny` points from him to the thing. A
 * grazing pass can already be receding when it is sampled; it still pops,
 * it just costs him nothing.
 */
export function popImpulse(h: Him, nx: number, ny: number, closing: number, m: number, tune: Tune, scale: number): void {
  if (closing > 0) {
    const j = ((1 + tune.bodyRestitution) * closing) / (1 / HIM_MASS + 1 / m);
    h.vx -= (j / HIM_MASS) * nx * scale;
    h.vy -= (j / HIM_MASS) * ny * scale;
  }
}

/**
 * An ordinary bump between him and a body of mass `m` that overlaps him
 * by `overlap`: both are moved apart by their share, and if they were
 * closing they trade speed.
 */
export function bumpHim(
  h: Him,
  d: Body,
  nx: number,
  ny: number,
  overlap: number,
  closing: number,
  m: number,
  tune: Tune,
): void {
  const wh = 1 / HIM_MASS;
  const wd = 1 / m;
  h.x -= nx * overlap * (wh / (wh + wd));
  h.y -= ny * overlap * (wh / (wh + wd));
  d.x += nx * overlap * (wd / (wh + wd));
  d.y += ny * overlap * (wd / (wh + wd));
  if (closing > 0) {
    const j = ((1 + tune.bodyRestitution) * closing) / (wh + wd);
    h.vx -= j * wh * nx;
    h.vy -= j * wh * ny;
    d.vx += j * wd * nx;
    d.vy += j * wd * ny;
  }
}

/** Two light things of the same mass pushed apart, trading speed if they were closing. */
export function pushApart(A: Body, ra: number, B: Body, rb: number, m: number, tune: Tune): void {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const dist = Math.hypot(dx, dy);
  const reach = ra + rb;
  if (dist >= reach) return;
  const nx = dist > 1e-6 ? dx / dist : 1;
  const ny = dist > 1e-6 ? dy / dist : 0;
  const overlap = reach - dist;
  A.x -= nx * overlap * 0.5;
  A.y -= ny * overlap * 0.5;
  B.x += nx * overlap * 0.5;
  B.y += ny * overlap * 0.5;
  const closing = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
  if (closing > 0) {
    const j = ((1 + tune.bodyRestitution) * closing) / (1 / m + 1 / m);
    A.vx -= (j / m) * nx;
    A.vy -= (j / m) * ny;
    B.vx += (j / m) * nx;
    B.vy += (j / m) * ny;
  }
}
