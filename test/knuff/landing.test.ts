import { describe, expect, it } from "vitest";
import { isHot, land } from "../../lib/knuff/sim/hot";
import { hotSpeed } from "../../lib/knuff/sim/physics";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent } from "../../lib/knuff/sim/types";
import { REST, distance, fire, night, of, put, run, scripted, shot, speedOf, tick, tuned, until } from "./room";

/**
 * Hot and landed (§3.5). He is a weapon while he is hot and a target the
 * rest of the time, and there is no third state: the moment a launch is in
 * flight and he is not hot, he lands where he is, with a thump that dazes
 * the dust bunnies beside him and moves nothing.
 */

/** A launch softer than the game ever fires, for the cases that need him near the hot line. */
const SOFT = { minPower: 0.01 };

describe("hot by speed", () => {
  const tune = tuned();
  const hotAt = hotSpeed(tune);

  it("the hot speed is a third of the launch speed: 297 u/s", () => {
    expect(hotAt).toBeCloseTo(297, 9);
    const s = night(tune);
    expect(isHot(s, tune, hotAt)).toBe(true);
    expect(isHot(s, tune, hotAt - 1e-9)).toBe(false);
    expect(isHot(s, tune, 900)).toBe(true);
    // He is hot when he is MOVING and fast: standing still is never hot.
    expect(isHot(s, tune, 0)).toBe(false);
    expect(isHot(s, tuned({ hotFrac: 0 }), 0)).toBe(false);
  });

  it("he is hot for as long as his speed is at or above it, and lands the tick it drops under", () => {
    const s = night(tune);
    const events = tick(s, tune, shot(0, -1, 0.5));
    expect(s.him.hot).toBe(true);
    let ticks = 1;
    while (s.him.hot && ticks < 100) {
      expect(speedOf(s)).toBeGreaterThanOrEqual(hotAt);
      events.push(...tick(s, tune));
      ticks++;
    }
    // A 50% launch in the open is hot for 18 ticks.
    expect(ticks).toBe(18);
    expect(of(events, "land")).toEqual([{ type: "land", tick: 17, x: s.him.x, y: s.him.y, dazed: 0 }]);
    // He stops dead where he is. There is no cool slide.
    expect([s.him.vx, s.him.vy]).toEqual([0, 0]);
    expect(s.him.y).toBeCloseTo(374 - 111.551, 3);
    const stood = [s.him.x, s.him.y];
    run(s, tune, 200);
    expect([s.him.x, s.him.y]).toEqual(stood);
  });

  it("the landing ends the launch", () => {
    const s = night(tune);
    const events = fire(s, tune, shot(0, -1, 0.5));
    expect(s.launch.active).toBe(true);
    events.push(...run(s, tune, 30));
    expect(s.launch.active).toBe(false);
    expect(of(events, "launchEnd")).toEqual([{ type: "launchEnd", tick: 17, x: s.him.x, y: s.him.y, id: 1, pops: 0, total: 0 }]);
    // Once, and not again while he stands.
    expect(of(run(s, tune, 100), "land")).toEqual([]);
  });

  it("a launch released while he is hot does not land him", () => {
    const s = night(tune);
    const events = tick(s, tune, shot(0, -1, 1));
    events.push(...run(s, tune, 9));
    events.push(...tick(s, tune, shot(1, 0, 1)));
    expect(of(events, "land")).toEqual([]);
    expect(s.him.hot).toBe(true);
    expect(s.launch.id).toBe(2);
    // The first launch ended all the same: at the release of the second.
    expect(of(events, "launchEnd").map((e) => [e.tick, e.id])).toEqual([[10, 1]]);
  });

  it("with the knob at 0, a pop that takes him under the hot speed lands him on that tick", () => {
    const soft = tuned(SOFT);
    const s = night(soft);
    const bunny = put(s, "bunny", 180, 374 - 27);
    const events = fire(s, soft, shot(0, -1, 0.36));
    events.push(...until(s, soft, (seen) => of([...events, ...seen], "pop").length > 0, 20));
    const [pop] = of(events, "pop");
    expect(pop.id).toBe(bunny.id);
    // He came in over the line and left the pop under it.
    expect(pop.speed).toBeGreaterThan(hotAt);
    expect(pop.speed * (1 - 0.228)).toBeLessThan(hotAt);
    // So he landed there, on that tick, at the very spot of the contact.
    const [landing] = of(events, "land");
    expect(landing.tick).toBe(pop.tick);
    expect([landing.x, landing.y]).toEqual([pop.hx, pop.hy]);
    expect([s.him.x, s.him.y]).toEqual([pop.hx, pop.hy]);
    expect(s.him.hot).toBe(false);
    expect(events.indexOf(landing)).toBeGreaterThan(events.indexOf(pop));
    // The same pop made faster leaves him over the line, and he flies on.
    const fast = night(soft);
    put(fast, "bunny", 180, 374 - 27);
    const more = fire(fast, soft, shot(0, -1, 0.6), 4);
    expect(of(more, "pop")).toHaveLength(1);
    expect(of(more, "land")).toEqual([]);
    expect(fast.him.hot).toBe(true);
  });

  it("a cushion that takes him under the hot speed lands him at the cushion", () => {
    const soft = tuned(SOFT);
    const s = night(soft);
    s.him.y = 31;
    const events = fire(s, soft, shot(0, -1, 0.37), 6);
    const [cushion] = of(events, "cushion");
    const [landing] = of(events, "land");
    expect(cushion.side).toBe("top");
    expect(cushion.speed).toBeGreaterThan(hotAt);
    expect(cushion.speed * soft.wallRestitution).toBeLessThan(hotAt);
    expect(landing.tick).toBe(cushion.tick);
    // His centre is his radius inside the floor's edge: he stands against the cushion.
    expect(s.him.y).toBe(8 + 13);
    expect(s.him.hot).toBe(false);
    // At full power the same bounce leaves him hot.
    const fast = night(soft);
    fast.him.y = 31;
    const more = fire(fast, soft, shot(0, -1, 1), 3);
    expect(of(more, "cushion")).toHaveLength(1);
    expect(of(more, "land")).toEqual([]);
  });

  it("he lands in the very substep of the bounce or the pop, not at the end of the tick", () => {
    // Fast enough for a tick of two substeps, into a cushion that gives
    // little back: the bounce comes in the first substep and lands him
    // there. He does not use the second to roll away from the cushion.
    const dead = tuned({ wallRestitution: 0.5 });
    const s = night(dead);
    s.him.y = 8 + 13 + 2;
    const events = fire(s, dead, shot(0, -1, 500 / 900));
    expect(of(events, "cushion").map((e) => e.speed)).toEqual([500]);
    expect(of(events, "land")).toEqual([{ type: "land", tick: 0, x: 180, y: 21, dazed: 0 }]);
    expect([s.him.x, s.him.y]).toEqual([180, 21]);
    // The same for a pop: a thing thrown at him takes him under the line in the first substep of two.
    const still = tuned({ bunnySpeed: 0 });
    const t = night(still);
    put(t, "bunny", 180, 374 - 23, { vy: 300 });
    const more = fire(t, still, shot(0, -1, 0.5));
    const [pop] = of(more, "pop");
    expect(pop.speed).toBe(450);
    expect(of(more, "land").map((e) => [e.x, e.y])).toEqual([[pop.hx, pop.hy]]);
    expect([t.him.x, t.him.y]).toEqual([pop.hx, pop.hy]);
    // One substep of a 450 u/s tick is 3.75 u: that is as far as he got.
    expect(374 - t.him.y).toBeCloseTo(3.75, 9);
  });

  it("a launch too soft to be hot never flies: it costs its pip and lands where he stands", () => {
    // No launch in the game is this soft; a table typed by hand can ask for one.
    const soft = tuned(SOFT);
    const s = night(soft);
    const events = tick(s, soft, shot(0, -1, 0.2));
    expect(of(events, "launch")).toHaveLength(1);
    expect(of(events, "land")).toHaveLength(1);
    expect([s.him.x, s.him.y, s.him.vx, s.him.vy]).toEqual([180, 374, 0, 0]);
    expect(s.pips).toBe(soft.pipMax - 1);
  });
});

