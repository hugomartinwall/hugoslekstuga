import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { aimLine } from "../../lib/knuff/sim/aim";
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

/** A scripted player: no Math.random in the tests either. A launch every 25 to 90 ticks, any direction, any power. */
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

function run(seed: number, ticks: number, onTick?: (s: State, events: SimEvent[]) => void): State {
  const s = createState(seed, DEFAULT_TUNE);
  const input = scriptedInputs(99);
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    events.length = 0;
    step(s, input(t), DEFAULT_TUNE, events);
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
      expect(a.tick).toBe(ticks);
      expect(a).toEqual(b);
    }
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
    const kinds = new Set(first.map((e) => e.type));
    expect([...kinds].sort()).toEqual(["arrive", "cushion", "launch", "pop"]);
  });

  it("a copy taken in the middle plays on exactly as the original does", () => {
    for (const at of [1, 137, 600, 2000]) {
      const original = createState(4242, DEFAULT_TUNE);
      const inputs = scriptedInputs(5);
      const script: Input[] = Array.from({ length: at + 900 }, (_, t) => inputs(t));
      const events: SimEvent[] = [];
      for (let t = 0; t < at; t++) step(original, script[t], DEFAULT_TUNE, events);
      const copy = cloneState(original);
      expect(hashState(copy)).toBe(hashState(original));
      for (let t = at; t < at + 900; t++) {
        step(original, script[t], DEFAULT_TUNE, events);
        step(copy, script[t], DEFAULT_TUNE, events);
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
    for (let t = 0; t < 200; t++) step(original, { launch: t === 0 ? { dx: 1, dy: -1, power: 1 } : null, pullHeld: false }, DEFAULT_TUNE, events);
    expect(hashState(copy)).toBe(before);
    expect(hashState(original)).not.toBe(before);
  });

  it("different seeds part", () => {
    const a = run(1, 600);
    const b = run(2, 600);
    expect(hashState(a)).not.toBe(hashState(b));
    // Not only because the seed itself is in the State: the dummies came back in other places.
    expect(a.things.map((d) => [d.x, d.y])).not.toEqual(b.things.map((d) => [d.x, d.y]));
    // His own flight is the same until something he touches is somewhere else.
    expect(a.launch.id).toBe(b.launch.id);
  });

  it("the three streams are seeded apart, and step 0 draws from arrivals only", () => {
    const fresh = seedStreams(31337);
    expect(new Set([fresh.arrivals, fresh.offers, fresh.behaviour]).size).toBe(3);
    expect(fresh.arrivals).toBe(rngSeed(31337, 1));
    const s = run(31337, 3600);
    expect(s.rng.arrivals).not.toBe(fresh.arrivals);
    // Nothing reshuffles these two until the systems they belong to exist.
    expect(s.rng.offers).toBe(fresh.offers);
    expect(s.rng.behaviour).toBe(fresh.behaviour);
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
        if (!d.alive) continue;
        if (d.x < left + d.r || d.x > right - d.r || d.y < top + d.r || d.y > bottom - d.r) outside.push(`thing ${d.id} at tick ${s.tick}`);
        checked++;
      }
    });
    expect(outside).toEqual([]);
    expect(checked).toBeGreaterThan(6000);
  });

  it("the default floor is the room less its 8 u cushions, and he starts at (180, 374)", () => {
    const s = createState(1, DEFAULT_TUNE);
    expect(s.room).toEqual({ left: 8, top: 8, right: 352, bottom: 472 });
    expect([s.him.x, s.him.y]).toEqual([180, 374]);
    expect(s.things).toHaveLength(6);
    expect(s.tick).toBe(0);
  });

  it("the start options: the toy's room, and an empty one", () => {
    const toyRoom = { left: 0, top: 0, right: 360, bottom: 480 };
    const s = createState(1, DEFAULT_TUNE, { room: toyRoom, empty: true });
    expect(s.room).toEqual(toyRoom);
    expect(s.room).not.toBe(toyRoom);
    expect(s.things).toEqual([]);
    // Straight left at full power: he stops 13 u from the toy's wall, not from a cushion 8 u in.
    const events: SimEvent[] = [];
    for (let t = 0; t < 30; t++) step(s, { launch: t === 0 ? { dx: -1, dy: 0, power: 1 } : null, pullHeld: false }, DEFAULT_TUNE, events);
    expect(events.some((e) => e.type === "cushion" && e.side === "left" && e.x === 13)).toBe(true);
  });

  it("the aim line is worked out on a copy: it leaves the State as it was", () => {
    const s = run(55, 400);
    const before = hashState(s);
    const line = aimLine(s, { dx: 0.3, dy: -1, power: 1 }, DEFAULT_TUNE);
    expect(hashState(s)).toBe(before);
    expect(line.pts.length).toBeGreaterThan(4);
  });

  it("the aim line shows what the next ticks do, while nothing else moves", () => {
    // An empty room: his real flight passes through every point of the line.
    const s = createState(3, DEFAULT_TUNE, { empty: true });
    const launch = { dx: 0.62, dy: -1, power: 1 };
    const line = aimLine(s, launch, { ...DEFAULT_TUNE, aimCushions: 3 });
    const events: SimEvent[] = [];
    const ticks = line.end === "cushion" ? line.pts.length / 2 - 2 : line.pts.length / 2 - 1;
    expect(ticks).toBeGreaterThan(20);
    for (let t = 1; t <= ticks; t++) {
      step(s, { launch: t === 1 ? launch : null, pullHeld: false }, DEFAULT_TUNE, events);
      expect(s.him.x).toBe(line.pts[t * 2]);
      expect(s.him.y).toBe(line.pts[t * 2 + 1]);
    }
  });

  it("the aim line runs through one cushion and stops at the next", () => {
    expect(DEFAULT_TUNE.aimCushions).toBe(1);
    const s = createState(3, DEFAULT_TUNE, { empty: true });
    // Down and to the right at full power: off the bottom cushion, and it stops on the right one.
    const one = aimLine(s, { dx: 1, dy: 1, power: 1 }, DEFAULT_TUNE);
    expect(one.end).toBe("cushion");
    expect(one.cushions).toHaveLength(2);
    const [endX, endY] = one.pts.slice(-2);
    expect(endX).toBe(s.room.right - DEFAULT_TUNE.himRadius);
    expect(endY).toBeLessThan(s.room.bottom - DEFAULT_TUNE.himRadius);
    // The knob: with two, the same launch is drawn on past the right cushion.
    const two = aimLine(s, { dx: 1, dy: 1, power: 1 }, { ...DEFAULT_TUNE, aimCushions: 2 });
    expect(two.cushions.length).toBeGreaterThanOrEqual(2);
    expect(two.pts.length).toBeGreaterThan(one.pts.length);
    expect(two.pts.slice(0, one.pts.length - 2)).toEqual(one.pts.slice(0, -2));
    // Straight at the rack: it ends on the first dummy, and he is hot when he gets there.
    const rack = createState(3, DEFAULT_TUNE);
    const hit = aimLine(rack, { dx: 0, dy: -1, power: 1 }, DEFAULT_TUNE);
    expect(hit.end).toBe("thing");
    expect(hit.hitId).toBe(rack.things[0].id);
    expect(hit.hitHot).toBe(true);
    expect(hit.cushions).toEqual([]);
  });
});
