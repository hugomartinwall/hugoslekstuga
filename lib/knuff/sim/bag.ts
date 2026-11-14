/**
 * Venture capital: the money bag of 00:00 (spec §5.3, §5.4), and the
 * timers of what comes and goes by itself: the tokens it lets out, and the
 * love heart.
 *
 * The bag is a large round sack that creeps toward him. He cannot move it,
 * and neither can the wave or a blast; only the polisher pushes it. It
 * takes `bagHits` hits: at most one a launch (his body and Spark's ring
 * together), two if the hit comes off a cushion; the ring's always counts
 * as two, and a blast of his is always one. Each hit point taken off pays
 * 40, flat. His hot body bounces off it (`bodyRestitution`), hit or not,
 * and that bounce is a contact. Landed, it costs him a heart when it
 * touches him, unless it is dazed or he is invulnerable. For every second
 * hit point it loses it lets out a runaway token at its rim, on the side
 * away from him, dazed for a telegraph and then rolling straight away from
 * it; such a token stops and fades `bagTokenLife` after it appeared.
 *
 * Everything here that changes a State is called from `step` only.
 */
import { KINDS } from "../content/kinds";
import { isHot, land, loseHeart } from "./hot";
import { addThing, announce, daze, intruders } from "./night";
import type { SimEvent, State, Thing, Tune } from "./types";

export const BAG_R = KINDS.bag.radius;
const TOKEN_R = KINDS.token.radius;

/** The bag's telegraph is twice an arrival's: 72 ticks at the starting values (§3.3). */
export function bagTelegraph(tune: Tune): number {
  return 2 * tune.telegraphTicks;
}

/**
 * An arrival lands dazed this close to him: `arriveDazedWithin`, and for
 * the bag that much past its rim (94 u: 60 + its radius, §3.3).
 */
export function dazedWithin(kind: Thing["kind"], tune: Tune): number {
  return kind === "bag" ? tune.arriveDazedWithin + BAG_R : tune.arriveDazedWithin;
}

/**
 * Hit points come off the bag: `off` of them, from `source`. Pays 40 each,
 * flat, into the launch in flight for his body and the ring (a blast pays
 * through its own books: the caller adds `points` there). For every second
 * hit point lost (at 6, 4, 2 and 0 left) a token comes out. At none left it
 * is gone. Returns what the hit paid.
 */
export function takeOff(s: State, tune: Tune, d: Thing, off: number, events: SimEvent[]): number {
  const before = d.hp;
  d.hp = Math.max(0, d.hp - off);
  const taken = before - d.hp;
  const every = tune.bagTokenEvery;
  if (every > 0) {
    for (let k = before - 1; k >= d.hp; k--) if ((tune.bagHits - k) % every === 0) letOut(s, tune, d, events);
  }
  return KINDS.bag.points * taken;
}

/**
 * Where on the bag's rim a token comes out: the side away from him, the
 * token's centre `out` from the bag's. A bag against a cushion (the
 * polisher pushes it there) can have that spot outside the floor; then the
 * spot slides along the rim, a degree at a time each way, to the nearest
 * one that is inside it, toward the middle of the room on a tie. Returns
 * the way out, from the bag's centre: the token stands there and rolls
 * that way, straight away from the bag.
 */
export function rimOut(s: State, bag: Thing, out: number): { nx: number; ny: number } {
  const h = s.him;
  const len = Math.hypot(bag.x - h.x, bag.y - h.y);
  const away = len > 1e-6 ? Math.atan2(bag.y - h.y, bag.x - h.x) : -Math.PI / 2;
  const room = s.room;
  const inside = (a: number) => {
    const x = bag.x + Math.cos(a) * out;
    const y = bag.y + Math.sin(a) * out;
    return x >= room.left + TOKEN_R && x <= room.right - TOKEN_R && y >= room.top + TOKEN_R && y <= room.bottom - TOKEN_R;
  };
  const midX = (room.left + room.right) / 2;
  const midY = (room.top + room.bottom) / 2;
  const fromMid = (a: number) => Math.hypot(bag.x + Math.cos(a) * out - midX, bag.y + Math.sin(a) * out - midY);
  let a = away;
  for (let k = 0; k <= 180; k++) {
    const turn = (k * Math.PI) / 180;
    const plus = inside(away + turn);
    const minus = k > 0 && inside(away - turn);
    if (plus || minus) {
      a = plus && minus ? (fromMid(away - turn) < fromMid(away + turn) ? away - turn : away + turn) : plus ? away + turn : away - turn;
      break;
    }
  }
  // Straight on (k = 0) is the plain case: the way away from him, as it always was (straight up the room if the centres coincide).
  if (a === away) return len > 1e-6 ? { nx: (bag.x - h.x) / len, ny: (bag.y - h.y) / len } : { nx: 0, ny: -1 };
  return { nx: Math.cos(a), ny: Math.sin(a) };
}

/**
 * A token comes out of the bag: at its rim on the side away from him (kept
 * on the floor: `rimOut`), dazed for `dazeTicks` (the daze is its
 * telegraph), then rolling straight away from the bag. It does not come
 * while the room is at the cap.
 */
function letOut(s: State, tune: Tune, bag: Thing, events: SimEvent[]): void {
  if (intruders(s) >= tune.roomCap) return;
  const h = s.him;
  const out = BAG_R + TOKEN_R;
  const { nx, ny } = rimOut(s, bag, out);
  const d = addThing(s, "token", bag.x + nx * out, bag.y + ny * out, s.tick, nx * tune.tokenSpeed + 0, ny * tune.tokenSpeed + 0);
  d.goneTick = s.tick + tune.bagTokenLife;
  announce(s, d, events);
  daze(s, d, s.tick + tune.dazeTicks, events);
  events.push({ type: "arrive", tick: s.tick, x: d.x, y: d.y, id: d.id, kind: d.kind, dist: Math.hypot(d.x - h.x, d.y - h.y), dazed: true });
  events.push({ type: "bagToken", tick: s.tick, x: d.x, y: d.y, id: d.id, bag: bag.id });
}

