/**
 * The intruders: what each kind does, and what happens when one meets him
 * (spec §5.2 to §5.4, as far as dust bunnies and tokens go), and the
 * offer's pickup tiles, which he takes rather than hits.
 *
 * A dust bunny walks toward him, its heading swinging. A token rolls
 * straight, mirrors off cushions and never slows. His hot body pops either
 * in one hit and flies on; so does Spark's ring, while it lasts. Landed,
 * either costs him a heart unless it is dazed or he is invulnerable, and is
 * then held at arm's length. A pickup does not move, hurts nothing and is
 * not hit: an armed launch whose circle overlaps it takes it (§6.3).
 *
 * Everything here that changes a State is called from `step` only.
 */
import { KINDS } from "../content/kinds";
import { canTake, overlapsTile, takePickup } from "./charms";
import { givePip, isHot, keepInside, land, loseHeart } from "./hot";
import { collideWalls, popImpulse, slow } from "./physics";
import { scorePop } from "./score";
import type { SimEvent, State, Thing, Tune } from "./types";

const BUNNY_R = KINDS.bunny.radius;
const TOKEN_R = KINDS.token.radius;

/**
 * A thing's radius. One comparison, not a look-up in the kind table by
 * name: this is asked for every thing on every substep, and a look-ahead
 * player takes a quarter of a million substeps to choose one night's shots.
 * A pickup is a square tile: it has no radius, and it is met by
 * `overlapsTile`.
 */
function radiusOf(d: Thing): number {
  switch (d.kind) {
    case "bunny":
      return BUNNY_R;
    case "token":
      return TOKEN_R;
    case "pickup":
      return 0;
  }
}

/** Does his circle, at its size after charms, overlap this thing? */
function overlapsHim(s: State, d: Thing, slack = 0): boolean {
  const h = s.him;
  if (d.kind === "pickup") return overlapsTile(h.x, h.y, s.stats.radius - slack, d);
  return Math.hypot(d.x - h.x, d.y - h.y) < s.stats.radius + radiusOf(d) - slack;
}

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
  // The fastest is found by comparing squares, and its speed worked out once.
  let fastestSq = 0;
  let fx = 0;
  let fy = 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (s.tick < d.landTick || d.kind === "pickup") continue;
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
      const sx = d.wx + d.vx;
      const sy = d.wy + d.vy;
      const sq = sx * sx + sy * sy;
      if (sq > fastestSq) {
        fastestSq = sq;
        fx = sx;
        fy = sy;
      }
    } else if (s.tick >= d.dazedUntil) {
      const sq = d.vx * d.vx + d.vy * d.vy;
      if (sq > fastestSq) {
        fastestSq = sq;
        fx = d.vx;
        fy = d.vy;
      }
    }
  }
  return fastestSq === 0 ? 0 : Math.hypot(fx, fy);
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
    } else if (d.kind === "token") {
      // A dazed token stands still. Its roll is kept: when the daze ends it rolls on.
      if (s.tick < d.dazedUntil) continue;
      d.x += d.vx * sub;
      d.y += d.vy * sub;
      // It mirrors off cushions with no loss.
      collideWalls(d, TOKEN_R, room, 1);
    }
  }
}

/**
 * His body and Spark's ring against each thing, in the order of `things`
 * (§5.3). Returns false if that ended the night: the last heart is gone.
 */
