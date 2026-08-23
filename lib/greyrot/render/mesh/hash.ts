/**
 * Stable fingerprint of a generated mesh.
 *
 * The regression guard compares geometry, not pixels. Pixel diffing across
 * machines and GPU drivers is fragile and needs an image decoder; the mesh
 * generators are pure double-precision JS, so their output is bit-identical
 * everywhere. Hashing it catches the thing that actually matters — a DSL
 * refactor silently deforming a creature — with no browser and no tolerance
 * fudging.
 *
 * Positions are quantised to 1e-5 before hashing so that a harmless
 * last-bit difference doesn't produce a spurious failure.
 */

import type { Mesh } from "./dsl";

export interface MeshFingerprint {
  vertices: number;
  triangles: number;
  /** FNV-1a over quantised positions and face colours. */
  hash: string;
}

const QUANT = 1e5;

export function fingerprint(mesh: Mesh): MeshFingerprint {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };

  for (const p of mesh.positions) {
    mix(Math.round(p[0] * QUANT));
    mix(Math.round(p[1] * QUANT));
    mix(Math.round(p[2] * QUANT));
  }
  for (const f of mesh.faces) {
    mix(f.length);
    for (const i of f) mix(i);
  }
  for (const c of mesh.faceColors) {
    const col = c ?? mesh.defaultColor;
    mix(Math.round(col[0] * 255));
    mix(Math.round(col[1] * 255));
    mix(Math.round(col[2] * 255));
  }

  return {
    vertices: mesh.positions.length,
    triangles: mesh.triangleCount(),
    hash: (h >>> 0).toString(16).padStart(8, "0"),
  };
}
