/**
 * `step`: one tick, in place. The only place game state changes.
 *
 * Pure and deterministic: a fixed 60 Hz step over plain data, the random
 * numbers kept inside the State, no DOM, no clock. The same State and the
 * same inputs give the same State, bit for bit. That is what lets a bot
 * stand in for a hand, and the aim line be this very motion run on a copy.
 *
 * Step 0 is the feel toy's tick, laid out in the order the game's tick
 * will have (the numbers are the spec's): the launch (2), arrivals (4),
 * the move in substeps (7), slowing down (9), closing up (10). He still
 * slides on after he cools, as in the toy; the landing is step 1's.
 */
import { respawnDummies } from "./dummies";
import {
  BOTTOM,
  DT,
  LEFT,
  RIGHT,
  TOP,
  applyLaunch,
  bumpHim,
  collideWalls,
  contain,
  hotSpeed,
  popImpulse,
  pushApart,
  slow,
  substepsFor,
} from "./physics";
import type { Input, SimEvent, State, Tune } from "./types";

export function step(s: State, input: Input, tune: Tune, events: SimEvent[]): void {
  const h = s.him;
  const room = s.room;
  const r = tune.himRadius;
  const hotAt = hotSpeed(tune);

  // Every mover remembers where it was, so the picture can be drawn between two ticks.
  h.px = h.x;
  h.py = h.y;
  for (const d of s.things) {
    d.px = d.x;
    d.py = d.y;
  }

  // 2. The launch. A new one closes the one before it. A launch that is
  // not made of numbers is no launch: one NaN here would spread to every
  // number in the State.
  const l = input.launch;
  if (l && Number.isFinite(l.dx) && Number.isFinite(l.dy) && l.power > 0 && (l.dx !== 0 || l.dy !== 0)) {
    const power = applyLaunch(h, l, tune);
    s.launch = { id: s.launch.id + 1, startTick: s.tick, pops: 0, cushions: 0 };
    events.push({ type: "launch", tick: s.tick, x: h.x, y: h.y, power });
  }

  // 4. Arrivals: the dummies that are due come back.
  respawnDummies(s, events);

  // 7. Move everything, in substeps small enough that nothing tunnels.
  let fastest = Math.hypot(h.vx, h.vy);
  for (const d of s.things) {
    if (!d.alive) continue;
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > fastest) fastest = sp;
  }
  const n = substepsFor(fastest, tune);
  const sub = DT / n;
  for (let i = 0; i < n; i++) {
    h.x += h.vx * sub;
    h.y += h.vy * sub;
    const speedIn = Math.hypot(h.vx, h.vy);
    const walls = collideWalls(h, r, room, tune.wallRestitution);
    if (walls !== 0) {
      // Two cushions in one substep: the side cushion counts as touched first.
      if (walls & LEFT) cushion(s, events, "left", speedIn);
      if (walls & RIGHT) cushion(s, events, "right", speedIn);
      if (walls & TOP) cushion(s, events, "top", speedIn);
      if (walls & BOTTOM) cushion(s, events, "bottom", speedIn);
    }
    for (const d of s.things) {
      if (!d.alive) continue;
      d.x += d.vx * sub;
      d.y += d.vy * sub;
      collideWalls(d, d.r, room, tune.lightWallRestitution);
    }

    // His body against each thing, in the order of `things`.
    for (const d of s.things) {
      if (!d.alive) continue;
      const dx = d.x - h.x;
      const dy = d.y - h.y;
      const dist = Math.hypot(dx, dy);
      const reach = r + d.r;
      if (dist >= reach) continue;
      const nx = dist > 1e-6 ? dx / dist : 0;
      const ny = dist > 1e-6 ? dy / dist : -1;
      const speedNow = Math.hypot(h.vx, h.vy);
      const closing = (h.vx - d.vx) * nx + (h.vy - d.vy) * ny;
      if (speedNow >= hotAt) {
        // Fast: the thing pops, and he feels only part of the knock.
        popImpulse(h, nx, ny, closing, tune.lightMass, tune);
        d.alive = false;
        d.respawnIn = tune.dummyRespawnTicks;
        s.launch.pops++;
        events.push({ type: "pop", tick: s.tick, x: d.x, y: d.y, id: d.id, kind: d.kind, n: s.launch.pops, speed: speedNow });
        continue;
      }
      // Slow (or a thing drifting into him): an ordinary bump.
      bumpHim(h, d, nx, ny, reach - dist, closing, tune.lightMass, tune);
    }

    // Light things pushed apart.
    for (let a = 0; a < s.things.length; a++) {
      const A = s.things[a];
      if (!A.alive) continue;
      for (let b = a + 1; b < s.things.length; b++) {
        const B = s.things[b];
        if (!B.alive) continue;
        pushApart(A, A.r, B, B.r, tune.lightMass, tune);
      }
    }

    // Contacts may have pushed something through a cushion: put it back.
    contain(h, r, room);
    for (const d of s.things) if (d.alive) contain(d, d.r, room);
  }

  // 9. Slow down: drag on him, then the hot test. Knocked things slow.
  const speed = slow(h, tune.dragK, tune.friction, tune.restSpeed);
  for (const d of s.things) {
    if (!d.alive) continue;
    slow(d, tune.lightDragK, tune.lightFriction, tune.lightRestSpeed);
  }
  h.hot = speed >= hotAt;

  // 10. Close up. A speed that reached zero from below is a negative zero
  // in floating point. Adding zero makes it a plain one and changes no
  // other number, so the State can go through JSON and come back the same.
  h.vx += 0;
  h.vy += 0;
  for (const d of s.things) {
    d.vx += 0;
    d.vy += 0;
  }
  s.tick++;
}

function cushion(s: State, events: SimEvent[], side: "left" | "right" | "top" | "bottom", speed: number): void {
  s.launch.cushions++;
  events.push({ type: "cushion", tick: s.tick, x: s.him.x, y: s.him.y, side, speed });
}
