/**
 * WHAT A DECLARED PROP OCCUPIES — as a silhouette of revolution, sim-side.
 *
 * The camera-sleeve rule (`stage-validator.ts` V13) asks how far the walking
 * lens is from a prop's SURFACE. `sim/` may not import `render/`, so the shape
 * has to be declared here — and a declared shape is only worth anything if
 * something checks it against the mesh that actually ships.
 * `test/prop-volume.test.ts` is that check, and it fails in BOTH directions:
 *
 *   - **under-cover** — any sampled surface point outside the declared
 *     envelope. A rule whose volume is smaller than the object is a rule that
 *     lies, and it lies in the direction that ships the bug.
 *   - **over-cover** — an envelope inflated past the silhouette. An inflated
 *     volume passes its own containment check trivially and then rejects
 *     ground the prop does not occupy, which is how the FIRST camera-sleeve
 *     proposal came to red 7 of 9 declared props and get thrown out.
 *
 * ── WHY A SILHOUETTE OF REVOLUTION AND NOT A HEIGHT ──
 *
 * fun root-caused the shipped bug as *"I am not inside the hut; I am under the
 * eaves"*: a lens 0.81 m outside a hut's 1.9 m collision cylinder and 0.26 m
 * under its apex still has roof over it, because the roof rim reaches 2.4 m
 * where the walls stop at 2.0. One radius cannot express that and one height
 * cannot either. A radius-per-height can, and it is the smallest thing that
 * can.
 *
 * ── WHY NOT A VERTEX TABLE ──
 *
 * `scripts/prop-volume.mjs` binned the mesh BY VERTEX for the whole of R5 and
 * R6. A hut roof has its rim vertices at ~2.4 m and a single apex vertex at
 * 3.2 m and **nothing in between**, so the table reported *reach at or above
 * 2.6 m = 0.00* for a roof that is solid there — and the walking lens flies at
 * exactly 2.6 m. The first model of this rule inherited that hole and reported
 * 9–14 m of clearance where the driven `check-near-lens.mjs` measures the lens
 * **1.83 m INSIDE** a hut. A cone is the worst case for vertex binning and a
 * roof is a cone: the surface between rim and apex is entirely interpolation,
 * and interpolation is exactly what a vertex sample cannot see. **The mesh is
 * not its vertices.** (gfx has since rebuilt that script on exact triangle
 * clipping; this table is verified against the mesh either way.)
 *
 * ── THE ROTATION ──
 *
 * A hut is square in plan and this envelope is round, so it over-covers the
 * faces by up to 0.57 m at the eave notch (0.05 m mean over the height). That
 * is deliberate: `rotY` then cannot matter, the rule has no orientation term
 * to get wrong, and every error runs in the strict direction. The price is
 * paid where it is cheap — a hut that fails V13 by less than 0.6 m is a hut
 * standing close enough that nobody wants to argue about its corners.
 */

import type { ObstacleKind } from "./world/obstacles";

/**
 * `[height, radius]` breakpoints at scale 1, in metres, measured off the built
 * geometry and linearly interpolated between. Heights are relative to the
 * prop's base (the terrain height at its own coordinates); radii are horizontal
 * distance from its axis. Below the first breakpoint the first radius holds;
 * above the last, the last.
 */
export type PropProfile = readonly (readonly [number, number])[];

/**
 * Every obstacle kind, and what it occupies.
 *
 * A `Record` over the closed `ObstacleKind` union for the same reason
 * `OBSTACLE_SOURCE` is one: adding a kind without answering "what volume does
 * this occupy" is a COMPILE error rather than a silent exemption.
 *
 * `null` means **no stage declaration places this kind** — it is ambient
 * scatter, and `plantWalls` already owns the camera's sight sleeve for scatter
 * (trees inside it become rocks; the standing band is emptied outright). A
 * `null` here is not a permission: if a stage ever declares one, V13 fails the
 * build naming the kind, because a declared prop with no volume would
 * otherwise be silently exempt from the one rule written for declared props.
 */
export const PROP_PROFILE: Record<ObstacleKind, PropProfile | null> = {
  // Walls to 2.01, eaves flaring to 2.41 at 1.75, roof to a point at 3.20.
  // Verified: 0.000 m under-cover, 0.57 m worst over-cover, 0.05 m mean.
  hut: [
    [0.0, 2.01],
    [1.73, 2.01],
    [1.75, 2.41],
    [2.6, 1.41],
    [3.2, 0.01],
  ],
  // A bowl on a stem. Its apex is 1.17 m and the walking lens flies at 2.6 m,
  // which is why the gating brazier survives this rule standing beside the
  // road: **the exemption is the geometry, not a flag.** Verified: 0.000 m
  // under-cover, 0.20 m worst over-cover, 0.08 m mean.
  brazier: [
    [-0.02, 0.58],
    [0.62, 0.58],
    [0.99, 0.64],
    [1.11, 0.3],
    [1.17, 0.05],
  ],
  tree: null,
  rock: null,
  cypress: null,
  snag: null,
};

/** Widest point of a profile, doubled — the diameter the near-lens guard faces. */
export function profileDiameter(profile: PropProfile, scale: number): number {
  let r = 0;
  for (const [, pr] of profile) if (pr > r) r = pr;
  return 2 * r * scale;
}

/** Highest point of a profile above its own base, in metres. */
export function profileApex(profile: PropProfile, scale: number): number {
  let y = -Infinity;
  for (const [py] of profile) if (py > y) y = py;
  return y * scale;
}

/**
 * Distance in metres from a world point to the solid's SURFACE, 0 inside it.
 *
 * The solid is the profile revolved about the vertical axis through
 * `(px, pz)`, sitting with its own zero at `baseY` and scaled uniformly. In
 * the (radius, height) half-plane that is a closed polygon — the profile, plus
 * a cap at each end back to the axis — and for any point with radius >= 0 the
 * 2D distance to that polygon IS the 3D distance to the surface of
 * revolution, so no trigonometry appears anywhere in here.
 */
export function propSurfaceDistance(
  profile: PropProfile,
  px: number,
  baseY: number,
  pz: number,
  scale: number,
  x: number,
  y: number,
  z: number,
): number {
  const rho = Math.hypot(x - px, z - pz) / scale;
  const h = (y - baseY) / scale;

  // The boundary polygon, walked once: up the outside, in along the top cap,
  // down the axis, out along the bottom cap.
  const n = profile.length;
  const pts: [number, number][] = [[0, profile[0]![0]]];
  for (const [py, pr] of profile) pts.push([pr, py]);
  pts.push([0, profile[n - 1]![0]]);

  // Inside? Even-odd crossing count on the (r, y) polygon.
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ri, yi] = pts[i]!;
    const [rj, yj] = pts[j]!;
    if (yi > h !== yj > h && rho < ((rj - ri) * (h - yi)) / (yj - yi) + ri) inside = !inside;
  }
  if (inside) return 0;

  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ri, yi] = pts[i]!;
    const [rj, yj] = pts[j]!;
    const dr = ri - rj;
    const dy = yi - yj;
    const len2 = dr * dr + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((rho - rj) * dr + (h - yj) * dy) / len2)) : 0;
    const d = Math.hypot(rho - (rj + dr * t), h - (yj + dy * t));
    if (d < best) best = d;
  }
  return best * scale;
}
