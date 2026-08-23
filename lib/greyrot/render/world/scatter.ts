/**
 * World-object instancing: sim-owned blockers plus decorative grass.
 *
 * Trees and rocks BLOCK MOVEMENT, so their placement is simulation truth
 * (src/sim/world/obstacles.ts) and this file just instances meshes at those
 * positions — what blocks you and what you see are the same objects. Blockers
 * are ALWAYS all drawn, on every quality tier: culling a blocking rock on Low
 * would give the cheapest devices invisible walls.
 *
 * Grass is pure decoration with zero collision, so it stays render-side,
 * seeded, and is the only thing the tier budget thins. Degrading never
 * rearranges anything — lower tiers draw a prefix of the same stable set.
 *
 * One draw call per kind either way.
 */

import { InstancedMesh, Matrix4, Object3D, type Material } from "three";
import { mulberry32 } from "../../sim/math/noise";
import type { Heightfield } from "../../sim/world/heightfield";
import type { Obstacle, ObstacleKind, Obstacles } from "../../sim/world/obstacles";
import { WORLD } from "../art";
import { box, cone, lathe, sphere, tube, type Mesh as DslMesh, type RGB } from "../mesh/dsl";
import { registerMesh } from "../mesh/registry";

// Authored in render/art.ts terms. Foliage was previously dark enough that
// canopies read as black blobs against the sky — in a cozy forest floor the
// trees are part of the warmth, not holes punched in it.
const GRASS: RGB = [...WORLD.mossLit];
const ROCK: RGB = [...WORLD.scatterRock];
const TRUNK: RGB = [...WORLD.bark];
const LEAF: RGB = [...WORLD.leaf];
const LEAF_WARM: RGB = [...WORLD.leafWarm];
const CHAR: RGB = [...WORLD.charBark];

/* ------------------------------------------------------- blocker meshes */

/**
 * The tree trunk is modelled STRAIGHT because its collision circle is a
 * cylinder around the origin — a leaning trunk would visibly disagree with
 * where the hero stops. Character comes from the canopy instead.
 */
function treeMesh(): DslMesh {
  const trunk = tube(
    [
      [0, 0, 0],
      [0, 1.1, 0],
      [0, 2.1, 0],
    ],
    [0.42, 0.3, 0.18],
    7,
  ).color(TRUNK);
  const canopy = lathe(
    [
      [0, 0],
      [0.95, 0.35],
      [0.8, 1.0],
      [0, 1.5],
    ],
    7,
  )
    .translate(0, 1.55, 0)
    .color(LEAF);
  const upper = lathe(
    [
      [0, 0],
      [0.6, 0.3],
      [0, 0.95],
    ],
    6,
  )
    .translate(0.08, 2.5, -0.05)
    .color(LEAF_WARM);
  return trunk.merge(canopy, upper);
}

/** Rock radius matches the collision circle at scale 1 (0.5 m). */
function rockMesh(): DslMesh {
  return sphere(0.5, 1)
    .noise(0.22, 5, 21)
    .scaleBy(1.05, 0.72, 0.95)
    .translate(0, 0.2, 0)
    .color(ROCK);
}

const WALL: RGB = [...WORLD.hutWall];
const ROOF: RGB = [...WORLD.hutRoof];
const DOOR: RGB = [...WORLD.hutDoor];

/**
 * A village hut. Collision circle 1.9 m at scale 1 — the walls, not the roof
 * overhang, since characters walk under eaves.
 */
function hutMesh(): DslMesh {
  const walls = lathe(
    [
      [1.9, 0],
      [1.85, 1.7],
      [1.7, 1.9],
    ],
    8,
  ).color(WALL);
  const roof = lathe(
    [
      [2.4, 1.75],
      [1.4, 2.6],
      [0, 3.2],
    ],
    8,
  ).color(ROOF);
  const door = box(0.9, 1.4, 0.2).translate(0, 0.7, 1.85).color(DOOR);
  return walls.merge(roof, door);
}

/**
 * Fen cypress (round 7): tall thin trunk with a flared, root-buttressed base
 * — the flare is what lets it stand IN pond shallows and read planted rather
 * than dropped — and one sparse dark canopy high up. Same trunk-cylinder
 * collision story as the tree (0.42 at scale 1; converted trees keep their
 * radius), roughly the same triangle budget.
 */
