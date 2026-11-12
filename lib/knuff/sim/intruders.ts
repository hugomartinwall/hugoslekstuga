/**
 * The intruders: what each kind does, and what happens when one meets him
 * (spec §5.2 to §5.4, as far as dust bunnies and tokens go).
 *
 * A dust bunny walks toward him, its heading swinging. A token rolls
 * straight, mirrors off cushions and never slows. His hot body pops either
 * in one hit and flies on; landed, either costs him a heart unless it is
 * dazed or he is invulnerable, and is then held at arm's length.
 *
 * Everything here that changes a State is called from `step` only.
 */
import { KINDS } from "../content/kinds";
import { givePip, isHot, keepInside, land, loseHeart } from "./hot";
import { collideWalls, popImpulse, slow } from "./physics";
import { scorePop } from "./score";
import type { SimEvent, State, Thing, Tune } from "./types";

const BUNNY_R = KINDS.bunny.radius;

/** Has it landed? Until then it is announced: it cannot be touched and cannot hurt. */
export function landed(s: State, d: Thing): boolean {
  return s.tick >= d.landTick;
}

/** Is it dazed? A dazed thing stands still, cannot cost a heart, and still pops if he hits it. */
export function dazed(s: State, d: Thing): boolean {
  return s.tick < d.dazedUntil;
}

/**
 * Step 6 of a tick: each intruder sets its velocity for this tick. Returns
 * the speed of the fastest of them, for the size of the substeps.
 */
export function choose(s: State, tune: Tune): number {
  const h = s.him;
  let fastest = 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (s.tick < d.landTick) continue;
    if (d.kind === "bunny") {
      if (s.tick < d.dazedUntil) {
        d.wx = 0;
        d.wy = 0;
      } else {
        // `bunnySpeed` along the bearing to him, turned by its wobble.
        const dx = h.x - d.x;
        const dy = h.y - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        const wobble = tune.bunnyWobble * Math.sin(d.phase + tune.bunnyWobbleRate * s.tick);
        const c = Math.cos(wobble);
        const sn = Math.sin(wobble);
        const ux = dx / dist;
        const uy = dy / dist;
        // Adding zero turns a negative zero into a plain one (see `step`, "close up").
        d.wx = (ux * c - uy * sn) * tune.bunnySpeed + 0;
        d.wy = (ux * sn + uy * c) * tune.bunnySpeed + 0;
      }
      const speed = Math.hypot(d.wx + d.vx, d.wy + d.vy);
      if (speed > fastest) fastest = speed;
    } else if (s.tick >= d.dazedUntil) {
      const speed = Math.hypot(d.vx, d.vy);
      if (speed > fastest) fastest = speed;
    }
  }
  return fastest;
}

/** One substep of the intruders' own motion. */
export function moveThings(s: State, tune: Tune, sub: number): void {
  const room = s.room;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp <= 0 || s.tick < d.landTick) continue;
    if (d.kind === "bunny") {
      // Its walk, and a shove on top. A shoved dust bunny bounces off a
      // cushion as the toy's dummies do; its walk is not turned round.
      d.x += (d.wx + d.vx) * sub;
      d.y += (d.wy + d.vy) * sub;
      collideWalls(d, BUNNY_R, room, tune.lightWallRestitution);
    } else {
      // A dazed token stands still. Its roll is kept: when the daze ends it rolls on.
      if (s.tick < d.dazedUntil) continue;
      d.x += d.vx * sub;
      d.y += d.vy * sub;
      // It mirrors off cushions with no loss.
      collideWalls(d, KINDS.token.radius, room, 1);
    }
  }
}

/**
 * His body against each thing, in the order of `things` (§5.3). Returns
 * false if that ended the night: the last heart is gone.
 */
