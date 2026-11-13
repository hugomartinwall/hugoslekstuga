import { describe, expect, it } from "vitest";
import { KINDS } from "../../lib/knuff/content/kinds";
import { carryFor, chainFor, countCushion, cushionsFor } from "../../lib/knuff/sim/score";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State, Tune } from "../../lib/knuff/sim/types";
import { fire, night, of, put, run, scripted, shot, tick, tuned, until } from "./room";

/**
 * Score (§7). A pop scores points × chain × cushions. The chain is counted
 * inside one launch, and a launch released while he is still hot carries
 * it one step on. Cushions touched before the pop multiply it. A launch's
 * total is everything scored from its release to the next release or the
 * landing, and the largest total of the night is the best shot.
 */

/** Things that stay where they are put. */
const STILL = { bunnySpeed: 0, tokenSpeed: 0 };

/** A night with dust bunnies standing in a line straight ahead of him, 30 u apart. */
function line(tune: Tune, n: number, kind: "bunny" | "token" = "bunny"): State {
  const s = night(tune);
  for (let i = 0; i < n; i++) put(s, kind, 180, 374 - 40 - i * 30);
  return s;
}

describe("a pop", () => {
  const tune = tuned(STILL);

  it("a dust bunny is worth 10 and a token 25", () => {
    expect(KINDS.bunny.points).toBe(10);
    expect(KINDS.token.points).toBe(25);
    const s = night(tune);
    put(s, "bunny", 180, 374 - 40);
    const events = fire(s, tune, shot(0, -1), 4);
    expect(of(events, "pop").map((e) => [e.kind, e.n, e.chain, e.cushions, e.points])).toEqual([["bunny", 1, 1, 1, 10]]);
    expect(s.score).toBe(10);
    const t = night(tune);
    put(t, "token", 180, 374 - 40);
    fire(t, tune, shot(0, -1), 4);
    expect(t.score).toBe(25);
  });

  it("the nth pop of a launch is worth n times as much", () => {
    const s = line(tune, 4);
    const events = fire(s, tune, shot(0, -1), 20);
    expect(of(events, "pop").map((e) => [e.n, e.chain, e.points])).toEqual([
      [1, 1, 10],
      [2, 2, 20],
      [3, 3, 30],
      [4, 4, 40],
    ]);
    expect(s.score).toBe(100);
  });

  it("the straight shot into the opening rack: three of the four for 60, and all four for 100 with popHotTicks at 15", () => {
    // The known opening (§3.9). With only speed keeping him hot, three
    // pops leave him too slow to reach the fourth: he lands in the rack,
    // one short.
    const real = tuned();
    const s = createState(1, real);
    const events = fire(s, real, shot(0, -1), 40);
    expect(of(events, "pop").map((e) => e.points)).toEqual([10, 20, 30]);
    expect(of(events, "land")).toHaveLength(1);
    expect(s.things.filter((d) => d.landTick === -1)).toHaveLength(1);
    expect(s.score).toBe(60);
    expect(s.bestShot).toBe(60);
    const kind = tuned({ popHotTicks: 15 });
    const k = createState(1, kind);
    const more = fire(k, kind, shot(0, -1), 40);
    expect(of(more, "pop").map((e) => e.points)).toEqual([10, 20, 30, 40]);
    expect(k.score).toBe(100);
  });

  it("the chain stops growing at 8", () => {
    // Light things, so that ten pops in a row leave him flying.
    const light = tuned({ ...STILL, lightMass: 0.02 });
    const s = line(light, 10);
    const events = fire(s, light, shot(0, -1), 30);
    expect(of(events, "pop").map((e) => e.chain)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
    expect(s.score).toBe(10 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 8 + 8));
    expect(light.chainCap).toBe(8);
    expect(chainFor(9, 0, light)).toBe(8);
    expect(chainFor(3, 0, tuned({ chainCap: 2 }))).toBe(2);
  });

  it("the chain is counted inside one launch: after a landing the next starts at 1", () => {
    const s = line(tune, 2);
    const events = fire(s, tune, shot(0, -1), 80);
    expect(of(events, "land")).toHaveLength(1);
    put(s, "bunny", s.him.x, s.him.y - 40);
    events.push(...fire(s, tune, shot(0, -1), 10));
    expect(of(events, "pop").map((e) => [e.n, e.chain])).toEqual([
      [1, 1],
      [2, 2],
      [1, 1],
    ]);
  });

  it("two pops in the same tick are scored in the order of the room", () => {
    // Side by side, both in reach on the same tick: the first in the list is the first pop.
    const s = night(tune);
    const right = put(s, "bunny", 180 + 8.5, 374 - 30);
    const left = put(s, "bunny", 180 - 8.5, 374 - 30);
    const events = fire(s, tune, shot(0, -1), 3);
    const pops = of(events, "pop");
    expect(pops.map((e) => e.id)).toEqual([right.id, left.id]);
    expect(pops[0].tick).toBe(pops[1].tick);
    expect(pops.map((e) => e.points)).toEqual([10, 20]);
  });
});

