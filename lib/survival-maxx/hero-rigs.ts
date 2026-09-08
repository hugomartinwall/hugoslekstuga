import * as THREE from "three";
import { poseEquippedWeapons } from "./weapon-pose";
import {
  bake,
  cylinder,
  torus,
  glowMaterial,
  material,
  matte,
  type Rig,
} from "./geometry";

/**
 * The crew shares manufacturing details, not bodies. Armor is cut from authored
 * silhouettes; the graphite chassis shows only at seams and working joints.
 * Face layers have real depth separation. No cloth planes or coplanar decals.
 */
const INK = 0x25343b;
const JOINT = 0x40545a;
const CERAMIC = 0xe3e2d6;
const EDGE = 0x939f9b;
const opticGlass = new THREE.MeshPhysicalMaterial({
  color: 0x1c2b32,
  roughness: 0.19,
  metalness: 0.38,
  clearcoat: 0.75,
  clearcoatRoughness: 0.16,
});
const palettes: Record<string, { armor: number; trim: number; light: number }> =
  {
    ember: { armor: 0xdd8647, trim: CERAMIC, light: 0xffcf83 },
    volt: { armor: 0x708e97, trim: CERAMIC, light: 0x92f4f0 },
    bastion: { armor: 0x84957c, trim: 0xdfdfc8, light: 0xcbea99 },
    cinder: { armor: 0xaf5041, trim: 0xdec3a0, light: 0xffa164 },
    frost: { armor: 0xa9c9d0, trim: 0xebede2, light: 0xb8f3ff },
    thorn: { armor: 0x879558, trim: 0xe2dfbf, light: 0xd4f185 },
    wisp: { armor: 0x9787bc, trim: 0xe0dce8, light: 0xe1c9ff },
    flux: { armor: 0xc49949, trim: 0xe0d7b4, light: 0xffe4a0 },
    reaper: { armor: 0x625973, trim: 0xbcbbc8, light: 0xe9bfdc },
    prism: { armor: 0xb3a4bf, trim: 0xe8e5db, light: 0xf5cfdf },
  };
type Profile = readonly (readonly [number, number])[];
function mirrorProfile(points: Profile, side: number): Profile {
  const mirrored: [number, number][] = points.map(([x, y]) => [x * side, y]);
  return side < 0 ? mirrored.reverse() : mirrored;
}
const geometryCache = new Map<string, THREE.BufferGeometry>();

function profileGeometry(points: Profile, depth: number, bevel: number) {
  const key = JSON.stringify([points, depth, bevel]);
  let geometry = geometryCache.get(key);
  if (!geometry) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) =>
      i ? shape.lineTo(x, y) : shape.moveTo(x, y),
    );
    shape.closePath();
    const edge = Math.min(bevel, depth * 0.32);
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - edge * 2,
      bevelEnabled: edge > 0,
      bevelSize: edge,
      bevelThickness: edge,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 1,
    });
    geometry.translate(0, 0, -depth / 2 + edge);
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function panel(
  parent: THREE.Object3D,
  points: Profile,
  depth: number,
  at: number[],
  color: number,
  bevel = 0.035,
  lit = false,
) {
  const mesh = new THREE.Mesh(
    profileGeometry(points, depth, bevel),
    lit ? glowMaterial(color) : material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = !lit;
  mesh.receiveShadow = !lit;
  parent.add(mesh);
  return mesh;
}

/** A tapered eight-corner plate. Widths describe the upper and lower shoulders. */
function shield(
  parent: THREE.Object3D,
  top: number,
  bottom: number,
  h: number,
  d: number,
  at: number[],
  color: number,
  corner = 0.1,
  lit = false,
) {
  const c = Math.min(corner, h * 0.24, Math.min(top, bottom) * 0.24);
  return panel(
    parent,
    [
      [-bottom / 2 + c, -h / 2],
      [bottom / 2 - c, -h / 2],
      [bottom / 2, -h / 2 + c],
      [top / 2, h / 2 - c],
      [top / 2 - c, h / 2],
      [-top / 2 + c, h / 2],
      [-top / 2, h / 2 - c],
      [-bottom / 2, -h / 2 + c],
    ],
    d,
    at,
    color,
    Math.min(0.035, d * 0.25),
    lit,
  );
}

function bar(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  at: number[],
  color: number,
  lit = false,
) {
  return shield(parent, w, w, h, d, at, color, Math.min(h * 0.26, 0.05), lit);
}

function disc(
  parent: THREE.Object3D,
  radius: number,
  depth: number,
  at: number[],
  color: number,
  lit = false,
  segments = 24,
) {
  const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = cylinder(
    parent,
    radius,
    depth,
    at,
    color,
    segments,
  );
  mesh.rotation.x = Math.PI / 2;
  if (lit) {
    mesh.material = glowMaterial(color);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return mesh;
}

function axle(
  parent: THREE.Object3D,
  radius: number,
  width: number,
  at: number[],
  cap = EDGE,
) {
  cylinder(parent, radius, width, at, INK, 16).rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const c = cylinder(
      parent,
      radius * 0.69,
      0.045,
      [at[0] + side * (width / 2 + 0.018), at[1], at[2]],
      cap,
      16,
    );
    c.rotation.z = Math.PI / 2;
  }
}

function fastener(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  color = EDGE,
) {
  disc(parent, 0.026, 0.02, [x, y, z], color, false, 6);
}

function vents(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  count: number,
  width: number,
  light?: number,
) {
  for (let i = 0; i < count; i++)
    bar(
      parent,
      width,
      0.027,
      0.028,
      [x, y - i * 0.069, z],
      light ?? INK,
      light !== undefined,
    );
}

function optic(
  parent: THREE.Object3D,
  width: number,
  height: number,
  z: number,
  light: number,
  style: "slit" | "eyes" | "mono" | "split" = "slit",
  y = 0,
) {
  const housing = shield(
    parent,
    width + 0.13,
    width + 0.06,
    height + 0.16,
    0.11,
    [0, y, z],
    INK,
    0.08,
  );
  housing.material = opticGlass;
  const lensZ = z + 0.072;
  if (style === "mono") {
    disc(parent, height * 0.67, 0.03, [0, y, lensZ], JOINT);
    disc(parent, height * 0.46, 0.025, [0, y, lensZ + 0.035], light, true);
    disc(
      parent,
      height * 0.16,
      0.025,
      [-0.025, y + 0.025, lensZ + 0.06],
      0xf7ffed,
      true,
    );
  } else if (style === "eyes") {
    for (const side of [-1, 1]) {
      shield(
        parent,
        width * 0.35,
        width * 0.31,
        height,
        0.024,
        [side * width * 0.24, y, lensZ],
        light,
        0.025,
        true,
      );
      bar(
        parent,
        width * 0.25,
        0.021,
        0.027,
        [side * width * 0.24, y + height * 0.34, lensZ + 0.022],
        0xf5f5df,
        true,
      );
    }
  } else {
    shield(
      parent,
      width,
      width * 0.92,
      height,
      0.024,
      [0, y, lensZ],
      light,
      0.025,
      true,
    );
    if (style === "split")
      bar(parent, 0.065, height + 0.045, 0.04, [0, y, lensZ + 0.034], INK);
    else
      bar(
        parent,
        width * 0.7,
        0.02,
        0.025,
        [-width * 0.07, y + height * 0.27, lensZ + 0.022],
        0xf5f8e9,
        true,
      );
  }
}

function capsule(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  color: number,
  trim: number,
) {
  cylinder(parent, radius, height, [x, y, z], color, 16);
  for (const side of [-1, 1]) {
    cylinder(
      parent,
      radius * 1.11,
      0.09,
      [x, y + side * height * 0.43, z],
      INK,
      16,
    );
    cylinder(
      parent,
      radius * 0.98,
      0.13,
      [x, y + side * height * 0.49, z],
      trim,
      16,
      radius * 0.7,
    );
  }
}

type Build = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  arms: THREE.Group[];
  weaponMounts: THREE.Group[];
  legs: THREE.Group[];
  accents: THREE.Object3D[];
  armor: number;
  trim: number;
  light: number;
  hero: string;
};