function cypressMesh(): DslMesh {
  const trunk = tube(
    [
      [0, 0, 0],
      [0, 1.6, 0],
      [0, 3.1, 0],
    ],
    [0.52, 0.24, 0.15],
    7,
  ).color(TRUNK);
  const flare = lathe(
    [
      [0.72, 0],
      [0.4, 0.35],
      [0.26, 0.7],
    ],
    7,
  ).color(TRUNK);
  const canopy = lathe(
    [
      [0, 0],
      [0.78, 0.5],
      [0.5, 1.1],
      [0, 1.6],
    ],
    7,
  )
    .translate(0, 2.9, 0)
    .color(LEAF);
  return trunk.merge(flare, canopy);
}

/**
 * Ash-country snag: a bare charred trunk and three branch stubs, no canopy —
 * CHEAPER than a tree, and the bareness is the zone's whole silhouette
 * statement. `charBark`, never black (ART_DIRECTION §2.1b).
 */
function snagMesh(): DslMesh {
  const trunk = tube(
    [
      [0, 0, 0],
      [0.06, 1.3, -0.04],
      [0.02, 2.5, 0.05],
    ],
    [0.4, 0.26, 0.14],
    6,
  ).color(CHAR);
  const b1 = tube(
    [
      [0, 1.7, 0],
      [0.7, 2.2, 0.2],
    ],
    [0.11, 0.05],
    5,
  ).color(CHAR);
  const b2 = tube(
    [
      [0, 2.1, 0],
      [-0.6, 2.6, -0.15],
    ],
    [0.1, 0.04],
    5,
  ).color(CHAR);
  const b3 = tube(
    [
      [0, 1.2, 0],
      [0.35, 1.35, -0.45],
    ],
    [0.09, 0.04],
    5,
  ).color(CHAR);
  return trunk.merge(b1, b2, b3);
}

/**
 * Damp-pyres brazier (R4): a wide iron fire-bowl on three splayed legs over a
 * stone plinth. Silhouette-first — one chunky dish on legs, readable at
 * 800×450 lit or doused — and deliberately COLD as geometry: charBark
 * ironwork, scatterRock plinth, both existing spec colours. The warm half of
 * the read ("glowing warm fire against ash country") is state, not mesh:
 * flame/ember particles over the bowl while the sim says lit, plus a
 * lantern-coloured practical on High/Medium — a brazier's glow always has a
 * visible source, so the practical is legal (ART_DIRECTION §3).
 *
 * Not yet in `BLOCKER_MESH`: proposed to mech as an `ObstacleKind` so
 * placement rides the stage declaration and collision comes 1:1 like every
 * other piece of dressing (~0.6 m circle — the plinth, not the rim overhang,
 * the hut-eaves rule at fire-bowl scale).
 */
export function brazierMesh(): DslMesh {
  const plinth = lathe(
    [
      [0.38, 0],
      [0.33, 0.08],
      [0.22, 0.13],
    ],
    7,
  ).color(ROCK);
  // A chalice, not a puck: the first pass dished only 0.06 m deep and read
  // as a TABLE from the diorama's high angle (capture-judged). The rim lip
  // and a 0.2 m visible inner wall are what say "this holds fire".
  const bowl = lathe(
    [
      [0, 0.58],
      [0.2, 0.6],
      [0.5, 0.72],
      [0.6, 0.88],
      [0.63, 0.98], // outer rim — the silhouette line
      [0.55, 1.0], // rim top
      [0.46, 0.9], // inner wall, visible from above
      [0.3, 0.82],
      [0, 0.8], // coal bed
    ],
    8,
  ).color(CHAR);
  // The heaped coals crest OVER the rim: from the diorama's ~30° the dish
  // interior self-occludes, so the contents have to be silhouette — a flat
  // top read as a table in two straight captures until the heap existed.
  const coals = sphere(0.42, 1).scaleBy(1, 0.5, 1).translate(0, 0.96, 0).color(CHAR);
  const legs = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    return tube(
      [
        [Math.cos(a) * 0.34, 0.66, Math.sin(a) * 0.34],
        [Math.cos(a) * 0.5, 0.0, Math.sin(a) * 0.5],
      ],
      [0.05, 0.07],
      5,
    ).color(CHAR);
  });
  return plinth.merge(bowl, coals, ...legs);
}

registerMesh({ id: "prop/brazier", group: "prop", build: brazierMesh });