describe("the carry", () => {
  const tune = tuned({ ...STILL, lightMass: 0.02, pipMax: 9 });

  it("is 0 for a launch released while he is landed", () => {
    const s = line(tune, 1);
    const events = fire(s, tune, shot(0, -1), 80);
    events.push(...fire(s, tune, shot(0, 1), 3));
    expect(of(events, "launch").map((e) => e.carry)).toEqual([0, 0]);
    expect(carryFor(false, { ...s.launch, active: true, popped: true, carry: 2 }, tune)).toBe(0);
  });

  it("a launch released while he is hot, after a launch that popped something, starts one step higher", () => {
    const s = line(tune, 3);
    const events = fire(s, tune, shot(0, -1), 5);
    expect(of(events, "pop")).toHaveLength(2);
    expect(s.him.hot).toBe(true);
    events.push(...fire(s, tune, shot(0, -1), 6));
    expect(of(events, "launch").map((e) => e.carry)).toEqual([0, 1]);
    // Its first pop is the second step of the chain.
    expect(of(events, "pop").map((e) => [e.n, e.chain, e.points])).toEqual([
      [1, 1, 10],
      [2, 2, 20],
      [1, 2, 20],
    ]);
    expect(s.launch.carry).toBe(1);
  });

  it("each such launch carries one step more, up to 3", () => {
    const s = night(tune);
    const carries: number[] = [];
    const firstChains: number[] = [];
    // Six launches in a row, each released while he is still flying, each
    // popping the dust bunny that is put straight ahead of it.
    for (let i = 0; i < 6; i++) {
      s.him.x = 180;
      s.him.y = 240;
      put(s, "bunny", 180, 240 - 30);
      const events = fire(s, tune, shot(0, -1), 3);
      const pops = of(events, "pop");
      expect(pops, `launch ${i + 1}`).toHaveLength(1);
      expect(s.him.hot).toBe(true);
      carries.push(of(events, "launch")[0].carry);
      firstChains.push(pops[0].chain);
    }
    expect(carries).toEqual([0, 1, 2, 3, 3, 3]);
    expect(firstChains).toEqual([1, 2, 3, 4, 4, 4]);
    expect(tune.carryMax).toBe(3);
  });

  it("a launch that pops nothing puts the next carry back to 0", () => {
    const s = line(tune, 2);
    const events = fire(s, tune, shot(0, -1), 5);
    expect(of(events, "pop")).toHaveLength(2);
    // Hot, and off sideways into nothing; then hot again, and another launch.
    events.push(...fire(s, tune, shot(1, 0), 3));
    events.push(...fire(s, tune, shot(-1, 0), 3));
    expect(s.him.hot).toBe(true);
    expect(of(events, "launch").map((e) => e.carry)).toEqual([0, 1, 0]);
  });

  it("and so does any landing", () => {
    const s = line(tune, 2);
    const events = fire(s, tune, shot(0, -1), 90);
    expect(of(events, "pop")).toHaveLength(2);
    expect(s.him.hot).toBe(false);
    events.push(...fire(s, tune, shot(1, 0), 3));
    expect(of(events, "launch").map((e) => e.carry)).toEqual([0, 0]);
  });

  it("the carry counts toward the cap of 8", () => {
    expect(chainFor(6, 3, tune)).toBe(8);
    expect(chainFor(5, 3, tune)).toBe(8);
    expect(chainFor(4, 3, tune)).toBe(7);
    expect(carryFor(true, { ...night(tune).launch, active: true, popped: true, carry: 3 }, tune)).toBe(3);
    expect(carryFor(true, { ...night(tune).launch, active: true, popped: false, carry: 2 }, tune)).toBe(0);
  });
});