function buildChassis(b: Build, width: number, height = 1, waist = 0.6) {
  const { torso, armor, trim } = b;
  // Keep the inner chassis inside the armor envelope on every axis. The old
  // core shared Rook's rear surface and Volt's roof, causing visible flicker.
  shield(
    torso,
    width * 0.86,
    waist,
    height - 0.1,
    0.42,
    [0, 1.73, 0],
    INK,
    0.13,
  );
  shield(torso, waist + 0.08, waist, 0.3, 0.48, [0, 1.16, 0.025], JOINT);
  shield(torso, waist, waist * 0.76, 0.21, 0.12, [0, 1.16, 0.32], armor, 0.04);
  bar(torso, waist * 0.52, 0.045, 0.04, [0, 1.19, 0.4], trim);
  // Bastion's taller shell otherwise meets the spindle cap at y=2.325; head
  // stabilization exposes that seam while walking, despite hiding it at rest.
  cylinder(
    torso,
    0.19,
    0.17,
    [0, b.hero === "bastion" ? 2.275 : 2.24, 0],
    JOINT,
    16,
  );
  cylinder(torso, 0.23, 0.055, [0, 2.19, 0], INK, 16);
}

function buildHead(b: Build) {
  const { head, hero, armor, trim, light } = b;
  head.position.set(0, 2.61, 0.01);
  if (hero === "ember") {
    shield(head, 0.63, 0.5, 0.63, 0.58, [0, 0, 0], trim, 0.15);
    shield(head, 0.65, 0.56, 0.26, 0.56, [0, 0.22, -0.025], armor, 0.08);
    optic(head, 0.47, 0.105, 0.31, light, "eyes", -0.005);
    shield(head, 0.41, 0.32, 0.13, 0.12, [0, -0.245, 0.265], trim, 0.045);
    axle(head, 0.12, 0.73, [0, 0.005, -0.015], armor);
  } else if (hero === "volt") {
    head.position.y = 2.56;
    shield(head, 0.75, 0.47, 0.48, 0.54, [0, 0, 0], trim, 0.12);
    shield(head, 0.59, 0.59, 0.15, 0.53, [0, 0.24, -0.045], armor, 0.05);
    optic(head, 0.4, 0.14, 0.3, light, "slit", -0.015);
    for (const side of [-1, 1]) {
      axle(head, 0.16, 0.13, [side * 0.39, 0.03, -0.015], 0xb49569);
      bar(head, 0.035, 0.11, 0.03, [side * 0.3, 0.095, 0.32], light, true);
    }
  } else if (hero === "bastion") {
    head.position.y = 2.63;
    shield(head, 0.54, 0.44, 0.5, 0.51, [0, 0, 0], trim, 0.12);
    shield(head, 0.6, 0.57, 0.18, 0.62, [0, 0.2, -0.025], armor, 0.05);
    optic(head, 0.37, 0.075, 0.28, light, "slit", -0.025);
    for (const side of [-1, 1])
      shield(
        head,
        0.12,
        0.09,
        0.25,
        0.24,
        [side * 0.275, -0.15, 0.11],
        armor,
        0.04,
      );
  } else if (hero === "cinder") {
    head.position.y = 2.55;
    shield(head, 0.71, 0.46, 0.62, 0.56, [0, 0, 0], armor, 0.15);
    shield(head, 0.6, 0.6, 0.15, 0.62, [0, 0.25, -0.025], trim, 0.04);
    optic(head, 0.41, 0.105, 0.31, light, "split");
    shield(head, 0.42, 0.29, 0.19, 0.13, [0, -0.235, 0.29], INK, 0.05);
    vents(head, 0, -0.205, 0.365, 2, 0.21);
    axle(head, 0.14, 0.74, [0, -0.02, -0.07], trim);
  } else if (hero === "frost") {
    head.position.y = 2.64;
    panel(
      head,
      [
        [-0.23, -0.29],
        [0.23, -0.29],
        [0.36, 0.06],
        [0.22, 0.31],
        [-0.22, 0.31],
        [-0.36, 0.06],
      ],
      0.53,
      [0, 0, 0],
      trim,
      0.035,
    );
    shield(head, 0.62, 0.48, 0.2, 0.56, [0, 0.19, -0.02], armor, 0.04);
    optic(head, 0.44, 0.08, 0.29, light, "eyes", -0.045);
    for (const side of [-1, 1]) {
      const rail = shield(
        head,
        0.1,
        0.08,
        0.37,
        0.25,
        [side * 0.29, -0.03, 0.04],
        armor,
        0.03,
      );
      rail.rotation.z = -side * 0.18;
    }
  } else if (hero === "thorn") {
    shield(head, 0.63, 0.48, 0.62, 0.59, [0, 0, 0], trim, 0.16);
    shield(head, 0.59, 0.58, 0.18, 0.62, [0, 0.265, -0.035], armor, 0.04);
    bar(head, 0.54, 0.27, 0.14, [0, 0, 0.31], INK);
    for (const side of [-1, 1]) {
      disc(head, 0.115, 0.065, [side * 0.155, 0.01, 0.4], JOINT);
      disc(head, 0.075, 0.02, [side * 0.155, 0.01, 0.445], light, true);
      disc(
        head,
        0.023,
        0.017,
        [side * 0.155 - 0.018, 0.035, 0.465],
        0xf4ffdf,
        true,
      );
      axle(head, 0.12, 0.08, [side * 0.35, -0.13, 0], armor);
    }
  } else if (hero === "wisp") {
    head.position.y = 2.61;
    shield(head, 0.87, 0.57, 0.59, 0.61, [0, 0, 0], trim, 0.16);
    shield(head, 0.72, 0.71, 0.17, 0.61, [0, 0.24, -0.045], armor, 0.05);
    optic(head, 0.43, 0.185, 0.33, light, "mono");
    for (const side of [-1, 1])
      bar(head, 0.075, 0.15, 0.04, [side * 0.33, 0.025, 0.34], armor);
  } else if (hero === "flux") {
    head.position.y = 2.58;
    shield(head, 0.61, 0.5, 0.55, 0.57, [0, 0, 0], armor, 0.1);
    shield(head, 0.67, 0.64, 0.15, 0.64, [0, 0.24, 0], trim, 0.045);
    optic(head, 0.4, 0.1, 0.31, light, "eyes", -0.025);
    for (const side of [-1, 1])
      axle(head, 0.145, 0.15, [side * 0.34, -0.06, -0.04], trim);
  } else if (hero === "reaper") {
    head.position.y = 2.69;
    panel(
      head,
      [
        [-0.18, -0.3],
        [0.18, -0.3],
        [0.31, 0.04],
        [0.21, 0.27],
        [-0.21, 0.27],
        [-0.31, 0.04],
      ],
      0.51,
      [0, 0, 0],
      armor,
      0.035,
    );
    optic(head, 0.36, 0.065, 0.28, light, "eyes", 0.025);
    shield(head, 0.25, 0.09, 0.2, 0.1, [0, -0.21, 0.27], trim, 0.025);
    for (const side of [-1, 1]) {
      const temple = shield(
        head,
        0.1,
        0.13,
        0.33,
        0.3,
        [side * 0.27, 0.02, -0.065],
        trim,
        0.025,
      );
      temple.rotation.z = -side * 0.2;
    }
  } else {
    head.position.y = 2.69;
    panel(
      head,
      [
        [-0.22, -0.26],
        [0.22, -0.26],
        [0.36, 0],
        [0.2, 0.28],
        [-0.2, 0.28],
        [-0.36, 0],
      ],
      0.54,
      [0, 0, 0],
      trim,
      0.035,
    );
    optic(head, 0.44, 0.065, 0.3, light, "slit");
    panel(
      head,
      [
        [-0.105, 0],
        [0, -0.105],
        [0.105, 0],
        [0, 0.105],
      ],
      0.04,
      [0, 0.19, 0.295],
      armor,
      0.012,
    );
    for (const side of [-1, 1])
      bar(head, 0.05, 0.16, 0.08, [side * 0.3, -0.03, 0.15], 0xa6cbd0);
  }
  bake(head);
}