describe("hot after a pop: popHotTicks", () => {
  const window = tuned({ popHotTicks: 15, minPower: 0.01 });
  const hotAt = hotSpeed(window);

  it("is 0 at the start: only speed counts", () => {
    expect(tuned().popHotTicks).toBe(0);
  });

  it("holds him hot on the tick of the pop and the 14 after it, and he lands on the 15th", () => {
    const s = night(window);
    put(s, "bunny", 180, 374 - 27);
    const events = fire(s, window, shot(0, -1, 0.36));
    events.push(...until(s, window, (seen) => of([...events, ...seen], "pop").length > 0, 20));
    const popTick = of(events, "pop")[0].tick;
    // The near edge: under the line on the very tick of the pop, and still hot.
    expect(speedOf(s)).toBeLessThan(hotAt);
    expect(s.him.hot).toBe(true);
    expect(s.him.lastContactTick).toBe(popTick);
    for (let after = 1; after <= 14; after++) {
      const before = s.him.y;
      events.push(...tick(s, window));
      expect(s.tick - 1).toBe(popTick + after);
      expect(s.him.hot, `${after} ticks after the pop`).toBe(true);
      expect(speedOf(s)).toBeLessThan(hotAt);
      // He is flying, not standing: he moves on every one of them.
      expect(s.him.y).toBeLessThan(before);
    }
    expect(of(events, "land")).toEqual([]);
    // The far edge.
    events.push(...tick(s, window));
    expect(of(events, "land").map((e) => e.tick)).toEqual([popTick + 15]);
    expect(s.him.hot).toBe(false);
    expect([s.him.vx, s.him.vy]).toEqual([0, 0]);
  });

  it("does not hold him before his first pop of the night: under the hot speed in ticks 0 to 13, he lands", () => {
    // "Never" is written -1. Read as a tick, that would be a pop one tick
    // before the night began, and he would be hot on ticks 0 to 13.
    const s = night(window);
    expect(s.him.lastContactTick).toBe(-1);
    for (let t = 0; t <= 13; t++) {
      s.tick = t;
      expect(isHot(s, window, 100), `tick ${t}`).toBe(false);
    }
    s.tick = 0;
    const events = tick(s, window, shot(0, -1, 0.2));
    expect(of(events, "land").map((e) => e.tick)).toEqual([0]);
    expect([s.him.x, s.him.y]).toEqual([180, 374]);
    // With a pop made, the same launch on the same tick flies its window out.
    const popped = night(window);
    popped.him.lastContactTick = 0;
    const more = fire(popped, window, shot(0, -1, 0.2), 20);
    expect(of(more, "land").map((e) => e.tick)).toEqual([15]);
    expect(popped.him.y).toBeLessThan(374 - 30);
  });

  it("each pop starts the window again", () => {
    const s = night(window);
    put(s, "bunny", 180, 374 - 27);
    put(s, "bunny", 180, 374 - 57);
    const events = fire(s, window, shot(0, -1, 0.36), 60);
    const pops = of(events, "pop").map((e) => e.tick);
    expect(pops).toHaveLength(2);
    expect(pops[1] - pops[0]).toBeGreaterThan(2);
    expect(pops[1] - pops[0]).toBeLessThan(15);
    expect(of(events, "land").map((e) => e.tick)).toEqual([pops[1] + 15]);
  });

  it("a cushion does not: only a pop is a contact", () => {
    const s = night(window);
    s.him.y = 60;
    put(s, "bunny", 180, 60 - 27);
    const events = fire(s, window, shot(0, -1, 0.36), 40);
    const popTick = of(events, "pop")[0].tick;
    const cushions = of(events, "cushion").map((e) => e.tick);
    expect(cushions.length).toBeGreaterThanOrEqual(1);
    expect(cushions[0]).toBeGreaterThan(popTick);
    expect(cushions[0]).toBeLessThan(popTick + 15);
    // The bounce left him under the line, and inside the window he flew on.
    expect(of(events, "land").map((e) => e.tick)).toEqual([popTick + 15]);
  });

  it("slowed to rest inside the window, he lands on that tick, with the thump", () => {
    const still = tuned({ popHotTicks: 15, minPower: 0.01, bunnySpeed: 0 });
    const s = night(still);
    // A dust bunny thrown at him takes nearly all his speed as it pops.
    put(s, "bunny", 180, 374 - 23, { vy: 800 });
    const beside = put(s, "bunny", 210, 364);
    const events = fire(s, still, shot(0, -1, 0.34));
    expect(of(events, "pop")).toHaveLength(1);
    expect(speedOf(s)).toBeLessThan(60);
    expect(s.him.hot).toBe(true);
    let last = speedOf(s);
    for (let i = 0; i < 30 && s.him.hot; i++) {
      last = speedOf(s);
      events.push(...tick(s, still));
    }
    const [landing] = of(events, "land");
    // Inside the window, when the toy's slowing took the last of his speed: he was crawling, not cut off.
    expect(landing.tick).toBeLessThan(15);
    expect(last).toBeLessThan(still.restSpeed + 3);
    expect(last).toBeGreaterThan(0);
    expect([s.him.vx, s.him.vy]).toEqual([0, 0]);
    // And it is a landing like any other: the dust bunny beside him is dazed.
    expect(landing.dazed).toBe(1);
    expect(beside.dazedUntil).toBe(landing.tick + still.dazeTicks);
    expect(of(events, "launchEnd")).toHaveLength(1);
  });
});

