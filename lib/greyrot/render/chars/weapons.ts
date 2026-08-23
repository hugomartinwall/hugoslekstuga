/**
 * Weapon meshes — authored in the DSL, registered so the mesh regression
 * guard covers them like every other model.
 *
 * Modelled grip-at-origin, blade running -Y (down the hanging arm), so they
 * mount directly on the `foreArmR` joint and the attack swing carries them
 * through the slash arc for free.
 */

import { Mesh, box, lathe, type Mesh as DslMesh, type RGB } from "../mesh/dsl";
import { registerMesh } from "../mesh/registry";

const STEEL: RGB = [0.68, 0.7, 0.74];
const STEEL_DARK: RGB = [0.42, 0.44, 0.5];
const WOOD: RGB = [0.4, 0.28, 0.16];
const WOOD_DARK: RGB = [0.3, 0.2, 0.12];
const WRAP: RGB = [0.3, 0.22, 0.16];

/** A worn arming sword: grip, crossguard, tapering blade with a ridge. */
export function bladeMesh(): DslMesh {
  const m = Mesh.empty();
  const grip = box(0.05, 0.16, 0.05).translate(0, 0.05, 0).color(WRAP);
  const pommel = box(0.07, 0.05, 0.07).translate(0, 0.15, 0).color(STEEL_DARK);
  const guard = box(0.24, 0.035, 0.06).translate(0, -0.04, 0).color(STEEL_DARK);
  // Blade: a stretched octahedron reads as fuller + edge at this poly scale.
  const blade = lathe(
    [
      [0, 0],
      [0.035, 0.06],
      [0.028, 0.62],
      [0, 0.78],
    ],
    4,
  )
    .scaleBy(1.6, 1, 0.5) // flatten: blades are wide, not round
    .rotate(Math.PI, 0, 0) // run -Y from the guard
    .translate(0, -0.05, 0)
    .color(STEEL);
  return m.merge(grip, pommel, guard, blade);
}

/** An oak cudgel: fat knotted head, banded. */
export function cudgelMesh(): DslMesh {
  const m = Mesh.empty();
  const shaft = lathe(
    [
      [0.028, 0],
      [0.032, -0.28],
      [0.05, -0.5],
      [0.085, -0.66],
      [0.075, -0.78],
      [0, -0.84],
    ],
    7,
  )
    .noise(0.012, 9, 5)
    .color(WOOD);
  const band = lathe(
    [
      [0.052, -0.46],
      [0.058, -0.5],
      [0.052, -0.54],
    ],
    7,
  ).color(STEEL_DARK);
  const grip = lathe(
    [
      [0.03, 0.12],
      [0.034, 0.02],
      [0.03, -0.02],
    ],
    7,
  ).color(WOOD_DARK);
  return m.merge(shaft, band, grip);
}

registerMesh({ id: "weapon/blade", group: "prop", build: bladeMesh });
registerMesh({ id: "weapon/cudgel", group: "prop", build: cudgelMesh });