function buildTorso(b: Build) {
  const { torso, hero, armor, trim, light } = b;
  if (hero === "ember") {
    buildChassis(b, 0.92);
    shield(torso, 0.98, 0.7, 0.94, 0.65, [0, 1.74, 0], armor, 0.15);
    shield(torso, 0.78, 0.54, 0.49, 0.16, [0, 1.91, 0.385], trim, 0.08);
    shield(torso, 0.55, 0.48, 0.17, 0.085, [0, 1.48, 0.365], INK, 0.035);
    vents(torso, 0, 1.51, 0.415, 2, 0.31);
    bar(torso, 0.17, 0.035, 0.025, [-0.2, 1.98, 0.485], armor);
    for (const side of [-1, 1]) fastener(torso, side * 0.29, 1.98, 0.48);
    shield(torso, 0.64, 0.56, 0.56, 0.22, [0, 1.79, -0.39], JOINT, 0.08);
    shield(torso, 0.49, 0.43, 0.36, 0.045, [0, 1.84, -0.52], trim);
  } else if (hero === "volt") {
    buildChassis(b, 0.84, 0.91, 0.53);
    shield(torso, 0.88, 0.52, 0.83, 0.57, [0, 1.77, 0], armor, 0.12);
    for (const side of [-1, 1]) {
      const cheek = shield(
        torso,
        0.2,
        0.12,
        0.6,
        0.2,
        [side * 0.32, 1.83, 0.34],
        trim,
        0.035,
      );
      cheek.rotation.z = -side * 0.16;
      capsule(torso, side * 0.28, 1.83, -0.33, 0.115, 0.65, 0xa88c69, INK);
    }
    disc(torso, 0.26, 0.1, [0, 1.8, 0.35], INK);
    disc(torso, 0.19, 0.08, [0, 1.8, 0.415], JOINT);
    torus(torso, 0.145, 0.025, [0, 1.8, 0.467], light, true);
    disc(torso, 0.07, 0.024, [0, 1.8, 0.48], light, true);
    for (const side of [-1, 1])
      bar(torso, 0.085, 0.22, 0.08, [side * 0.25, 1.42, 0.24], trim);
  } else if (hero === "bastion") {
    buildChassis(b, 1.23, 1.04, 0.77);
    shield(torso, 1.23, 0.91, 1.04, 0.78, [0, 1.77, -0.015], armor, 0.17);
    shield(torso, 1.02, 0.71, 0.69, 0.24, [0, 1.83, 0.45], trim, 0.1);
    shield(torso, 0.47, 0.34, 0.29, 0.05, [0, 1.82, 0.602], armor, 0.04);
    bar(torso, 0.16, 0.042, 0.024, [0, 1.86, 0.637], light, true);
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.18,
        0.23,
        0.42,
        0.48,
        [side * 0.37, 2.25, -0.01],
        armor,
        0.04,
      );
      fastener(torso, side * 0.38, 1.99, 0.59);
      shield(
        torso,
        0.34,
        0.28,
        0.28,
        0.2,
        [side * 0.28, 1.23, 0.26],
        trim,
        0.035,
      );
    }
    shield(torso, 0.79, 0.74, 0.62, 0.25, [0, 1.81, -0.47], JOINT, 0.08);
    vents(torso, 0, 1.91, -0.61, 4, 0.51);
  } else if (hero === "cinder") {
    buildChassis(b, 1.05, 0.92, 0.69);
    shield(torso, 1.06, 0.85, 0.91, 0.73, [0, 1.7, -0.025], armor, 0.14);
    shield(torso, 0.73, 0.54, 0.6, 0.16, [0, 1.76, 0.405], INK, 0.08);
    for (let i = 0; i < 3; i++) {
      bar(
        torso,
        0.47 - i * 0.055,
        0.055,
        0.04,
        [0, 1.91 - i * 0.135, 0.51],
        light,
        true,
      );
      bar(
        torso,
        0.57 - i * 0.04,
        0.048,
        0.08,
        [0, 1.95 - i * 0.135, 0.53],
        JOINT,
      );
    }
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.19,
        0.18,
        0.52,
        0.19,
        [side * 0.4, 1.77, 0.37],
        trim,
        0.04,
      );
      capsule(torso, side * 0.31, 1.91, -0.46, 0.185, 0.88, JOINT, armor);
      cylinder(torso, 0.125, 0.13, [side * 0.31, 2.4, -0.46], INK, 16);
      cylinder(torso, 0.081, 0.024, [side * 0.31, 2.48, -0.46], 0xf19b60, 16);
    }
    bar(torso, 0.91, 0.095, 0.18, [0, 1.63, -0.58], trim);
  } else if (hero === "frost") {
    buildChassis(b, 0.88, 1, 0.54);
    shield(torso, 1, 0.49, 0.95, 0.62, [0, 1.77, 0], armor, 0.08);
    for (const side of [-1, 1]) {
      panel(
        torso,
        mirrorProfile(
          [
            [-0.19, -0.25],
            [0.04, -0.31],
            [0.2, 0.24],
            [-0.14, 0.27],
          ],
          side,
        ),
        0.14,
        [side * 0.225, 1.89, 0.39],
        trim,
        0.025,
      );
      bar(
        torso,
        0.03,
        0.23,
        0.026,
        [side * 0.29, 1.95, 0.48],
        light,
        true,
      ).rotation.z = -side * 0.28;
      capsule(torso, side * 0.255, 1.75, -0.36, 0.12, 0.67, armor, trim);
    }
    shield(torso, 0.3, 0.13, 0.34, 0.09, [0, 1.52, 0.32], JOINT, 0.025);
  } else if (hero === "thorn") {
    buildChassis(b, 0.92, 0.94, 0.64);
    shield(torso, 0.97, 0.7, 0.91, 0.67, [0, 1.72, 0], armor, 0.13);
    shield(torso, 0.73, 0.57, 0.38, 0.16, [0, 1.97, 0.385], trim, 0.07);
    disc(torso, 0.125, 0.06, [0, 1.99, 0.495], INK);
    disc(torso, 0.076, 0.025, [0, 1.99, 0.54], light, true);
    for (const side of [-1, 1]) {
      capsule(torso, side * 0.34, 1.86, -0.41, 0.19, 0.89, armor, trim);
      bar(torso, 0.1, 0.46, 0.04, [side * 0.34, 1.85, -0.605], 0xbacc79);
      capsule(torso, side * 0.255, 1.5, 0.37, 0.083, 0.28, 0xb9cd79, INK);
    }
    bar(torso, 0.92, 0.1, 0.2, [0, 1.56, -0.5], INK);
    shield(torso, 0.29, 0.28, 0.23, 0.08, [0, 1.48, 0.35], trim, 0.025);
  } else if (hero === "wisp") {
    // The pilot is a purpose-built hovering chassis, with one manipulator.
    shield(torso, 0.84, 0.48, 0.8, 0.61, [0, 1.96, 0], INK, 0.12);
    shield(torso, 1.01, 0.5, 0.52, 0.65, [0, 1.97, 0], trim, 0.11);
    shield(torso, 0.6, 0.43, 0.24, 0.14, [0, 2, 0.395], armor, 0.055);
    bar(torso, 0.28, 0.039, 0.027, [0, 2.015, 0.49], light, true);
    shield(torso, 0.71, 0.41, 0.46, 0.59, [0, 1.49, -0.025], armor, 0.085);
    cylinder(torso, 0.21, 0.3, [0, 1.15, -0.015], JOINT, 20, 0.3);
    cylinder(torso, 0.2, 0.12, [0, 0.965, -0.015], INK, 20);
    const engine = torus(torso, 0.155, 0.035, [0, 0.91, -0.015], light, true);
    engine.rotation.x = Math.PI / 2;
    b.accents.push(engine);
    shield(torso, 0.26, 0.25, 0.29, 0.5, [-0.57, 2.0, 0], armor, 0.06);
    axle(torso, 0.16, 0.25, [-0.64, 1.97, 0], trim);
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.23,
        0.16,
        0.53,
        0.46,
        [side * 0.4, 1.38, -0.11],
        trim,
        0.055,
      ).rotation.z = side * 0.15;
      cylinder(torso, 0.106, 0.13, [side * 0.44, 1.065, -0.1], INK, 16);
      cylinder(torso, 0.078, 0.028, [side * 0.44, 0.98, -0.1], 0xcab4e6, 16);
    }
    cylinder(torso, 0.18, 0.17, [0, 2.31, 0], JOINT, 16);
  } else if (hero === "flux") {
    buildChassis(b, 1.02, 0.96, 0.63);
    shield(torso, 0.85, 0.66, 0.9, 0.64, [0, 1.76, 0], JOINT, 0.1);
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.27,
        0.23,
        0.83,
        0.75,
        [side * 0.39, 1.79, 0],
        armor,
        0.06,
      );
      shield(torso, 0.29, 0.29, 0.22, 0.8, [side * 0.39, 2.12, 0], trim, 0.04);
      bar(
        torso,
        0.18,
        0.047,
        0.024,
        [side * 0.39, 1.7, 0.405],
        INK,
      ).rotation.z = -0.25;
      bar(
        torso,
        0.18,
        0.047,
        0.024,
        [side * 0.39, 1.59, 0.405],
        INK,
      ).rotation.z = -0.25;
    }
    shield(torso, 0.76, 0.69, 0.23, 0.17, [0, 1.43, 0.38], armor, 0.04);
    disc(torso, 0.21, 0.12, [0, 1.88, 0.365], INK);
    disc(torso, 0.14, 0.08, [0, 1.88, 0.445], trim);
    bar(torso, 0.045, 0.14, 0.025, [0, 1.88, 0.5], light, true);
    shield(torso, 0.68, 0.59, 0.51, 0.22, [0, 1.77, -0.4], armor, 0.07);
  } else if (hero === "reaper") {
    buildChassis(b, 0.78, 0.96, 0.46);
    shield(torso, 0.91, 0.42, 0.95, 0.54, [0, 1.83, 0], armor, 0.08);
    panel(
      torso,
      [
        [-0.34, 0.26],
        [0, -0.24],
        [0.34, 0.26],
        [0.22, 0.35],
        [-0.22, 0.35],
      ],
      0.13,
      [0, 1.88, 0.32],
      trim,
      0.025,
    );
    panel(
      torso,
      [
        [-0.13, 0.05],
        [0, -0.09],
        [0.13, 0.05],
      ],
      0.026,
      [0, 1.95, 0.41],
      light,
      0.008,
      true,
    );
    shield(torso, 0.31, 0.29, 0.21, 0.06, [0, 1.42, 0.315], JOINT, 0.035);
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.16,
        0.2,
        0.39,
        0.45,
        [side * 0.22, 1.25, 0],
        armor,
        0.035,
      ).rotation.z = -side * 0.12;
      bar(torso, 0.12, 0.56, 0.16, [side * 0.19, 1.87, -0.32], JOINT);
    }
  } else {
    buildChassis(b, 0.79, 1.04, 0.49);
    panel(
      torso,
      [
        [-0.2, -0.49],
        [0.2, -0.49],
        [0.43, 0.15],
        [0.26, 0.48],
        [-0.26, 0.48],
        [-0.43, 0.15],
      ],
      0.61,
      [0, 1.83, 0],
      trim,
      0.035,
    );
    panel(
      torso,
      [
        [0, -0.3],
        [0.25, 0],
        [0, 0.3],
        [-0.25, 0],
      ],
      0.12,
      [0, 1.85, 0.37],
      INK,
      0.025,
    );
    panel(
      torso,
      [
        [0, -0.22],
        [0.17, 0],
        [0, 0.22],
        [-0.17, 0],
      ],
      0.047,
      [0, 1.85, 0.462],
      light,
      0.013,
      true,
    );
    panel(
      torso,
      [
        [0, -0.115],
        [0.09, 0],
        [0, 0.115],
        [-0.09, 0],
      ],
      0.027,
      [0, 1.85, 0.503],
      trim,
      0.008,
    );
    for (const side of [-1, 1]) {
      shield(
        torso,
        0.2,
        0.18,
        0.91,
        0.46,
        [side * 0.37, 1.8, -0.02],
        armor,
        0.04,
      ).rotation.z = -side * 0.09;
      shield(
        torso,
        0.24,
        0.22,
        0.57,
        0.22,
        [side * 0.26, 1.9, -0.4],
        JOINT,
        0.035,
      );
    }
  }
  bake(torso);
}