/**
 * Exported so the prop-height probe and the height-drift test can measure the
 * SHIPPED geometry rather than re-declare it. mech's camera-sleeve rule is
 * height-aware, and a hand-copied height table is the same defect shape as a
 * hand-copied camera constant — one level down (LOOP.md R4.5, rider 2).
 */
export const BLOCKER_MESH: Record<ObstacleKind, () => DslMesh> = {
  tree: treeMesh,
  rock: rockMesh,
  hut: hutMesh,
  cypress: cypressMesh,
  snag: snagMesh,
  brazier: brazierMesh,
};

/* ------------------------------------------------------------- the class */

export class Scatter {
  private meshes: InstancedMesh[] = [];
  private grass: InstancedMesh | null = null;
  private grassMatrices: Matrix4[] = [];

  constructor(
    field: Heightfield,
    obstacles: Obstacles,
    /** Blockers' material — trunks, boulders, huts. */
    material: Material,
    /** Grass gets its OWN material: the wind sway is a vertex-stage patch
     * (`detail.ts` patchGrass) that must never move a hut. */
    grassMaterial: Material,
    grassBudget: number,
    seed: number,
    waterLevel: number,
    /**
     * Veto for a grass blade at a world point (round 7): the ash country
     * goes BARE — its silhouette statement — and the Low-tier instance
     * budget gets easier for it. Omitted = grass everywhere (the sandbox).
     */
    grassOk?: (x: number, z: number) => boolean,
  ) {
    const dummy = new Object3D();

    /* ---- blockers: instanced 1:1 from the sim's list, always all drawn */
    const byKind = new Map<ObstacleKind, Obstacle[]>();
    for (const o of obstacles.list) {
      const arr = byKind.get(o.kind);
      if (arr) arr.push(o);
      else byKind.set(o.kind, [o]);
    }
    for (const [kind, list] of byKind) {
      const geo = BLOCKER_MESH[kind]().toGeometry({ flat: true });
      const mesh = new InstancedMesh(geo, material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // spans the whole zone
      list.forEach((o, i) => {
        dummy.position.set(o.x, o.y, o.z);
        dummy.rotation.set(0, o.rotY, 0);
        dummy.scale.setScalar(o.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.push(mesh);
    }

    /* ---- grass: decorative, render-seeded, tier-budgeted */
    const rand = mulberry32(seed);
    const half = field.opts.size * 0.5 - 2;
    const MAX_GRASS = 4000; // stable superset; tiers draw a prefix
    let attempts = 0;
    while (this.grassMatrices.length < MAX_GRASS && attempts < MAX_GRASS * 8) {
      attempts++;
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      const y = field.heightAt(x, z);
      if (y < waterLevel + 0.15) continue;
      if (field.slopeAt(x, z) > 0.45) continue;
      if (grassOk && !grassOk(x, z)) continue;
      dummy.position.set(x, y, z);
      dummy.rotation.set(
        (rand() * 2 - 1) * 0.22,
        rand() * Math.PI * 2,
        (rand() * 2 - 1) * 0.22,
      );
      dummy.scale.setScalar(0.7 + rand() * 0.8);
      dummy.updateMatrix();
      this.grassMatrices.push(dummy.matrix.clone());
    }

    if (this.grassMatrices.length > 0) {
      const blades = cone(0.06, 0.55, 3).color(GRASS);
      blades.merge(
        cone(0.05, 0.42, 3).rotate(0, 1.1, 0.3).translate(0.07, 0, 0.04).color(GRASS),
      );
      blades.merge(
        cone(0.05, 0.36, 3).rotate(0, -0.8, -0.28).translate(-0.06, 0, 0.05).color(GRASS),
      );
      const mesh = new InstancedMesh(
        blades.toGeometry({ flat: true }),
        grassMaterial,
        this.grassMatrices.length,
      );
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.grassMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      this.grass = mesh;
      this.meshes.push(mesh);
    }

    this.setGrassBudget(grassBudget);
  }

  /** Tier budget thins GRASS ONLY. Blockers always draw in full. */
  setGrassBudget(n: number): void {
    if (!this.grass) return;
    this.grass.count = Math.max(0, Math.min(this.grassMatrices.length, n));
  }

  get objects(): InstancedMesh[] {
    return this.meshes;
  }

  get instanceCount(): number {
    return this.meshes.reduce((sum, m) => sum + m.count, 0);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}
