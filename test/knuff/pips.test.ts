import { describe, expect, it } from "vitest";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent } from "../../lib/knuff/sim/types";
import { REST, fire, night, of, put, run, scripted, shot, tick, tuned } from "./room";

/**
 * Pips (§3.7): launches in hand. Three; a launch costs one; one comes back
 * on a timer while he is below the maximum, and one on a launch's second
 * body pop, once. With none, a release is refused and nothing happens.
 */

describe("pips", () => {
  const tune = tuned();

  it("he starts with three, and a launch costs one", () => {
    const s = night(tune);
    expect(s.pips).toBe(3);
    expect(tune.pipMax).toBe(3);
    tick(s, tune, shot(0, -1));
    expect(s.pips).toBe(2);
    tick(s, tune, shot(1, 0));
    tick(s, tune, shot(0, 1));
    expect(s.pips).toBe(0);
    expect(s.launch.id).toBe(3);
  });

  it("with none, a release is refused: nothing happens in the simulation", () => {
    const s = night(tune);
    for (let i = 0; i < 3; i++) tick(s, tune, shot(0, -1));
    run(s, tune, 4);
    expect(s.pips).toBe(0);
    const twin = cloneState(s);
    const events = tick(s, tune, shot(1, 0.3));
    tick(twin, tune, REST);
    // A tick went by as it would have with no input at all.
    expect(hashState(s)).toBe(hashState(twin));
    expect(s).toEqual(twin);
    expect(of(events, "refused")).toEqual([{ type: "refused", tick: twin.tick - 1 }]);
    expect(of(events, "launch")).toEqual([]);
    expect(s.launch.id).toBe(3);
    // Again and again, and still nothing: it never goes under zero.
    for (let i = 0; i < 5; i++) expect(of(tick(s, tune, shot(1, 0)), "refused")).toHaveLength(1);
    expect(s.pips).toBe(0);
  });

  it("with no pip there is no first launch either: the night does not start", () => {
    const none = tuned({ pipMax: 0 });
    const s = createState(1, none);
    const before = hashState(s);
    const events = tick(s, none, shot(0, -1));
    expect(of(events, "refused")).toHaveLength(1);
    expect(s.phase).toBe("waiting");
    expect(hashState(s)).toBe(before);
  });
});

describe("the pip timer", () => {
  const tune = tuned();

  it("gives one back every 96 ticks at pace 2 and 3, and every 120 at pace 1", () => {
    for (const [pace, every] of [
      [2, 96],
      [3, 96],
      [1, 120],
    ]) {
      const paced = tuned({ pace });
      expect(paced.pipRefillTicks).toBe(every);
      const s = night(paced);
      const events = fire(s, paced, shot(0, -1), every - 1);
      // Not a tick sooner.
      expect(s.pips).toBe(2);
      expect(of(events, "pip")).toEqual([]);
      events.push(...tick(s, paced));
      expect(s.pips).toBe(3);
      // The pip is in hand `every` ticks after the launch that spent it.
      expect(of(events, "pip")).toEqual([{ type: "pip", tick: every - 1, pips: 3, why: "timer" }]);
      expect(s.tick).toBe(every);
    }
  });

  it("runs only while he is below the maximum", () => {
    const s = night(tune);
    // A long wait at full pips does not wind the timer down.
    run(s, tune, 500);
    expect(s.pips).toBe(3);
    expect(s.pipTimer).toBe(96);
    const events = fire(s, tune, shot(0, -1), 95);
    expect(s.pips).toBe(2);
    events.push(...tick(s, tune));
    expect(s.pips).toBe(3);
    // At the maximum again it stops, with a whole wait ahead of it.
    expect(s.pipTimer).toBe(96);
    expect(of(run(s, tune, 300), "pip")).toEqual([]);
  });

  it("restarts when a launch takes him from full, and only then", () => {
    const s = night(tune);
    const events = fire(s, tune, shot(0, -1), 50);
    // A second launch, from two pips: the timer keeps the time it has.
    events.push(...fire(s, tune, shot(1, 0), 46));
    expect(of(events, "pip").map((e) => [e.tick, e.pips])).toEqual([[95, 2]]);
    events.push(...run(s, tune, 96));
    expect(of(events, "pip").map((e) => [e.tick, e.pips])).toEqual([
      [95, 2],
      [191, 3],
    ]);
    // From full again: a fresh 96.
    events.length = 0;
    events.push(...fire(s, tune, shot(0, 1), 96));
    expect(of(events, "pip").map((e) => e.tick - 192)).toEqual([95]);
  });

  it("restarts on a launch from a hand that a pop filled, however far along the timer was", () => {
    // Dust bunnies that stand still: two close together far up the room.
    const still = tuned({ bunnySpeed: 0 });
    const s = night(still);
    put(s, "bunny", 180, 374 - 300);
    put(s, "bunny", 180, 374 - 322);
    // A launch from full starts the timer; the second pop, some twenty ticks on, fills him again.
    const events = fire(s, still, shot(0, -1), 90);
    const refund = of(events, "pip").find((e) => e.why === "pop")!;
    expect(refund.tick).toBeGreaterThan(15);
    expect(s.pips).toBe(3);
    expect(s.him.hot).toBe(false);
    // The timer stopped where it was: part of the way down.
    expect(s.pipTimer).toBe(96 - 1 - refund.tick);
    expect(of(events, "pip")).toHaveLength(1);
    // The next launch takes him from full: a whole wait again, not what was left of the last.
    const from = s.tick;
    events.length = 0;
    events.push(...fire(s, still, shot(1, 0, 0.5), 96));
    expect(of(events, "pip").map((e) => [e.tick - from, e.why])).toEqual([[95, "timer"]]);
  });

  it("counts ticks, slowed or not", () => {
    const s = night(tune);
    put(s, "bunny", 30, 30);
    const still = tuned({ bunnySpeed: 0 });
    tick(s, still, shot(0, -1, 0.5));
    // A pull held all the way: the meter's sixteen ticks are slowed, and
    // the eight his landing tops it up with.
    const events = run(s, still, 95, { launch: null, pullHeld: true });
    expect(s.slowedTicks).toBe(24);
    expect(of(events, "pip").map((e) => e.tick)).toEqual([95]);
  });

  it("never takes him over the maximum or under zero, all night", () => {
    const long = tuned({ hearts: 40 });
    const s = createState(5, long);
    const input = scripted(4);
    const events: SimEvent[] = [];
    const seen = new Set<number>();
    for (let t = 0; t < 8000 && s.phase !== "over"; t++) {
      step(s, input(), long, events);
      seen.add(s.pips);
      // The most is his, after charms: a Fourth pip taken from an offer makes it 4.
      if (s.pips < 0 || s.pips > s.stats.pipMax) expect.fail(`${s.pips} pips at tick ${t}`);
      if (s.pipTimer < 1 || s.pipTimer > long.pipRefillTicks) expect.fail(`the pip timer reads ${s.pipTimer} at tick ${t}`);
    }
    expect([...seen].sort()).toEqual(s.stats.pipMax === 4 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]);
    expect(of(events, "refused").length).toBeGreaterThan(0);
    // The night as it starts has a Pip plate lit (plate 4): it gives pips too. And from 21:00 a
    // gum stop leaves him a pip if he has none.
    const why = new Set(of(events, "pip").map((e) => e.why));
    expect([...why].sort()).toEqual(["gum", "heart", "plate", "pop", "timer"]);
  });
});