function buildArm(b: Build, side: number, index: number, lower = false) {
  const { hero, body, armor, trim, light } = b;
  const heavy = hero === "bastion";
  const slender = hero === "reaper" || hero === "frost";
  const multi = hero === "prism";
  const shoulderX = heavy
    ? 0.72
    : multi
      ? lower
        ? 0.62
        : 0.63
      : hero === "cinder"
        ? 0.73
        : hero === "flux"
          ? 0.74
          : 0.63;
  const shoulderY = multi
    ? lower
      ? 1.58
      : 2.19
    : hero === "reaper"
      ? 2.14
      : 2.07;
  const length = multi ? 0.68 : slender ? 0.89 : 0.84;
  const arm = new THREE.Group();
  arm.position.set(side * shoulderX, shoulderY, lower ? -0.075 : 0);
  arm.userData.restZ = arm.position.z;
  arm.userData.restAngleZ = multi ? side * (lower ? 0.28 : 0.16) : side * 0.025;
  arm.rotation.z = arm.userData.restAngleZ;
  body.add(arm);
  b.arms.push(arm);
  const width = heavy ? 0.38 : multi ? 0.225 : slender ? 0.25 : 0.3;
  axle(arm, width * 0.54, width * 1.02, [0, 0, 0], JOINT);
  shield(
    arm,
    width,
    width * 0.79,
    length * 0.41,
    width * 0.88,
    [0, -length * 0.22, 0],
    JOINT,
    0.04,
  );
  axle(arm, width * 0.41, width * 0.94, [0, -length * 0.47, 0.015], EDGE);
  shield(
    arm,
    width * 1.1,
    width * 0.87,
    length * 0.34,
    width * 0.97,
    [0, -length * 0.68, 0.105],
    trim,
    0.045,
  );
  shield(
    arm,
    width * 0.92,
    width * 0.87,
    0.17,
    width * 0.86,
    [0, -length, 0.13],
    INK,
    0.045,
  );
  // A visible knuckle and separated thumb frame the palm origin.
  bar(arm, width * 0.73, 0.073, 0.08, [0, -length + 0.006, 0.275], JOINT);
  bar(
    arm,
    0.08,
    0.12,
    0.11,
    [-side * width * 0.52, -length + 0.015, 0.185],
    JOINT,
  );
  if (heavy) {
    shield(arm, 0.56, 0.38, 0.41, 0.62, [side * 0.065, 0.05, 0], trim, 0.085);
    shield(
      arm,
      0.34,
      0.26,
      0.21,
      0.06,
      [side * 0.065, 0.085, 0.355],
      armor,
      0.04,
    );
    const guard = shield(
      arm,
      0.34,
      0.26,
      0.7,
      0.16,
      [side * 0.22, -0.47, 0.13],
      trim,
      0.06,
    );
    guard.rotation.y = side * 0.7;
    shield(
      arm,
      0.24,
      0.15,
      0.38,
      0.065,
      [side * 0.25, -0.46, 0.23],
      armor,
      0.03,
    ).rotation.y = side * 0.7;
  } else if (hero === "cinder") {
    axle(arm, 0.24, 0.33, [side * 0.025, 0.045, -0.025], armor);
    shield(arm, 0.37, 0.32, 0.19, 0.49, [0, 0.17, 0], trim, 0.05);
    vents(arm, 0, -0.51, 0.278, 3, 0.18, light);
  } else if (hero === "frost") {
    panel(
      arm,
      mirrorProfile(
        [
          [-0.16, -0.16],
          [0.16, -0.11],
          [0.22, 0.14],
          [0.02, 0.29],
          [-0.19, 0.13],
        ],
        side,
      ),
      0.39,
      [side * 0.015, 0.025, 0],
      trim,
      0.027,
    );
    bar(arm, 0.05, 0.23, 0.028, [0, -0.59, 0.278], light, true);
  } else if (hero === "reaper") {
    panel(
      arm,
      mirrorProfile(
        [
          [-0.13, -0.13],
          [0.19, -0.07],
          [0.23, 0.17],
          [-0.07, 0.21],
          [-0.19, 0.05],
        ],
        side,
      ),
      0.38,
      [0, 0.04, -0.005],
      armor,
      0.025,
    );
    shield(arm, 0.14, 0.07, 0.31, 0.06, [0, -0.61, 0.269], armor, 0.023);
  } else if (multi) {
    shield(
      arm,
      0.3,
      0.26,
      0.25,
      0.33,
      [0, 0.05, 0],
      lower ? armor : trim,
      0.045,
    );
    bar(
      arm,
      0.045,
      0.13,
      0.03,
      [0, -0.46, 0.257],
      index % 2 ? 0xffdcc0 : 0xbceeee,
      true,
    );
  } else if (hero === "volt") {
    axle(arm, 0.205, 0.29, [0, 0.01, -0.02], trim);
    shield(arm, 0.33, 0.29, 0.14, 0.4, [0, 0.17, 0], armor, 0.04);
    bar(arm, 0.13, 0.06, 0.03, [0, -0.54, 0.3], light, true);
  } else {
    shield(
      arm,
      hero === "flux" ? 0.44 : 0.38,
      0.3,
      0.31,
      0.44,
      [side * 0.015, 0.07, 0],
      armor,
      0.07,
    );
    shield(
      arm,
      0.23,
      0.2,
      0.115,
      0.065,
      [side * 0.015, 0.095, 0.28],
      trim,
      0.025,
    );
    fastener(arm, 0, -0.51, 0.29);
    if (hero === "thorn")
      bar(arm, 0.07, 0.21, 0.045, [side * 0.16, -0.59, 0.14], armor);
  }
  bake(arm);
  const mount = new THREE.Group();
  mount.name = `weapon-mount-${index}`;
  mount.position.set(0, -length + 0.005, 0.17);
  mount.userData.slot = index;
  arm.add(mount);
  b.weaponMounts.push(mount);
}

