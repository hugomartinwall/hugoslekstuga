import { describe, expect, it } from "vitest";
import { KINDS } from "../../lib/knuff/content/kinds";
import { land } from "../../lib/knuff/sim/hot";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent } from "../../lib/knuff/sim/types";
import { distance, fire, night, of, put, run, shot, tick, tuned } from "./room";

/**
 * The two intruders of the first two minutes (§5.1, §5.2, §5.4). A dust
 * bunny walks toward him, its heading swinging. A runaway token rolls
 * straight, mirrors off cushions, never steers and never slows. Dust
 * bunnies are kept from overlapping each other; every other pair of
 * intruders passes through each other.
 */

describe("the kind table", () => {
  it("a dust bunny: radius 8, one hit, 10 points; a token: radius 7, one hit, 25 points", () => {
    expect(KINDS.bunny).toEqual({ radius: 8, boxW: 0, boxH: 0, hits: 1, points: 10, hurts: true, clear: true, intruder: true });
    expect(KINDS.token).toEqual({ radius: 7, boxW: 0, boxH: 0, hits: 1, points: 25, hurts: true, clear: true, intruder: true });
  });

  it("both weigh 0.35 of him: a head-on pop takes 22.8% of his closing speed", () => {
    const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    expect(tune.lightMass).toBe(0.35);
    for (const kind of ["bunny", "token"] as const) {
      const s = night(tune);
      put(s, kind, 180, 374 - 22);
      const events = fire(s, tune, shot(0, -1));
      const [pop] = of(events, "pop");
      expect(pop.speed).toBe(900);
      // The knock he feels: 0.55 of what a body of that mass would give him.
      const share = (tune.popImpulseScale * (1 + tune.bodyRestitution)) / (1 + 1 / tune.lightMass);
      expect(share).toBeCloseTo(0.228, 3);
      // He flies on, that much slower, with the tick's drag on top.
      const dragged = (v: number) => v * Math.exp(-tune.dragK / 60) - tune.friction / 60;
      expect(Math.hypot(s.him.vx, s.him.vy)).toBeCloseTo(dragged(900 * (1 - share)), 9);
      expect(s.him.hot).toBe(true);
    }
  });
});

