/**
 * `step`: one tick, in place. The only place game state changes.
 *
 * Pure and deterministic: a fixed 60 Hz step over plain data, the random
 * numbers kept inside the State, no DOM, no clock. The same State and the
 * same inputs give the same State, bit for bit. That is what lets a bot
 * stand in for a hand, and the aim line be this very motion run on a copy.
 *
 * The order of a tick is the spec's (§12.4); the numbers in the comments
 * below are its steps. His own motion is the feel toy's, piece for piece:
 * test/knuff/feel-lock.test.ts holds every tick he is hot against the toy.
 */
import { BOSS_HOUR } from "../content/night";
import { bossContact, moveBoss, nightBonus } from "./boss";
import { armedLaunch, bounceOff } from "./charms";
import { countTick, endLaunch, givePip, isHot, isLaunch, land } from "./hot";
import { choose, contacts, moveThings, overlapped, slowThings, spreadBunnies, unblock } from "./intruders";
import { nightStep } from "./night";
import { BOTTOM, DT, LEFT, RIGHT, TOP, applyLaunch, collideWalls, slow, substepsFor } from "./physics";
import { carryFor, countCushion } from "./score";
import type { Input, Side, SimEvent, State, Tune } from "./types";

export { wouldSlow } from "./hot";

export function step(s: State, input: Input, tune: Tune, events: SimEvent[]): void {
  const h = s.him;
  // A launch that is not made of numbers is no launch: one NaN here would
  // spread to every number in the State.
  const asked = isLaunch(input.launch) ? input.launch : null;

  // 1. Phase. Nothing in the room moves until the first launch: without
  // one the tick does not advance. A night that is over stays as it is.
  if (s.phase === "over") return;
  if (s.phase === "waiting") {
    if (asked === null) return;
    if (s.pips <= 0) {
      events.push({ type: "refused", tick: s.tick });
      return;
    }
    // A night begun at 06:00 is the polisher's hour from its first tick.
    s.phase = s.night.hour >= BOSS_HOUR ? "boss" : "night";
    s.night.hourStart = s.tick;
    events.push({ type: "hour", tick: s.tick, hour: s.night.hour });
  }

  // Every mover remembers where it was, so the picture can be drawn between two ticks.
  h.px = h.x;
  h.py = h.y;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    d.px = d.x;
    d.py = d.y;
  }
  const boss = s.boss;
  boss.px = boss.x;
  boss.py = boss.y;

  // 2. The launch. With a pip in hand: spend it, close the launch before
  // this one and open a new one, and set his velocity. With none: refused.
  if (asked !== null) {
    if (s.pips > 0) {
      const carry = carryFor(h.hot, s.launch, tune);
      endLaunch(s, events);
      // The pip timer runs only while he is below the maximum, and starts
      // again when a launch takes him from full.
      if (s.pips >= s.stats.pipMax) s.pipTimer = tune.pipRefillTicks;
      s.pips--;
      // No launch is softer than the minimum.
      const power = applyLaunch(h, { dx: asked.dx, dy: asked.dy, power: Math.max(tune.minPower, asked.power) }, tune);
      s.launch = {
        id: s.launch.id + 1,
        startTick: s.tick,
        active: true,
        carry,
        pops: 0,
        bodyPops: 0,
        refunded: false,
        cushions: 0,
        lastCushionTick: -1,
        coin: false,
        sparkUntil: -1,
        bumped: [],
        hit: [],
        thrown: false,
        points: 0,
        blocked: overlapped(s),
        // Released on a tick after the offer armed: it can take. (The
        // night's part of this tick comes after the launch, so a launch
        // released on the arming tick itself cannot.)
        armed: armedLaunch(s),
        took: false,
        popped: false,
      };
      h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
      events.push({ type: "launch", tick: s.tick, x: h.x, y: h.y, power, carry });
    } else {
      events.push({ type: "refused", tick: s.tick });
    }
  }

  // 3. Slow motion: is this a slowed tick or a normal one.
  countTick(s, input, tune);

  // 4. The night: the hour, the rows due, landings, the clear test.
  let running = nightStep(s, tune, events);
  if (!running) {
    // 05:00 has ended and there is no 06:00 yet: morning.
    s.ended = "morning";
  } else {
    // 5. Timers. One pip comes back every `pipRefillTicks` while he is below the maximum.
    if (s.pips < s.stats.pipMax) {
      s.pipTimer--;
      if (s.pipTimer <= 0) {
        s.pipTimer = tune.pipRefillTicks;
        givePip(s, "timer", events);
      }
    }

    // 6. Choose: each intruder sets its velocity for this tick.
    const fastestThing = choose(s, tune);

    // 7. Move, in substeps small enough that nothing tunnels: the toy's
    // rule, on the fastest mover.
    const speedNow = Math.hypot(h.vx, h.vy);
    let fastest = speedNow > fastestThing ? speedNow : fastestThing;
    if (boss.present && boss.speed > fastest) fastest = boss.speed;
    const n = substepsFor(fastest, tune);
    const sub = DT / n;
    const r = s.stats.radius;
    for (let i = 0; i < n && running; i++) {
      // He moves and bounces off cushions. He never moves while he is not
      // hot. At each bounce an offered plate is taken (if this is an armed
      // launch's first cushion), then the plate fires, then the landing test.
      if (h.hot) {
        h.x += h.vx * sub;
        h.y += h.vy * sub;
        const vxIn = h.vx;
        const vyIn = h.vy;
        const walls = collideWalls(h, r, s.room, tune.wallRestitution);
        if (walls !== 0) {
          const speedIn = Math.hypot(vxIn, vyIn);
          // Two cushions in one substep: the side cushion counts as touched first.
          if (walls & LEFT) cushion(s, tune, events, "left", speedIn);
          if (walls & RIGHT) cushion(s, tune, events, "right", speedIn);
          if (walls & TOP) cushion(s, tune, events, "top", speedIn);
          if (walls & BOTTOM) cushion(s, tune, events, "bottom", speedIn);
          // (A Bumper plate set his speed; the test reads the speed he leaves with.)
          // The landing test, after a cushion bounce.
          h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
          if (!h.hot) land(s, tune, events);
        }
      }
      moveThings(s, tune, sub);
      // The polisher moves and pushes the intruders in its way; then he
      // meets it (its plug is id 0, before every thing), then the things.
      if (boss.present) {
        moveBoss(s, tune, sub, events);
        running = bossContact(s, tune, events);
      }
      // Contacts in the order of `things`, with the landing test after each.
      if (running) running = contacts(s, tune, events);
      if (!running) {
        s.ended = "hearts";
        break;
      }
      if (s.launch.blocked.length > 0) unblock(s);
      spreadBunnies(s);
    }

    if (running) {
      // 9. Slow down: drag on him, then the hot test, then the landing. He
      // may be standing still by then: inside the `popHotTicks` window the
      // toy's slowing can stop him, and that tick is his landing too.
      if (h.hot) h.hot = isHot(s, tune, slow(h, tune.dragK, tune.friction, tune.restSpeed));
      // (A launch too soft to be hot at all never flew: it lands here.)
      if (!h.hot && s.launch.active) land(s, tune, events);
      slowThings(s, tune);
    }
  }

  // 10. Close up. A popped thing is gone. (On most ticks nothing popped,
  // and the list is left as it is.)
  const things = s.things;
  let kept = 0;
  while (kept < things.length && things[kept].hp > 0) kept++;
  if (kept < things.length) {
    for (let i = kept + 1; i < things.length; i++) {
      const d = things[i];
      if (d.hp > 0) things[kept++] = d;
    }
    things.length = kept;
  }
  // A speed that reached zero from below is a negative zero in floating
  // point. Adding zero makes it a plain one and changes no other number,
  // so the State can go through JSON and come back the same.
  h.vx += 0;
  h.vy += 0;
  // The end of the night: zero hearts comes first, then the beaten
  // polisher, then the boss's time (90 s after 06:00 began, beaten or not).
  let bonus = 0;
  if (s.ended === "" && boss.present) {
    if (boss.mode === "down") {
      // Not part of any launch's total, and not of the best shot.
      bonus = nightBonus(s, tune);
      s.score += bonus;
      s.ended = "morning";
    } else if (s.tick + 1 - boss.beganTick >= tune.bossMaxTicks) {
      s.ended = "dawn";
    }
  }
  if (s.ended !== "") {
    // The night ends where it stands. A launch in flight ends with it.
    endLaunch(s, events);
    h.vx = 0;
    h.vy = 0;
    h.hot = false;
    s.phase = "over";
    events.push({ type: "over", tick: s.tick, how: s.ended, score: s.score, bonus });
  }
  s.tick++;
}

function cushion(s: State, tune: Tune, events: SimEvent[], side: Side, speed: number): void {
  // The launch's first cushion: there is none before it, counted or not.
  const first = s.launch.lastCushionTick < 0;
  countCushion(s, tune);
  bounceOff(s, tune, side, first, speed, events);
}
