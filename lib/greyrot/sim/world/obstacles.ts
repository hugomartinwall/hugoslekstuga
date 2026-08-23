/**
 * Blocking obstacles — SIMULATION ground truth.
 *
 * Trees and large rocks block movement, so their placement belongs to the sim,
 * not the renderer. The renderer instances its meshes FROM this list, which
 * guarantees that what blocks you and what you see are the same objects.
 *
 * Two rules that fall out of that:
 *
 *  1. Blocking obstacles are ALWAYS drawn, on every quality tier. A tier that
 *     culled a blocking rock would give low-end players invisible walls.
 *  2. Only non-blocking decoration (grass, pebbles) may thin with the tier —
 *     that stays render-side and the sim never knows it exists.
 *
 * Placement is seeded rejection sampling; collision queries go through a
 * uniform grid so the per-tick cost is a handful of cells, not a scan of the
 * whole list.
 */

import { mulberry32 } from "../math/noise";
import type { Heightfield } from "./heightfield";

/**
 * `cypress` and `snag` are BIOME DRESSINGS (round 7), never placed by the
 * ambient sampler below: `dressBiomes` in scenario.ts converts ambient trees
 * in-place (same radius, so the lookup grid stays valid) — cypress in the
 * fen, bare charred snags in the ash country — and plants extra cypress into
 * pond shallows, which ambient placement's `minAboveWater` never does.
 */
export type ObstacleKind = "tree" | "rock" | "hut" | "cypress" | "snag" | "brazier";

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Terrain height at placement — cached so the renderer needn't resample. */
  y: number;
  /** Visual scale multiplier. */
  scale: number;
  /** Yaw, radians. Rotation is visual only; collision is a circle. */
  rotY: number;
  /** Blocking radius in metres, already scaled. */
  radius: number;
}

interface KindSpec {
  kind: ObstacleKind;
  count: number;
  minScale: number;
  maxScale: number;
  maxSlope: number;
  /** Metres above water level required to place. */
  minAboveWater: number;
  /** Blocking radius at scale 1 (trunk, not canopy — you can walk under leaves). */
  baseRadius: number;
  /** Keep-out radius around the spawn so the opening area stays playable. */
  spawnClearance: number;
}

const SPECS: readonly KindSpec[] = [
  {
    kind: "tree",
    count: 620,
    minScale: 0.75,
    maxScale: 1.7,
    maxSlope: 0.38,
    minAboveWater: 0.4,
    baseRadius: 0.42,
    spawnClearance: 6,
  },
  {
    kind: "rock",
    count: 340,
    minScale: 0.55,
    maxScale: 1.6,
    maxSlope: 0.7,
    minAboveWater: 0.05,
    baseRadius: 0.5,
    spawnClearance: 5,
  },
];

const CELL = 4; // metres; comfortably larger than any obstacle radius + hero

/**
 * Attempts made per placement slot (R5). The scatter no longer fills to a
 * target — it makes a FIXED number of tries and keeps whatever lands, so the
 * census is a function of the terrain rather than a guaranteed count.
 *
 * That is a deliberate semantic change, ratified rather than slipped in: a
 * forest that thins where the ground is bad is the honest world model, and the
 * fill loop was itself a global coupling (one rejection near an edit pulled in
 * extra attempts everywhere else, which is locality lost for a number nobody
 * reads). 1.4 puts chapter 1 at ~2149 against the fill loop's 2065.
 */
const ATTEMPT_RATIO = 1.4;

/**
 * The draw source for ONE attempt: a hash of (seed, spec, attempt), not the
 * next values off a shared stream.
 *
 * This is the whole locality guarantee. With a shared stream every draw
 * depended on how many earlier attempts had been REJECTED — and rejection
 * reads the terrain, so any terrain edit anywhere re-rolled every later tree
 * in the world. Measured on the fill-loop version: a 5 cm causeway change at
 * the far end of the chapter moved 310 of 2065 obstacles, a relief-class edit
 * 565, opening-stage trees ninety metres away included. It moved the village
 * marker 1.4 m in R4 and the validator caught it by name.
 *
 * Indexed like this, an attempt's candidate is a pure function of its index,
 * so terrain can only decide whether a candidate is KEPT — and that decision
 * is local (a height sample plus overlap against neighbours). The rebuild
 * needs this: it multiplies terrain edits, and every one of them was a world
 * re-roll.
 */