export function contacts(s: State, tune: Tune, events: SimEvent[]): boolean {
  const h = s.him;
  const things = s.things;
  // A thing announced during this loop cannot be touched yet anyway.
  const count = things.length;
  for (let i = 0; i < count; i++) {
    const d = things[i];
    if (d.hp <= 0 || s.tick < d.landTick) continue;
    const dx = d.x - h.x;
    const dy = d.y - h.y;
    const reach = tune.himRadius + KINDS[d.kind].radius;
    if (dx >= reach || dx <= -reach || dy >= reach || dy <= -reach) continue;
    const dist = Math.hypot(dx, dy);
    if (dist >= reach) continue;
    const nx = dist > 1e-6 ? dx / dist : 0;
    const ny = dist > 1e-6 ? dy / dist : -1;
    const isDazed = s.tick < d.dazedUntil;

    if (h.hot) {
      // A thing he overlapped at the release cannot be hit by this launch until he has left it.
      if (s.launch.blocked.length > 0 && s.launch.blocked.includes(d.id)) continue;
      // His hot body pops it. He feels part of the knock and flies on.
      const speed = Math.hypot(h.vx, h.vy);
      const tvx = d.kind === "bunny" ? d.wx + d.vx : isDazed ? 0 : d.vx;
      const tvy = d.kind === "bunny" ? d.wy + d.vy : isDazed ? 0 : d.vy;
      const closing = (h.vx - tvx) * nx + (h.vy - tvy) * ny;
      const hx = h.x;
      const hy = h.y;
      popImpulse(h, nx, ny, closing, tune.lightMass, tune);
      d.hp = 0;
      h.lastContactTick = s.tick;
      const scored = scorePop(s, d, tune);
      events.push({
        type: "pop",
        tick: s.tick,
        x: d.x,
        y: d.y,
        hx,
        hy,
        id: d.id,
        kind: d.kind,
        n: scored.n,
        chain: scored.chain,
        cushions: scored.cushions,
        points: scored.points,
        source: "body",
        speed,
      });
      // One pip back, once, on the launch's `pipRefundPop`th body pop.
      const l = s.launch;
      if (tune.pipRefundPop > 0 && l.bodyPops === tune.pipRefundPop && !l.refunded) {
        l.refunded = true;
        givePip(s, tune, "pop", events);
      }
      // The landing test, after every contact.
      h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
      if (!h.hot) land(s, tune, events);
      continue;
    }

    // He is landed: a touch costs a heart, unless the thing is dazed or he is invulnerable.
    if (!isDazed && s.tick >= h.invulnUntil) {
      loseHeart(s, tune, d, events);
      if (s.hearts <= 0) return false;
      continue;
    }
    // Held at arm's length: put back touching him.
    d.x = h.x + nx * reach;
    d.y = h.y + ny * reach;
    const inward = d.vx * nx + d.vy * ny;
    if (inward < 0) {
      // A token bounces off him. A dust bunny's shove loses the part that points at him.
      const k = d.kind === "token" ? 2 : 1;
      d.vx -= k * inward * nx;
      d.vy -= k * inward * ny;
    }
    keepInside(s, d);
  }
  return true;
}

/** Once he has left a thing he overlapped at the release, this launch can hit it again. */
export function unblock(s: State, tune: Tune): void {
  const blocked = s.launch.blocked;
  const h = s.him;
  for (let b = blocked.length - 1; b >= 0; b--) {
    let still = false;
    for (let i = 0; i < s.things.length; i++) {
      const d = s.things[i];
      if (d.id !== blocked[b]) continue;
      if (d.hp > 0) {
        const reach = tune.himRadius + KINDS[d.kind].radius;
        still = Math.hypot(d.x - h.x, d.y - h.y) < reach;
      }
      break;
    }
    if (!still) blocked.splice(b, 1);
  }
}

/** The things he is overlapping now: what a launch released here cannot hit until he has left it. */
export function overlapped(s: State, tune: Tune): number[] {
  const out: number[] = [];
  const h = s.him;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp <= 0 || s.tick < d.landTick) continue;
    // A thing held at arm's length touches him and no more: that is not an overlap.
    const reach = tune.himRadius + KINDS[d.kind].radius - 1e-7;
    if (Math.hypot(d.x - h.x, d.y - h.y) < reach) out.push(d.id);
  }
  return out;
}

/**
 * Dust bunnies are kept from overlapping each other: pushed apart equally
 * along the line between their centres. Positions only, no change of
 * speed. Every other pair of intruders passes through each other.
 */
export function spreadBunnies(s: State): void {
  const things = s.things;
  const reach = BUNNY_R + BUNNY_R;
  for (let a = 0; a < things.length; a++) {
    const A = things[a];
    if (A.kind !== "bunny" || A.hp <= 0 || s.tick < A.landTick) continue;
    for (let b = a + 1; b < things.length; b++) {
      const B = things[b];
      if (B.kind !== "bunny" || B.hp <= 0 || s.tick < B.landTick) continue;
      const dx = B.x - A.x;
      if (dx >= reach || dx <= -reach) continue;
      const dy = B.y - A.y;
      if (dy >= reach || dy <= -reach) continue;
      const dist = Math.hypot(dx, dy);
      if (dist >= reach) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      const half = (reach - dist) * 0.5;
      A.x -= nx * half;
      A.y -= ny * half;
      B.x += nx * half;
      B.y += ny * half;
      keepInside(s, A);
      keepInside(s, B);
    }
  }
}

/** Step 9 for the things: a shoved dust bunny slows as the toy's dummies do. Tokens never slow. */
export function slowThings(s: State, tune: Tune): void {
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.kind !== "bunny" || d.hp <= 0) continue;
    if (d.vx !== 0 || d.vy !== 0) {
      slow(d, tune.lightDragK, tune.lightFriction, tune.lightRestSpeed);
      // A speed that ran down to nothing from below is a negative zero; see `step`.
      d.vx += 0;
      d.vy += 0;
    }
  }
}
