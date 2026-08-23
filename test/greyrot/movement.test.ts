import { describe, expect, it } from "vitest";
import { HERO_RADIUS, MAX_GRADE, MAX_SPEED, WADE_DEPTH } from "../../lib/greyrot/sim/constants";
import { createRtState, type RtState } from "../../lib/greyrot/sim/rt/state";
import { rtStep } from "../../lib/greyrot/sim/rt/step";
import { createSimWorld, type SimWorld } from "../../lib/greyrot/sim/world";

/**
 * Movement physics ("physics and logic in gameplay movement and
 * surroundings" — playtest feedback that became M1 slice 1). Every rule the
 * controller claims to enforce is asserted here against the real world data,
 * not fixtures.
 *
 * Re-pointed at `rtStep` when the exploration sim was deleted. That is not
 * bookkeeping: these rules live in `sim/motion.ts`, which both simulations
 * shared, and asserting them against the one that no longer runs would have
 * been a whole file of green tests measuring nothing. The world-bound clamp
 * below is the proof — `rtStep` did not have one, and this is what found it.
 */

const SEED = 1337;
const WATER = -1.2;

function setup(): { w: SimWorld; s: RtState } {
  return { w: createSimWorld({ seed: SEED, waterLevel: WATER }), s: createRtState(SEED) };
}

function driveToward(w: SimWorld, s: RtState, x: number, z: number, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    const dx = x - s.hero.x;
    const dz = z - s.hero.z;
    const d = Math.hypot(dx, dz) || 1;
    rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
  }
}

