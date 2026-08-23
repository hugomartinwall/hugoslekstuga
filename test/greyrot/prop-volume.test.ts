import { describe, expect, it } from "vitest";
import { BLOCKER_MESH } from "../../lib/greyrot/render/world/scatter";
import {
  PROP_PROFILE,
  profileApex,
  profileDiameter,
  propSurfaceDistance,
  type PropProfile,
} from "../../lib/greyrot/sim/prop-volume";
import type { ObstacleKind } from "../../lib/greyrot/sim/world/obstacles";

/**
 * THE TRANSCRIPTION CHECK for the camera sleeve's volumes (R7).
 *
 * `sim/` may not import `render/`, so `PROP_PROFILE` is a hand-declared
 * silhouette of the mesh that ships — and this project has now shipped a stale
 * evaluated number at five sites, one of them inside the sentence addressed to
 * the implementer. A declared copy with no checker is the sixth.
 *
 * **It fails in BOTH directions, and that is the whole design.**
 *
 *  - **UNDER-COVER** — a surface point outside the declared envelope. A volume
 *    smaller than the object makes V13 pass a prop the lens is standing in, and
 *    the error runs in the direction that ships the bug.
 *  - **OVER-COVER** — an envelope inflated past the silhouette. This is the one
 *    a one-sided check misses, and it is not hypothetical: **the FIRST
 *    camera-sleeve proposal red 7 of 9 declared props** — both village huts,
 *    damp_pyres' gating brazier and all three boss-arena bowls — because its
 *    footprint was far larger than the objects. An inflated volume passes
 *    containment trivially and then rejects ground the prop does not occupy,
 *    which reads as "the rule says the village is illegal" rather than as "the
 *    table is wrong".
 *
 * ── WHY PER TRIANGLE ──
 *
 * `scripts/prop-volume.mjs` binned by VERTEX for the whole of R5 and R6. A hut
 * roof has its rim vertices at ~2.4 m and one apex vertex at 3.2 m and nothing
 * in between, so it reported *reach at or above 2.6 m = 0.00* for a roof that
 * is solid there — **and the walking lens flies at exactly 2.6 m.** A cone is
 * the worst case for vertex binning and a roof is a cone. Everything here
 * samples the SURFACE.
 *
 * ── CURRENT STATE ── GREEN, and a regression guard. Red-proven by shrinking
 * the hut's wall radius 2.01 -> 1.95 (under-cover fires, −0.06 m at y=1.40) and
 * by inflating it to 2.60 (over-cover fires, +0.59 m).
 */

/** Radius of the declared envelope at a height, metres, scale 1. */
function profileRadius(profile: PropProfile, y: number): number {
  if (y <= profile[0]![0]) return profile[0]![1];
  for (let i = 1; i < profile.length; i++) {
    const [hy, hr] = profile[i]!;
    if (y <= hy) {
      const [ly, lr] = profile[i - 1]!;
      const t = (y - ly) / (hy - ly || 1);
      return lr + (hr - lr) * t;
    }
  }
  return profile[profile.length - 1]![1];
}

/** Surface samples of a built mesh: `[y, radius]`, barycentric over every face. */
function surfaceSamples(kind: keyof typeof BLOCKER_MESH): [number, number][] {
  const geo = BLOCKER_MESH[kind]().toGeometry({ flat: true });
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex();
  const v = (i: number): [number, number, number] => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  const tris: [number, number, number][][] = [];
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) tris.push([v(idx.getX(i)), v(idx.getX(i + 1)), v(idx.getX(i + 2))]);
  } else {
    for (let i = 0; i < pos.count; i += 3) tris.push([v(i), v(i + 1), v(i + 2)]);
  }
  const out: [number, number][] = [];
  const M = 16;
  for (const [a, b, c] of tris) {
    for (let i = 0; i <= M; i++) {
      for (let j = 0; i + j <= M; j++) {
        const u = i / M;
        const w = j / M;
        const k = 1 - u - w;
        out.push([
          a![1] * u + b![1] * w + c![1] * k,
          Math.hypot(a![0] * u + b![0] * w + c![0] * k, a![2] * u + b![2] * w + c![2] * k),
        ]);
      }
    }
  }
  return out;
}

/** The declared kinds — the ones a stage places and V13 therefore measures. */
const DECLARED = (Object.keys(PROP_PROFILE) as ObstacleKind[]).filter(
  (k): k is ObstacleKind & keyof typeof BLOCKER_MESH => PROP_PROFILE[k] !== null,
);

