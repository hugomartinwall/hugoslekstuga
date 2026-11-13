/**
 * Hot and landed, the thump, hearts and the wave, pips, and the
 * slow-motion meter (spec §3.5 to §3.8).
 *
 * He is a weapon while he is hot and a target the rest of the time. There
 * is no third state: the moment a launch is in flight and he is not hot,
 * he lands where he is.
 *
 * Everything here that changes a State is called from `step` only.
 */
import { KINDS } from "../content/kinds";
import { keepShot } from "./battery";
import { takeUnderHim } from "./charms";
import { takeHeart } from "./intruders";
import { daze } from "./night";
import type { Input, SimEvent, State, Thing, Tune } from "./types";

/**
 * Is he hot at `speed`? He is when he is moving and either his speed is at
 * or above the hot speed (his, after charms: lower with Long burn), or a
 * contact keeps him hot: he has made one and it is less than `popHotTicks`
 * old. With that knob at 0 only speed counts.
 */
export function isHot(s: State, tune: Tune, speed: number): boolean {
  if (!(speed > 0)) return false;
  if (speed >= s.stats.hotSpeed) return true;
  const last = s.him.lastContactTick;
  return last >= 0 && s.tick - last < tune.popHotTicks;
}

/** Keep a thing's centre its radius inside the floor. Its position only. */
export function keepInside(s: State, d: Thing): void {
  const r = KINDS[d.kind].radius;
  const room = s.room;
  if (d.x < room.left + r) d.x = room.left + r;
  else if (d.x > room.right - r) d.x = room.right - r;
  if (d.y < room.top + r) d.y = room.top + r;
  else if (d.y > room.bottom - r) d.y = room.bottom - r;
}

/**
 * The landing. His velocity is set to zero where he is, and the thump
 * dazes every dust bunny whose centre is within `thumpRadius` of his. The
 * thump moves nothing: a dust bunny overlapping him is only set down
 * touching him. A landing also tops up the slow-motion meter and ends the
 * launch.
 *
 * The tick he lands is still part of the launch: an armed launch that sets
 * him down on a pickup's tile takes it, before he lands.
 */
export function land(s: State, tune: Tune, events: SimEvent[]): void {
  const h = s.him;
  takeUnderHim(s, tune, events);
  // So is the love heart's tile, if he lands on it.
  for (let i = 0; i < s.things.length; i++) if (s.things[i].kind === "heart") takeHeart(s, s.things[i], events);
  h.vx = 0;
  h.vy = 0;
  h.hot = false;
  const reachSq = tune.thumpRadius * tune.thumpRadius;
  const until = s.tick + tune.dazeTicks;
  let dazed = 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    // An announced thing cannot be touched, and a popped one is gone.
    if (d.hp <= 0 || s.tick < d.landTick) continue;
    const dx = d.x - h.x;
    const dy = d.y - h.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;
    if (d.kind === "bunny") {
      daze(s, d, until, events);
      dazed++;
      const touch = s.stats.radius + KINDS.bunny.radius;
      if (distSq < touch * touch) {
        // Out along the line between the two centres; straight up the room if they coincide.
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-6 ? dx / dist : 0;
        const ny = dist > 1e-6 ? dy / dist : -1;
        d.x = h.x + nx * touch;
        d.y = h.y + ny * touch;
        keepInside(s, d);
      }
    } else if (d.kind === "token" && tune.thumpTurnsTokens) {
      // The fallback: a token inside the ring is turned to roll straight away.
      const dist = Math.sqrt(distSq);
      const nx = dist > 1e-6 ? dx / dist : 0;
      const ny = dist > 1e-6 ? dy / dist : -1;
      d.vx = nx * tune.tokenSpeed;
      d.vy = ny * tune.tokenSpeed;
    }
  }
  if (s.slow.meter < tune.slowLandingFloor) s.slow.meter = tune.slowLandingFloor;
  events.push({ type: "land", tick: s.tick, x: h.x, y: h.y, dazed });
  endLaunch(s, events);
}

/** Close the launch in flight, if there is one. Its total is already in the score and the best shot. */
export function endLaunch(s: State, events: SimEvent[]): void {
  const l = s.launch;
  if (!l.active) return;
  l.active = false;
  if (l.blocked.length > 0) l.blocked.length = 0;
  // A battery it knocked still alive: its total is kept, for that blast to add to (§5.4).
  keepShot(s);
  events.push({ type: "launchEnd", tick: s.tick, x: s.him.x, y: s.him.y, id: l.id, pops: l.pops, total: l.points });
}