describe("a dust bunny", () => {
  const tune = tuned({ tokenSpeed: 0 });

  it("walks toward him at 22 u/s, its heading turned by its wobble", () => {
    const s = night(tune);
    const bunny = put(s, "bunny", 180 + 120, 374 - 160, { phase: 0.9 });
    for (let t = 0; t < 200; t++) {
      const from = { x: bunny.x, y: bunny.y };
      tick(s, tune);
      // Its walk this tick: `bunnySpeed` along the bearing to him, rotated by wobble × sin(phase + rate × tick).
      const bearing = Math.atan2(374 - from.y, 180 - from.x);
      const heading = bearing + tune.bunnyWobble * Math.sin(0.9 + tune.bunnyWobbleRate * t);
      expect(bunny.wx).toBeCloseTo(22 * Math.cos(heading), 9);
      expect(bunny.wy).toBeCloseTo(22 * Math.sin(heading), 9);
      expect(Math.hypot(bunny.wx, bunny.wy)).toBeCloseTo(22, 9);
      // And that is how far it went.
      expect(bunny.x - from.x).toBeCloseTo(bunny.wx / 60, 9);
      expect(bunny.y - from.y).toBeCloseTo(bunny.wy / 60, 9);
    }
    expect([tune.bunnySpeed, tune.bunnyWobble, tune.bunnyWobbleRate]).toEqual([22, 0.6, 0.07]);
  });

  it("swings 0.6 rad each way, one cycle in about 90 ticks, and still closes on him", () => {
    const s = night(tune);
    const bunny = put(s, "bunny", 180, 374 - 200, { phase: 0 });
    const off: number[] = [];
    const started = distance(s, bunny);
    for (let t = 0; t < 200; t++) {
      const bearing = Math.atan2(374 - bunny.y, 180 - bunny.x);
      tick(s, tune);
      let turn = Math.atan2(bunny.wy, bunny.wx) - bearing;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      off.push(turn);
    }
    expect(Math.max(...off)).toBeCloseTo(0.6, 2);
    expect(Math.min(...off)).toBeCloseTo(-0.6, 2);
    // One cycle is 2π / 0.07 ticks: it crosses its bearing four times in 200 ticks.
    let crossings = 0;
    for (let i = 1; i < off.length; i++) if (off[i - 1] * off[i] < 0) crossings++;
    expect(crossings).toBe(4);
    expect(2 * Math.PI / tune.bunnyWobbleRate).toBeCloseTo(89.8, 1);
    // 200 ticks of walking at 22 u/s is 73 u, less what the swing costs: well over 55 u nearer.
    expect(started - distance(s, bunny)).toBeGreaterThan(55);
    expect(started - distance(s, bunny)).toBeLessThan(73.4);
  });

  it("each has its own phase, drawn from the behaviour stream when it is made", () => {
    const s = createState(3, tuned());
    const phases = s.things.map((d) => d.phase);
    expect(new Set(phases).size).toBe(4);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(2 * Math.PI);
    }
    // So the rack does not walk in step.
    const events: SimEvent[] = [];
    step(s, shot(1, 0, 0.5), tuned(), events);
    expect(new Set(s.things.slice(0, 4).map((d) => d.wx.toFixed(6))).size).toBe(4);
  });

  it("does not walk while it is announced, and walks from the tick it lands", () => {
    const s = night(tune);
    const bunny = put(s, "bunny", 180 + 150, 374 - 150, { landTick: 10 });
    run(s, tune, 10);
    expect([bunny.x, bunny.y, bunny.wx, bunny.wy]).toEqual([330, 224, 0, 0]);
    tick(s, tune);
    expect(Math.hypot(bunny.wx, bunny.wy)).toBeCloseTo(22, 9);
    expect(bunny.x).not.toBe(330);
  });

  it("a shove is added on top of its walk and dies away", () => {
    const s = night(tune);
    const bunny = put(s, "bunny", 180 + 150, 374, { vx: 200, vy: 0, phase: 0 });
    tick(s, tune);
    // Walking toward him (to the left) and shoved away (to the right): the shove wins, for now.
    expect(bunny.wx).toBeLessThan(-18);
    expect(bunny.x - 330).toBeCloseTo((bunny.wx + 200) / 60, 9);
    expect(bunny.vx).toBeCloseTo(200 * Math.exp(-tune.lightDragK / 60) - tune.lightFriction / 60, 9);
    run(s, tune, 120);
    expect([bunny.vx, bunny.vy]).toEqual([0, 0]);
    // The walk never stopped.
    expect(Math.hypot(bunny.wx, bunny.wy)).toBeCloseTo(22, 9);
  });

  it("a shoved dust bunny bounces off a cushion and stays on the floor", () => {
    const still = tuned({ bunnySpeed: 0 });
    const s = night(still);
    const bunny = put(s, "bunny", 352 - 30, 100, { vx: 400, vy: 0 });
    run(s, still, 8);
    // It reached the right cushion and came back off it, with the toy's 0.55 of its speed.
    expect(bunny.vx).toBeLessThan(0);
    expect(bunny.x).toBeLessThanOrEqual(352 - 8);
    expect(still.lightWallRestitution).toBe(0.55);
  });
});

describe("a runaway token", () => {
  const tune = tuned({ bunnySpeed: 0 });

  it("rolls straight at 150 u/s", () => {
    const s = night(tune);
    const token = put(s, "token", 60, 60, { vx: 90, vy: 120 });
    run(s, tune, 60);
    expect(token.x).toBeCloseTo(60 + 90, 9);
    expect(token.y).toBeCloseTo(60 + 120, 9);
    expect([token.vx, token.vy]).toEqual([90, 120]);
    expect(tune.tokenSpeed).toBe(150);
  });

  it("mirrors off the cushions with no loss, never steers and never slows", () => {
    const s = night(tune);
    // He is given hearts enough to be rolled over all night without the night ending.
    s.hearts = 1000;
    const token = put(s, "token", 30, 30, { vx: 90, vy: 120 });
    const speeds = new Set<string>();
    let turns = 0;
    let last = [token.vx, token.vy];
    for (let t = 0; t < 3000; t++) {
      tick(s, tune);
      speeds.add(`${Math.abs(token.vx)},${Math.abs(token.vy)}`);
      if (token.vx !== last[0] || token.vy !== last[1]) turns++;
      last = [token.vx, token.vy];
      // Its radius inside the floor, always.
      expect(token.x).toBeGreaterThanOrEqual(8 + 7);
      expect(token.x).toBeLessThanOrEqual(352 - 7);
      expect(token.y).toBeGreaterThanOrEqual(8 + 7);
      expect(token.y).toBeLessThanOrEqual(472 - 7);
    }
    // Fifty seconds, dozens of cushions (and him, now and then), and every turn was a mirror or the wave: 150 u/s to the end.
    expect(turns).toBeGreaterThan(20);
    expect(Math.hypot(token.vx, token.vy)).toBeCloseTo(150, 9);
    // Left alone by him, its two speeds only ever change sign.
    const alone = night(tune);
    alone.him.invulnUntil = 1e9;
    alone.him.x = 30;
    alone.him.y = 440;
    const far = put(alone, "token", 200, 60, { vx: 150, vy: 0 });
    run(alone, tune, 600);
    expect(Math.abs(far.vx)).toBe(150);
    expect(far.vy).toBe(0);
    expect(far.y).toBe(60);
  });

  it("does not roll while it is announced: it stands on its spot, pointed the way it will go", () => {
    const s = night(tune);
    const token = put(s, "token", 100, 100, { landTick: 20, vx: 150, vy: 0 });
    run(s, tune, 20);
    expect([token.x, token.y, token.vx]).toEqual([100, 100, 150]);
    tick(s, tune);
    expect(token.x).toBe(102.5);
  });
});