describe("the pip a launch gives back", () => {
  /** Dust bunnies that stand still in a line straight ahead of him. */
  const still = tuned({ bunnySpeed: 0 });
  function line(tune: ReturnType<typeof tuned>, n: number) {
    const s = night(tune);
    for (let i = 0; i < n; i++) put(s, "bunny", 180, 374 - 40 - i * 30);
    return s;
  }

  it("comes on its second body pop, and only then", () => {
    const s = line(still, 4);
    const events = fire(s, still, shot(0, -1), 20);
    const pops = of(events, "pop");
    expect(pops.map((e) => e.n)).toEqual([1, 2, 3, 4]);
    // One pip, on the tick of the second pop.
    expect(of(events, "pip")).toEqual([{ type: "pip", tick: pops[1].tick, pips: 3, why: "pop" }]);
    expect(s.launch.refunded).toBe(true);
    expect(s.launch.bodyPops).toBe(4);
    expect(still.pipRefundPop).toBe(2);
  });

  it("is one pip and no more, however many it pops: four pops from an empty hand leave him with one", () => {
    const s = line(still, 4);
    // Two launches into nothing first: one pip left.
    tick(s, still, shot(1, 0, 0.5));
    tick(s, still, shot(-1, 0, 0.5));
    expect(s.pips).toBe(1);
    const events = fire(s, still, shot(0, -1), 20);
    expect(of(events, "pop")).toHaveLength(4);
    expect(of(events, "pip").map((e) => [e.why, e.pips])).toEqual([["pop", 1]]);
    expect(s.pips).toBe(1);
  });

  it("a launch with one pop gives none", () => {
    const s = line(still, 1);
    const events = fire(s, still, shot(0, -1), 20);
    expect(of(events, "pop")).toHaveLength(1);
    expect(of(events, "pip")).toEqual([]);
    expect(s.pips).toBe(2);
    expect(s.launch.refunded).toBe(false);
  });

  it("is once a launch, and the next launch can earn its own", () => {
    const s = line(still, 4);
    const events = fire(s, still, shot(0, -1), 4);
    // Two are popped by now. He is launched again, still flying, into the other two.
    expect(of(events, "pop")).toHaveLength(2);
    events.push(...fire(s, still, shot(0, -1), 20));
    expect(of(events, "pop")).toHaveLength(4);
    expect(of(events, "pip").map((e) => e.why)).toEqual(["pop", "pop"]);
    // Two launches spent two, and each earned one back.
    expect(s.pips).toBe(3);
  });

  it("a pip that would take him over the maximum is lost, and the launch has had its one", () => {
    // The timer has already filled him up by the time of the second pop.
    const quick = tuned({ bunnySpeed: 0, pipRefillTicks: 1 });
    const s = line(quick, 4);
    const events = fire(s, quick, shot(0, -1), 20);
    expect(of(events, "pop")).toHaveLength(4);
    expect(of(events, "pip").map((e) => e.why)).toEqual(["timer"]);
    expect(s.pips).toBe(3);
    expect(s.launch.refunded).toBe(true);
  });

  it("pipRefundPop names the pop: 1 is the first, 3 the third, and 0 means never", () => {
    for (const [nth, expected] of [
      [1, 1],
      [3, 3],
      [0, -1],
    ]) {
      const tune = tuned({ bunnySpeed: 0, pipRefundPop: nth });
      const s = line(tune, 4);
      const events = fire(s, tune, shot(0, -1), 20);
      const pops = of(events, "pop");
      const refunds = of(events, "pip").filter((e) => e.why === "pop");
      if (expected < 0) expect(refunds).toEqual([]);
      else expect(refunds.map((e) => e.tick)).toEqual([pops[expected - 1].tick]);
    }
  });
});
