import { describe, expect, it } from "vitest";
import { threat } from "../../lib/knuff/sim/hot";
import { createState, hashState } from "../../lib/knuff/sim/state";
import { step, wouldSlow } from "../../lib/knuff/sim/step";
import type { Input, SimEvent, State } from "../../lib/knuff/sim/types";
import { HOLD, REST, fire, night, of, put, run, shot, tick, tuned } from "./room";

/**
 * Slow motion (§3.8) lives in the State and is counted in ticks, so bots,
 * replays and the real game agree. A tick is a slowed tick when a pull is
 * held, something in the room can hurt him, and the meter is above zero.
 * The shell only asks `wouldSlow` how fast to feed ticks.
 */

/** Things that stay where they are put: a threat that never arrives. */
const STILL = { bunnySpeed: 0, tokenSpeed: 0 };

describe("a slowed tick", () => {
  const tune = tuned(STILL);

  it("the meter starts the night full: sixteen slowed ticks", () => {
    expect(night(tune).slow).toEqual({ meter: 16, refill: 0 });
    expect(createState(1, tune).slow.meter).toBe(16);
    expect(tune.slowMeterMax).toBe(16);
  });

  it("needs a pull held, a threat, and something in the meter; each one takes one from it", () => {
    const s = night(tune);
    put(s, "bunny", 30, 30);
    for (let held = 1; held <= 16; held++) {
      expect(wouldSlow(s, HOLD)).toBe(true);
      tick(s, tune, HOLD);
      expect(s.slowedTicks).toBe(held);
      expect(s.slow.meter).toBe(16 - held);
    }
    expect(s.normalTicks).toBe(0);
    // Empty: the room runs at full speed although the pull is still held.
    expect(wouldSlow(s, HOLD)).toBe(false);
    run(s, tune, 40, HOLD);
    expect(s.slowedTicks).toBe(16);
    expect(s.normalTicks).toBe(40);
    // And nothing comes back while the pull is held.
    expect(s.slow).toEqual({ meter: 0, refill: 0 });
  });

  it("with no pull held nothing is slowed, however full the meter", () => {
    const s = night(tune);
    put(s, "bunny", 30, 30);
    expect(wouldSlow(s, REST)).toBe(false);
    run(s, tune, 30, REST);
    expect([s.slowedTicks, s.normalTicks, s.slow.meter]).toEqual([0, 30, 16]);
  });

  it("with no threat there is no slow motion and nothing is spent", () => {
    // An empty room, as during an offer.
    const s = night(tune);
    expect(threat(s)).toBe(false);
    expect(wouldSlow(s, HOLD)).toBe(false);
    run(s, tune, 50, HOLD);
    expect([s.slowedTicks, s.normalTicks, s.slow.meter]).toEqual([0, 50, 16]);
  });

  it("a thing that is only announced is a threat already", () => {
    const s = night(tune);
    put(s, "token", 300, 100, { landTick: 500 });
    expect(threat(s)).toBe(true);
    tick(s, tune, HOLD);
    expect(s.slowedTicks).toBe(1);
  });

  it("before the first launch there is none: nothing moves, and no tick is counted", () => {
    const s = createState(1, tune);
    // The rack is in the room, and it is no threat until the night is on.
    expect(s.things).toHaveLength(4);
    expect(threat(s)).toBe(false);
    expect(wouldSlow(s, HOLD)).toBe(false);
    const before = hashState(s);
    run(s, tune, 100, HOLD);
    expect(hashState(s)).toBe(before);
    expect([s.tick, s.slowedTicks, s.normalTicks]).toEqual([0, 0, 0]);
  });

  it("is a whole tick of the game: slow motion changes no outcome", () => {
    // Two nights with the same launches, one played with a pull held
    // whenever it could be. Tick for tick they are the same night.
    const play = (hold: boolean): State => {
      const s = createState(21, tuned());
      const events: SimEvent[] = [];
      for (let t = 0; t < 900; t++) {
        const launch = t % 45 === 0 ? { dx: Math.cos(t), dy: Math.sin(t), power: 1 } : null;
        step(s, { launch, pullHeld: hold && launch === null }, tuned(), events);
      }
      return s;
    };
    const slowed = play(true);
    const plain = play(false);
    expect(slowed.slowedTicks).toBeGreaterThan(40);
    expect(plain.slowedTicks).toBe(0);
    // Everything but the meter and the two counts of ticks.
    const rest = (s: State) => ({ ...s, slow: null, slowedTicks: 0, normalTicks: 0 });
    expect(rest(slowed)).toEqual(rest(plain));
  });
});

