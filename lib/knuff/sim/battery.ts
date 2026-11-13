/**
 * Batteries and their blasts, and gum (spec §5.3, §5.4).
 *
 * A battery drifts toward him and its fuse runs from its landing. His hot
 * body does not pop it: it knocks it. A knocked battery flies off along
 * the line between the two centres and is his: from then on it never costs
 * him a heart. It bursts at the first of: its fuse ending; after a knock,
 * the tick it touches a dust bunny, a token, another battery, the polisher
 * or a cushion; `batteryKnockTicks` after the first knock. A blast reaches
 * every thing whose centre is within `blastRadius` of the battery's. His
 * pops what it reaches, at twice their points, takes one hit off gum, and
 * sets off the batteries it reaches, which become his. One that is not his
 * pops nothing; it costs him a heart if he is landed, not invulnerable and
 * inside it.
 *
 * Gum lies flat and only he ever touches it. A straight hit on gum with
 * two hits left stops him dead on it; any other hit takes one off, or two
 * off a cushion, and he flies on.
 *
 * A battery due to burst is queued (in the timers of a tick, and in its
 * substeps when it touches something), and the queue is resolved after the
 * substeps, in the order queued (§12.4 steps 5, 7 and 8). The queue lives
 * here, not in the State: it is empty again by the end of every tick.
 *
 * Everything here that changes a State is called from `step` only.
 */
import { KINDS } from "../content/kinds";
import { givePip, isHot, land, loseHeart } from "./hot";
import { popImpulse } from "./physics";
import type { PastShot, SimEvent, State, Thing, Tune } from "./types";

export const BATTERY_R = KINDS.battery.radius;
/** Gum is a box 28 × 12: half of each. */
export const GUM_HALF_W = KINDS.gum.boxW / 2;
export const GUM_HALF_H = KINDS.gum.boxH / 2;

type Why = "fuse" | "touch" | "knock" | "chain";

/** The batteries due to burst this tick, in the order they were queued, and why. Emptied by `resolveBlasts`. */
const queue: Thing[] = [];
const whys: Why[] = [];

/** The sooner of a battery's time and `t`. A battery with no time yet (-1) gets `t`. */
function soonest(fuseTick: number, t: number): number {
  return fuseTick < 0 ? t : Math.min(fuseTick, t);
}

/** Empty the queue: at the start of every tick, so a tick that was cut short cannot leave one behind. */
export function clearQueue(): void {
  queue.length = 0;
  whys.length = 0;
}

/** Is this a battery going off this tick? It has been queued: it no longer moves, knocks or hurts. */
export function bursting(s: State, d: Thing): boolean {
  return d.kind === "battery" && d.fuseTick >= 0 && d.fuseTick <= s.tick;
}

/** Queue a battery to go off this tick. */
export function queueBurst(s: State, d: Thing, why: Why): void {
  if (d.kind !== "battery" || d.hp <= 0 || queue.includes(d)) return;
  d.fuseTick = s.tick;
  queue.push(d);
  whys.push(why);
}

/** Why a battery whose time has come goes off: its fuse, its knock's time, or a blast that set it off. */
function whyDue(d: Thing, tune: Tune): Why {
  if (d.fuseTick === d.landTick + tune.batteryFuseTicks) return "fuse";
  if (d.knockTick >= 0 && d.fuseTick === d.knockTick + tune.batteryKnockTicks) return "knock";
  return "chain";
}

/** Step 5's part: every landed battery whose time has come is queued, in the order of `things`. */
export function fuses(s: State, tune: Tune): void {
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.kind !== "battery" || d.hp <= 0 || s.tick < d.landTick) continue;
    if (d.fuseTick >= 0 && d.fuseTick <= s.tick) queueBurst(s, d, whyDue(d, tune));
  }
}

// ── The knock ─────────────────────────────────────────────────────────

/**
 * His hot body meets battery `d`; `nx`, `ny` points from him to it. It
 * leaves along that line at `batteryKnockKeep` times his speed along it
 * before the hit, and he feels the impulse of a pop of a light body and
 * flies on. It is his from this tick, and its blast belongs to this
 * launch. A second knock sends it off again; it does not restart the
 * knock's time. A body that is not closing on it (a graze already moving
 * apart) does not knock it. Returns whether it knocked.
 */
