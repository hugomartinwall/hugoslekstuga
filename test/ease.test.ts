import { describe, expect, it } from "vitest";
import { clamp01, easeOut, lerp, progress } from "../lib/overrun/render/ease";
import { effectiveReduced, pulse, setMotionPref } from "../lib/overrun/render/motion";

describe("easing", () => {
  it("pins its endpoints exactly", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(lerp(3, 9, 0)).toBe(3);
    expect(lerp(3, 9, 1)).toBe(9);
  });

  it("is the quadratic ease-out the renderer already open-coded", () => {
    // renderer.ts had `1.2 - 0.2*t*(2-t)` for the overlay title, i.e. this
    // curve. If the shape changes, those call sites change with it.
    expect(easeOut(0.5)).toBeCloseTo(0.75, 10);
    expect(easeOut(0.25)).toBeCloseTo(0.4375, 10);
  });

  it("is monotonic across the unit interval", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps outside 0..1 — a backgrounded tab hands you an age of minutes", () => {
    expect(clamp01(-4)).toBe(0);
    expect(clamp01(40)).toBe(1);
    expect(easeOut(-4)).toBe(0);
    expect(easeOut(40)).toBe(1);
    // The realistic shape of the bug: 90s elapsed on a 150ms animation.
    expect(progress(90_000, 0, 150)).toBe(1);
  });

  it("eases from 0 to 1 over the stated duration", () => {
    expect(progress(1000, 1000, 200)).toBe(0);
    expect(progress(1100, 1000, 200)).toBeCloseTo(0.75, 10);
    expect(progress(1200, 1000, 200)).toBe(1);
  });

  it("returns 1, not 0, when motion is reduced", () => {
    // The contract that makes reduced motion mean "show me the end state"
    // rather than "freeze at the start" — a panel stuck at t=0 is invisible.
    for (const age of [0, 1, 75, 150, 10_000]) {
      expect(progress(age, 0, 150, true)).toBe(1);
    }
  });

  it("treats a zero-length animation as already finished", () => {
    expect(progress(0, 0, 0)).toBe(1);
  });
});

describe("pulse period", () => {
  it("treats its second argument as a full period in ms, not an angular divisor", () => {
    // The regression this exists for: four call sites were converted from
    // `Math.sin(now / n)` to `pulse(now, n)` verbatim. In the former, `n` is an
    // inverse angular frequency and the period is 2*PI*n — so every one of them
    // ran 6.28x too fast, putting the selection ring at 6.7 Hz and the aim ring
    // at 8.3 Hz. Nothing failed, because nothing pinned the units.
    expect(pulse(0, 1000)).toBeCloseTo(0, 10);
    expect(pulse(250, 1000)).toBeCloseTo(1, 10); // quarter period -> peak
    expect(pulse(500, 1000)).toBeCloseTo(0, 10); // half period -> zero crossing
    expect(pulse(750, 1000)).toBeCloseTo(-1, 10);
    expect(pulse(1000, 1000)).toBeCloseTo(0, 10); // one full cycle
  });

  it("completes exactly one cycle per period, at any period", () => {
    for (const period of [120, 942, 1131, 1571]) {
      expect(pulse(period * 0.25, period), `period ${period}`).toBeCloseTo(1, 10);
      expect(pulse(period * 1.25, period), `period ${period}`).toBeCloseTo(1, 10);
    }
  });

  it("flattens to zero when motion is reduced, so the mark stops moving but stays put", () => {
    setMotionPref("on");
    expect(pulse(250, 1000)).toBe(0);
    setMotionPref("auto");
    expect(pulse(250, 1000)).toBeCloseTo(1, 10);
  });
});

describe("motion preference", () => {
  it("lets the player override the OS in both directions", () => {
    // The whole reason this is three states and not a boolean.
    expect(effectiveReduced("off", true)).toBe(false);
    expect(effectiveReduced("on", false)).toBe(true);
  });

  it("follows the OS on auto", () => {
    expect(effectiveReduced("auto", true)).toBe(true);
    expect(effectiveReduced("auto", false)).toBe(false);
  });

  it("is total over the six combinations", () => {
    // The truth table, spelled out. An earlier version built a Set of
    // `${pref}:${os}:${result}` and asserted size 6 — but the (pref, os)
    // prefix is already unique across the six iterations, so the RESULT could
    // not affect the count. It passed for a function that always returned
    // true, always false, or ignored the override entirely.
    expect(
      (["auto", "on", "off"] as const).flatMap((p) =>
        [true, false].map((os) => effectiveReduced(p, os)),
      ),
    ).toEqual([true, false, true, true, false, false]);
  });
});

describe("reduced motion at the particle chokepoint", () => {
  it("spawns nothing when motion is reduced", async () => {
    // ParticlePool takes an injectable predicate precisely so this can be
    // asserted with no canvas and no matchMedia stub. Every particle effect in
    // the game funnels through spawn(), including burst() and confetti().
    const { ParticlePool } = await import("../lib/overrun/render/fx");
    const off = new ParticlePool(() => true);
    const on = new ParticlePool(() => false);
    const live = (p: InstanceType<typeof ParticlePool>) =>
      (p as unknown as { life: Float32Array }).life.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

    off.burst(0, 0, 14, 1);
    off.confetti(34, 1, 5);
    off.spawn(0, 0, 1, 1, 200, 1, 1);
    expect(live(off)).toBe(0);

    on.burst(0, 0, 14, 1);
    expect(live(on)).toBe(14);
  });

  it("wires the SHIPPED default to the real preference, not just an injection", async () => {
    // The test above injects its predicate, so it passes even if the default
    // parameter is mis-wired — which is the only version the game actually
    // constructs. This pins the default with no injection at all.
    const { ParticlePool } = await import("../lib/overrun/render/fx");
    const { setMotionPref } = await import("../lib/overrun/render/motion");
    const live = (p: InstanceType<typeof ParticlePool>) =>
      (p as unknown as { life: Float32Array }).life.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

    setMotionPref("on");
    const off = new ParticlePool();
    off.burst(0, 0, 14, 1);
    expect(live(off), "default predicate ignores the motion preference").toBe(0);

    setMotionPref("off");
    const on2 = new ParticlePool();
    on2.burst(0, 0, 14, 1);
    expect(live(on2)).toBe(14);
    setMotionPref("auto");
  });
});