function buildLeg(b: Build, side: number) {
  const { root, hero, armor, trim } = b;
  const heavy = hero === "bastion";
  const slim = hero === "reaper" || hero === "frost";
  const width = heavy ? 0.39 : slim ? 0.265 : hero === "prism" ? 0.275 : 0.31;
  const leg = new THREE.Group();
  const hipY = slim ? 1.14 : 1.08;
  leg.position.set(side * (heavy ? 0.34 : slim ? 0.23 : 0.27), hipY, 0);
  leg.userData.restY = hipY;
  root.add(leg);
  b.legs.push(leg);
  axle(leg, width * 0.43, width * 0.93, [0, -0.01, 0], JOINT);
  shield(
    leg,
    width * 0.96,
    width * 0.78,
    0.31,
    width * 0.91,
    [0, -0.22, 0],
    armor,
    0.035,
  );
  const kneeY = -0.45;
  axle(leg, width * 0.42, width * 0.95, [0, kneeY, 0.015], EDGE);
  shield(
    leg,
    width * 0.84,
    width * 0.76,
    0.18,
    0.09,
    [0, kneeY, width * 0.57],
    trim,
    0.025,
  );
  bake(leg);
  const shin = new THREE.Group();
  shin.position.y = kneeY;
  leg.add(shin);
  leg.userData.shin = shin;
  const ankleY = -hipY - kneeY + 0.22;
  leg.userData.upperLength = -kneeY;
  leg.userData.lowerLength = -ankleY;
  leg.userData.ankleHeight = 0.22;
  shield(
    shin,
    width * 1.15,
    width * 0.83,
    Math.abs(ankleY) - 0.02,
    width * 1.09,
    [0, ankleY * 0.5, 0.025],
    trim,
    0.055,
  );
  shield(
    shin,
    width * 0.58,
    width * 0.5,
    Math.abs(ankleY) * 0.61,
    0.055,
    [0, ankleY * 0.54, width * 0.64],
    armor,
    0.025,
  );
  // A separate ankle keeps the sole level while the knee articulates. The
  // shared flat sole is 0.205 below the ankle, at world y=0.015 in a stance.
  const ankle = new THREE.Group();
  ankle.name = "ankle-and-boot";
  ankle.position.y = ankleY;
  shin.add(ankle);
  leg.userData.ankle = ankle;
  const footY = -0.065;
  shield(
    ankle,
    width * 1.27,
    width * 1.27,
    0.16,
    0.53,
    [0, footY - 0.025, 0.1],
    INK,
    0.033,
  );
  shield(
    ankle,
    width * 1.08,
    width * 1.23,
    0.16,
    0.45,
    [0, footY + 0.056, 0.16],
    armor,
    0.04,
  );
  bar(ankle, width * 0.81, 0.041, 0.025, [0, footY + 0.06, 0.393], trim);
  bake(ankle);
  if (heavy) {
    shield(
      shin,
      width * 1.13,
      width * 0.95,
      0.24,
      0.14,
      [0, -0.15, 0.235],
      armor,
      0.045,
    );
    for (const s of [-1, 1]) fastener(shin, s * width * 0.32, -0.12, 0.325);
  }
  bake(shin);
}