describe("the declared prop volumes (V13's subject)", () => {
  it("has a mesh for every declared profile, and a decision for every kind", () => {
    // The `Record` is exhaustive by the type system; this asserts the other
    // half — that a declared profile names something the renderer builds.
    expect(DECLARED.length).toBeGreaterThan(0);
    for (const k of DECLARED) expect(typeof BLOCKER_MESH[k]).toBe("function");
    // A null is a claim that no stage declares this kind, and `OBSTACLE_SOURCE`
    // in stage-validator.ts is where that claim is held. Both are `Record`s
    // over the same closed union, so adding a kind forces both answers.
    expect(Object.keys(PROP_PROFILE).sort()).toEqual(Object.keys(BLOCKER_MESH).sort());
  });

  for (const kind of DECLARED) {
    describe(kind, () => {
      const profile = PROP_PROFILE[kind]!;
      const samples = surfaceSamples(kind);

      it("CONTAINS the built mesh — no surface point outside the envelope", () => {
        let worst = 0;
        let at: [number, number] | null = null;
        for (const [y, r] of samples) {
          const slack = profileRadius(profile, y) - r;
          if (slack < worst) {
            worst = slack;
            at = [y, r];
          }
        }
        expect(
          worst,
          at
            ? `surface point at y=${at[0].toFixed(3)} reaches r=${at[1].toFixed(3)} where the declared profile is ${profileRadius(profile, at[0]).toFixed(3)} — a volume smaller than the object lets V13 pass a prop the lens is standing in`
            : "",
        ).toBeGreaterThanOrEqual(-0.001);
      });

      it("is not INFLATED past the silhouette — the half a one-sided check misses", () => {
        // Per 2 cm of height, the widest the mesh actually reaches vs what the
        // profile claims. Compared against the SILHOUETTE, not against interior
        // points: a solid of revolution is legitimately wider than the vertices
        // on its own axis, and scoring that would make every honest profile
        // look inflated.
        const env = new Map<number, number>();
        for (const [y, r] of samples) {
          const k = Math.round(y / 0.02);
          env.set(k, Math.max(env.get(k) ?? 0, r));
        }
        let worst = 0;
        let sum = 0;
        for (const [k, r] of env) {
          const d = profileRadius(profile, k * 0.02) - r;
          worst = Math.max(worst, d);
          sum += d;
        }
        // 0.6 m is the hut's eave notch — a round envelope over a square plan.
        // That over-cover is deliberate and priced in prop-volume.ts; anything
        // beyond it is a table that has stopped describing the object.
        expect(worst).toBeLessThan(0.6);
        expect(sum / env.size).toBeLessThan(0.12);
      });

      it("reports an apex and a width that match the mesh's own extremes", () => {
        // apex and rMax are attained at VERTICES — a linear surface has no
        // interior maximum — so these two can be checked exactly, and they are
        // the two numbers three scripts transcribe by hand.
        let apex = -Infinity;
        let rMax = 0;
        for (const [y, r] of samples) {
          apex = Math.max(apex, y);
          rMax = Math.max(rMax, r);
        }
        expect(profileApex(profile, 1)).toBeGreaterThanOrEqual(apex - 0.001);
        expect(profileApex(profile, 1)).toBeLessThan(apex + 0.05);
        expect(profileDiameter(profile, 1)).toBeGreaterThanOrEqual(2 * rMax - 0.002);
        expect(profileDiameter(profile, 1)).toBeLessThan(2 * rMax + 0.1);
      });

      it("scales linearly — a 0.9 hut is 0.9 of a hut", () => {
        expect(profileDiameter(profile, 0.9)).toBeCloseTo(profileDiameter(profile, 1) * 0.9, 6);
        expect(profileApex(profile, 0.9)).toBeCloseTo(profileApex(profile, 1) * 0.9, 6);
        // …and so does the distance field, which is what V13 multiplies.
        const one = propSurfaceDistance(profile, 0, 0, 0, 1, 9, 2.6, 0);
        const half = propSurfaceDistance(profile, 0, 0, 0, 0.5, 4.5, 1.3, 0);
        expect(half).toBeCloseTo(one * 0.5, 6);
      });
    });
  }

  describe("propSurfaceDistance", () => {
    const hut = PROP_PROFILE.hut!;

    it("is zero inside the solid and grows outside it", () => {
      // Inside the walls, at chest height.
      expect(propSurfaceDistance(hut, 0, 0, 0, 1, 0.5, 1.0, 0.5)).toBe(0);
      // Under the roof but outside the walls — fun's "under the eaves".
      expect(propSurfaceDistance(hut, 0, 0, 0, 1, 2.2, 1.8, 0)).toBe(0);
      // Out in the open at lens height.
      expect(propSurfaceDistance(hut, 0, 0, 0, 1, 6, 2.6, 0)).toBeGreaterThan(3);
    });

    it("SEES THE ROOF BETWEEN RIM AND APEX — the vertex-binning hole, as a test", () => {
      // A lens 2.6 m up and 1.0 m out from a hut's axis is under solid roof.
      // The vertex table said the reach at 2.6 m was 0.00 and a rule built on
      // it reported clear air here. This is that claim, pinned.
      expect(propSurfaceDistance(hut, 0, 0, 0, 1, 1.0, 2.6, 0)).toBe(0);
      expect(profileRadius(hut, 2.6)).toBeGreaterThan(1.3);
      // And the mesh agrees: a real surface sample lives up there.
      const high = surfaceSamples("hut").filter(([y]) => y > 2.55 && y < 2.65);
      expect(high.length).toBeGreaterThan(0);
      expect(Math.max(...high.map(([, r]) => r))).toBeGreaterThan(1.3);
    });

    it("never over-reports distance against the built triangles — the conservative direction", () => {
      // The profile is a round envelope over a square plan, so it must always
      // read the lens as CLOSER than the true mesh does, never further. An
      // envelope that under-reports proximity is a rule that clears a breach.
      const geo = BLOCKER_MESH.hut().toGeometry({ flat: true });
      const pos = geo.getAttribute("position");
      let worst = Infinity;
      for (let a = 0; a < 24; a++) {
        for (let d = 1; d <= 6; d++) {
          // Deterministic ring of probe points; no RNG in a test that pins a
          // bound (a flaky bound is not a bound).
          const t = (a / 24) * 6.283185307179586;
          const px = Math.cos(t) * d;
          const pz = Math.sin(t) * d;
          const py = 2.6;
          let tri = Infinity;
          for (let i = 0; i < pos.count; i++) {
            tri = Math.min(tri, Math.hypot(px - pos.getX(i), py - pos.getY(i), pz - pos.getZ(i)));
          }
          const env = propSurfaceDistance(hut, 0, 0, 0, 1, px, py, pz);
          worst = Math.min(worst, tri - env);
        }
      }
      expect(worst).toBeGreaterThanOrEqual(-0.001);
    });
  });
});