describe("basic locomotion", () => {
  it("accelerates to max speed and never beyond", () => {
    const { w, s } = setup();
    for (let t = 0; t < 60; t++) {
      rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
      expect(Math.hypot(s.hero.vx, s.hero.vz)).toBeLessThanOrEqual(MAX_SPEED + 1e-12);
    }
    expect(Math.hypot(s.hero.vx, s.hero.vz)).toBeCloseTo(MAX_SPEED, 6);
  });

  it("stops completely within half a second of releasing input", () => {
    const { w, s } = setup();
    for (let t = 0; t < 30; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    for (let t = 0; t < 15; t++) rtStep(w, s, []);
    expect(s.hero.vx).toBe(0);
    expect(s.hero.vz).toBe(0);
  });

  it("clamps hostile oversized input to unit length", () => {
    const { w, s } = setup();
    const honest = setup();
    for (let t = 0; t < 60; t++) {
      rtStep(w, s, [{ type: "move", dx: 1000, dz: 0 }]);
      rtStep(honest.w, honest.s, [{ type: "move", dx: 1, dz: 0 }]);
    }
    expect(s.hero.x).toBeCloseTo(honest.s.hero.x, 10);
  });

  it("pivots on a reversal — opposed velocity crosses zero within 3 ticks", () => {
    // The playtest's "movement needs to be more reactive": FRICTION only
    // applies at zero input, so a 180° reversal used to fight momentum for
    // ~10 ticks of drift. The pivot brake damps the opposed component.
    const { w, s } = setup();
    for (let t = 0; t < 30; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    expect(s.hero.vx).toBeCloseTo(MAX_SPEED, 6);
    let crossed = -1;
    for (let t = 0; t < 10 && crossed < 0; t++) {
      rtStep(w, s, [{ type: "move", dx: -1, dz: 0 }]);
      if (s.hero.vx <= 0) crossed = t;
    }
    expect(crossed).toBeGreaterThanOrEqual(0);
    expect(crossed).toBeLessThanOrEqual(2); // ticks 0..2 = within 3 ticks
  });

  it("turns facing toward travel and keeps it unit-length", () => {
    const { w, s } = setup();
    for (let t = 0; t < 40; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    expect(s.hero.fx).toBeCloseTo(1, 3);
    expect(Math.hypot(s.hero.fx, s.hero.fz)).toBeCloseTo(1, 9);
    // About-face — the lerp-through-zero edge case must still resolve.
    for (let t = 0; t < 40; t++) rtStep(w, s, [{ type: "move", dx: -1, dz: 0 }]);
    expect(s.hero.fx).toBeCloseTo(-1, 3);
    expect(Math.hypot(s.hero.fx, s.hero.fz)).toBeCloseTo(1, 9);
  });

  it("resolves an EXACTLY collinear about-face from rest", () => {
    // Regression: default facing is (0, 1); walking due south is a perfect
    // 180° opposition, and lerp+normalise deadlocks on it (the lerp shrinks
    // the vector in place and normalising restores it). The hero walked south
    // facing north until the dot-product guard in turnToward. The x-axis test
    // above never caught it — its approach leaves a tiny off-axis residual.
    const { w, s } = setup();
    for (let t = 0; t < 40; t++) rtStep(w, s, [{ type: "move", dx: 0, dz: -1 }]);
    expect(s.hero.fz).toBeCloseTo(-1, 3);
    expect(Math.hypot(s.hero.fx, s.hero.fz)).toBeCloseTo(1, 9);
  });
});

describe("obstacles", () => {
  it("can never end a tick inside any blocker, however long it pushes", () => {
    const { w, s } = setup();
    // Find the nearest tree and shove into it for 100 seconds of sim time.
    let nearest = w.obstacles.list[0]!;
    let best = Infinity;
    for (const o of w.obstacles.list) {
      const d = Math.hypot(o.x, o.z);
      if (d < best) {
        best = d;
        nearest = o;
      }
    }
    driveToward(w, s, nearest.x, nearest.z, 3000);
    for (const o of w.obstacles.list) {
      const d = Math.hypot(s.hero.x - o.x, s.hero.z - o.z);
      expect(d).toBeGreaterThanOrEqual(o.radius + HERO_RADIUS - 1e-6);
    }
  });

  it("slides around a blocker on an oblique approach instead of sticking", () => {
    const { w, s } = setup();
    const o = w.obstacles.list.reduce((a, b) =>
      Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? a : b,
    );
    // Start beside the blocker, aim past it at a tangent-ish angle.
    s.hero.x = o.x - (o.radius + HERO_RADIUS + 0.5);
    s.hero.z = o.z - 2;
    const startZ = s.hero.z;
    for (let t = 0; t < 300; t++) rtStep(w, s, [{ type: "move", dx: 0.25, dz: 1 }]);
    // It must have made real progress along z — a sticky wall would pin it.
    expect(s.hero.z - startZ).toBeGreaterThan(4);
  });
});

describe("terrain rules", () => {
  it("enforces the grade cap on every single tick of a cliff assault", () => {
    const { w, s } = setup();
    // Find a genuinely steep, tall target: a point markedly higher than its
    // approach. The scan is itself an assertion that cliffs exist — the first
    // terrain pass had a map-wide max slope of 0.111 and nothing to test.
    let target: { x: number; z: number; h: number } | null = null;
    for (let z = -70; z <= 70 && !target; z += 2) {
      for (let x = -70; x <= 70; x += 2) {
        const hh = w.field.heightAt(x, z);
        if (
          w.field.slopeAt(x, z) > 0.26 &&
          hh > WATER + 2 &&
          hh - w.field.heightAt(x, z + 4) > 2.2 // approach from +z is well below
        ) {
          target = { x, z, h: hh };
          break;
        }
      }
    }
    expect(target, "test world has no cliff to assault").not.toBeNull();
    const t = target!;
    // Fell the forest on the cliff face (R5). The claim below is about the
    // INTEGRATOR's grade cap, and `pushOutOfBlockers` is not bound by it: a
    // hero squeezed out of a trunk's radius can be displaced a couple of
    // millimetres uphill, which the per-tick assertion reads as illegal climb.
    // That is a real (and tiny) engine truth — collision resolution outranks
    // the grade cap — recorded here rather than hidden, and kept out of a test
    // that exists to measure the terrain rule. It surfaced when the R5 scatter
    // change put a trunk on this particular cliff for the first time.
    w.obstacles.clearRegion((o) => Math.hypot(o.x - t.x, o.z - t.z) > 20);
    s.hero.x = t.x;
    s.hero.z = t.z + 4;

    // Drive straight at it, asserting the physics claim on EVERY tick:
    // height gained ≤ distance moved × MAX_GRADE. Reaching the summit by
    // legal switchbacks is FINE — the rule is the per-tick grade, not the
    // destination (an earlier version asserted "never summits" and failed
    // against a perfectly legal contour route).
    let impeded = 0;
    for (let i = 0; i < 600; i++) {
      const beforeH = w.field.heightAt(s.hero.x, s.hero.z);
      const bx = s.hero.x;
      const bz = s.hero.z;
      const dx = t.x - s.hero.x;
      const dz = t.z - s.hero.z;
      const d = Math.hypot(dx, dz) || 1;
      rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
      const gained = w.field.heightAt(s.hero.x, s.hero.z) - beforeH;
      const moved = Math.hypot(s.hero.x - bx, s.hero.z - bz);
      expect(gained).toBeLessThanOrEqual(moved * MAX_GRADE + 1e-6);
      // "The cap fired": either a hard block, or the contour slide bent the
      // path well away from the driven direction (> ~45° off intent). The old
      // detector counted only full stops, which the pivot brake retired — a
      // braked hero glides along the contour instead of ramming to a
      // standstill, but the slide's redirection is just as observable.
      const along = (dx / d) * (s.hero.x - bx) + (dz / d) * (s.hero.z - bz);
      if (moved < 1e-4 || along < moved * 0.7) impeded++;
    }
    // The cap must have actually FIRED during a cliff assault — a rule that
    // never binds is not a rule (how the first terrain got caught).
    expect(impeded).toBeGreaterThan(5);
  });

  it("never wades past WADE_DEPTH into a real lake", () => {
    const { w, s } = setup();
    // Find deep water — the terrain must have lakes (the first terrain pass
    // had ZERO wet cells, so this scan is itself an assertion that water is a
    // landform, not decoration).
    let lake: { x: number; z: number } | null = null;
    for (let z = -70; z <= 70 && !lake; z += 2) {
      for (let x = -70; x <= 70; x += 2) {
        if (w.field.heightAt(x, z) < WATER - WADE_DEPTH - 0.5) {
          lake = { x, z };
          break;
        }
      }
    }
    expect(lake, "world has no deep lakes — water is decoration again").not.toBeNull();
    // March at the middle of it for 60 seconds of sim time.
    for (let t = 0; t < 1800; t++) {
      const dx = lake!.x - s.hero.x;
      const dz = lake!.z - s.hero.z;
      const d = Math.hypot(dx, dz) || 1;
      rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
      expect(w.field.heightAt(s.hero.x, s.hero.z)).toBeGreaterThanOrEqual(
        WATER - WADE_DEPTH - 1e-6,
      );
    }
  });

  it("wades freely through shallows", () => {
    const { w, s } = setup();
    // Find a shallow (wadeable) wet cell with dry land nearby.
    let shallow: { x: number; z: number } | null = null;
    for (let z = -70; z <= 70 && !shallow; z += 2) {
      for (let x = -70; x <= 70; x += 2) {
        const hh = w.field.heightAt(x, z);
        if (hh < WATER - 0.05 && hh > WATER - WADE_DEPTH + 0.1) {
          shallow = { x, z };
          break;
        }
      }
    }
    expect(shallow, "no wadeable shallows exist").not.toBeNull();
    // A hero standing beside the shallows can walk INTO them.
    s.hero.x = shallow!.x + 1.5;
    s.hero.z = shallow!.z;
    driveToward(w, s, shallow!.x, shallow!.z, 300);
    const d = Math.hypot(s.hero.x - shallow!.x, s.hero.z - shallow!.z);
    expect(d, "shallows are being treated as walls").toBeLessThan(1.0);
  });

  it("a hero dropped into DEEP water can escape to the shallows", () => {
    const { w, s } = setup();
    let deep: { x: number; z: number } | null = null;
    for (let z = -70; z <= 70 && !deep; z += 2) {
      for (let x = -70; x <= 70; x += 2) {
        if (w.field.heightAt(x, z) < WATER - WADE_DEPTH - 0.3) {
          deep = { x, z };
          break;
        }
      }
    }
    expect(deep).not.toBeNull();
    s.hero.x = deep!.x;
    s.hero.z = deep!.z;
    // Head for spawn (dry). Shoreline ripples must not pin the hero — the
    // stuck-forever regression this test exists for.
    let escaped = false;
    for (let t = 0; t < 1800 && !escaped; t++) {
      const d = Math.hypot(s.hero.x, s.hero.z) || 1;
      rtStep(w, s, [{ type: "move", dx: -s.hero.x / d, dz: -s.hero.z / d }]);
      if (w.field.heightAt(s.hero.x, s.hero.z) >= WATER - WADE_DEPTH) escaped = true;
    }
    expect(escaped, "hero is pinned in deep water forever").toBe(true);
  });

  it("stays inside the world bound", () => {
    const { w, s } = setup();
    for (let t = 0; t < 4000; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0.001 }]);
    expect(Math.abs(s.hero.x)).toBeLessThanOrEqual(w.obstacles.bound);
  });
});