export function makeHero(heroId: string): Rig {
  const hero = heroId in palettes ? heroId : "ember";
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const torso = new THREE.Group();
  root.name = `crew-${hero}`;
  body.name = "upper-chassis";
  head.name = "optic-assembly";
  torso.name = "pressure-shell";
  root.add(body);
  body.add(torso, head);
  const b: Build = {
    root,
    body,
    head,
    torso,
    hero,
    ...palettes[hero],
    arms: [],
    weaponMounts: [],
    legs: [],
    accents: [],
  };
  buildTorso(b);
  buildHead(b);
  if (hero === "wisp") buildArm(b, 1, 0);
  else {
    buildArm(b, -1, 0);
    buildArm(b, 1, 1);
    if (hero === "prism") {
      buildArm(b, -1, 2, true);
      buildArm(b, 1, 3, true);
    }
    buildLeg(b, -1);
    buildLeg(b, 1);
  }
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.userData.heroRig = true;
  root.userData.visualHeight = bounds.max.y;
  root.userData.proportions = {
    height: bounds.max.y,
    width: bounds.max.x - bounds.min.x,
    depth: bounds.max.z - bounds.min.z,
  };
  return {
    root,
    body,
    head,
    arms: b.arms,
    weaponMounts: b.weaponMounts,
    legs: b.legs,
    accents: b.accents,
    kind: hero,
    recoil: 0,
    lastX: 0,
    lastY: 0,
  };
}