function attemptSeed(seed: number, spec: number, attempt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ spec, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ attempt, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export class Obstacles {
  readonly list: Obstacle[];
  private grid = new Map<number, number[]>();
  private halfSize: number;

  constructor(field: Heightfield, seed: number, waterLevel: number) {
    const half = field.opts.size * 0.5 - 2;
    this.halfSize = half;
    const out: Obstacle[] = [];

    // Counts were authored against the 160 m field; a bigger world keeps the
    // same DENSITY, or the forest thins out exactly where the campaign grew.
    const areaScale = (field.opts.size / 160) ** 2;

    SPECS.forEach((spec, si) => {
      const attempts = Math.round(spec.count * areaScale * ATTEMPT_RATIO);
      for (let a = 0; a < attempts; a++) {
        // Every attempt draws from its OWN source, and draws ALL FOUR values
        // whatever happens next — a rejection must not cost the stream a
        // different number of draws than an acceptance, or the locality this
        // buys is given straight back.
        const rand = mulberry32(attemptSeed(seed, si, a));
        const x = (rand() * 2 - 1) * half;
        const z = (rand() * 2 - 1) * half;
        const scale = spec.minScale + rand() * (spec.maxScale - spec.minScale);
        const rotY = rand() * Math.PI * 2;

        // Spawn clearance: the first 60 seconds happen here; a tree on the
        // player's toes at t=0 is a bad opening frame.
        if (x * x + z * z < spec.spawnClearance * spec.spawnClearance) continue;
        const y = field.heightAt(x, z);
        if (y < waterLevel + spec.minAboveWater) continue;
        if (field.slopeAt(x, z) > spec.maxSlope) continue;

        const radius = spec.baseRadius * scale;

        // No overlapping blockers: two trees fused at the trunk look wrong
        // and create pinch gaps narrower than the hero. This is the one test
        // that reads other obstacles, and it reads only NEIGHBOURS — which is
        // what keeps a rejection's blast radius to its own cell.
        let overlaps = false;
        for (const j of this.cellCandidates(x, z)) {
          const o = out[j]!;
          const dx = o.x - x;
          const dz = o.z - z;
          const minDist = o.radius + radius + 0.5;
          if (dx * dx + dz * dz < minDist * minDist) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        const idx = out.length;
        out.push({ kind: spec.kind, x, z, y, scale, rotY, radius });
        this.insert(idx, x, z);
      }
    });
    this.list = out;
  }

  private cellKey(cx: number, cz: number): number {
    // Offset into positive space; 16 bits per axis is far beyond any map size.
    return ((cx + 32768) << 16) | (cz + 32768);
  }

  private insert(index: number, x: number, z: number): void {
    const key = this.cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    const cell = this.grid.get(key);
    if (cell) cell.push(index);
    else this.grid.set(key, [index]);
  }

  /** Indices of obstacles in the 3x3 cells around a point. */
  private cellCandidates(x: number, z: number): number[] {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const out: number[] = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cell = this.grid.get(this.cellKey(cx + i, cz + j));
        if (cell) out.push(...cell);
      }
    }
    return out;
  }

  /**
   * Obstacles within reach of a circle at (x, z). Iteration order is grid
   * order, which is deterministic — placement never mutates after build.
   */
  near(x: number, z: number): readonly Obstacle[] {
    return this.cellCandidates(x, z).map((i) => this.list[i]!);
  }

  /**
   * Scenario-placed blocker (a hut, a barricade). Deterministic as long as
   * the scenario itself is; call during setup, before any stepping.
   */
  addStatic(o: Omit<Obstacle, "y"> & { y: number }): void {
    const idx = this.list.length;
    this.list.push(o);
    this.insert(idx, o.x, o.z);
  }

  /**
   * Fell every obstacle the predicate rejects, and rebuild the lookup grid.
   *
   * Used to CARVE a glade for an encounter. Hunting the procedural forest for
   * a clearing that happens to be flat, big enough, and not behind a tree from
   * the fixed camera's angle turned out to have no solutions within a sane
   * radius — the honest move is to author the clearing rather than pray for
   * one, which is what a level designer would do with the same problem.
   *
   * Deterministic: a pure filter over a deterministic list, preserving order.
   * Setup-time only — the grid holds indices into `list`, so this must run
   * before any stepping.
   *
   * @returns how many obstacles were removed.
   */
  clearRegion(keep: (o: Obstacle) => boolean): number {
    const kept: Obstacle[] = [];
    let removed = 0;
    for (const o of this.list) {
      if (keep(o)) kept.push(o);
      else removed++;
    }
    if (removed === 0) return 0;
    this.list.length = 0;
    this.list.push(...kept);
    this.grid.clear();
    for (let i = 0; i < this.list.length; i++) {
      this.insert(i, this.list[i]!.x, this.list[i]!.z);
    }
    return removed;
  }

  /** World bound for movement clamping. */
  get bound(): number {
    return this.halfSize;
  }
}