export function knock(s: State, tune: Tune, d: Thing, nx: number, ny: number, events: SimEvent[]): boolean {
  const h = s.him;
  const closing = (h.vx - (d.wx + d.vx)) * nx + (h.vy - (d.wy + d.vy)) * ny;
  if (!(closing > 0)) return false;
  const speed = Math.hypot(h.vx, h.vy);
  const along = h.vx * nx + h.vy * ny;
  const hx = h.x;
  const hy = h.y;
  popImpulse(h, nx, ny, closing, tune.lightMass, tune, s.stats.popImpulse);
  const k = tune.batteryKnockKeep * Math.max(0, along);
  // Adding zero turns a negative zero into a plain one (see `step`, "close up").
  d.vx = nx * k + 0;
  d.vy = ny * k + 0;
  // It stops drifting.
  d.wx = 0;
  d.wy = 0;
  if (d.knockTick < 0) {
    d.knockTick = s.tick;
    d.fuseTick = soonest(d.fuseTick, s.tick + tune.batteryKnockTicks);
  }
  d.mine = true;
  d.launchId = s.launch.id;
  // A knock is a contact (§3.5).
  h.lastContactTick = s.tick;
  events.push({ type: "knock", tick: s.tick, x: d.x, y: d.y, hx, hy, id: d.id, vx: d.vx, vy: d.vy, speed, until: d.fuseTick });
  return true;
}

/**
 * Step 7's part, after his contacts: a knocked battery bursts on touching
 * a dust bunny, a token or another battery. (It passes over gum, the heart
 * and pickups; the polisher bursts it when it meets it, in its own push,
 * and a cushion in the battery's move.)
 */
export function knockedTouches(s: State): void {
  const things = s.things;
  for (let i = 0; i < things.length; i++) {
    const b = things[i];
    if (b.kind !== "battery" || b.knockTick < 0 || b.hp <= 0 || s.tick < b.landTick || bursting(s, b)) continue;
    for (let j = 0; j < things.length; j++) {
      const t = things[j];
      if (t === b || t.hp <= 0 || s.tick < t.landTick) continue;
      if (t.kind !== "bunny" && t.kind !== "token" && t.kind !== "battery") continue;
      const reach = BATTERY_R + KINDS[t.kind].radius;
      const dx = t.x - b.x;
      const dy = t.y - b.y;
      if (dx >= reach || dx <= -reach || dy >= reach || dy <= -reach) continue;
      if (Math.hypot(dx, dy) < reach) {
        queueBurst(s, b, "touch");
        break;
      }
    }
  }
}

// ── The blast ─────────────────────────────────────────────────────────

/** Points a blast of his paid, into the launch it belongs to: the one in flight, or its entry in `pastShots`. The best shot is raised either way. */
function payShot(s: State, launchId: number, points: number): void {
  s.score += points;
  const l = s.launch;
  let total = points;
  if (l.active && l.id === launchId) {
    l.points += points;
    total = l.points;
  } else {
    const past = pastShotOf(s, launchId);
    if (past) {
      past.points += points;
      total = past.points;
    }
  }
  if (total > s.bestShot) s.bestShot = total;
}

function pastShotOf(s: State, id: number): PastShot | null {
  for (let i = 0; i < s.pastShots.length; i++) if (s.pastShots[i].id === id) return s.pastShots[i];
  return null;
}

/** Has launch `id` a battery alive whose blast belongs to it? */
function hasBattery(s: State, id: number): boolean {
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.kind === "battery" && d.hp > 0 && d.mine && d.launchId === id) return true;
  }
  return false;
}

/** A launch has ended: if a battery of it is still alive, its total is kept, for the blast to add to. */
export function keepShot(s: State): void {
  const l = s.launch;
  if (l.id > 0 && hasBattery(s, l.id) && !pastShotOf(s, l.id)) s.pastShots.push({ id: l.id, points: l.points });
}

/** An entry is dropped when its last battery has burst. */
function dropShots(s: State): void {
  const past = s.pastShots;
  for (let i = past.length - 1; i >= 0; i--) if (!hasBattery(s, past[i].id)) past.splice(i, 1);
}

/**
 * Step 8: the blasts queued this tick, in the order queued. Returns false
 * if a blast took his last heart.
 */
export function resolveBlasts(s: State, tune: Tune, events: SimEvent[]): boolean {
  if (queue.length === 0) return true;
  let running = true;
  for (let q = 0; q < queue.length && running; q++) running = blast(s, tune, queue[q], whys[q], events);
  clearQueue();
  dropShots(s);
  return running;
}