describe("the thump", () => {
  for (const popHotTicks of [0, 15]) {
    describe(`with popHotTicks at ${popHotTicks}`, () => {
      const tune = tuned({ popHotTicks });

      /** He is set flying by hand and landed where he stands, with the room as the case put it. */
      function landNow(s: ReturnType<typeof night>): SimEvent[] {
        s.tick = 100;
        s.him.hot = true;
        s.him.vx = 120;
        s.him.vy = -50;
        s.launch.active = true;
        s.launch.id = 1;
        const events: SimEvent[] = [];
        land(s, tune, events);
        return events;
      }

      it("dazes every dust bunny whose centre is within 40 u of his, for 36 ticks", () => {
        const s = night(tune);
        const inside = put(s, "bunny", 180 + 39.99, 374);
        const onTheRing = put(s, "bunny", 180, 374 - 40);
        const outside = put(s, "bunny", 180 - 40.01, 374);
        const far = put(s, "bunny", 60, 60);
        const events = landNow(s);
        expect(inside.dazedUntil).toBe(136);
        expect(onTheRing.dazedUntil).toBe(136);
        expect(outside.dazedUntil).toBe(0);
        expect(far.dazedUntil).toBe(0);
        expect(of(events, "daze")).toEqual([
          { type: "daze", tick: 100, id: inside.id, until: 136 },
          { type: "daze", tick: 100, id: onTheRing.id, until: 136 },
        ]);
        expect(of(events, "land")).toEqual([{ type: "land", tick: 100, x: 180, y: 374, dazed: 2 }]);
        expect(tune.thumpRadius).toBe(40);
        expect(tune.dazeTicks).toBe(36);
      });

      it("stops him dead, and ends the launch", () => {
        const s = night(tune);
        const events = landNow(s);
        expect([s.him.vx, s.him.vy, s.him.hot]).toEqual([0, 0, false]);
        expect(s.launch.active).toBe(false);
        expect(of(events, "launchEnd")).toHaveLength(1);
      });

      it("moves nothing", () => {
        const s = night(tune);
        put(s, "bunny", 180 + 22, 374 - 3, { vx: 14, vy: -9 });
        put(s, "bunny", 180 - 30, 374 + 20);
        put(s, "token", 180 + 10, 374 + 28, { vx: 90, vy: 120 });
        put(s, "token", 300, 100, { vx: -150, vy: 0 });
        const before = JSON.stringify(s.things.map((d) => [d.x, d.y, d.vx, d.vy]));
        landNow(s);
        expect(JSON.stringify(s.things.map((d) => [d.x, d.y, d.vx, d.vy]))).toBe(before);
      });

      it("a dust bunny overlapping him is only set down touching him", () => {
        const s = night(tune);
        const over = put(s, "bunny", 180 + 6, 374 - 8);
        const onHim = put(s, "bunny", 180, 374);
        landNow(s);
        // Out along the line between the two centres, to where they touch: 13 + 8 u.
        expect(distance(s, over)).toBeCloseTo(21, 9);
        expect((over.x - 180) / (over.y - 374)).toBeCloseTo(6 / -8, 9);
        // Straight up the room if the centres coincide.
        expect([onHim.x, onHim.y]).toEqual([180, 374 - 21]);
        expect(over.dazedUntil).toBe(136);
        expect(onHim.dazedUntil).toBe(136);
      });

      it("leaves tokens alone: one inside the ring is not dazed and rolls on as it was", () => {
        const s = night(tune);
        const token = put(s, "token", 180 + 25, 374, { vx: -150, vy: 0 });
        landNow(s);
        expect(token.dazedUntil).toBe(0);
        expect([token.vx, token.vy]).toEqual([-150, 0]);
      });

      it("with thumpTurnsTokens on, a token inside the ring is turned to roll straight away", () => {
        const turning = tuned({ popHotTicks, thumpTurnsTokens: true });
        const s = night(turning);
        const inside = put(s, "token", 180 + 18, 374 - 24, { vx: -150, vy: 0 });
        const outside = put(s, "token", 180, 374 - 41, { vx: 0, vy: 150 });
        s.him.hot = true;
        s.launch.active = true;
        land(s, turning, []);
        expect(inside.vx).toBeCloseTo(150 * 0.6, 9);
        expect(inside.vy).toBeCloseTo(150 * -0.8, 9);
        expect(inside.dazedUntil).toBe(0);
        expect([outside.vx, outside.vy]).toEqual([0, 150]);
      });

      it("does not reach a thing that is still announced", () => {
        const s = night(tune);
        const announced = put(s, "bunny", 180 + 20, 374, { landTick: 130 });
        landNow(s);
        expect(announced.dazedUntil).toBe(0);
        expect(announced.x).toBe(200);
      });

      it("never shortens a daze", () => {
        const s = night(tune);
        const long = put(s, "bunny", 180 + 30, 374, { dazedUntil: 400 });
        const events = landNow(s);
        expect(long.dazedUntil).toBe(400);
        expect(of(events, "daze")).toEqual([]);
        // It is inside the ring all the same, and the landing says so.
        expect(of(events, "land")[0].dazed).toBe(1);
      });

      it("a dazed dust bunny stands still and cannot cost a heart; the tick the daze ends, it can", () => {
        // Two dust bunnies side by side, straight ahead. He pops the first
        // and the knock takes him under the line: he lands there, on the
        // second one. With the knob at 15 the pop keeps him hot instead, so
        // this case fires at the hot speed's edge only when it is at 0.
        const soft = tuned({ popHotTicks: 0, minPower: 0.01 });
        const s = night(soft);
        put(s, "bunny", 180 - 8.5, 374 - 25);
        const second = put(s, "bunny", 180 + 8.5, 374 - 25);
        const events = fire(s, soft, shot(0, -1, 0.36));
        events.push(...until(s, soft, (seen) => of([...events, ...seen], "land").length > 0, 20));
        const landed = of(events, "land")[0].tick;
        expect(of(events, "pop")).toHaveLength(1);
        expect(s.things).toEqual([second]);
        // Set down touching him, and dazed.
        expect(distance(s, second)).toBeCloseTo(21, 9);
        expect(second.dazedUntil).toBe(landed + 36);
        const stood = [second.x, second.y];
        // For the 36 ticks of the daze it does not walk, and it costs nothing.
        for (let i = 0; i < 36 && s.tick < landed + 36; i++) {
          events.push(...tick(s, soft));
          expect([second.x, second.y]).toEqual(stood);
          expect([second.wx, second.wy]).toEqual([0, 0]);
        }
        expect(s.tick).toBe(landed + 36);
        expect(of(events, "hurt")).toEqual([]);
        expect(s.hearts).toBe(3);
        // On the tick the daze ends it walks into him.
        events.push(...tick(s, soft));
        expect(of(events, "hurt").map((e) => [e.tick, e.by, e.id])).toEqual([[landed + 36, "bunny", second.id]]);
        expect(s.hearts).toBe(2);
      });
    });
  }
});