export function animateHeroRig(
  rig: Rig,
  time: number,
  speed: number,
  angle: number,
  dt: number,
  dashing = false,
  hurt = false,
  hurtColor = 0xffd0a8,
  hurtIntensity = 0.22,
): void {
  const target = Math.min(1, speed / 5);
  const blend = 1 - Math.exp(-Math.min(dt, 0.05) * 13);
  rig.moveBlend = THREE.MathUtils.lerp(rig.moveBlend ?? target, target, blend);
  const move = rig.moveBlend;
  rig.gait =
    (rig.gait ?? 0) +
    Math.min(dt, 0.05) *
      (rig.kind === "bastion" ? 10.5 : 13.5) *
      Math.max(0.15, move);
  const phase = rig.gait;
  const stride = Math.sin(phase);
  const facing = Math.PI / 2 - angle;
  const oldFacing = rig.facing ?? facing;
  rig.facing =
    oldFacing +
    Math.atan2(Math.sin(facing - oldFacing), Math.cos(facing - oldFacing)) *
      (1 - Math.exp(-dt * (dashing ? 36 : 16)));
  rig.root.rotation.y = rig.facing;
  const hipOffset = (-0.048 + Math.cos(phase * 2) * 0.008) * move;
  rig.body.position.y =
    (rig.body.userData.restY ?? 0) + hipOffset + Math.sin(time * 2.25) * 0.008;
  rig.body.rotation.x = THREE.MathUtils.lerp(
    rig.body.rotation.x,
    dashing ? 0.2 : move * 0.055,
    blend,
  );
  rig.body.rotation.z = -stride * 0.016 * move;
  rig.head.rotation.x = -rig.body.rotation.x * 0.68;
  rig.head.rotation.z = -rig.body.rotation.z * 0.72;
  rig.head.rotation.y = Math.sin(time * 0.7) * 0.025 * (1 - move);
  rig.legs.forEach((leg, index) => {
    const legPhase = phase + index * Math.PI;
    const swing = Math.max(0, Math.sin(legPhase));
    const targetZ = -Math.cos(legPhase) * 0.22 * move;
    const targetY = leg.userData.ankleHeight + swing * swing * 0.115 * move;
    const upper = leg.userData.upperLength as number;
    const lower = leg.userData.lowerLength as number;
    leg.position.y = leg.userData.restY + hipOffset;
    const down = leg.position.y - targetY;
    // Two-bone inverse kinematics: stance ankles stay on the floor, while the
    // opposite foot follows a smooth arc. This remains local, allocation-free,
    // and independent of render rate; no frame-by-frame bounds calculations.
    const knee = Math.acos(
      THREE.MathUtils.clamp(
        (down * down + targetZ * targetZ - upper * upper - lower * lower) /
          (2 * upper * lower),
        -1,
        1,
      ),
    );
    const hip =
      Math.atan2(-targetZ, down) -
      Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee));
    leg.rotation.set(hip, 0, 0);
    const shin = leg.userData.shin as THREE.Group;
    shin.rotation.x = knee;
    const ankle = leg.userData.ankle as THREE.Group;
    ankle.rotation.x = -hip - knee;
  });
  rig.recoil = Math.max(0, rig.recoil - dt * 8);
  rig.arms.forEach((arm, index) => {
    arm.rotation.x =
      -0.1 - rig.recoil * 0.3 + Math.sin(phase + index * Math.PI) * 0.04 * move;
    arm.rotation.z = arm.userData.restAngleZ ?? 0;
    arm.position.z = arm.userData.restZ ?? 0;
    arm.rotation.y = 0;
  });
  poseEquippedWeapons(rig);
  if (rig.kind === "wisp") {
    rig.body.position.y += Math.sin(time * 2.7) * 0.045;
    rig.body.rotation.z += Math.sin(time * 1.4) * 0.026;
    for (const accent of rig.accents)
      accent.scale.setScalar(1 + Math.sin(time * 3.5) * 0.045 + move * 0.12);
  }
  if (!rig.flashMaterial) {
    rig.flashMaterial = matte.clone();
    rig.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material === matte)
        object.material = rig.flashMaterial!;
    });
  }
  rig.flashMaterial.emissive.setHex(hurt ? hurtColor : 0x000000);
  rig.flashMaterial.emissiveIntensity = hurt ? hurtIntensity : 0;
}
