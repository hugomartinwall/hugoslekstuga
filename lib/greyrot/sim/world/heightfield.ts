/**
 * The terrain heightfield — SIMULATION ground truth.
 *
 * This used to live in the renderer, which was backwards: walkability (slopes,
 * water, footing) is gameplay, and the architecture guard forbids the sim from
 * importing render code. So the sim owns the heights and the renderer consumes
 * this same object to build its mesh — what you walk on and what you see are
 * one dataset by construction.
 *
 * Determinism: generation uses only IEEE-exact arithmetic (valueNoise is
 * integer/multiply/floor math), and heights are quantised to 1/256 world units
 * at build time so no future refactor can make replay depend on transcendental
 * rounding. `heightAt` interpolates those quantised values exactly.
 */

import { valueNoise } from "../math/noise";

export interface FlatSpot {
  x: number;
  z: number;
  r: number;
  /**
   * Explicit target height. Omit to flatten toward the terrain's own height at
   * the centre, which is right for a settlement built on whatever was there.
   *
   * A ROAD needs this: flattening each disc to its local height removes bumps
   * but leaves the hill, so a road over rising ground stays as steep as the
   * ground. Supplying a graded profile is what turns a chain of discs into an
   * actual road (see `gradedRoadSpots` in scenario.ts).
   */
  h?: number;
}

export interface HeightfieldOptions {
  /** World size in metres. */
  size: number;
  /** Grid resolution. */
  segments: number;
  seed: number;
  amplitude: number;
  /** Lower = broader landforms. */
  frequency: number;
  /** Radius inside which the terrain is flattened for playable ground. */
  flatRadius: number;
  /**
   * Additional flattened discs (settlements, arenas). Each blends the ground
   * toward the height at its own centre with a smooth skirt — same treatment
   * as the spawn disc, so built-up areas sit on believable ground.
   */
  flatSpots: FlatSpot[];
}

export const DEFAULT_HEIGHTFIELD: HeightfieldOptions = {
  size: 160,
  segments: 128,
  seed: 1337,
  // Tuned against measurement, not vibes. The first pass (amplitude 14,
  // freq 0.012) produced a max slope of 0.111 across the whole map against a
  // walkable limit of 0.5, and ZERO cells below the waterline — every terrain
  // rule in the movement controller was unfireable. Terrain that never says
  // "no" is a lawn, not a world.
  amplitude: 26,
  frequency: 0.016,
  flatRadius: 9,
  flatSpots: [],
};

/** 1/256 world units ≈ 4 mm — invisible, and exactly representable. */
const QUANT = 256;

export class Heightfield {
  readonly opts: HeightfieldOptions;
  private heights: Float32Array;

  constructor(opts: Partial<HeightfieldOptions> = {}) {
    this.opts = { ...DEFAULT_HEIGHTFIELD, ...opts };
    const noise = valueNoise(this.opts.seed);
    const { size, segments, amplitude, frequency, flatRadius, flatSpots } = this.opts;
    const n = segments + 1;
    this.heights = new Float32Array(n * n);

    /** Fractal Brownian motion — four octaves is plenty at this scale. */
    const fbm = (x: number, z: number): number => {
      let sum = 0;
      let amp = 1;
      let freq = frequency;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        sum += noise([x * freq, 0, z * freq]) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.07; // non-integer so octaves don't align into visible grids
      }
      return sum / norm;
    };

    // Basins: an independent low-frequency field that depresses whole regions
    // below the waterline, so lakes are landforms rather than a decorative
    // plane that never intersects the ground.
    const basinNoise = valueNoise((this.opts.seed ^ 0x5bd1e995) >>> 0);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / segments - 0.5) * size;
        const z = (j / segments - 0.5) * size;
        let h = fbm(x, z);
        // Ridged component, squared for sharper crests — this is what puts
        // genuinely unwalkable faces on the hillsides.
        const ridge = 1 - Math.abs(fbm(x + 500, z - 500));
        h = h * 0.6 + ridge * ridge * 0.4;
        h *= amplitude;
        // Carve basins where the basin field runs deep.
        const basin = basinNoise([x * 0.008, 7.3, z * 0.008]);
        if (basin < -0.08) h += (basin + 0.08) * amplitude * 1.1;

        // Flatten a disc around the origin so there is playable ground, with
        // a smooth skirt so it doesn't read as a crater.
        if (flatRadius > 0) {
          const d = Math.hypot(x, z);
          const t = Math.min(1, Math.max(0, (d - flatRadius) / (flatRadius * 1.8)));
          h *= t * t * (3 - 2 * t);
        }
        // Settlement discs: blend toward each spot's centre height.
        for (const spot of flatSpots) {
          const d = Math.hypot(x - spot.x, z - spot.z);
          const t = Math.min(1, Math.max(0, (d - spot.r) / (spot.r * 1.2)));
          const blend = 1 - t * t * (3 - 2 * t); // 1 inside, 0 outside skirt
          if (blend > 0) {
            const centreH =
              spot.h ?? this.heightOfRaw(spot.x, spot.z, amplitude, frequency, fbm);
            h = h * (1 - blend) + centreH * blend;
          }
        }
        this.heights[j * n + i] = Math.round(h * QUANT) / QUANT;
      }
    }
  }

  /** Raw pre-flatten height at a point — used as flat-spot centre height. */
  private heightOfRaw(
    x: number,
    z: number,
    amplitude: number,
    frequency: number,
    fbm: (x: number, z: number) => number,
  ): number {
    void frequency;
    let h = fbm(x, z);
    const ridge = 1 - Math.abs(fbm(x + 500, z - 500));
    h = h * 0.6 + ridge * ridge * 0.4;
    return h * amplitude;
  }

  /** Bilinear height sample in world space. THE walkability ground truth. */
  heightAt(x: number, z: number): number {
    const { size, segments } = this.opts;
    const n = segments + 1;
    const fx = (x / size + 0.5) * segments;
    const fz = (z / size + 0.5) * segments;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= segments || j >= segments) return 0;
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.heights[j * n + i]!;
    const h10 = this.heights[j * n + i + 1]!;
    const h01 = this.heights[(j + 1) * n + i]!;
    const h11 = this.heights[(j + 1) * n + i + 1]!;
    return (
      h00 * (1 - tx) * (1 - tz) +
      h10 * tx * (1 - tz) +
      h01 * (1 - tx) * tz +
      h11 * tx * tz
    );
  }

  /** Surface normal from the heightfield gradient. sqrt only — IEEE-exact. */
  normalAt(x: number, z: number): [number, number, number] {
    const e = this.opts.size / this.opts.segments;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const len = Math.hypot(dx, 2 * e, dz);
    return [-dx / len, (2 * e) / len, -dz / len];
  }

  /** Steepness in [0, 1]: 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z)[1];
  }

  /** Raw grid access for the renderer's mesh builder. */
  gridHeight(i: number, j: number): number {
    return this.heights[j * (this.opts.segments + 1) + i]!;
  }
}
