import { describe, expect, it } from "vitest";
import { KINDS } from "../../lib/knuff/content/kinds";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { rngSeed, seedStreams } from "../../lib/knuff/sim/rng";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Input, SimEvent, State } from "../../lib/knuff/sim/types";

/**
 * The same seed and the same inputs give the same State, tick for tick:
 * across two runs, and across a copy taken in the middle of one. That is
 * what lets a bot stand in for a hand and the aim line be the simulation
 * itself.
 */

/** A scripted player: no Math.random in the tests either. A launch every 25 to 90 ticks, any direction, any power, a pull held before each. */
function scriptedInputs(scriptSeed: number): (tick: number) => Input {
  let state = scriptSeed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let wait = 0;
  return () => {
    const pullHeld = wait < 12;
    if (wait > 0) {
      wait--;
      return { launch: null, pullHeld };
    }
    wait = 25 + Math.floor(next() * 66);
    const a = next() * Math.PI * 2;
    return { launch: { dx: Math.cos(a), dy: Math.sin(a), power: 0.35 + 0.65 * next() }, pullHeld };
  };
}

/**
 * Play `ticks` ticks. The player is given hearts enough to see every hour:
 * a night that ended in its second hour would leave most of the rules
 * unrun. (A night is over by 25,200 ticks whatever happens: the last stretch
 * of the longest run is a State that no longer moves.)
 */
const TUNE = { ...DEFAULT_TUNE, hearts: 60 };

function run(seed: number, ticks: number, onTick?: (s: State, events: SimEvent[]) => void): State {
  const s = createState(seed, TUNE);
  const input = scriptedInputs(99);
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    events.length = 0;
    step(s, input(t), TUNE, events);
    onTick?.(s, events);
  }
  return s;
}