/** A counted hit by his body or Spark's ring: one or two hit points, flat, into the launch in flight. */
function hitBag(s: State, tune: Tune, d: Thing, two: boolean, source: "body" | "spark", events: SimEvent[]): void {
  const h = s.him;
  const l = s.launch;
  l.hit.push(d.id);
  const points = takeOff(s, tune, d, two ? 2 : 1, events);
  l.points += points;
  s.score += points;
  if (l.points > s.bestShot) s.bestShot = l.points;
  events.push({ type: "hit", tick: s.tick, x: h.x, y: h.y, kind: "bag", id: d.id, left: d.hp, points, two, source, stop: false });
  // A counted hit is a contact.
  h.lastContactTick = s.tick;
}

/**
 * Him against the bag, in the order of `things` (§5.3). Spark's ring, while
 * it lasts and reaches the bag past his body, takes one hit that counts as
 * two if the bag has not been hit this launch. His hot body bounces off it
 * (by his speed relative to its creep) and, if this launch has not hit it,
 * hits it: one, or two off a cushion. A launch released on top of it
 * cannot hit it until he has left it (rule 5); it still bounces him.
 * Landed, a touch costs a heart unless it is dazed or he is invulnerable;
 * then it is held at arm's length. Returns false if that was his last heart.
 */
export function bagContact(s: State, tune: Tune, d: Thing, events: SimEvent[]): boolean {
  const h = s.him;
  const l = s.launch;
  const r = s.stats.radius;
  const reach = r + BAG_R;
  const spark = h.hot && s.tick < l.sparkUntil;
  const far = spark ? reach + tune.sparkReach : reach;
  const dx = d.x - h.x;
  const dy = d.y - h.y;
  if (dx >= far || dx <= -far || dy >= far || dy <= -far) return true;
  const dist = Math.hypot(dx, dy);
  if (dist >= far) return true;
  const blocked = l.blocked.length > 0 && l.blocked.includes(d.id);
  const hitAlready = l.hit.includes(d.id);
  if (dist >= reach) {
    // Only the ring reaches it: one hit that counts as two, if the bag has not been hit this launch.
    if (!blocked && !hitAlready) {
      hitBag(s, tune, d, true, "spark", events);
      h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
      if (!h.hot) land(s, tune, events);
    }
    return true;
  }
  const nx = dist > 1e-6 ? dx / dist : 0;
  const ny = dist > 1e-6 ? dy / dist : -1;
  if (h.hot) {
    // He bounces off it: it cannot be moved, so he is set touching it, out along the line between the centres.
    const speedIn = Math.hypot(h.vx, h.vy);
    h.x = d.x - nx * reach;
    h.y = d.y - ny * reach;
    const closing = (h.vx - d.wx) * nx + (h.vy - d.wy) * ny;
    if (closing > 0) {
      h.vx -= (1 + tune.bodyRestitution) * closing * nx;
      h.vy -= (1 + tune.bodyRestitution) * closing * ny;
    }
    // A bounce off the money bag is a contact (§3.5).
    h.lastContactTick = s.tick;
    if (!blocked && !hitAlready) hitBag(s, tune, d, l.cushions > 0, "body", events);
    else events.push({ type: "bounce", tick: s.tick, x: h.x, y: h.y, kind: "bag", id: d.id, speed: speedIn });
    // The landing test, after every contact.
    h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
    if (!h.hot) land(s, tune, events);
    return true;
  }
  // Landed: a touch costs a heart, unless it is dazed or he is invulnerable.
  if (s.tick >= d.dazedUntil && s.tick >= h.invulnUntil) {
    loseHeart(s, tune, d, events);
    return s.hearts > 0;
  }
  // Held at arm's length (§3.5), and never moved by him (§5.4): its own creep
  // into him is undone, so it stands touching him. A bag that was on him
  // already as the tick began (it landed on him dazed, or crept on while he
  // could not be hurt) stays where it was: overlapping, so his next launch
  // cannot hit it until he has left it (rule 5).
  const sx = d.px - h.x;
  const sy = d.py - h.y;
  if (sx * sx + sy * sy < reach * reach) {
    d.x = d.px;
    d.y = d.py;
    return true;
  }
  d.x = h.x + nx * reach;
  d.y = h.y + ny * reach;
  const room = s.room;
  d.x = Math.min(room.right - BAG_R, Math.max(room.left + BAG_R, d.x));
  d.y = Math.min(room.bottom - BAG_R, Math.max(room.top + BAG_R, d.y));
  return true;
}

/**
 * Step 5's part: what goes by itself. A token the bag let out stops and
 * fades `bagTokenLife` after it appeared: it is gone, harmless and worth
 * nothing. The love heart leaves `heartLife` after its tile came.
 */
export function fades(s: State, events: SimEvent[]): void {
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.goneTick < 0 || d.hp <= 0 || s.tick < d.goneTick) continue;
    d.hp = 0;
    if (d.kind === "heart") events.push({ type: "heartGone", tick: s.tick, x: d.x, y: d.y, id: d.id });
    else events.push({ type: "fade", tick: s.tick, x: d.x, y: d.y, id: d.id });
  }
}