export function contacts(s: State, tune: Tune, events: SimEvent[]): boolean {
  const h = s.him;
  const things = s.things;
  const r = s.stats.radius;
  // A thing announced during this loop cannot be touched yet anyway.
  const count = things.length;
  for (let i = 0; i < count; i++) {
    const d = things[i];
    if (d.hp <= 0 || s.tick < d.landTick) continue;
    if (d.kind === "pickup") {
      // Taken by an armed launch whose circle overlaps its tile, at any
      // speed; not by the launch that was released on it, until he has left it.
      if (canTake(s) && !s.launch.blocked.includes(d.id) && overlapsTile(h.x, h.y, r, d)) takePickup(s, tune, d, events);
      continue;
    }
    const dx = d.x - h.x;
    const dy = d.y - h.y;
    const reach = r + radiusOf(d);
    // Spark's ring reaches `sparkReach` past his edge while it lasts and he is hot.
    const spark = h.hot && s.tick < s.launch.sparkUntil;
    const far = spark ? reach + tune.sparkReach : reach;
    if (dx >= far || dx <= -far || dy >= far || dy <= -far) continue;
    const dist = Math.hypot(dx, dy);
    if (dist >= far) continue;
    if (dist >= reach) {
      // Only the ring reaches it. It pops in one hit and counts in his
      // chain; it is not a body pop, and he feels nothing.
      if (s.launch.blocked.length > 0 && s.launch.blocked.includes(d.id)) continue;
      d.hp = 0;
      h.lastContactTick = s.tick;
      const scored = scorePop(s, d, tune, false);
      events.push({
        type: "pop",
        tick: s.tick,
        x: d.x,
        y: d.y,
        hx: h.x,
        hy: h.y,
        id: d.id,
        kind: d.kind,
        n: scored.n,
        chain: scored.chain,
        cushions: scored.cushions,
        coin: scored.coin,
        points: scored.points,
        source: "spark",
        speed: Math.hypot(h.vx, h.vy),
      });
      continue;
    }
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
      popImpulse(h, nx, ny, closing, tune.lightMass, tune, s.stats.popImpulse);
      d.hp = 0;
      h.lastContactTick = s.tick;
      const scored = scorePop(s, d, tune, true);
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
        coin: scored.coin,
        points: scored.points,
        source: "body",
        speed,
      });
      // One pip back, once, on the launch's `pipRefundPop`th body pop.
      const l = s.launch;
      if (tune.pipRefundPop > 0 && l.bodyPops === tune.pipRefundPop && !l.refunded) {
        l.refunded = true;
        givePip(s, "pop", events);
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

/** Once he has left a thing (or a tile) he overlapped at the release, this launch can hit (or take) it again. */
export function unblock(s: State): void {
  const blocked = s.launch.blocked;
  for (let b = blocked.length - 1; b >= 0; b--) {
    let still = false;
    for (let i = 0; i < s.things.length; i++) {
      const d = s.things[i];
      if (d.id !== blocked[b]) continue;
      if (d.hp > 0) still = overlapsHim(s, d);
      break;
    }
    if (!still) blocked.splice(b, 1);
  }
}

/** The things and tiles he is overlapping now: what a launch released here cannot hit or take until he has left it. */
export function overlapped(s: State): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    // By the order of a tick the release comes before the landings: a thing
    // that lands on the release tick was still announced when he let go.
    // (A pickup's tile lies there from the tick its offer opened: a release
    // on that tick cannot take anyway, since the offer has not armed.)
    if (d.hp <= 0 || s.tick <= d.landTick) continue;
    // A thing held at arm's length touches him and no more: that is not an overlap.
    if (overlapsHim(s, d, 1e-7)) out.push(d.id);
  }
  return out;
}

/** The landed dust bunnies of the pass in hand. Filled and emptied by `spreadBunnies`; nothing is kept in it between two calls. */
const bunch: Thing[] = [];

/**
 * Dust bunnies are kept from overlapping each other: pushed apart equally
 * along the line between their centres. Positions only, no change of
 * speed. Every other pair of intruders passes through each other.
 */
export function spreadBunnies(s: State): void {
  // Every pair is looked at on every substep, so the dust bunnies are
  // picked out once, in the room's order, and the pairs are made of those.
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.kind === "bunny" && d.hp > 0 && s.tick >= d.landTick) bunch.push(d);
  }
  const n = bunch.length;
  const reach = BUNNY_R + BUNNY_R;
  // Clearly apart, by a margin far wider than any rounding: such a pair needs no square root.
  const apartSq = reach * reach * (1 + 1e-9);
  for (let a = 0; a < n; a++) {
    const A = bunch[a];
    for (let b = a + 1; b < n; b++) {
      const B = bunch[b];
      const dx = B.x - A.x;
      if (dx >= reach || dx <= -reach) continue;
      const dy = B.y - A.y;
      if (dy >= reach || dy <= -reach) continue;
      if (dx * dx + dy * dy >= apartSq) continue;
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
  bunch.length = 0;
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
