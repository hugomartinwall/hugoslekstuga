import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const COLORS = {
  ember: 0xf38c48,
  volt: 0x78e5e2,
  bastion: 0xb9c7a1,
  cinder: 0xf16642,
  frost: 0x87d9f1,
  thorn: 0x8ecd71,
  wisp: 0xc7b0ed,
  flux: 0xe7bd63,
  reaper: 0xa18bad,
  prism: 0xedc4da,
  enemy: 0x805955,
  eye: 0xff6549,
  ivory: 0xd9d8c9,
  dark: 0x202a30,
  steel: 0x596668,
};
const cache = new Map<string, THREE.BufferGeometry>();
export const matte = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.48,
  metalness: 0.28,
});
const mats = new Map<number, THREE.MeshStandardMaterial>();
export function material(color: number) {
  if (!mats.has(color))
    mats.set(
      color,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.48,
        metalness: 0.28,
      }),
    );
  return mats.get(color)!;
}
const glowCache = new Map<number, THREE.MeshBasicMaterial>();
export function glowMaterial(color: number) {
  if (!glowCache.has(color))
    glowCache.set(
      color,
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
  return glowCache.get(color)!;
}
function rounded(w: number, h: number, d: number, r: number) {
  const key = `b${w},${h},${d},${r}`;
  if (!cache.has(key)) cache.set(key, new RoundedBoxGeometry(w, h, d, 3, r));
  return cache.get(key)!;
}
export function box(
  parent: THREE.Object3D,
  size: number[],
  at: number[],
  color: number,
  radius = 0.04,
) {
  const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(
    rounded(
      size[0],
      size[1],
      size[2],
      Math.min(radius, ...size.map((n) => n / 3)),
    ),
    material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function cylinder(
  parent: THREE.Object3D,
  r: number,
  h: number,
  at: number[],
  color: number,
  segments = 12,
  top = r,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(top, r, h, segments),
    material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function orb(
  parent: THREE.Object3D,
  r: number,
  at: number[],
  color: number,
  emissive = false,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 1),
    emissive ? glowMaterial(color) : material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  mesh.castShadow = !emissive;
  return mesh;
}
export function torus(
  parent: THREE.Object3D,
  r: number,
  t: number,
  at: number[],
  color: number,
  glow = false,
) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(r, t, 5, 32),
    glow ? glowMaterial(color) : material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  return mesh;
}
export function bake(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const keep: THREE.Object3D[] = [];
  for (const child of [...group.children]) {
    if (
      !(child instanceof THREE.Mesh) ||
      !(child.material instanceof THREE.MeshStandardMaterial) ||
      mats.get(child.material.color.getHex()) !== child.material
    ) {
      keep.push(child);
      continue;
    }
    const g = child.geometry.index
      ? child.geometry.toNonIndexed()
      : child.geometry.clone();
    g.applyMatrix4(child.matrix);
    g.deleteAttribute("uv");
    const c = child.material.color;
    const values = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = c.r;
      values[i + 1] = c.g;
      values[i + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(values, 3));
    geos.push(g);
    group.remove(child);
  }
  if (geos.length) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, matte);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  return group;
}
export type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group[];
  /** Palm origins. Equipment points forward along local +Z. */
  weaponMounts: THREE.Group[];
  legs: THREE.Group[];
  accents: THREE.Object3D[];
  kind: string;
  flashMaterial?: THREE.MeshStandardMaterial;
  recoil: number;
  lastX: number;
  lastY: number;
  gait?: number;
  moveBlend?: number;
  facing?: number;
};
