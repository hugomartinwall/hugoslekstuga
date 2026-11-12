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
import { daze } from "./night";
import { hotSpeed } from "./physics";
import type { Input, SimEvent, State, Thing, Tune } from "./types";

/**
 * Is he hot at `speed`? He is when he is moving and either his speed is at
 * or above the hot speed, or a pop keeps him hot: he has made one and it
 * is less than `popHotTicks` old. With that knob at 0 only speed counts.
 */
export function isHot(s: State, tune: Tune, speed: number): boolean {
  if (!(speed > 0)) return false;
  if (speed >= hotSpeed(tune)) return true;
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
 */
export function land(s: State, tune: Tune, events: SimEvent[]): void {
  const h = s.him;
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
      const touch = tune.himRadius + KINDS.bunny.radius;
      if (distSq < touch * touch) {
        // Out along the line between the two centres; straight up the room if they coincide.
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-6 ? dx / dist : 0;
        const ny = dist > 1e-6 ? dy / dist : -1;
        d.x = h.x + nx * touch;
        d.y = h.y + ny * touch;
        keepInside(s, d);
      }
    } else if (tune.thumpTurnsTokens) {
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
  events.push({ type: "launchEnd", tick: s.tick, x: s.him.x, y: s.him.y, id: l.id, pops: l.pops, total: l.points });
}

/** One pip back, unless he is at the maximum: a pip that would take him over it is lost. */
export function givePip(s: State, tune: Tune, why: "timer" | "pop", events: SimEvent[]): boolean {
  if (s.pips >= tune.pipMax) return false;
  s.pips++;
  events.push({ type: "pip", tick: s.tick, pips: s.pips, why });
  return true;
}

/**
 * A heart is lost to thing `d`. He is invulnerable for `invulnTicks`; a
 * wave goes out; his pips are refilled and the pip timer restarts, so the
 * player always gets one clean shot after a hit.
 */
export function loseHeart(s: State, tune: Tune, d: Thing, events: SimEvent[]): void {
  const h = s.him;
  s.hearts--;
  h.invulnUntil = s.tick + tune.invulnTicks;
  s.lastHurtBy = d.kind;
  s.lastHurtHour = s.night.hour;
  events.push({ type: "hurt", tick: s.tick, x: h.x, y: h.y, by: d.kind, id: d.id, hearts: s.hearts });

  // The wave. It throws every dust bunny within reach straight away from
  // him and turns every token to roll straight away. It pops nothing and
  // dazes nothing, and it throws dazed things too.
  const reachSq = tune.hitWaveRadius * tune.hitWaveRadius;
  for (let i = 0; i < s.things.length; i++) {
    const o = s.things[i];
    if (o.hp <= 0 || s.tick < o.landTick) continue;
    const dx = o.x - h.x;
    const dy = o.y - h.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;
    const dist = Math.sqrt(distSq);
    const nx = dist > 1e-6 ? dx / dist : 1;
    const ny = dist > 1e-6 ? dy / dist : 0;
    const speed = o.kind === "bunny" ? tune.hitWaveSpeed : tune.tokenSpeed;
    o.vx = nx * speed;
    o.vy = ny * speed;
  }

  const had = s.pips;
  s.pips = tune.pipMax;
  s.pipTimer = tune.pipRefillTicks;
  if (s.pips > had) events.push({ type: "pip", tick: s.tick, pips: s.pips, why: "heart" });
}

// ── Slow motion ───────────────────────────────────────────────────────

/** Is there a threat: is the night on, with at least one thing that can hurt him alive or announced? */
export function threat(s: State): boolean {
  if (s.phase !== "night" && s.phase !== "boss") return false;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp > 0 && KINDS[d.kind].hurts) return true;
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