describe("cushions", () => {
  const tune = tuned(STILL);

  it("a pop after one cushion is doubled, after two or more tripled", () => {
    expect(cushionsFor(0, tune)).toBe(1);
    expect(cushionsFor(1, tune)).toBe(2);
    expect(cushionsFor(2, tune)).toBe(3);
    expect(cushionsFor(3, tune)).toBe(3);
    expect(cushionsFor(7, tune)).toBe(3);
    expect(tune.cushionCap).toBe(3);
  });

  it("a bank shot: off the top cushion and back into a dust bunny for 20", () => {
    const s = night(tune);
    s.him.y = 100;
    put(s, "bunny", 180 + 30, 130);
    const events = fire(s, tune, shot(0.18, -1), 30);
    expect(of(events, "cushion").map((e) => e.side)).toEqual(["top"]);
    expect(of(events, "pop").map((e) => [e.chain, e.cushions, e.points])).toEqual([[1, 2, 20]]);
  });

  it("only cushions touched before the pop count for it", () => {
    const s = night(tune);
    s.him.y = 100;
    put(s, "bunny", 180, 100 - 30);
    const events = fire(s, tune, shot(0, -1), 12);
    const pop = of(events, "pop")[0];
    const cushion = of(events, "cushion")[0];
    expect(cushion.tick).toBeGreaterThan(pop.tick);
    expect(pop.cushions).toBe(1);
    expect(s.launch.cushions).toBe(1);
  });

  it("the first cushion of a launch always counts, even on its first tick", () => {
    const s = night(tune);
    s.him.y = 8 + 13 + 4;
    const events = fire(s, tune, shot(0, -1));
    expect(of(events, "cushion")).toHaveLength(1);
    expect(s.launch.cushions).toBe(1);
    expect(s.launch.lastCushionTick).toBe(0);
  });

  it("a corner is one cushion: two touched in the same tick", () => {
    const s = night(tune);
    s.him.x = 8 + 13 + 20;
    s.him.y = 8 + 13 + 20;
    const events = fire(s, tune, shot(-1, -1), 4);
    const cushions = of(events, "cushion");
    expect(cushions.map((e) => e.side)).toEqual(["left", "top"]);
    expect(cushions[0].tick).toBe(cushions[1].tick);
    expect(s.launch.cushions).toBe(1);
  });

  it("a cushion within 9 ticks of the last one touched does not count again; at 10 it does", () => {
    const s = night(tune);
    s.launch.active = true;
    const touch = (at: number) => {
      s.tick = at;
      countCushion(s, tune);
      return s.launch.cushions;
    };
    expect(touch(100)).toBe(1);
    expect(touch(109)).toBe(1);
    expect(s.launch.lastCushionTick).toBe(109);
    // Measured from the last cushion TOUCHED, counted or not: a rattle is one cushion however long it lasts.
    expect(touch(118)).toBe(1);
    expect(touch(127)).toBe(1);
    expect(touch(137)).toBe(2);
    expect(touch(147)).toBe(3);
    expect(tune.cushionMergeTicks).toBe(9);
  });

  it("a new launch starts with none", () => {
    const s = night(tuned({ ...STILL, pipMax: 9 }));
    s.him.y = 40;
    fire(s, tune, shot(0, -1), 3);
    expect(s.launch.cushions).toBe(1);
    tick(s, tune, shot(0, 1));
    expect(s.launch.cushions).toBe(0);
    expect(s.launch.lastCushionTick).toBe(-1);
  });
});