describe("the meter coming back", () => {
  const tune = tuned(STILL);

  /** A night with a far threat and the meter run down to `left`. */
  function drained(left: number): State {
    const s = night(tune);
    put(s, "bunny", 30, 30);
    run(s, tune, 16 - left, HOLD);
    expect(s.slow.meter).toBe(left);
    return s;
  }

  it("one slowed tick comes back for every 9 ticks with no pull held", () => {
    const s = drained(0);
    run(s, tune, 8);
    expect(s.slow.meter).toBe(0);
    tick(s, tune);
    expect(s.slow.meter).toBe(1);
    run(s, tune, 9 * 3);
    expect(s.slow.meter).toBe(4);
    expect(tune.slowRefillTicks).toBe(9);
  });

  it("up to the maximum and no further", () => {
    const s = drained(0);
    run(s, tune, 9 * 16);
    expect(s.slow.meter).toBe(16);
    run(s, tune, 500);
    expect(s.slow).toEqual({ meter: 16, refill: 0 });
  });

  it("a held pull stops the count, and it goes on where it was when the pull is let go", () => {
    const s = drained(0);
    run(s, tune, 5);
    expect(s.slow).toEqual({ meter: 0, refill: 5 });
    run(s, tune, 30, HOLD);
    expect(s.slow).toEqual({ meter: 0, refill: 5 });
    run(s, tune, 4);
    expect(s.slow).toEqual({ meter: 1, refill: 0 });
  });

  it("it comes back with or without a threat in the room", () => {
    const s = drained(2);
    s.things.length = 0;
    run(s, tune, 18);
    expect(s.slow.meter).toBe(4);
  });

  it("a landing tops it up to at least 8", () => {
    // With nothing coming back by itself, so that the landing is all that can move it.
    const quiet = tuned({ ...STILL, slowRefillTicks: 1e6 });
    for (const [left, after] of [
      [0, 8],
      [3, 8],
      [7, 8],
      [8, 8],
      [11, 11],
      [16, 16],
    ]) {
      const s = night(quiet);
      put(s, "bunny", 30, 30);
      run(s, quiet, 16 - left, HOLD);
      const events = tick(s, quiet, shot(0, -1, 0.5));
      // In flight it is as he left it.
      while (of(events, "land").length === 0 && s.tick < 200) {
        expect(s.slow.meter).toBe(left);
        events.push(...tick(s, quiet));
      }
      expect(of(events, "land")).toHaveLength(1);
      expect(s.slow.meter, `from ${left}`).toBe(after);
    }
    expect(tune.slowLandingFloor).toBe(8);
  });

  it("the three numbers are knobs", () => {
    const other = tuned({ ...STILL, slowMeterMax: 10, slowRefillTicks: 18, slowLandingFloor: 0 });
    const s = night(other);
    put(s, "bunny", 30, 30);
    run(s, other, 40, HOLD);
    expect(s.slowedTicks).toBe(10);
    run(s, other, 17);
    expect(s.slow.meter).toBe(0);
    tick(s, other);
    expect(s.slow.meter).toBe(1);
    // With no floor a landing gives nothing back.
    fire(s, other, shot(0, -1, 0.5), 5);
    run(s, other, 30, HOLD);
    expect(s.him.hot).toBe(false);
    expect(s.slow.meter).toBe(0);
  });
});

describe("wouldSlow is what step then does", () => {
  it("on every tick of a night, the first launch included", () => {
    const tune = tuned({ hearts: 30 });
    const s = createState(8, tune);
    let state = 12345;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const events: SimEvent[] = [];
    let slowed = 0;
    let normal = 0;
    for (let t = 0; t < 7000 && s.phase !== "over"; t++) {
      // A hand that holds a pull in bursts and lets go at any moment, sometimes with the pull still reported held.
      const a = next() * Math.PI * 2;
      const input: Input = {
        launch: next() < 0.03 ? { dx: Math.cos(a), dy: Math.sin(a), power: 1 } : null,
        pullHeld: Math.floor(t / 23) % 3 !== 0,
      };
      const said = wouldSlow(s, input);
      const before = s.slowedTicks;
      const ticked = s.tick;
      step(s, input, tune, events);
      const was = s.slowedTicks > before;
      if (said !== was) expect.fail(`at tick ${t} wouldSlow said ${said} and step ${was ? "slowed" : "did not slow"} the tick`);
      if (s.tick > ticked) {
        if (was) slowed++;
        else normal++;
      }
      // Every tick is one or the other, and real time is their sum at two prices.
      if (s.normalTicks + s.slowedTicks !== s.tick) expect.fail(`ticks do not add up at tick ${t}`);
      if (s.slow.meter < 0 || s.slow.meter > tune.slowMeterMax) expect.fail(`the meter reads ${s.slow.meter} at tick ${t}`);
    }
    expect(slowed).toBeGreaterThan(200);
    expect(normal).toBeGreaterThan(2000);
    expect(s.slowedTicks).toBe(slowed);
    expect(s.normalTicks).toBe(normal);
  });

  it("the tick of the first launch can be a slowed one: by then the rack is a threat", () => {
    const tune = tuned();
    const s = createState(1, tune);
    const input: Input = { launch: { dx: 0, dy: -1, power: 1 }, pullHeld: true };
    expect(wouldSlow(s, input)).toBe(true);
    step(s, input, tune, []);
    expect([s.slowedTicks, s.normalTicks, s.slow.meter]).toEqual([1, 0, 15]);
    // With no launch, or one that is not made of numbers, the night does not start and nothing is slowed.
    const waiting = createState(1, tune);
    expect(wouldSlow(waiting, HOLD)).toBe(false);
    expect(wouldSlow(waiting, { launch: { dx: Number.NaN, dy: 1, power: 1 }, pullHeld: true })).toBe(false);
    // In an empty room the first launch starts a night with no threat in it.
    const empty = createState(1, tune, { empty: true });
    expect(wouldSlow(empty, input)).toBe(false);
  });

  it("when the night is over nothing is slowed", () => {
    const tune = tuned({ ...STILL, hearts: 1 });
    const s = night(tune);
    put(s, "bunny", 185, 374);
    put(s, "bunny", 30, 30);
    tick(s, tune);
    expect(s.phase).toBe("over");
    expect(wouldSlow(s, HOLD)).toBe(false);
  });

  it("real time is normal ticks at 60 a second and slowed ticks at 12", () => {
    // The 12 is 60 × the toy's slow share. If the share is ever changed, the 12 changes with it.
    expect(60 * tuned().slowShare).toBe(12);
    const s = night(tuned(STILL));
    put(s, "bunny", 30, 30);
    run(s, tuned(STILL), 16, HOLD);
    run(s, tuned(STILL), 60, REST);
    const realSeconds = s.normalTicks / 60 + s.slowedTicks / (60 * tuned().slowShare);
    expect(realSeconds).toBeCloseTo(1 + 16 / 12, 12);
  });
});
