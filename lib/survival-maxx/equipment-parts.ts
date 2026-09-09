import * as THREE from "three";
import { RANKS } from "./content";
import { box, cylinder, glowMaterial, material } from "./geometry";

// Shared manufactured-kit primitives. Every gear model (core set and the
// expansion packs) is assembled from these so the finish stays consistent.
// A hand weapon's origin is the centre of its grip; its bore points along +Z.
export const P = {
  chassis: 0x273238,
  recess: 0x111b21,
  steel: 0x70848a,
  edge: 0xc6d2d2,
  ceramic: 0xd8ded5,
  rubber: 0x263034,
  brass: 0xb79764,
};
export type Point = readonly [number, number];
const opticalMaterials = new Map<number, THREE.MeshStandardMaterial>();
export function optical(color: number) {
  if (!opticalMaterials.has(color))
    opticalMaterials.set(
      color,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.17,
        metalness: 0.56,
        emissive: color,
        emissiveIntensity: 0.055,
      }),
    );
  return opticalMaterials.get(color)!;
}

/** Beveled side-profile extrusion: points are [forward Z, height Y]. */
export function receiver(
  parent: THREE.Object3D,
  width: number,
  outline: readonly Point[],
  color: number,
  bevel = 0.018,
) {
  const shape = new THREE.Shape();
  outline.forEach(([z, y], index) =>
    index ? shape.lineTo(z, y) : shape.moveTo(z, y),
  );
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 16,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Faceted plate in XY, with an actual edge thickness rather than coplanar decals. */
export function plate(
  parent: THREE.Object3D,
  points: readonly Point[],
  depth: number,
  at: number[],
  color: number,
  bevel = 0.018,
) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    bevelEnabled: bevel > 0,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, material(color));
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function axial(
  parent: THREE.Object3D,
  radius: number,
  length: number,
  at: number[],
  color: number,
  top = radius,
  segments = 16,
) {
  const mesh = cylinder(parent, radius, length, at, color, segments, top);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

export function strip(
  parent: THREE.Object3D,
  size: number[],
  at: number[],
  color: number,
  lit = false,
) {
  const part = box(parent, size, at, color, 0.006);
  if (lit) part.material = glowMaterial(color);
  return part;
}

export function bore(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  radius: number,
  collar = P.steel,
) {
  axial(parent, radius, 0.075, [x, y, z], collar);
  axial(parent, radius * 0.67, 0.008, [x, y, z + 0.042], P.recess);
}

export function grip(parent: THREE.Group, long = false) {
  receiver(
    parent,
    0.2,
    [
      [-0.15, -0.24],
      [0.065, -0.24],
      [0.14, 0.2],
      [-0.09, 0.2],
    ],
    P.rubber,
    0.025,
  );
  box(parent, [0.22, 0.06, 0.245], [0, -0.24, -0.039], P.steel, 0.018);
  for (const x of [-0.111, 0.111])
    strip(parent, [0.012, 0.2, 0.085], [x, -0.025, -0.015], 0x536367);
  if (long) {
    // The stock stays close to the receiver: no long bar crossing the robot's waist.
    receiver(
      parent,
      0.24,
      [
        [-0.49, 0.16],
        [-0.17, 0.2],
        [-0.13, 0.42],
        [-0.5, 0.42],
      ],
      P.chassis,
    );
    box(parent, [0.27, 0.32, 0.07], [0, 0.275, -0.51], P.rubber, 0.025);
  }
}

export function sight(
  parent: THREE.Group,
  y: number,
  back: number,
  front: number,
) {
  box(parent, [0.15, 0.065, 0.085], [0, y, back], P.chassis, 0.012);
  box(parent, [0.07, 0.065, 0.055], [0, y, front], P.chassis, 0.009);
  strip(parent, [0.035, 0.025, 0.012], [0, y + 0.01, front + 0.029], 0xeccba0);
}

export function rankInset(
  parent: THREE.Group,
  rank: number,
  width: number,
  y: number,
  z: number,
) {
  const tint = new THREE.Color(RANKS[rank - 1].color).getHex();
  for (const side of [-1, 1]) {
    // Every rank uses the same installed inset, avoiding arbitrary floating upgrade fins.
    strip(parent, [0.018, 0.075, 0.21], [side * width, y, z], P.recess);
    strip(
      parent,
      [0.021, 0.026, 0.15],
      [side * (width + 0.002), y, z],
      tint,
      rank === 6,
    );
  }
}

/** Rank colour as a hex number, shared by every model that tints an accent. */
export function rankColor(rank: number): number {
  return new THREE.Color(RANKS[rank - 1].color).getHex();
}

export function thruster(
  group: THREE.Group,
  x: number,
  z: number,
  tint: number,
  y = 0,
) {
  cylinder(group, 0.155, 0.24, [x, y, z], P.chassis, 12, 0.19);
  cylinder(group, 0.158, 0.04, [x, y - 0.135, z], P.steel, 12);
  cylinder(group, 0.109, 0.016, [x, y - 0.164, z], tint, 12);
}

export function medicalMark(group: THREE.Group, at: number[], scale = 1) {
  strip(group, [0.22 * scale, 0.07 * scale, 0.018], at, P.ceramic);
  strip(
    group,
    [0.07 * scale, 0.22 * scale, 0.02],
    [at[0], at[1], at[2] + 0.002],
    P.ceramic,
  );
}

export function canister(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  color: number,
  radius = 0.19,
  height = 0.7,
) {
  cylinder(group, radius, height, [x, y, z], color, 12, radius * 0.9);
  for (const side of [-1, 1])
    cylinder(
      group,
      radius * 1.035,
      0.09,
      [x, y + (side * height) / 2, z],
      P.chassis,
      12,
    );
  cylinder(
    group,
    radius * 0.65,
    0.09,
    [x, y + height / 2 + 0.07, z],
    P.steel,
    12,
  );
}

export function moduleBadge(group: THREE.Group, rank: number, at: number[]) {
  strip(group, [0.17, 0.056, 0.026], at, P.recess);
  strip(
    group,
    [0.11, 0.018, 0.03],
    [at[0], at[1], at[2] + 0.003],
    new THREE.Color(RANKS[rank - 1].color).getHex(),
    rank === 6,
  );
}

/** Common drone airframe: armoured chassis, coloured hull, tail light and twin thrusters. */
export function droneHull(group: THREE.Group, hullColor: number, tint: number) {
  receiver(
    group,
    0.49,
    [
      [-0.42, -0.1],
      [0.31, -0.1],
      [0.45, 0.04],
      [0.24, 0.27],
      [-0.27, 0.27],
      [-0.42, 0.1],
    ],
    P.chassis,
    0.028,
  );
  receiver(
    group,
    0.44,
    [
      [-0.29, 0.08],
      [0.27, 0.08],
      [0.32, 0.16],
      [0.18, 0.31],
      [-0.21, 0.31],
      [-0.34, 0.21],
    ],
    hullColor,
    0.022,
  );
  strip(group, [0.15, 0.055, 0.025], [0, 0.063, 0.446], tint, true);
  for (const side of [-1, 1]) {
    box(group, [0.32, 0.09, 0.17], [side * 0.32, 0.02, -0.12], P.steel, 0.018);
    thruster(group, side * 0.46, -0.12, tint);
  }
}