describe("points × chain × cushions", () => {
  it("a token, third pop of a launch that carried one step in, after a cushion: 25 × 4 × 2", () => {
    const tune = tuned({ ...STILL, lightMass: 0.02, pipMax: 9 });
    const s = night(tune);
    s.him.x = 180;
    s.him.y = 200;
    // A first launch pops one thing, and he is launched again while hot.
    put(s, "bunny", 180, 170);
    const events = fire(s, tune, shot(0, -1), 2);
    expect(of(events, "pop")).toHaveLength(1);
    // The second launch: off the top cushion, then two dust bunnies and a token on the way back down.
    s.him.x = 100;
    s.him.y = 60;
    put(s, "bunny", 100, 85);
    put(s, "bunny", 100, 115);
    put(s, "token", 100, 145);
    events.length = 0;
    events.push(...fire(s, tune, shot(0, -1), 13));
    const pops = of(events, "pop");
    expect(of(events, "launch")[0].carry).toBe(1);
    expect(pops.map((e) => [e.kind, e.n, e.chain, e.cushions, e.points])).toEqual([
      ["bunny", 1, 2, 2, 40],
      ["bunny", 2, 3, 2, 60],
      ["token", 3, 4, 2, 200],
    ]);
  });

  it("the most a pop can be multiplied in the first two minutes is 8 × 3", () => {
    const tune = tuned();
    expect(chainFor(99, 3, tune) * cushionsFor(99, tune)).toBe(24);
  });
});

describe("a launch's total, the score and the best shot", () => {
  const tune = tuned(STILL);

  it("a launch's total is what it scored from its release to its landing", () => {
    const s = line(tune, 3);
    const events = fire(s, tune, shot(0, -1), 90);
    expect(s.launch.points).toBe(60);
    expect(of(events, "launchEnd")).toEqual([{ type: "launchEnd", tick: of(events, "land")[0].tick, x: s.him.x, y: s.him.y, id: 1, pops: 3, total: 60 }]);
    expect(s.score).toBe(60);
    expect(s.bestShot).toBe(60);
  });

  it("or to the next release", () => {
    const s = line(tuned({ ...STILL, lightMass: 0.02 }), 4);
    const light = tuned({ ...STILL, lightMass: 0.02 });
    const events = fire(s, light, shot(0, -1), 4);
    events.push(...fire(s, light, shot(0, -1), 8));
    const ends = of(events, "launchEnd");
    expect(ends).toHaveLength(1);
    expect([ends[0].id, ends[0].pops, ends[0].total]).toEqual([1, 2, 30]);
    // The second launch carried the chain on: its two pops are the 2nd and 3rd steps.
    expect(s.launch.points).toBe(20 + 30);
    expect(s.score).toBe(80);
    expect(s.bestShot).toBe(50);
  });

  it("the best shot is the largest total of the night, and a smaller launch does not lower it", () => {
    const s = line(tune, 2);
    fire(s, tune, shot(0, -1), 90);
    expect(s.bestShot).toBe(30);
    put(s, "bunny", s.him.x + 40, s.him.y);
    fire(s, tune, shot(1, 0), 90);
    expect(s.score).toBe(40);
    expect(s.bestShot).toBe(30);
    // A bigger one raises it, and as it is made: it is the best shot before it has landed.
    for (let i = 0; i < 4; i++) put(s, "bunny", s.him.x, s.him.y + 40 + i * 30);
    const events = tick(s, tune, shot(0, 1));
    events.push(...until(s, tune, (seen) => of(seen, "pop").length >= 3, 400));
    expect(s.launch.active).toBe(true);
    expect(s.bestShot).toBe(60);
    events.push(...run(s, tune, 90));
    expect(of(events, "pop")).toHaveLength(4);
    expect(s.launch.active).toBe(false);
    expect(s.bestShot).toBe(100);
    expect(s.score).toBe(140);
  });

  it("the score is the sum of every pop, and of every launch's total, all night", () => {
    // Dust bunnies and tokens only: every point is a pop's. (The night with gum and batteries, whose
    // flat scores and blasts are added in, is the case after this one.)
    const long = tuned({ hearts: 40 });
    const s = createState(9, long, { kinds: ["bunny", "token", "polisher"] });
    const input = scripted(6);
    const events: SimEvent[] = [];
    for (let t = 0; t < 9000 && s.phase !== "over"; t++) step(s, input(), long, events);
    const pops = of(events, "pop");
    expect(pops.length).toBeGreaterThan(80);
    expect(s.score).toBe(pops.reduce((sum, e) => sum + e.points, 0));
    // Every pop is its kind's points times its three multipliers (the coin is 1 without a Coin slot).
    for (const e of pops) expect(e.points).toBe(KINDS[e.kind].points * e.chain * e.cushions * e.coin);
    // Every launch that began also ended, once, and their totals add up to the score.
    const ends = of(events, "launchEnd");
    const begun = of(events, "launch").length;
    expect(ends.length).toBe(s.launch.active ? begun - 1 : begun);
    expect(ends.reduce((sum, e) => sum + e.total, 0) + (s.launch.active ? s.launch.points : 0)).toBe(s.score);
    expect(s.bestShot).toBe(Math.max(...ends.map((e) => e.total), s.launch.points));
    // Some of them were banked, and some chained.
    expect(pops.some((e) => e.cushions >= 2)).toBe(true);
    expect(pops.some((e) => e.chain >= 3)).toBe(true);
  });
});