describe("an envelope (the newsletter)", () => {
  const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
  const DEG = Math.PI / 180;

  it("is a circle of radius 9, one hit, 15 points; it hurts on touch and counts for clear", () => {
    expect(KINDS.envelope).toEqual({ radius: 9, boxW: 0, boxH: 0, hits: 1, points: 15, hurts: true, clear: true, intruder: true });
  });

  it("weighs 0.2 of him: a head-on pop takes 14.7% of his closing speed", () => {
    const still = tuned({ envelopeSpeed: 0 });
    expect(still.envelopeMass).toBe(0.2);
    const s = night(still);
    put(s, "envelope", 180, 374 - 23);
    const [pop] = of(fire(s, still, shot(0, -1)), "pop");
    expect([pop.kind, pop.speed]).toEqual(["envelope", 900]);
    const share = (still.popImpulseScale * (1 + still.bodyRestitution)) / (1 + 1 / still.envelopeMass);
    expect(share).toBeCloseTo(0.147, 3);
    const dragged = (v: number) => v * Math.exp(-still.dragK / 60) - still.friction / 60;
    expect(Math.hypot(s.him.vx, s.him.vy)).toBeCloseTo(dragged(900 * (1 - share)), 9);
  });

  it("flies at 60 u/s, its heading turned toward him by at most 0.5 degrees a tick", () => {
    expect([tune.envelopeSpeed, tune.envelopeTurnDeg]).toEqual([60, 0.5]);
    const s = night(tune);
    s.him.invulnUntil = 1e9;
    // Heading straight right, with him below it: it turns toward him, half a degree a tick.
    const e = put(s, "envelope", 60, 100, { heading: 0 });
    let last = e.heading;
    for (let t = 0; t < 30; t++) {
      tick(s, tune);
      const bearing = Math.atan2(s.him.y - e.y, s.him.x - e.x);
      expect(e.heading - last).toBeCloseTo(0.5 * DEG, 12);
      expect(e.heading).toBeLessThan(bearing);
      last = e.heading;
    }
    expect(Math.hypot(e.wx, e.wy)).toBeCloseTo(60, 9);
    // Its last tick's flight moved it a sixtieth of that.
    expect(Math.hypot(e.x - e.px, e.y - e.py)).toBeCloseTo(1, 9);
    // Pointed at him, it does not turn past him: it flies straight at him.
    const s2 = night(tune);
    s2.him.invulnUntil = 1e9;
    const at = put(s2, "envelope", 180, 100, { heading: Math.PI / 2 });
    run(s2, tune, 30);
    expect(at.heading).toBe(Math.PI / 2);
    expect(at.x).toBeCloseTo(180, 9);
  });

  it("at a cushion its heading is mirrored; a shove on top bounces as a dummy's does, and dies away", () => {
    const s = night(tune);
    s.him.x = 180;
    s.him.y = 440;
    // Flying up-left into the top cushion: its heading is mirrored, and it flies down-left.
    const e = put(s, "envelope", 100, 17.5, { heading: -0.75 * Math.PI });
    tick(s, tune);
    expect(e.y).toBe(8 + 9);
    expect(Math.sin(e.heading)).toBeGreaterThan(0);
    expect(Math.cos(e.heading)).toBeLessThan(0);
    for (let t = 0; t < 600; t++) {
      tick(s, tune);
      expect(e.x).toBeGreaterThanOrEqual(8 + 9);
      expect(e.x).toBeLessThanOrEqual(352 - 9);
      expect(e.y).toBeGreaterThanOrEqual(8 + 9);
      expect(e.y).toBeLessThanOrEqual(472 - 9);
    }
    // A shove dies away as a dummy's does; its flight does not.
    const s2 = night(tuned({ envelopeSpeed: 0 }));
    const shoved = put(s2, "envelope", 180, 200, { vx: 200, vy: 0 });
    run(s2, tuned({ envelopeSpeed: 0 }), 120);
    expect([shoved.vx, shoved.vy]).toEqual([0, 0]);
  });

  it("dazed, it stands still and keeps its heading; when the daze ends it flies on as before", () => {
    const s = night(tune);
    s.him.invulnUntil = 1e9;
    const e = put(s, "envelope", 100, 100, { heading: 0.3, dazedUntil: 20 });
    run(s, tune, 20);
    expect([e.x, e.y, e.heading, e.wx, e.wy]).toEqual([100, 100, 0.3, 0, 0]);
    tick(s, tune);
    expect(e.x).toBeGreaterThan(100);
    expect(Math.hypot(e.wx, e.wy)).toBeCloseTo(60, 9);
  });

  it("passes through dust bunnies, tokens and other envelopes", () => {
    const s = night(tuned({ bunnySpeed: 0, tokenSpeed: 0, envelopeSpeed: 0 }));
    const a = put(s, "envelope", 100, 100);
    const b = put(s, "envelope", 104, 100);
    const d = put(s, "bunny", 100, 106);
    run(s, tuned({ bunnySpeed: 0, tokenSpeed: 0, envelopeSpeed: 0 }), 10);
    expect([a.x, a.y, b.x, b.y, d.x, d.y]).toEqual([100, 100, 104, 100, 100, 106]);
  });
});

