/**
 * Terrain MESH building — presentation only.
 *
 * The heights themselves live in the simulation (src/sim/world/heightfield.ts)
 * because walkability is gameplay truth; this file just turns that heightfield
 * into flat-shaded, vertex-coloured geometry. Same data the hero walks on, by
 * construction.
 *
 * No textures. Banding grass → rock → snow by altitude, and forcing steep
 * faces to rock regardless of altitude, reads as geological for the cost of a
 * vertex colour. Flat shading keeps it consistent with the characters.
 */

import { BufferAttribute, BufferGeometry } from "three";
import type { Heightfield } from "../../sim/world/heightfield";
import { WORLD } from "../art";
import { srgbToLinear, type RGB } from "../mesh/dsl";

/**
 * Bands, authored in render/art.ts. The ground is MOSS by default, not dry
 * grass — this is a forest floor at golden hour, and the first pass's
 * sand-dominant low band made every stage read as a beach
 * (`docs/ART_DIRECTION.md` §2.1).
 */
const PALETTE = {
  earth: WORLD.earth,
  shore: WORLD.shore,
  moss: WORLD.moss,
  mossLit: WORLD.mossLit,
  rock: WORLD.rock,
  lichen: WORLD.lichen,
};

const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The three LOW bands a biome may recolour (`ART_DIRECTION.md` §2.1b). The
 * band structure never varies — only these inputs do; `rock`/`lichen` stay
 * global because summits sit above any biome.
 */
export interface GroundBands {
  shore: RGB;
  ground: RGB;
  groundLit: RGB;
}

const DEFAULT_BANDS: GroundBands = {
  shore: PALETTE.shore,
  ground: PALETTE.moss,
  groundLit: PALETTE.mossLit,
};

function colorFor(
  y: number,
  normalY: number,
  amplitude: number,
  waterLevel: number,
  bands: GroundBands,
): RGB {
  const h = (y - waterLevel) / amplitude;
  // Steepness forces rock regardless of altitude — this is what stops the
  // terrain looking like a painted blanket draped over hills.
  const slope = 1 - Math.min(1, Math.max(0, normalY));
  const rockiness = Math.min(1, Math.max(0, (slope - 0.28) / 0.32));

  // The ground band owns the widest range by a distance: the playable ground
  // is where the player spends every second of the game. The waterline is
  // DAMP SHORE, not earth (round 6: the old earth band ran 3.6 m up from the
  // water — a huge horizontal ring in the shallow basin — and multiplied
  // with the cream haze into tan desert). Earth belongs to the road tread;
  // the band table is authored in ART_DIRECTION §2.1, the per-biome low
  // bands in §2.1b.
  let base: RGB;
  if (h < 0.005) base = bands.shore;
  else if (h < 0.05) base = lerp3(bands.shore, bands.ground, (h - 0.005) / 0.045);
  else if (h < 0.14) base = bands.ground;
  else if (h < 0.68) base = lerp3(bands.ground, bands.groundLit, (h - 0.14) / 0.54);
  else if (h < 0.88) base = lerp3(bands.groundLit, PALETTE.rock, (h - 0.68) / 0.2);
  else base = lerp3(PALETTE.rock, PALETTE.lichen, Math.min(1, (h - 0.88) / 0.12));

  return lerp3(base, PALETTE.rock, rockiness);
}

/**
 * How far from the centreline the worn dirt reaches, and where it has faded
 * back to moss entirely. Narrower than the 2.4 m walkable half-width on
 * purpose: a path the exact width of its own collision channel reads as a
 * generated artefact; a slightly narrow tread with green edges reads as WORN.
 */
const ROAD_FULL = 1.6;
const ROAD_FADE = 2.6;

/**
 * Flat-shaded triangle soup with per-face colour — no vertex sharing, so the
 * facets stay crisp, matching the character pipeline.
 *
 * `road` is the sim's road centreline (`SimWorld.roadPath`) — faces near it
 * blend toward `earth`, the palette's authored "Earth / path" colour, so the
 * route the scenario carved is a route the player can SEE. First playtest:
 * the road existed as physics and not as a picture, and "which way is
 * forward" was a guess. Boot-time cost only; the geometry is built once.
 */
export function buildTerrainGeometry(
  field: Heightfield,
  waterLevel: number,
  road: readonly { x: number; z: number }[] = [],
  // Per-road-sample ground bands (round 7's biomes), pre-blended by the
  // caller. The road argmin below already finds the nearest sample per face;
  // recording its INDEX makes the zone lookup free. Faces far from the road
  // inherit the zone of the stretch they flank — total coverage, no seams.
  bandsAt?: readonly GroundBands[],
): BufferGeometry {
  const { size, segments, amplitude } = field.opts;
  const tris = segments * segments * 2;
  const pos = new Float32Array(tris * 9);
  const nrm = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);

  const at = (i: number, j: number): [number, number, number] => {
    const x = (i / segments - 0.5) * size;
    const z = (j / segments - 0.5) * size;
    return [x, field.gridHeight(i, j), z];
  };

  let p = 0;
  const emit = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ): void => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;

    const midY = (a[1] + b[1] + c[1]) / 3;
    let color: RGB;

    // The road argmin. Squared-distance test against every centreline sample —
    // 32k faces × ~150 samples is a few million comparisons, ONCE, at boot.
    // It now earns twice: the distance drives the tread blend, the INDEX
    // picks the face's biome bands.
    if (road.length > 0) {
      const mx = (a[0] + b[0] + c[0]) / 3;
      const mz = (a[2] + b[2] + c[2]) / 3;
      let d2 = Infinity;
      let nearest = 0;
      for (let ri = 0; ri < road.length; ri++) {
        const r = road[ri]!;
        const dx = mx - r.x;
        const dz = mz - r.z;
        const q = dx * dx + dz * dz;
        if (q < d2) {
          d2 = q;
          nearest = ri;
        }
      }
      color = colorFor(midY, ny, amplitude, waterLevel, bandsAt?.[nearest] ?? DEFAULT_BANDS);
      const d = Math.sqrt(d2);
      // The road tread stays EARTH in every zone (§2.1b — it is what keeps
      // the route legible through the ash country). Not full strength even
      // at the centre: a dirt ribbon at 100% reads as paint,
      // worn-through-to-earth at 85% keeps the ground's texture in it.
      if (d < ROAD_FADE) {
        const t = d <= ROAD_FULL ? 1 : 1 - (d - ROAD_FULL) / (ROAD_FADE - ROAD_FULL);
        color = lerp3(color, PALETTE.earth, t * 0.85);
      }
    } else {
      color = colorFor(midY, ny, amplitude, waterLevel, DEFAULT_BANDS);
    }

    for (const v of [a, b, c]) {
      pos[p] = v[0];
      pos[p + 1] = v[1];
      pos[p + 2] = v[2];
      nrm[p] = nx;
      nrm[p + 1] = ny;
      nrm[p + 2] = nz;
      col[p] = srgbToLinear(color[0]);
      col[p + 1] = srgbToLinear(color[1]);
      col[p + 2] = srgbToLinear(color[2]);
      p += 3;
    }
  };

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j + 1);
      const d = at(i + 1, j);
      emit(a, b, c);
      emit(a, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("normal", new BufferAttribute(nrm, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
