import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE, GAME, TOY, mergeTune } from "../../lib/knuff/content/tune";
import { MAX_DUMMIES } from "../../lib/knuff/sim/dummies";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, Tune } from "../../lib/knuff/sim/types";

/**
 * The knobs are one plain table, and a caller may lay a partial one over
 * it when a game starts: the owner turns them from a link while he plays.
 * A table typed by hand must not be able to break the game it is laid on.
 */

describe("the knob table", () => {
  it("is plain: every knob a finite number, but the pull's direction", () => {
    for (const [knob, value] of Object.entries(DEFAULT_TUNE)) {
      if (knob === "pullDir") expect(["back", "push"]).toContain(value);
      else expect(typeof value === "number" && Number.isFinite(value), knob).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(DEFAULT_TUNE))).toEqual(DEFAULT_TUNE);
  });

  it("is its two halves, and no knob is in both", () => {
    const toy = Object.keys(TOY);
    const game = Object.keys(GAME);
    expect(toy.filter((k) => game.includes(k))).toEqual([]);
    expect([...toy, ...game].sort()).toEqual(Object.keys(DEFAULT_TUNE).sort());
  });

  it("the aim line runs through one cushion, the pull is a pull back, the room slows to a fifth", () => {
    expect(DEFAULT_TUNE.aimCushions).toBe(1);
    expect(DEFAULT_TUNE.pullDir).toBe("back");
    expect(DEFAULT_TUNE.slowShare).toBe(0.2);
    expect(DEFAULT_TUNE.pullFullPx).toBe(100);
  });
});

describe("laying a partial table over it", () => {
  it("changes the knobs it names and no other", () => {
    const tune = mergeTune(DEFAULT_TUNE, { aimCushions: 2, pullDir: "push", maxSpeed: 1000 });
    expect(tune.aimCushions).toBe(2);
    expect(tune.pullDir).toBe("push");
    expect(tune.maxSpeed).toBe(1000);
    const rest = (t: Tune) => Object.entries(t).filter(([k]) => !["aimCushions", "pullDir", "maxSpeed"].includes(k));
    expect(rest(tune)).toEqual(rest(DEFAULT_TUNE));
  });

  it("never changes the table it is laid on", () => {
    const before = JSON.stringify(DEFAULT_TUNE);
    const tune = mergeTune(DEFAULT_TUNE, { friction: 1 });
    expect(JSON.stringify(DEFAULT_TUNE)).toBe(before);
    expect(tune).not.toBe(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, undefined)).toEqual(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, undefined)).not.toBe(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, null)).toEqual(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, {})).toEqual(DEFAULT_TUNE);
  });

  it("leaves out what is not a knob, or not the kind of thing the knob holds", () => {
    // As it would arrive from a link: JSON, typed by hand.
    const typed = JSON.parse(
      '{"aimCushions":2,"pace":3,"maxSpeed":"fast","friction":null,"pullDir":"sideways","hotFrac":true,"restSpeed":[14],"__proto__":{"dragK":9},"constructor":1}',
    ) as Partial<Tune>;
    const tune = mergeTune(DEFAULT_TUNE, typed);
    expect(tune).toEqual({ ...DEFAULT_TUNE, aimCushions: 2 });
    expect(Object.keys(tune).sort()).toEqual(Object.keys(DEFAULT_TUNE).sort());
    expect(Object.getPrototypeOf(tune)).toBe(Object.prototype);
  });

  it("leaves out a number that is not one", () => {
    const tune = mergeTune(DEFAULT_TUNE, { maxSpeed: Number.NaN, friction: Number.POSITIVE_INFINITY, dragK: Number.NEGATIVE_INFINITY });
    expect(tune).toEqual(DEFAULT_TUNE);
  });

  it("a second table goes over the first", () => {
    const once = mergeTune(DEFAULT_TUNE, { maxSpeed: 1000, friction: 100 });
    const twice = mergeTune(once, { friction: 120 });
    expect(twice.maxSpeed).toBe(1000);
    expect(twice.friction).toBe(120);
  });
});

describe("an odd table still gives a State made of numbers", () => {
  /**
   * The values of a knob are not checked for sense: a table that asks for
   * a negative mass, or for cushions that give back three times what they
   * get, gets what it asks for (and numbers that run away). What is checked
   * is that the ordinary slips of a hand on a link (a nought, a minus, a
   * knob turned far too high) do not put a NaN into the State.
   */
  function survives(over: Partial<Tune>): boolean {
    const tune = mergeTune(DEFAULT_TUNE, over);
    const s = createState(7, tune);
    const events: SimEvent[] = [];
    // Hard launches and soft ones, at the rack and away from it: pops, slow
    // bumps, cushions, dummies shoving dummies, dummies coming back.
    for (let t = 0; t < 1500; t++) {
      events.length = 0;
      const n = t / 50;
      const launch = t % 50 === 0 ? { dx: Math.cos(n * 2.4) * 0.5, dy: -1 + (n % 5) * 0.45, power: n % 3 === 0 ? 1 : 0.15 + (n % 7) * 0.03 } : null;
      step(s, { launch, pullHeld: false }, tune, events);
    }
    const copy = cloneState(s);
    const text = JSON.stringify(s);
    // No NaN and no Infinity anywhere: JSON would have written them as null.
    return !text.includes("null") && hashState(copy) === hashState(JSON.parse(text));
  }

  const ODD: [string, Partial<Tune>][] = [
    ["nothing changed", {}],
    ["no launch speed", { maxSpeed: 0 }],
    ["a huge launch speed", { maxSpeed: 1e6 }],
    ["no drag and no friction", { dragK: 0, friction: 0 }],
    ["negative friction", { friction: -500 }],
    ["no substeps", { maxSubsteps: 0 }],
    ["no substep travel", { maxSubstepTravel: 0 }],
    ["a negative radius", { himRadius: -5 }],
    ["a radius wider than the room", { himRadius: 400 }],
    ["cushions that give nothing back", { wallRestitution: 0, lightWallRestitution: 0 }],
    ["no slow motion, and time stopped while aiming", { slowShare: 0 }],
    ["everything is hot", { hotFrac: 0 }],
    ["nothing is hot", { hotFrac: 50 }],
    ["no dummies", { dummyCount: 0 }],
    ["a negative number of dummies", { dummyCount: -3 }],
    ["dummies that come back at once", { dummyRespawnTicks: 0 }],
    ["a pull with no length", { pullFullPx: 0, noShotPx: 0, lineShowsPx: 0 }],
  ];
  for (const [name, over] of ODD) {
    it(name, () => {
      expect(survives(over)).toBe(true);
    });
  }

  it("a million dummies asked for is forty", () => {
    const s = createState(7, mergeTune(DEFAULT_TUNE, { dummyCount: 1e6 }));
    expect(s.things).toHaveLength(MAX_DUMMIES);
    expect(MAX_DUMMIES).toBe(40);
  });
});