describe("flat scores and blasts (step 4)", () => {
  const T = tuned({ ...STILL, batterySpeed: 0 });

  it("a hit on gum pays 15 for each hit point it takes off: once, or twice for a hit that counts as two", () => {
    // Straight, on gum with two left: one off, 15, and he stops on it.
    const s = night(T);
    put(s, "gum", 180, 280);
    fire(s, T, shot(0, -1), 20);
    expect([s.score, s.launch.points, s.bestShot]).toEqual([15, 15, 15]);
    // Off a cushion: two off, 30.
    const b = night(T);
    b.him.y = 60;
    b.him.py = 60;
    put(b, "gum", 180, 150);
    fire(b, T, shot(0, -1), 20);
    expect(b.score).toBe(30);
    // Flat: not a pop, and the chain does not move.
    expect([b.launch.pops, b.launch.popped]).toEqual([0, false]);
  });

  it("a blast of his pays 40, and its pops twice their points, flat, into the launch that knocked it", () => {
    const s = night(T);
    const b = put(s, "battery", 180, 300, { fuseTick: 400 });
    for (let i = 0; i < 4; i++) put(s, "bunny", 160 + i * 14, 250);
    const events = fire(s, T, shot(0, -1), 30);
    const [k] = of(events, "knock");
    const [burst] = of(events, "burst");
    expect([k.id, burst.id, burst.mine, burst.launchId]).toEqual([b.id, b.id, true, 1]);
    expect(burst.points).toBe(40 + 4 * 20);
    // His blast's pops are not his chain's: the launch popped nothing with his body.
    expect(s.launch.pops).toBe(0);
    // Still the launch in flight, or landed since: its total holds the blast.
    expect(s.score).toBe(120);
    const ends = of(events, "launchEnd");
    expect(ends.length === 0 ? s.launch.points : ends[0].total).toBe(120);
    expect(s.bestShot).toBe(120);
  });

  it("a blast that goes off after its launch has ended adds to that launch's entry in pastShots, and raises the best shot", () => {
    const s = night(T);
    // His battery, of launch 1, which has ended: its total was 30.
    s.launch = { ...s.launch, id: 1, active: false, points: 30 };
    s.pastShots = [{ id: 1, points: 30 }];
    s.bestShot = 30;
    s.score = 30;
    const b = put(s, "battery", 180, 150, { mine: true, knockTick: 0, launchId: 1, fuseTick: 3 });
    put(s, "token", 180 + 40, 150);
    // A second launch is in flight meanwhile, and scores 10 of its own.
    put(s, "bunny", 180, 374 - 40);
    const events = fire(s, T, shot(0, -1), 6);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.launchId, burst.points]).toEqual([b.id, 1, 40 + 50]);
    expect(s.launch.id).toBe(2);
    expect(s.launch.points).toBe(10);
    expect(s.score).toBe(30 + 10 + 90);
    // The entry is dropped once its last battery has burst; the best shot is the old launch with its blast.
    expect(s.pastShots).toEqual([]);
    expect(s.bestShot).toBe(120);
  });

  it("a launch that ends with a battery of his alive keeps its total in pastShots until that battery has burst", () => {
    const s = night(T);
    const b = put(s, "battery", 180, 300, { fuseTick: 400 });
    const events = tick(s, T, shot(0, -1));
    events.push(...until(s, T, (e) => of(e, "knock").length > 0, 20));
    // A new launch at once: the knocking launch ends with its battery still flying.
    events.push(...tick(s, T, shot(0, 1)));
    expect(of(events, "launchEnd").map((e) => e.id)).toEqual([1]);
    expect(s.pastShots).toEqual([{ id: 1, points: 0 }]);
    events.push(...until(s, T, (e) => of(e, "burst").length > 0, 60));
    const [burst] = of(events, "burst");
    expect([burst.id, burst.launchId]).toEqual([b.id, 1]);
    expect(s.pastShots).toEqual([]);
    expect(s.bestShot).toBe(40);
  });

  it("a battery set off by a blast of his takes that blast's launch, and pays its 40 there", () => {
    const s = night(T);
    s.launch = { ...s.launch, id: 3, active: false, points: 0 };
    s.pastShots = [{ id: 3, points: 0 }];
    put(s, "battery", 180, 150, { mine: true, knockTick: 0, launchId: 3, fuseTick: 1 });
    const other = put(s, "battery", 180 + 60, 150, { fuseTick: 400 });
    const events = run(s, T, 20);
    expect(of(events, "burst").map((e) => [e.launchId, e.points])).toEqual([
      [3, 40],
      [3, 40],
    ]);
    expect(other.launchId).toBe(3);
    expect(s.bestShot).toBe(80);
    expect(s.pastShots).toEqual([]);
  });

  it("all night, with gum and batteries: the score is every pop, every hit and every blast; and every launch's total with its blasts", () => {
    const long = tuned({ hearts: 40 });
    let knocks = 0;
    let gums = 0;
    for (let seed = 9; seed < 12; seed++) {
      const s = createState(seed, long, { kinds: ["bunny", "token", "gum", "battery"] });
      const input = scripted(seed);
      const events: SimEvent[] = [];
      /** Each launch's total, its blasts included, by id. */
      const totals = new Map<number, number>();
      for (let t = 0; t < 14000 && s.phase !== "over"; t++) {
        const from = events.length;
        step(s, input(), long, events);
        for (let i = from; i < events.length; i++) {
          const e = events[i];
          if (e.type === "launchEnd") totals.set(e.id, (totals.get(e.id) ?? 0) + e.total);
          if (e.type === "burst" && e.mine && !(s.launch.active && s.launch.id === e.launchId)) totals.set(e.launchId, (totals.get(e.launchId) ?? 0) + e.points);
        }
      }
      const pops = of(events, "pop");
      const hits = of(events, "hit");
      const bursts = of(events, "burst");
      knocks += of(events, "knock").length;
      gums += hits.filter((e) => e.kind === "gum").length;
      // Every point is a pop by his body or Spark's ring, a hit on gum by either, or a blast (its 40, its pops and its hits).
      const own = (e: { source: string }) => e.source !== "blast";
      const sum = pops.filter(own).reduce((a, e) => a + e.points, 0) + hits.filter(own).reduce((a, e) => a + e.points, 0) + bursts.reduce((a, e) => a + e.points, 0);
      expect(s.score, `seed ${seed}`).toBe(sum);
      // A blast pays 40 if it is his, and what it popped and hit; one not his pays nothing.
      for (const e of bursts) if (!e.mine) expect(e.points).toBe(0);
      const blastPops = pops.filter((p) => p.source === "blast");
      const blastHits = hits.filter((h) => h.source === "blast");
      for (const p of blastPops) expect(p.points).toBe(p.chain === 1 && p.n === 0 ? 2 * KINDS[p.kind].points : -1);
      for (const h of blastHits) expect([h.kind, h.points, h.two]).toEqual(["gum", 15, false]);
      expect(bursts.reduce((a, e) => a + e.points, 0)).toBe(40 * bursts.filter((e) => e.mine).length + blastPops.reduce((a, p) => a + p.points, 0) + blastHits.reduce((a, h) => a + h.points, 0));
      // A launch's total is what it scored and the blasts that belong to it: they add up to the score.
      if (s.launch.active) totals.set(s.launch.id, (totals.get(s.launch.id) ?? 0) + s.launch.points);
      expect([...totals.values()].reduce((a, b) => a + b, 0), `seed ${seed}`).toBe(s.score);
      expect(s.bestShot, `seed ${seed}`).toBe(Math.max(...totals.values()));
    }
    // The nights had knocks and gum in them.
    expect(knocks).toBeGreaterThan(3);
    expect(gums).toBeGreaterThan(3);
  });
});