describe("there is no third state", () => {
  for (const popHotTicks of [0, 15]) {
    it(`he never moves while he is not hot (popHotTicks ${popHotTicks})`, () => {
      const tune = tuned({ popHotTicks, hearts: 40 });
      const s = createState(77, tune);
      const input = scripted(11);
      const events: SimEvent[] = [];
      let stood: [number, number] | null = null;
      let landedTicks = 0;
      let touched = 0;
      for (let t = 0; t < 9000 && s.phase !== "over"; t++) {
        events.length = 0;
        step(s, input(), tune, events);
        if (s.phase === "waiting") continue;
        const h = s.him;
        if (h.hot) {
          // Hot is flying: a launch in flight, and moving.
          if (!s.launch.active) expect.fail(`hot with no launch in flight at tick ${t}`);
          if (h.vx === 0 && h.vy === 0) expect.fail(`hot and standing still at tick ${t}`);
          stood = null;
          continue;
        }
        // Landed is at rest: no speed at all, and the launch is over.
        if (h.vx !== 0 || h.vy !== 0) expect.fail(`landed and moving at tick ${t}: ${h.vx}, ${h.vy}`);
        if (s.launch.active) expect.fail(`landed with a launch in flight at tick ${t}`);
        if (stood === null) stood = [h.x, h.y];
        // Nothing pushes him: not the things held at arm's length, not a token bouncing off him.
        else if (h.x !== stood[0] || h.y !== stood[1]) expect.fail(`he moved while landed at tick ${t}`);
        landedTicks++;
        if (events.some((e) => e.type === "hurt")) touched++;
      }
      expect(landedTicks).toBeGreaterThan(2000);
      expect(touched).toBeGreaterThan(3);
    });
  }

  it("on the start screen he is landed, and nothing is a threat until the first launch", () => {
    const s = createState(1, tuned());
    expect(s.him.hot).toBe(false);
    expect(run(s, tuned(), 100, REST)).toEqual([]);
    expect(s.tick).toBe(0);
  });
});