/** One pip back, unless he is at the maximum (his, after charms): a pip that would take him over it is lost. */
export function givePip(s: State, why: "timer" | "pop" | "plate" | "gum", events: SimEvent[]): boolean {
  if (s.pips >= s.stats.pipMax) return false;
  s.pips++;
  events.push({ type: "pip", tick: s.tick, pips: s.pips, why });
  return true;
}

/**
 * A heart is lost to `d`: a thing in the room, or the polisher's pad (kind
 * "polisher", id 0). He is invulnerable for `invulnTicks`; a wave goes out;
 * his pips are refilled and the pip timer restarts, so the player always
 * gets one clean shot after a hit.
 */
export function loseHeart(s: State, tune: Tune, d: { kind: Thing["kind"] | "polisher"; id: number }, events: SimEvent[], blast = false): void {
  const h = s.him;
  s.hearts--;
  h.invulnUntil = s.tick + tune.invulnTicks;
  s.lastHurtBy = d.kind;
  s.lastHurtHour = s.night.hour;
  events.push({ type: "hurt", tick: s.tick, x: h.x, y: h.y, by: d.kind, id: d.id, hearts: s.hearts, blast });

  // The wave. It throws every dust bunny, envelope and battery within reach straight
  // away from him and turns every token to roll straight away. It pops
  // nothing and dazes nothing, it throws dazed things too, and it changes
  // no battery's timers or owner.
  const reachSq = tune.hitWaveRadius * tune.hitWaveRadius;
  for (let i = 0; i < s.things.length; i++) {
    const o = s.things[i];
    // The wave moves intruders; a pickup's tile lies where it lies, and gum and the money bag ignore it.
    if (o.hp <= 0 || s.tick < o.landTick || o.kind === "pickup" || o.kind === "heart" || o.kind === "gum" || o.kind === "bag") continue;
    const dx = o.x - h.x;
    const dy = o.y - h.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;
    const dist = Math.sqrt(distSq);
    const nx = dist > 1e-6 ? dx / dist : 1;
    const ny = dist > 1e-6 ? dy / dist : 0;
    const speed = o.kind === "token" ? tune.tokenSpeed : tune.hitWaveSpeed;
    o.vx = nx * speed;
    o.vy = ny * speed;
  }

  const had = s.pips;
  s.pips = s.stats.pipMax;
  s.pipTimer = tune.pipRefillTicks;
  if (s.pips > had) events.push({ type: "pip", tick: s.tick, pips: s.pips, why: "heart" });
}

// ── Slow motion ───────────────────────────────────────────────────────

/** Is there a threat: is the night on, with at least one thing that can hurt him alive or announced (the polisher among them)? */
export function threat(s: State): boolean {
  if (s.phase !== "night" && s.phase !== "boss") return false;
  if (s.boss.present) return true;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    // A battery that is his can never cost him a heart.
    if (d.hp > 0 && KINDS[d.kind].hurts && !d.mine) return true;
  }
  return false;
}

/** A launch `step` would take up: made of numbers, with a direction and some power. */
export function isLaunch(l: Input["launch"]): l is NonNullable<Input["launch"]> {
  return l !== null && Number.isFinite(l.dx) && Number.isFinite(l.dy) && l.power > 0 && (l.dx !== 0 || l.dy !== 0);
}

/**
 * Would the next tick be a slowed one? It is when a pull is held, there is
 * a threat and the meter is above zero. The shell asks this before each
 * tick to decide how fast to feed them; `step` asks it of itself.
 */
export function wouldSlow(s: State, input: Input): boolean {
  if (!input.pullHeld || s.slow.meter <= 0) return false;
  if (s.phase === "waiting") {
    // Nothing moves until the first launch. The tick that takes it starts
    // the night, and from then on the rack is a threat.
    if (!isLaunch(input.launch) || s.pips <= 0) return false;
    for (let i = 0; i < s.things.length; i++) if (KINDS[s.things[i].kind].hurts) return true;
    return false;
  }
  return threat(s);
}

/**
 * Step 3 of a tick: count it as slowed or as normal. A slowed tick takes
 * one from the meter. While no pull is held the meter gets one back every
 * `slowRefillTicks`.
 */
export function countTick(s: State, input: Input, tune: Tune): void {
  if (input.pullHeld && s.slow.meter > 0 && threat(s)) {
    s.slow.meter--;
    s.slowedTicks++;
    return;
  }
  s.normalTicks++;
  if (!input.pullHeld && s.slow.meter < tune.slowMeterMax) {
    s.slow.refill++;
    if (s.slow.refill >= tune.slowRefillTicks) {
      s.slow.refill = 0;
      s.slow.meter++;
    }
  }
}
