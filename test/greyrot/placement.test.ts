import { describe, expect, it } from "vitest";
import { STAGES } from "../../lib/greyrot/content";
import { findArenaNear, scenarioHeightfieldOptions } from "../../lib/greyrot/sim/scenario";
import { Heightfield } from "../../lib/greyrot/sim/world/heightfield";
import { Obstacles } from "../../lib/greyrot/sim/world/obstacles";
import type { SimWorld } from "../../lib/greyrot/sim/world";

/**
 * PLACEMENT: locality and controllability (R5).
 *
 * Two properties the twelve-stage re-theater rests on, neither of which the
 * suite measured before, and both of which the shipped code fails.
 *
 * 1. **Locality.** The scatter drew from one shared RNG stream and consumed a
 *    variable number of draws per attempt, so every rejection shifted the
 *    whole sequence: a five-centimetre causeway change at the far end of the
 *    chapter moved 310 of 2065 obstacles (15%), a relief-class edit 565
 *    (27.4%), opening-stage trees ninety metres away included. That is what
 *    moved the village marker 1.4 m in R4 and got caught by name.
 *
 * 2. **Controllability.** `findArenaNear` scanned a 1 m INTEGER lattice and
 *    took the first flat hit in ring order, so the placed fight was the
 *    authored point plus an integer offset, chosen by scan order. Measured
 *    over a 3 m sweep: a 25 cm authored nudge moved the fight up to 3.01 m,
 *    and twice moved it NORTH when authored south. Twelve stages of that is
 *    authoring by guesswork.
 *
 * Both tests were written before either fix and seen failing for their own
 * reasons — the numbers above are their pre-fix readings.
 */

const SEED = 1337;
const WATER = -1.2;
/** The obstacle stream's derived seed — `createSimWorld`'s own derivation. */
const OBS_SEED = (SEED ^ 0x9e3779b9) >>> 0;

const opts = scenarioHeightfieldOptions();

/** A world literal around a given field: enough for the placement queries. */
const worldOf = (field: Heightfield): SimWorld => ({
  seed: SEED,
  waterLevel: WATER,
  field,
  obstacles: new Obstacles(field, OBS_SEED, WATER),
  wetZones: [],
  roadPath: [],
  gateIndices: [],
  biomeSpans: [],
});

const key = (o: { x: number; z: number }): string => `${o.x.toFixed(4)},${o.z.toFixed(4)}`;

describe("scatter locality", () => {
  it("a terrain edit moves obstacles near it and NOWHERE else", () => {
    // The edit: a disc of ground pushed under the waterline at the chapter's
    // far end. Every candidate inside it fails `minAboveWater` and is
    // rejected — a guaranteed LOCAL change, which is what makes the far-field
    // assertion below mean something instead of measuring an edit that did
    // nothing (this suite's named failure mode, and the exact trap that turned
    // my first version of this measurement green against a 5 cm perturbation
    // no candidate was near enough to notice).
    const EDIT = { x: 24, z: 110 };
    const base = new Heightfield({ seed: SEED, ...opts });
    const edited = new Heightfield({
      seed: SEED,
      ...opts,
      flatSpots: [...opts.flatSpots, { x: EDIT.x, z: EDIT.z, r: 10, h: WATER - 2 }],
    });

    const before = new Obstacles(base, OBS_SEED, WATER).list;
    const after = new Obstacles(edited, OBS_SEED, WATER).list;
    const afterKeys = new Set(after.map(key));

    const far = (o: { x: number; z: number }): boolean =>
      Math.hypot(o.x - EDIT.x, o.z - EDIT.z) > 25;
    const movedFar = before.filter((o) => far(o) && !afterKeys.has(key(o)));
    const movedNear = before.filter((o) => !far(o) && !afterKeys.has(key(o)));

    // The guard first: if the edit changed nothing anywhere, the far-field
    // zero below is a green that measures nothing.
    expect(
      movedNear.length,
      "the edit changed no obstacle at all — the perturbation is inert and this test proves nothing",
    ).toBeGreaterThan(0);
    expect(
      movedFar.length,
      `${movedFar.length} obstacles more than 25 m from the edit moved — placement is not terrain-local`,
    ).toBe(0);
  });
});

describe("placement controllability", () => {
  /**
   * Walk a fight's AUTHORED point south in 25 cm steps and record where it is
   * actually PLACED. The field is built once because `carveArena` fells trees
   * and never touches terrain; the obstacles are rebuilt per step so each
   * reading sees the same forest the real setup pass would.
   */
  const sweep = (x0: number, z0: number): { x: number; z: number }[] => {
    const field = new Heightfield({ seed: SEED, ...opts });
    const out: { x: number; z: number }[] = [];
    for (let k = 0; k <= 12; k++) out.push(findArenaNear(worldOf(field), x0, z0 - k * 0.25));
    return out;
  };

  /** The bar: one 25 cm nudge may not move the fight more than this. */
  const SURPRISE = 2.0;

  for (const id of ["s3", "s8"]) {
    it(`authoring ${id}'s fight south moves it south, predictably`, () => {
      const st = STAGES.find((s) => s.id === id)!;
      const m = st.markers[0]!;
      expect(m.exact, `${id}'s fight is exact — placement never searches, nothing to measure`).not.toBe(
        true,
      );
      const rows = sweep(m.at[0], m.at[1]);

      let backward = 0;
      let surprise = 0;
      let worst = "";
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]!;
        const b = rows[i]!;
        if (b.z > a.z) backward++;
        const jump = Math.hypot(b.x - a.x, b.z - a.z);
        if (jump > surprise) {
          surprise = jump;
          worst = `(${a.x.toFixed(1)}, ${a.z.toFixed(1)}) -> (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`;
        }
      }
      expect(
        backward,
        `${id}: authoring the fight SOUTH moved it north ${backward} time(s) — placement is not steerable`,
      ).toBe(0);
      expect(
        surprise,
        `${id}: one 25 cm nudge moved the fight ${surprise.toFixed(2)} m ${worst} — authoring by guesswork`,
      ).toBeLessThanOrEqual(SURPRISE);
    });
  }
});
