import * as THREE from "three";
import { ITEMS } from "./content";
import {
  axial,
  bore,
  canister,
  droneHull,
  optical,
  P,
  plate,
  rankInset,
  strip,
} from "./equipment-parts";
import { box, cylinder, material } from "./geometry";

// Expansion drones share the core airframe from `droneHull` and add one
// unmistakable payload each. Builders return the muzzle / emitter point.
export type DroneBuilder = (
  group: THREE.Group,
  rank: number,
) => [number, number, number];

const FALLBACK_TINT: Record<string, number> = {
  torch_drone: 0xf38c48,
  frost_drone: 0x87d9f1,
  mortar_drone: 0xe7bd63,
  aegis_drone: 0xb9c7a1,
  venom_drone: 0x8ecd71,
};

/** Accent colour from content once the drone is registered, else the design tint. */
function droneTint(kind: string): number {
  const entry = (ITEMS as unknown as Record<string, { color?: string }>)[kind];
  return entry?.color
    ? new THREE.Color(entry.color).getHex()
    : (FALLBACK_TINT[kind] ?? 0xb9c7cc);
}

const UP = new THREE.Vector3(0, 1, 0);
function pitched(
  group: THREE.Group,
  radius: number,
  length: number,
  base: readonly [number, number, number],
  along: number,
  angle: number,
  color: number,
) {
  const axis = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
  const centre = new THREE.Vector3(...base).addScaledVector(
    axis,
    along + length / 2,
  );
  const mesh = cylinder(group, radius, length, centre.toArray(), color, 16);
  mesh.quaternion.setFromUnitVectors(UP, axis);
  return mesh;
}

export const DRONE_BUILDERS: Record<string, DroneBuilder> = {
  torch_drone(group, rank) {
    // Flame nozzle under the nose, fuel canister riding on the spine.
    const tint = droneTint("torch_drone");
    droneHull(group, 0xc28a5a, tint);
    axial(group, 0.09, 0.5, [0, -0.14, 0.3], P.steel);
    axial(group, 0.1, 0.14, [0, -0.14, 0.58], P.chassis, 0.13, 16);
    bore(group, 0, -0.14, 0.66, 0.15, 0x9f775b);
    canister(group, 0, 0.36, -0.05, 0xd4a45a, 0.12, 0.34);
    axial(group, 0.026, 0.08, [0, -0.3, 0.6], 0xffb168, 0.026, 8);
    rankInset(group, rank, 0.275, 0.052, -0.02);
    return [0, -0.14, 0.72];
  },
  frost_drone(group, rank) {
    // Crystal fins grow from the spine; a cold lens sits under the nose.
    const tint = droneTint("frost_drone");
    droneHull(group, 0x9fc3d1, tint);
    const crystal = (
      x: number,
      z: number,
      height: number,
      color: number,
      glass = false,
    ) => {
      const mesh = plate(
        group,
        [
          [0, height],
          [0.07, height * 0.3],
          [0, 0],
          [-0.07, height * 0.3],
        ],
        0.05,
        [x, 0.29, z],
        color,
        0.012,
      );
      if (glass) mesh.material = optical(color);
      return mesh;
    };
    crystal(0, 0.05, 0.42, 0xcdefff, true);
    crystal(0.15, -0.08, 0.3, 0xa9d6e8);
    crystal(-0.15, -0.08, 0.3, 0xa9d6e8);
    axial(group, 0.07, 0.3, [0, -0.1, 0.45], P.steel);
    axial(group, 0.05, 0.012, [0, -0.1, 0.605], 0xa3e5f1, 0.05, 12).material =
      optical(0xa3e5f1);
    rankInset(group, rank, 0.275, 0.052, -0.02);
    return [0, -0.1, 0.62];
  },
  mortar_drone(group, rank) {
    // A short tube pitched up from a top mount.
    const tint = droneTint("mortar_drone");
    droneHull(group, 0x8f8a6a, tint);
    const pitch = 0.61;
    const base = [0, 0.28, -0.05] as const;
    box(group, [0.24, 0.1, 0.24], [0, 0.3, -0.05], P.steel, 0.016);
    pitched(group, 0.11, 0.36, base, 0, pitch, 0x5f6b58);
    pitched(group, 0.125, 0.06, base, 0.3, pitch, P.steel);
    pitched(group, 0.08, 0.012, base, 0.36, pitch, P.recess);
    rankInset(group, rank, 0.275, 0.052, -0.02);
    return [0, 0.28 + Math.sin(pitch) * 0.38, -0.05 + Math.cos(pitch) * 0.38];
  },
  aegis_drone(group, rank) {
    // A shield disc held out in front on two arms.
    const tint = droneTint("aegis_drone");
    droneHull(group, 0xb9c7a1, tint);
    for (const side of [-1, 1])
      box(group, [0.08, 0.08, 0.3], [side * 0.2, 0.02, 0.45], P.steel, 0.012);
    axial(group, 0.4, 0.06, [0, 0.05, 0.62], 0xd8e2c6, 0.4, 16);
    axial(group, 0.14, 0.03, [0, 0.05, 0.66], 0x9db089, 0.14, 6);
    axial(group, 0.06, 0.015, [0, 0.05, 0.68], 0xd9f2c8, 0.06, 12).material =
      optical(0xd9f2c8);
    rankInset(group, rank, 0.275, 0.052, -0.02);
    return [0, 0.05, 0.7];
  },
  venom_drone(group, rank) {
    // Spray tank on top, a drip nozzle hanging from the nose.
    const tint = droneTint("venom_drone");
    droneHull(group, 0x9aa86a, tint);
    axial(group, 0.13, 0.4, [0, 0.4, -0.05], 0xc9d36f, 0.13, 12);
    for (const z of [-0.25, 0.15])
      axial(group, 0.135, 0.06, [0, 0.4, z], P.chassis, 0.135, 12);
    box(group, [0.06, 0.36, 0.06], [0, 0.1, 0.3], P.steel, 0.01);
    axial(group, 0.06, 0.4, [0, -0.12, 0.4], P.steel);
    cylinder(group, 0.03, 0.12, [0, -0.2, 0.58], P.chassis, 12, 0.06);
    const drop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.03, 1),
      material(0xb7e35a),
    );
    drop.position.set(0, -0.3, 0.58);
    group.add(drop);
    strip(group, [0.05, 0.02, 0.16], [0, 0.525, -0.05], 0xe1f28c);
    rankInset(group, rank, 0.275, 0.052, -0.02);
    return [0, -0.24, 0.58];
  },
};
