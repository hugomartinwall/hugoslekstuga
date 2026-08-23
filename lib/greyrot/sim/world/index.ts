/**
 * The simulation's world: heightfield + blocking obstacles + water.
 *
 * Built entirely from a seed and never serialized — saves store the seed and
 * rebuild (CLAUDE.md §7: store decisions and seeds, never derived state).
 */

import type { BiomeId } from "../../content/types";
import { Heightfield, type HeightfieldOptions } from "./heightfield";
import { Obstacles } from "./obstacles";

/** Standing water that isn't the global water table — troughs, puddles. */
export interface WetZone {
  x: number;
  z: number;
  r: number;
}

export interface SimWorldOptions {
  seed: number;
  waterLevel: number;
  heightfield?: Partial<HeightfieldOptions>;
}

export interface SimWorld {
  readonly seed: number;
  readonly waterLevel: number;
  readonly field: Heightfield;
  readonly obstacles: Obstacles;
  /** Mutable only during scenario setup. */
  readonly wetZones: WetZone[];
  /**
   * The road's centreline, sampled at ~1 m, filled by `setupRoad`.
   *
   * Lives on the sim world for the same reason `wetZones` does: one dataset,
   * two consumers. The sim carved and graded this line; the renderer tints the
   * ground along it so the player can SEE it — the first playtest's clearest
   * finding was a road that existed as physics and not as a picture.
   */
  readonly roadPath: { x: number; z: number }[];
  /**
   * `roadPath` index of each stage's gate, in stage order — filled by
   * `setupRoad` beside the path itself. The corridor clamp reads it to make
   * the road ONE-WAY: samples before the previous stage's gate stop counting
   * as road, so walking backward runs out of corridor ~4.5 m behind the gate
   * you already crossed (round 6: the player ran from mid-chapter back to
   * the starting lake). Setup-derived; never hashed.
   */
  readonly gateIndices: number[];
  /**
   * The biome zones as arc-length spans over `roadPath` (round 7): each entry
   * says "from this sample on, the world is `biome`", compiled by `setupRoad`
   * from the stage table's tags. Zones are SEQUENTIAL along the one road, so
   * spans-by-sample-index inherit the same arc-order logic the one-way clamp
   * uses, and the s3 doubleback stays inside its own zone for free.
   * Setup-derived like `gateIndices`; never hashed — no sim RULE reads it.
   */
  readonly biomeSpans: { biome: BiomeId; from: number }[];
}

export function createSimWorld(opts: SimWorldOptions): SimWorld {
  const field = new Heightfield({ seed: opts.seed, ...opts.heightfield });
  // Obstacle placement gets its own derived seed so tweaking terrain params
  // never reshuffles every tree, and vice versa.
  const obstacles = new Obstacles(field, (opts.seed ^ 0x9e3779b9) >>> 0, opts.waterLevel);
  return {
    seed: opts.seed,
    waterLevel: opts.waterLevel,
    field,
    obstacles,
    wetZones: [],
    roadPath: [],
    gateIndices: [],
    biomeSpans: [],
  };
}

/** How a point sits between zones: pure `b` at t=1, pure `a` at t=0. */
export interface BiomeBlend {
  a: BiomeId;
  b: BiomeId;
  t: number;
}

/**
 * Samples of road over which one zone eases into the next (~metres, since the
 * road is sampled at ~1 m). Crossing a gate into a new zone, the old world
 * bleeds this far up the walk — a hard colour seam at a gate line would read
 * as a rendering bug, not a border.
 */
const BIOME_TRANSITION = 12;

const PURE: BiomeBlend = { a: "village", b: "village", t: 1 };

/** The zone blend at a road sample index. */
export function biomeAtIndex(world: SimWorld, i: number): BiomeBlend {
  const spans = world.biomeSpans;
  if (spans.length === 0) return PURE;
  let k = 0;
  while (k + 1 < spans.length && spans[k + 1]!.from <= i) k++;
  const span = spans[k]!;
  if (k === 0 || i >= span.from + BIOME_TRANSITION) {
    return { a: span.biome, b: span.biome, t: 1 };
  }
  const raw = (i - span.from) / BIOME_TRANSITION;
  return { a: spans[k - 1]!.biome, b: span.biome, t: raw * raw * (3 - 2 * raw) };
}

/**
 * The zone blend at a world point — nearest-road-sample projection, so the
 * off-road backdrop inherits the zone of the stretch it flanks. A full argmin
 * scan: boot-time consumers only (terrain build, scatter dressing); anything
 * per-frame should track its nearest sample incrementally instead.
 */
export function biomeAt(world: SimWorld, x: number, z: number): BiomeBlend {
  const path = world.roadPath;
  if (path.length === 0) return PURE;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return biomeAtIndex(world, best);
}

/** Is this point standing water (a wet zone, or under the global table)? */
export function isWetAt(world: SimWorld, x: number, z: number): boolean {
  if (world.field.heightAt(x, z) < world.waterLevel) return true;
  for (const w of world.wetZones) {
    const dx = x - w.x;
    const dz = z - w.z;
    if (dx * dx + dz * dz <= w.r * w.r) return true;
  }
  return false;
}