describe("intruders and each other", () => {
  it("dust bunnies are kept from overlapping: pushed apart equally along the line between them", () => {
    const still = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(still);
    const a = put(s, "bunny", 100, 100);
    const b = put(s, "bunny", 106, 108);
    tick(s, still);
    // 10 u apart, they are moved to 16 u (two radii), each by 3 u, along the 3-4-5 line they were on.
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(16, 9);
    expect([a.x, a.y]).toEqual([100 - 1.8, 100 - 2.4].map((v) => expect.closeTo(v, 9)));
    expect([b.x, b.y]).toEqual([106 + 1.8, 108 + 2.4].map((v) => expect.closeTo(v, 9)));
    // Positions only: no change of speed.
    expect([a.vx, a.vy, b.vx, b.vy]).toEqual([0, 0, 0, 0]);
    // Two on the very same spot part along the room's width.
    const c = put(s, "bunny", 250, 250);
    const d = put(s, "bunny", 250, 250);
    tick(s, still);
    expect([c.x, c.y, d.x, d.y]).toEqual([242, 250, 258, 250]);
  });

  it("a bunch walking at him stays a bunch: no two ever closer than their two radii", () => {
    const tune = tuned();
    const s = night(tune, { kinds: [] });
    // He cannot be hurt, so they are held at arm's length and crowd round him.
    s.him.invulnUntil = 1e9;
    for (let i = 0; i < 9; i++) put(s, "bunny", 60 + (i % 3) * 18, 60 + Math.floor(i / 3) * 18, { phase: i * 0.7 });
    let closest = Infinity;
    for (let t = 0; t < 1800; t++) {
      tick(s, tune);
      const bunnies = s.things;
      for (let i = 0; i < bunnies.length; i++) {
        for (let j = i + 1; j < bunnies.length; j++) {
          closest = Math.min(closest, Math.hypot(bunnies[i].x - bunnies[j].x, bunnies[i].y - bunnies[j].y));
        }
      }
    }
    // They reached him: the nearest stands touching him, give or take the crowd's push.
    const nearest = Math.min(...s.things.map((d) => distance(s, d)));
    expect(nearest).toBeGreaterThan(20);
    expect(nearest).toBeLessThan(21.5);
    // And nine of them pressing in on one spot are still nine separate dust bunnies:
    // pressed together, never overlapping by more than the push of a tick.
    expect(closest).toBeLessThan(16.01);
    expect(closest).toBeGreaterThan(16 - 2);
  });

  it("a dust bunny pushed against a cushion stays on the floor", () => {
    const still = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(still);
    const inner = put(s, "bunny", 8 + 8 + 4, 200);
    const outer = put(s, "bunny", 8 + 8, 200);
    tick(s, still);
    expect(outer.x).toBe(16);
    expect(inner.x).toBeGreaterThan(outer.x);
    for (const d of s.things) expect(d.x).toBeGreaterThanOrEqual(16);
  });

  it("tokens pass through dust bunnies and through each other", () => {
    const tune = tuned({ bunnySpeed: 0 });
    const s = night(tune);
    const bunny = put(s, "bunny", 200, 100);
    const token = put(s, "token", 150, 100, { vx: 150, vy: 0 });
    const other = put(s, "token", 250, 100, { vx: -150, vy: 0 });
    run(s, tune, 40);
    // The two tokens crossed, right through the dust bunny, and nothing was moved or turned.
    expect([bunny.x, bunny.y]).toEqual([200, 100]);
    expect([token.x, token.vx]).toEqual([250, 150]);
    expect([other.x, other.vx]).toEqual([150, -150]);
    expect(s.things).toHaveLength(3);
  });
});