function blast(s: State, tune: Tune, b: Thing, why: Why, events: SimEvent[]): boolean {
  const h = s.him;
  const mine = b.mine;
  const launchId = mine ? b.launchId : -1;
  const reach = tune.blastRadius;
  const reachSq = reach * reach;
  // It is gone by the end of the tick.
  b.hp = 0;
  const e: Extract<SimEvent, { type: "burst" }> = { type: "burst", tick: s.tick, x: b.x, y: b.y, id: b.id, mine, why, launchId, points: 0, pops: 0, set: 0, hurt: false };
  events.push(e);
  // Every battery that goes off as his pays 40, flat.
  let points = mine ? KINDS.battery.points : 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d === b || d.hp <= 0 || s.tick < d.landTick) continue;
    const dx = d.x - b.x;
    const dy = d.y - b.y;
    if (dx * dx + dy * dy > reachSq) continue;
    switch (d.kind) {
      case "bunny":
      case "token": {
        // His pops it, at twice its points, flat. One not his does nothing to it.
        if (!mine) break;
        d.hp = 0;
        const p = d.worth0 ? 0 : 2 * KINDS[d.kind].points;
        points += p;
        e.pops++;
        events.push({
          type: "pop",
          tick: s.tick,
          x: d.x,
          y: d.y,
          hx: b.x,
          hy: b.y,
          id: d.id,
          kind: d.kind,
          n: 0,
          chain: 1,
          cushions: 1,
          coin: 1,
          points: p,
          source: "blast",
          speed: 0,
        });
        break;
      }
      case "battery": {
        // His blast makes it his; any other leaves its owner as it was.
        if (mine && !d.mine) {
          d.mine = true;
          d.launchId = launchId;
        }
        // One already going off this tick goes off in its own turn.
        if (bursting(s, d)) break;
        // Set off `blastChainTicks` later, unless its own time comes first.
        // Set off by a blast of his, it takes that blast's launch.
        e.set++;
        const chain = s.tick + tune.blastChainTicks;
        if (soonest(d.fuseTick, chain) === chain) {
          d.fuseTick = chain;
          if (mine) d.launchId = launchId;
        }
        break;
      }
      case "gum": {
        // His takes one hit off it (never two). One not his does nothing to it.
        if (!mine) break;
        d.hp -= 1;
        const p = KINDS.gum.points;
        points += p;
        events.push({ type: "hit", tick: s.tick, x: d.x, y: d.y, kind: "gum", id: d.id, left: d.hp, points: p, two: false, source: "blast", stop: false });
        break;
      }
      default:
        // The heart and the pickups: nothing.
        break;
    }
  }
  if (mine) payShot(s, launchId, points);
  e.points = points;
  // One that is not his costs him a heart if he is landed, not invulnerable,
  // and his centre is inside it. (A dazed battery cannot cost a heart, by
  // its touch or its blast: §5.2 rule 9.) His own never hurts him.
  if (!mine && !h.hot && s.tick >= h.invulnUntil && s.tick >= b.dazedUntil) {
    const dx = h.x - b.x;
    const dy = h.y - b.y;
    if (dx * dx + dy * dy <= reachSq) {
      e.hurt = true;
      loseHeart(s, tune, b, events, true);
      if (s.hearts <= 0) return false;
    }
  }
  return true;
}

// ── Gum ───────────────────────────────────────────────────────────────

/** How far his centre is from gum's box: 0 inside it. */
export function gapToGum(x: number, y: number, d: Thing): number {
  const cx = x < d.x - GUM_HALF_W ? d.x - GUM_HALF_W : x > d.x + GUM_HALF_W ? d.x + GUM_HALF_W : x;
  const cy = y < d.y - GUM_HALF_H ? d.y - GUM_HALF_H : y > d.y + GUM_HALF_H ? d.y + GUM_HALF_H : y;
  return Math.hypot(x - cx, y - cy);
}

/**
 * His hot body or Spark's ring against gum (§5.4). It takes at most one
 * hit a launch. A straight hit by his body with two left stops him dead on
 * it: that is a landing, with the thump, and he is left at least
 * `gumStopMinPips` pips. Any other hit takes one off, or two if it counts
 * as two (off a cushion, and always by the ring), and he flies on
 * unslowed. 15 points a hit point taken off, flat. Landed, he does nothing
 * to it and it does nothing to him.
 */
export function gumContact(s: State, tune: Tune, d: Thing, events: SimEvent[]): void {
  const h = s.him;
  if (!h.hot) return;
  const l = s.launch;
  const r = s.stats.radius;
  const spark = s.tick < l.sparkUntil;
  const gap = gapToGum(h.x, h.y, d);
  if (gap >= r + (spark ? tune.sparkReach : 0)) return;
  // A thing he overlapped at the release, and a thing this launch has hit already.
  if (l.blocked.length > 0 && l.blocked.includes(d.id)) return;
  if (l.hit.includes(d.id)) return;
  const ring = gap >= r;
  const two = ring || l.cushions > 0;
  const stop = !two && d.hp >= 2;
  const off = Math.min(d.hp, two ? 2 : 1);
  d.hp -= off;
  const points = KINDS.gum.points * off;
  l.points += points;
  s.score += points;
  if (l.points > s.bestShot) s.bestShot = l.points;
  l.hit.push(d.id);
  events.push({ type: "hit", tick: s.tick, x: h.x, y: h.y, kind: "gum", id: d.id, left: d.hp, points, two, source: ring ? "spark" : "body", stop });
  if (stop) {
    // He stops dead on it, and lands. The hit that stops him is not a contact.
    while (s.pips < Math.min(tune.gumStopMinPips, s.stats.pipMax)) givePip(s, "gum", events);
    land(s, tune, events);
    return;
  }
  // A counted hit is a contact. He flies on unslowed; the landing test all the same.
  h.lastContactTick = s.tick;
  h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
  if (!h.hot) land(s, tune, events);
}