describe("determinism", () => {
  it("same seed + same inputs ⇒ the same fingerprint at 600, 3,600 and 25,200 ticks", () => {
    for (const ticks of [600, 3600, 25200]) {
      const a = run(1234, ticks);
      const b = run(1234, ticks);
      expect(hashState(a)).toBe(hashState(b));
      expect(a).toEqual(b);
      if (ticks < 25200) expect(a.tick).toBe(ticks);
    }
    // The longest run plays a whole night: eleven hours and the boss, and it is over by 25,200 ticks.
    const whole = run(1234, 25200);
    expect(whole.phase).toBe("over");
    expect(whole.night.hour).toBe(11);
    expect(whole.boss.present).toBe(true);
    expect(whole.boss.beganTick).toBeGreaterThan(10836);
    expect(whole.boss.beganTick).toBeLessThanOrEqual(11 * 1800);
    expect(whole.tick).toBeLessThanOrEqual(25200);
    expect(whole.normalTicks + whole.slowedTicks).toBe(whole.tick);
    expect(whole.slowedTicks).toBeGreaterThan(100);
    expect(whole.hearts).toBeLessThan(60);
    expect(whole.score).toBeGreaterThan(1000);
  });

  it("the whole sequence of fingerprints is the same, not just its end", () => {
    const first: string[] = [];
    const second: string[] = [];
    run(77, 1200, (s) => first.push(hashState(s)));
    run(77, 1200, (s) => second.push(hashState(s)));
    expect(second).toEqual(first);
    // And it is a sequence: a fingerprint that never moved would pass the line above.
    expect(new Set(first).size).toBe(first.length);
  });

  it("the same events come out, in the same order", () => {
    const first: SimEvent[] = [];
    const second: SimEvent[] = [];
    run(77, 1200, (_, events) => first.push(...events.map((e) => ({ ...e }))));
    run(77, 1200, (_, events) => second.push(...events.map((e) => ({ ...e }))));
    expect(second).toEqual(first);
    // Everything the first two minutes can report came up but the two ends: a clear hour and the night's end.
    const kinds = new Set(first.map((e) => e.type));
    expect([...kinds].sort()).toEqual(["announce", "arrive", "cushion", "daze", "hour", "hurt", "land", "launch", "launchEnd", "pip", "pop", "refused", "row"]);
    // Every event carries the tick it happened in, and they come in order.
    for (let i = 1; i < first.length; i++) expect(first[i].tick).toBeGreaterThanOrEqual(first[i - 1].tick);
  });

  it("a copy taken in the middle plays on exactly as the original does", () => {
    for (const at of [1, 137, 600, 2000]) {
      const original = createState(4242, TUNE);
      const inputs = scriptedInputs(5);
      const script: Input[] = Array.from({ length: at + 900 }, (_, t) => inputs(t));
      const events: SimEvent[] = [];
      for (let t = 0; t < at; t++) step(original, script[t], TUNE, events);
      const copy = cloneState(original);
      expect(hashState(copy)).toBe(hashState(original));
      for (let t = at; t < at + 900; t++) {
        step(original, script[t], TUNE, events);
        step(copy, script[t], TUNE, events);
        if (hashState(copy) !== hashState(original)) {
          expect.fail(`a copy taken at tick ${at} parted from the original at tick ${t}`);
        }
      }
      expect(copy).toEqual(original);
    }
  });

  it("stepping the original leaves a copy alone", () => {
    const original = run(9, 300);
    const copy = cloneState(original);
    const before = hashState(copy);
    const events: SimEvent[] = [];
    for (let t = 0; t < 200; t++) step(original, { launch: t === 0 ? { dx: 1, dy: -1, power: 1 } : null, pullHeld: false }, TUNE, events);
    expect(hashState(copy)).toBe(before);
    expect(hashState(original)).not.toBe(before);
  });

  it("different seeds part", () => {
    const a = run(1, 600);
    const b = run(2, 600);
    expect(hashState(a)).not.toBe(hashState(b));
    // Not only because the seed itself is in the State: the bunches came down in other places.
    expect(a.things.map((d) => [d.x, d.y])).not.toEqual(b.things.map((d) => [d.x, d.y]));
    // And from the first tick on: the rack stands where it always stands, but its dust bunnies wobble out of step.
    const one = createState(1, TUNE);
    const two = createState(2, TUNE);
    expect(one.things.map((d) => [d.x, d.y])).toEqual(two.things.map((d) => [d.x, d.y]));
    expect(one.things.map((d) => d.phase)).not.toEqual(two.things.map((d) => d.phase));
  });

  it("the three streams are seeded apart, and each is drawn from by its own system only", () => {
    const fresh = seedStreams(31337);
    expect(new Set([fresh.arrivals, fresh.offers, fresh.behaviour]).size).toBe(3);
    expect(fresh.arrivals).toBe(rngSeed(31337, 1));
    // Making the State draws a wobble phase for each dust bunny of the rack, and no place: the rack's is written down.
    const made = createState(31337, TUNE);
    expect(made.rng.arrivals).toBe(fresh.arrivals);
    expect(made.rng.behaviour).not.toBe(fresh.behaviour);
    // Each stream moves only on a tick its own system drew from: the offers
    // stream when an offer is made, the arrivals stream when something is
    // announced, the behaviour stream when a dust bunny is placed (its wobble).
    let offersMoved = 0;
    let arrivalsMoved = 0;
    let before = { ...made.rng };
    const s = run(31337, 25200, (now, events) => {
      const has = (type: SimEvent["type"]) => events.some((e) => e.type === type);
      if (now.rng.offers !== before.offers) {
        offersMoved++;
        if (!has("offerOpen")) expect.fail(`the offers stream moved at tick ${now.tick - 1} with no offer made`);
      }
      if (now.rng.arrivals !== before.arrivals) {
        arrivalsMoved++;
        if (!has("announce")) expect.fail(`the arrivals stream moved at tick ${now.tick - 1} with nothing announced`);
      }
      if (now.rng.behaviour !== before.behaviour && !events.some((e) => e.type === "announce" && e.kind === "bunny"))
        expect.fail(`the behaviour stream moved at tick ${now.tick - 1} with no dust bunny placed`);
      before = { ...now.rng };
    });
    expect(s.rng.arrivals).not.toBe(fresh.arrivals);
    expect(s.rng.behaviour).not.toBe(made.rng.behaviour);
    expect(offersMoved).toBeGreaterThan(0);
    expect(arrivalsMoved).toBeGreaterThan(10);
    // With offers off nothing ever draws from it.
    const off = createState(31337, TUNE, { offers: false });
    const input = scriptedInputs(99);
    for (let t = 0; t < 25200; t++) step(off, input(t), TUNE, []);
    expect(off.rng.offers).toBe(fresh.offers);
  });

  it("he and everything else stay on the floor, their radius inside its edges", () => {
    const r = DEFAULT_TUNE.himRadius;
    let checked = 0;
    const outside: string[] = [];
    run(2026, 6000, (s) => {
      const { left, top, right, bottom } = s.room;
      const h = s.him;
      if (h.x < left + r || h.x > right - r || h.y < top + r || h.y > bottom - r) outside.push(`him at tick ${s.tick}`);
      for (const d of s.things) {
        const dr = KINDS[d.kind].radius;
        if (d.x < left + dr || d.x > right - dr || d.y < top + dr || d.y > bottom - dr) outside.push(`thing ${d.id} at tick ${s.tick}`);
        checked++;
      }
    });
    expect(outside).toEqual([]);
    expect(checked).toBeGreaterThan(20000);
  });

  it("everything in the room is alive, each under its own id, in the order it came", () => {
    const seen = new Set<number>();
    run(2026, 6000, (s) => {
      let last = 0;
      for (const d of s.things) {
        if (d.hp <= 0) expect.fail(`thing ${d.id} is still in the room at tick ${s.tick} with no hit left`);
        if (d.id <= last) expect.fail(`thing ${d.id} is out of order at tick ${s.tick}`);
        last = d.id;
        seen.add(d.id);
      }
      if (last >= s.nextId) expect.fail(`nextId ${s.nextId} is behind thing ${last}`);
    });
    expect(seen.size).toBeGreaterThan(50);
  });

  it("the default floor is the room less its 8 u cushions, and he starts at (180, 374)", () => {
    const s = createState(1, DEFAULT_TUNE);
    expect(s.room).toEqual({ left: 8, top: 8, right: 352, bottom: 472 });
    expect([s.him.x, s.him.y]).toEqual([180, 374]);
    expect(s.things).toHaveLength(4);
    expect(s.tick).toBe(0);
  });

  it("the start options: the toy's room, and an empty one", () => {
    const toyRoom = { left: 0, top: 0, right: 360, bottom: 480 };
    // With offers off: an offer's pickups would lie in the room, and an hour whose offer nobody takes runs to 1,800.
    const s = createState(1, DEFAULT_TUNE, { room: toyRoom, empty: true, offers: false });
    expect(s.room).toEqual(toyRoom);
    expect(s.room).not.toBe(toyRoom);
    expect(s.things).toEqual([]);
    expect(s.night.kinds).toEqual([]);
    // Straight left at full power: he bounces 13 u from the toy's wall, not from a cushion 8 u in.
    const events: SimEvent[] = [];
    for (let t = 0; t < 30; t++) step(s, { launch: t === 0 ? { dx: -1, dy: 0, power: 1 } : null, pullHeld: false }, DEFAULT_TUNE, events);
    expect(events.some((e) => e.type === "cushion" && e.side === "left" && e.x === 13)).toBe(true);
    // An empty room stays empty: nothing arrives, all night, and morning comes all the same.
    for (let t = 0; t < 12000; t++) step(s, { launch: null, pullHeld: false }, DEFAULT_TUNE, events);
    expect(events.some((e) => e.type === "announce" || e.type === "row")).toBe(false);
    expect(s.things).toEqual([]);
    expect(s.ended).toBe("morning");
  });

  it("the start options: an hour to begin in, and the kinds the rows may bring", () => {
    // From 23:00: no rack, and the first launch starts that hour at its tick 0.
    const late = createState(1, DEFAULT_TUNE, { hour: 4 });
    expect(late.night.hour).toBe(4);
    expect(late.things).toEqual([]);
    const events: SimEvent[] = [];
    step(late, { launch: { dx: 0, dy: -1, power: 1 }, pullHeld: false }, DEFAULT_TUNE, events);
    expect(events.filter((e) => e.type === "hour")).toEqual([{ type: "hour", tick: 0, hour: 4 }]);
    expect(events.some((e) => e.type === "row" && e.hour === 4)).toBe(true);
    expect(late.night.hourStart).toBe(0);
    // An hour outside the night is brought inside it: 06:00 is the last, on a night that has the polisher.
    expect(createState(1, DEFAULT_TUNE, { hour: 99 }).night.hour).toBe(11);
    expect(createState(1, DEFAULT_TUNE, { hour: 99, kinds: ["bunny", "token"] }).night.hour).toBe(10);
    expect(createState(1, DEFAULT_TUNE, { hour: -3 }).night.hour).toBe(0);
    // The kinds: every kind built so far by default, the polisher among them; a list is kept in the
    // order the kinds were built; a kind with no rules yet cannot be asked for.
    expect(createState(1, DEFAULT_TUNE).night.kinds).toEqual(["bunny", "token", "polisher", "gum", "battery"]);
    expect(createState(1, DEFAULT_TUNE, { kinds: ["token", "bunny", "token"] }).night.kinds).toEqual(["bunny", "token"]);
    expect(createState(1, DEFAULT_TUNE, { kinds: ["bunny", "envelope", "bag", "gum", "polisher", "nonsense"] }).night.kinds).toEqual(["bunny", "polisher", "gum"]);
    // A night of tokens only has no rack; one that is empty but for its kinds has none either, and its rows still come.
    expect(createState(1, DEFAULT_TUNE, { kinds: ["token"] }).things).toEqual([]);
    const noRack = createState(1, DEFAULT_TUNE, { empty: true, kinds: ["bunny", "token"] });
    expect(noRack.things).toEqual([]);
    expect(noRack.night.kinds).toEqual(["bunny", "token"]);
  });

  it("a launch that is not made of numbers is no launch", () => {
    // One NaN in his speed would spread to every number in the State within a tick.
    const odd = [
      { dx: Number.NaN, dy: -1, power: 1 },
      { dx: 0, dy: Number.NaN, power: 1 },
      { dx: Number.POSITIVE_INFINITY, dy: -1, power: 1 },
      { dx: 0, dy: -1, power: Number.NaN },
      { dx: 0, dy: 0, power: 1 },
      { dx: 0, dy: -1, power: 0 },
      { dx: 0, dy: -1, power: -1 },
    ];
    const first = { dx: 0.3, dy: -1, power: 1 };
    for (const launch of odd) {
      // On the start screen it does not start the night.
      const waiting = createState(8, DEFAULT_TUNE);
      const untouched = hashState(waiting);
      const events: SimEvent[] = [];
      step(waiting, { launch, pullHeld: false }, DEFAULT_TUNE, events);
      expect(hashState(waiting), JSON.stringify(launch)).toBe(untouched);
      expect(events).toEqual([]);
      // In the middle of a flight it changes nothing, costs nothing and is not even refused.
      const s = createState(8, DEFAULT_TUNE);
      const quiet = createState(8, DEFAULT_TUNE);
      for (let t = 0; t < 30; t++) {
        step(s, { launch: t === 0 ? first : t === 5 ? launch : null, pullHeld: false }, DEFAULT_TUNE, events);
        step(quiet, { launch: t === 0 ? first : null, pullHeld: false }, DEFAULT_TUNE, []);
      }
      expect(events.filter((e) => e.type === "launch"), JSON.stringify(launch)).toHaveLength(1);
      expect(events.filter((e) => e.type === "refused")).toEqual([]);
      expect(s).toEqual(quiet);
    }
    // A power over 1 is a full launch, not more; one under the minimum is the minimum.
    const fire = (power: number): State => {
      const s = createState(8, DEFAULT_TUNE, { empty: true });
      step(s, { launch: { dx: 1, dy: 0, power }, pullHeld: false }, DEFAULT_TUNE, []);
      return s;
    };
    expect(fire(7)).toEqual(fire(1));
    expect(fire(0.2)).toEqual(fire(DEFAULT_TUNE.minPower));
    expect(fire(0.5)).not.toEqual(fire(0.51));
  });
});