describe("a thing he overlaps at the release", () => {
  it("cannot be popped by that launch until he has left it", () => {
    const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(tune);
    // A dazed dust bunny he is standing half on, and one clear of him, both straight ahead.
    const under = put(s, "bunny", 180, 374 - 10, { dazedUntil: 1e6 });
    const ahead = put(s, "bunny", 180, 374 - 60);
    const events = fire(s, tune, shot(0, -1), 6);
    expect(s.launch.id).toBe(1);
    // He flew out of the first without popping it, and popped the second.
    expect(of(events, "pop").map((e) => e.id)).toEqual([ahead.id]);
    expect(s.things).toEqual([under]);
    // Once he has left it, it is no longer barred: the list is empty again.
    expect(s.launch.blocked).toEqual([]);
  });

  it("can be popped when he comes back to it", () => {
    const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(tune);
    s.him.y = 60;
    const under = put(s, "bunny", 180, 60 + 10, { dazedUntil: 1e6 });
    // Up, off the top cushion, and back down through where he stood.
    const events = fire(s, tune, shot(0, -1), 12);
    expect(of(events, "cushion")).toHaveLength(1);
    expect(of(events, "pop").map((e) => e.id)).toEqual([under.id]);
  });

  it("the list is what he overlaps on the tick of the release, and nothing he merely touches", () => {
    const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(tune);
    s.him.invulnUntil = 1e6;
    const over = put(s, "token", 180 + 5, 374);
    // Held at arm's length by an earlier tick: exactly touching, to the left.
    const touching = put(s, "bunny", 180 - 21, 374);
    tick(s, tune, shot(0, -1));
    expect(s.launch.blocked).toEqual([over.id]);
    expect(s.things).toContain(touching);
  });

  it("a dust bunny the thump set down touching him is popped by the next launch straight at it, on the release tick", () => {
    const tune = tuned({ bunnySpeed: 0 });
    const touch = tune.himRadius + KINDS.bunny.radius;
    let underByARounding = 0;
    for (let deg = 0; deg < 360; deg += 5) {
      const s = night(tune);
      const a = (deg * Math.PI) / 180;
      // Overlapping him as he lands: the thump sets it down touching him, out along the line between them.
      const d = put(s, "bunny", s.him.x + Math.cos(a) * 10, s.him.y + Math.sin(a) * 10);
      s.him.hot = true;
      s.launch.active = true;
      s.launch.id = 1;
      land(s, tune, []);
      const at = `${deg}°`;
      expect(distance(s, d), at).toBeCloseTo(touch, 9);
      // Set down by floating point, it can lie a rounding inside his reach: touching all the same.
      if (distance(s, d) < touch) underByARounding++;
      expect(d.dazedUntil, at).toBeGreaterThan(s.tick);
      const events = tick(s, tune, shot(Math.cos(a), Math.sin(a)));
      expect(s.launch.id, at).toBe(2);
      expect(of(events, "pop").map((e) => e.id), at).toEqual([d.id]);
      expect(s.launch.blocked, at).toEqual([]);
    }
    expect(underByARounding).toBeGreaterThan(0);
  });

  it("a thing that lands on him on the tick of the release was not there when he let go: that launch pops it", () => {
    const tune = tuned({ bunnySpeed: 0, tokenSpeed: 0 });
    const s = night(tune);
    // By the order of a tick the release (step 2) comes before the
    // landings (step 4): on the release tick these two are still announced.
    const landing = put(s, "bunny", 180 + 6, 374 - 12, { landTick: s.tick });
    const token = put(s, "token", 180 - 8, 374 - 10, { landTick: s.tick });
    // One that landed the tick before is under him at the release: barred, and he flies through it.
    const under = put(s, "token", 180, 374 - 6, { landTick: s.tick - 1 });
    const events = tick(s, tune, shot(0, -1));
    expect(
      of(events, "pop")
        .map((e) => e.id)
        .sort(),
    ).toEqual([landing.id, token.id].sort());
    expect(s.things).toEqual([under]);
  });
});
