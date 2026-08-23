/**
 * Every authored mesh generator, in one list.
 *
 * The preview harness renders from this registry, and the mesh regression
 * check screenshots every entry at a fixed camera — so a refactor inside the
 * DSL cannot silently deform the roster. Adding a creature means adding a row
 * here; that is also what puts it under regression.
 */

import type { Mesh } from "./dsl";
import { box, cone, cylinder, lathe, sphere, spline, tube } from "./dsl";

export interface MeshEntry {
  id: string;
  group: string;
  /** Deterministic: same id, same geometry, every time. */
  build: () => Mesh;
  /** Camera framing hint for the preview and the regression shot. */
  frame?: number;
}

/** DSL smoke shapes — these exist to make DSL regressions visible. */
const primitives: MeshEntry[] = [
  { id: "prim/box", group: "primitive", build: () => box(1, 1, 1) },
  { id: "prim/sphere", group: "primitive", build: () => sphere(0.6, 2) },
  { id: "prim/cylinder", group: "primitive", build: () => cylinder(0.4, 1.2, 12) },
  { id: "prim/cone", group: "primitive", build: () => cone(0.5, 1, 12) },
  {
    id: "prim/lathe-pot",
    group: "primitive",
    build: () =>
      lathe(
        [
          [0, 0],
          [0.45, 0.05],
          [0.5, 0.35],
          [0.3, 0.7],
          [0.36, 0.85],
          [0, 0.9],
        ],
        16,
      ),
  },
  {
    id: "prim/tube-horn",
    group: "primitive",
    build: () => {
      const path = spline(
        [
          [0, 0, 0],
          [0.15, 0.4, 0.05],
          [0.35, 0.7, 0.2],
          [0.4, 0.9, 0.5],
        ],
        18,
      );
      const radii = path.map((_, i) => 0.13 * (1 - i / path.length) + 0.01);
      return tube(path, radii, 8);
    },
  },
];

const entries: MeshEntry[] = [...primitives];

export function registerMesh(entry: MeshEntry): void {
  if (entries.some((e) => e.id === entry.id)) {
    throw new Error(`duplicate mesh id: ${entry.id}`);
  }
  entries.push(entry);
}

export function allMeshes(): readonly MeshEntry[] {
  return entries;
}

export function getMesh(id: string): MeshEntry | undefined {
  return entries.find((e) => e.id === id);
}
