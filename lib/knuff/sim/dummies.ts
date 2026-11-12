/**
 * The feel toy's dummies: something to hit while the room has no night.
 *
 * STEP 0 ONLY. Step 1 brings dust bunnies, tokens and the timetable, and
 * this file goes: the rack becomes the 19:00 rack and a respawn becomes an
 * arrival. Nothing else in the simulation depends on how a dummy comes
 * back, only that `things` holds bodies with a radius.
 *
 * A dummy pops when he hits it hot and comes back `dummyRespawnTicks`
 * later at a random spot away from him, in the same slot of `things` and
 * under a new id, as in the toy.
 */
import { rand } from "./rng";
import type { SimEvent, State, Thing, Tune } from "./types";

/** The room never holds more dummies than this, whatever the knob says. */
export const MAX_DUMMIES = 40;

/**
 * The opening picture: a tight triangle straight ahead, apex toward him,
 * so the very first release is a break shot. Placed in the room's own
 * 360 × 480 (`roomW`, `roomH`), as the toy places it, whatever the
 * floor's edges are.
 */
export function rackDummies(s: State, tune: Tune, roomW: number, roomH: number): void {
  const r = 12;
  const gap = 1;
  const cx = roomW / 2;
  const apexY = roomH * 0.34;
  const rowH = (2 * r + gap) * 0.87;
  // The knob can be typed by hand into a link: a slip of the finger must
  // not ask for a million of them.
  const count = Math.min(tune.dummyCount, MAX_DUMMIES);
  let made = 0;
  for (let row = 0; row < 3 && made < count; row++) {
    for (let i = 0; i <= row && made < count; i++) {
      const x = cx + (i - row / 2) * (2 * r + gap);
      const y = apexY - row * rowH;
      s.things.push({
        id: s.nextId++,
        kind: "dummy",
        x,
        y,
        px: x,
        py: y,
        vx: 0,
        vy: 0,
        r,
        alive: true,
        respawnIn: 0,
        bornTick: -1,
      });
      made++;
    }
  }
  while (made < count) {
    // More than six asked for: the rest arrive like any respawn.
    s.things.push({
      id: s.nextId++,
      kind: "dummy",
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      r: 10 + Math.floor(rand(s.rng, "arrivals") * 4),
      alive: false,
      respawnIn: 1 + made,
      bornTick: -1,
    });
    made++;
  }
}

/** Put a popped dummy back somewhere clear of him and of the others. False if no spot was found. */
function tryRespawn(s: State, d: Thing, events: SimEvent[]): boolean {
  const room = s.room;
  const r = 10 + Math.floor(rand(s.rng, "arrivals") * 4);
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = room.left + r + 14 + rand(s.rng, "arrivals") * (room.right - room.left - 2 * (r + 14));
    const y = room.top + r + 14 + rand(s.rng, "arrivals") * (room.bottom - room.top - 2 * (r + 14));
    if (Math.hypot(x - s.him.x, y - s.him.y) < 96) continue;
    let clear = true;
    for (const o of s.things) {
      if (!o.alive) continue;
      if (Math.hypot(x - o.x, y - o.y) < r + o.r + 8) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    d.id = s.nextId++;
    d.x = x;
    d.y = y;
    d.px = x;
    d.py = y;
    d.vx = 0;
    d.vy = 0;
    d.r = r;
    d.alive = true;
    d.bornTick = s.tick;
    events.push({ type: "arrive", tick: s.tick, x, y, id: d.id, kind: d.kind });
    return true;
  }
  return false;
}

/** Count down the popped dummies and bring back the ones that are due. */
export function respawnDummies(s: State, events: SimEvent[]): void {
  for (const d of s.things) {
    if (d.alive) continue;
    d.respawnIn--;
    if (d.respawnIn <= 0 && !tryRespawn(s, d, events)) d.respawnIn = 6;
  }
}
