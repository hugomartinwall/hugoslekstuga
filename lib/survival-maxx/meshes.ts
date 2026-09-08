import * as THREE from "three";
import { animateHeroRig } from "./hero-rigs";
export { makeHero } from "./hero-rigs";
export { makeEquipment, equipmentPortraits } from "./equipment-art";
import {
  COLORS,
  matte,
  material,
  glowMaterial,
  box,
  cylinder,
  orb,
  torus,
  bake,
  type Rig,
} from "./geometry";
export {
  COLORS,
  material,
  glowMaterial,
  box,
  cylinder,
  orb,
  torus,
  bake,
  type Rig,
} from "./geometry";

type BossPalette = { armor: number; trim: number; glow: number };
const BOSS_PALETTES: BossPalette[] = [
  { armor: 0x758071, trim: 0xc4bb98, glow: 0xffb470 }, // Gatekeeper
  { armor: 0x92805b, trim: 0xe1be7c, glow: 0xffd884 }, // Breaker
  { armor: 0x9a6048, trim: 0xd4a07b, glow: 0xff9b50 }, // Furnace
  { armor: 0x567e8b, trim: 0xa5c8cf, glow: 0x95e8ff }, // Stormheart
  { armor: 0x677156, trim: 0xbcc991, glow: 0xf0cb86 }, // Broodmother
  { armor: 0x79677f, trim: 0xc9b1c8, glow: 0xefb4ef }, // Iron Choir
  { armor: 0x696742, trim: 0xb6be72, glow: 0xc6ee7c }, // Venom Regent
  { armor: 0x63788e, trim: 0xb4c7d5, glow: 0x9addff }, // Citadel
  { armor: 0x628273, trim: 0xc0d8bf, glow: 0xb9ffd2 }, // Lifebinder
  { armor: 0x514d5b, trim: 0xd9c3a0, glow: 0xffd9a0 }, // The Crucible
];

/** Accessories are added before each articulated part is baked to one draw call. */
function bossArm(
  arm: THREE.Group,
  side: number,
  tier: number,
  palette: BossPalette,
): void {
  if (tier === 1) {
    // The Gatekeeper's paired shields make an unmistakable rectangular outline.
    box(arm, [0.76, 1.12, 0.19], [side * 0.05, -0.4, 0.46], palette.trim, 0.08);
    box(
      arm,
      [0.56, 0.89, 0.07],
      [side * 0.05, -0.4, 0.58],
      palette.armor,
      0.04,
    );
    box(
      arm,
      [0.075, 0.94, 0.06],
      [side * 0.05, -0.4, 0.63],
      palette.glow,
      0.015,
    );
  } else if (tier === 3) {
    cylinder(arm, 0.31, 0.5, [0, -0.43, 0.24], palette.armor, 10).rotation.x =
      Math.PI / 2;
    cylinder(arm, 0.2, 0.06, [0, -0.43, 0.51], 0x302a29, 10).rotation.x =
      Math.PI / 2;
    for (const y of [-0.55, -0.38])
      box(arm, [0.2, 0.04, 0.065], [0, y, 0.555], palette.glow, 0.01);
  } else if (tier === 4) {
    const electrode = cylinder(
      arm,
      0.13,
      0.76,
      [side * 0.2, 0.25, -0.14],
      COLORS.dark,
      10,
    );
    electrode.rotation.z = -side * 0.2;
    for (const y of [0.02, 0.2, 0.38])
      cylinder(arm, 0.235, 0.055, [side * 0.2, y, -0.14], palette.trim, 12);
    orb(arm, 0.16, [side * 0.23, 0.67, -0.14], palette.glow);
  } else if (tier === 6) {
    cylinder(
      arm,
      0.28,
      0.43,
      [side * 0.06, -0.18, 0.4],
      palette.trim,
      12,
      0.16,
    ).rotation.x = Math.PI / 2;
    cylinder(
      arm,
      0.19,
      0.04,
      [side * 0.06, -0.18, 0.63],
      0x39323f,
      12,
    ).rotation.x = Math.PI / 2;
    orb(arm, 0.08, [side * 0.06, -0.18, 0.658], palette.glow);
  } else if (tier === 2) {
    // A slab hammer and a tapered piledriver deliberately break the symmetry.
    if (side < 0) {
      box(arm, [0.99, 0.91, 0.87], [-0.04, -0.61, 0.13], palette.armor, 0.12);
      box(arm, [0.77, 0.16, 0.94], [-0.04, -0.61, 0.13], palette.trim, 0.025);
      for (const x of [-0.28, 0.2])
        box(arm, [0.1, 0.55, 0.08], [x, -0.61, 0.615], 0x4c463a, 0.015);
    } else {
      cylinder(arm, 0.37, 0.81, [0.02, -0.45, 0.2], palette.armor, 10);
      cylinder(arm, 0.21, 0.58, [0.02, -1.08, 0.2], palette.trim, 6, 0.33);
      for (const y of [-0.17, -0.39, -0.61])
        cylinder(arm, 0.4, 0.07, [0.02, y, 0.2], 0x4e4b43, 10);
    }
  } else if (tier === 5 || tier === 7) {
    // Splitter seed pods versus the Regent's sealed toxin dispensers.
    for (const z of [-0.15, 0.32]) {
      const pod = orb(
        arm,
        tier === 5 ? 0.3 : 0.25,
        [side * 0.16, -0.24, z],
        palette.trim,
      );
      pod.scale.y = tier === 5 ? 1.35 : 1.7;
      box(
        arm,
        [0.11, 0.55, 0.06],
        [side * 0.16, -0.24, z + 0.23],
        palette.glow,
        0.02,
      );
    }
    if (tier === 7)
      cylinder(arm, 0.12, 0.51, [0, -0.73, 0.23], COLORS.dark, 8, 0.2);
  } else if (tier === 8) {
    for (const offset of [-0.29, 0.29]) {
      const petal = box(
        arm,
        [0.6, 0.86, 0.2],
        [side * 0.24, offset - 0.23, 0.43],
        palette.trim,
        0.09,
      );
      petal.rotation.z = -side * (offset > 0 ? 0.28 : -0.28);
      box(
        arm,
        [0.07, 0.62, 0.06],
        [side * 0.24, offset - 0.23, 0.56],
        palette.glow,
        0.02,
      );
    }
  } else if (tier === 9) {
    cylinder(arm, 0.13, 0.83, [side * 0.16, -0.11, 0], palette.trim, 10);
    torus(arm, 0.29, 0.07, [side * 0.16, 0.37, 0], palette.trim).rotation.x =
      Math.PI / 2;
    orb(arm, 0.18, [side * 0.16, 0.46, 0], palette.glow);
    box(arm, [0.25, 0.54, 0.18], [0, -0.42, 0.24], palette.trim, 0.05);
  } else {
    const vane = box(
      arm,
      [0.23, 1.13, 0.45],
      [side * 0.37, -0.1, -0.06],
      palette.trim,
      0.055,
    );
    vane.rotation.z = -side * 0.16;
    box(arm, [0.3, 0.46, 0.17], [0, -0.45, 0.28], 0x323039, 0.05);
    orb(arm, 0.12, [0, -0.45, 0.4], palette.glow);
  }
}

function bossBody(
  body: THREE.Group,
  head: THREE.Group,
  tier: number,
  palette: BossPalette,
): void {
  if (tier === 1) {
    box(head, [1.04, 0.18, 0.76], [0, 0.28, 0], palette.trim, 0.06);
    for (const x of [-0.46, 0.46])
      box(head, [0.17, 0.7, 0.3], [x, 0.53, -0.13], palette.armor, 0.05);
    box(body, [0.78, 0.18, 0.17], [0, 1.77, 0.47], palette.trim, 0.03);
  } else if (tier === 3) {
    for (const x of [-0.57, 0.57]) {
      cylinder(body, 0.245, 1.4, [x, 2.04, -0.53], 0x423b35, 10);
      cylinder(body, 0.3, 0.16, [x, 2.78, -0.53], palette.trim, 10);
      cylinder(body, 0.19, 0.14, [x, 2.89, -0.53], 0x29262a, 10);
    }
    cylinder(body, 0.44, 0.15, [0, 1.45, 0.45], palette.trim, 16).rotation.x =
      Math.PI / 2;
    cylinder(body, 0.32, 0.17, [0, 1.45, 0.55], palette.glow, 12).rotation.x =
      Math.PI / 2;
    for (const x of [-0.18, 0, 0.18])
      box(body, [0.06, 0.5, 0.08], [x, 1.45, 0.66], 0x41312d, 0.01);
    box(head, [0.93, 0.2, 0.64], [0, 0.3, 0], palette.armor, 0.07);
  } else if (tier === 4) {
    for (const side of [-1, 1]) {
      const mast = cylinder(
        body,
        0.09,
        1.4,
        [side * 0.55, 2.6, -0.39],
        COLORS.dark,
        8,
      );
      mast.rotation.z = -side * 0.19;
      for (const y of [2.17, 2.38, 2.59])
        cylinder(
          body,
          0.24,
          0.075,
          [side * (0.5 + (y - 2.17) * 0.2), y, -0.39],
          palette.trim,
          10,
        );
      orb(body, 0.19, [side * 0.69, 3.32, -0.39], palette.glow);
    }
    cylinder(body, 0.3, 0.12, [0, 1.5, 0.48], 0x303d48, 12).rotation.x =
      Math.PI / 2;
    orb(body, 0.23, [0, 1.5, 0.59], palette.glow);
    box(head, [0.6, 0.15, 0.68], [0, 0.29, 0], palette.trim, 0.025);
  } else if (tier === 6) {
    box(body, [1.53, 0.3, 0.48], [0, 1.9, -0.58], 0x3f3946, 0.07);
    for (let i = -2; i <= 2; i++) {
      const top = 3.0 + (2 - Math.abs(i)) * 0.24;
      cylinder(
        body,
        0.12,
        top - 1.75,
        [i * 0.31, (top + 1.75) / 2, -0.62],
        palette.trim,
        10,
      );
      cylinder(body, 0.165, 0.11, [i * 0.31, top, -0.62], palette.armor, 10);
      cylinder(body, 0.105, 0.025, [i * 0.31, top + 0.06, -0.62], 0x36303a, 10);
    }
    box(head, [0.68, 0.63, 0.08], [0, -0.015, 0.32], palette.armor, 0.04);
    box(head, [0.51, 0.37, 0.045], [0, 0.01, 0.385], 0x24222b, 0.025);
    for (const x of [-0.18, 0, 0.18])
      box(head, [0.055, 0.26, 0.024], [x, 0.01, 0.423], palette.glow, 0.01);
  } else if (tier === 2) {
    box(body, [1.95, 0.34, 0.97], [0, 1.85, -0.12], palette.armor, 0.1);
    for (const side of [-1, 1]) {
      box(
        body,
        [0.31, 0.41, 0.18],
        [side * 0.88, 1.97, 0.41],
        palette.trim,
        0.035,
      );
      cylinder(body, 0.19, 0.79, [side * 0.53, 1.42, -0.54], 0x48453c, 10);
    }
    box(head, [0.98, 0.2, 0.79], [0, 0.32, 0.03], palette.trim, 0.055);
    box(head, [0.43, 0.19, 0.19], [0, -0.28, 0.28], palette.armor, 0.03);
    box(body, [0.65, 0.34, 0.14], [0, 1.38, 0.51], 0x514a3a, 0.04);
  } else if (tier === 5) {
    // Broad segmented nursery shell with visibly paired splitting pods.
    const shell = orb(body, 0.83, [0, 1.92, -0.53], palette.armor);
    shell.scale.set(1.32, 1.2, 0.82);
    for (const side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const pod = orb(
          body,
          0.31,
          [side * (0.57 + i * 0.15), 2.53 - i * 0.35, -0.43],
          palette.trim,
        );
        pod.scale.y = 1.3;
        box(
          body,
          [0.045, 0.42, 0.08],
          [side * (0.57 + i * 0.15), 2.53 - i * 0.35, -0.17],
          palette.glow,
          0.01,
        );
      }
    for (const side of [-1, 1]) {
      const mandible = cylinder(
        head,
        0.15,
        0.5,
        [side * 0.32, -0.21, 0.35],
        palette.trim,
        4,
        0,
      );
      mandible.rotation.z = side * 0.55;
    }
  } else if (tier === 7) {
    for (const x of [-0.58, 0, 0.58]) {
      cylinder(body, 0.22, 1.56, [x, 2.24, -0.49], palette.trim, 10);
      for (const y of [1.56, 2.36, 2.99])
        cylinder(body, 0.255, 0.12, [x, y, -0.49], COLORS.dark, 10);
      cylinder(body, 0.11, 0.25, [x, 3.17, -0.49], palette.armor, 8);
      orb(body, 0.13, [x, 3.36, -0.49], palette.glow);
    }
    box(head, [0.76, 0.19, 0.38], [0, -0.25, 0.35], palette.trim, 0.06);
    for (const x of [-0.22, 0.22])
      cylinder(head, 0.14, 0.16, [x, -0.23, 0.56], COLORS.dark, 8).rotation.x =
        Math.PI / 2;
  } else if (tier === 8) {
    for (const side of [-1, 1]) {
      const wing = box(
        body,
        [0.57, 1.29, 0.28],
        [side * 0.88, 2.4, -0.33],
        palette.trim,
        0.07,
      );
      wing.rotation.z = -side * 0.24;
      const inner = box(
        body,
        [0.34, 0.91, 0.1],
        [side * 0.88, 2.4, -0.14],
        palette.armor,
        0.035,
      );
      inner.rotation.z = -side * 0.24;
    }
    box(head, [0.9, 0.27, 0.81], [0, 0.29, 0], palette.trim, 0.04);
    for (const x of [-0.32, 0, 0.32])
      box(head, [0.18, 0.28, 0.36], [x, 0.52, 0], palette.armor, 0.02);
    box(body, [0.84, 0.81, 0.17], [0, 1.45, 0.49], palette.trim, 0.07);
    box(body, [0.09, 0.62, 0.08], [0, 1.46, 0.61], palette.glow, 0.02);
  } else if (tier === 9) {
    const crown = torus(body, 0.7, 0.075, [0, 2.85, -0.28], palette.trim);
    crown.rotation.x = Math.PI / 2;
    // The crown is carried by two rear struts, not suspended over the head.
    for (const side of [-1, 1]) {
      const support = cylinder(
        body,
        0.06,
        0.92,
        [side * 0.44, 2.445, -0.63],
        palette.armor,
        10,
      );
      support.rotation.x = -0.454;
    }
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * i) / 5;
      const x = Math.cos(angle) * 0.69,
        z = -0.28 + Math.sin(angle) * 0.69;
      cylinder(body, 0.07, 0.7, [x, 3.06, z], palette.trim, 8);
      orb(body, 0.16, [x, 3.43, z], palette.glow);
    }
    for (const side of [-1, 1])
      box(
        body,
        [0.23, 1.33, 0.31],
        [side * 0.55, 1.52, -0.42],
        palette.trim,
        0.06,
      );
    orb(body, 0.29, [0, 1.51, 0.51], palette.glow);
    box(head, [0.63, 0.17, 0.11], [0, 0.31, 0.3], palette.trim, 0.025);
  } else {
    // Reactor tower and a broken halo identify the final combined threat.
    box(body, [0.64, 0.92, 0.28], [0, 1.82, -0.43], 0x373540, 0.065);
    cylinder(body, 0.28, 1.1, [0, 3.04, -0.57], palette.armor, 8);
    for (const y of [2.64, 2.94, 3.24, 3.54])
      cylinder(body, 0.35, 0.09, [0, y, -0.57], palette.trim, 8);
    orb(body, 0.16, [0, 3.7, -0.57], palette.glow);
    const halo = torus(body, 1.02, 0.08, [0, 2.43, -0.57], 0x373540);
    halo.scale.y = 1.06;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      const plate = box(
        body,
        [0.5, 0.3, 0.19],
        [Math.cos(angle) * 1.04, 2.43 + Math.sin(angle) * 1.08, -0.57],
        palette.trim,
        0.045,
      );
      plate.rotation.z = angle + Math.PI / 2;
      const inlay = box(
        body,
        [0.3, 0.06, 0.045],
        [Math.cos(angle) * 1.04, 2.43 + Math.sin(angle) * 1.08, -0.454],
        palette.glow,
        0.01,
      );
      inlay.rotation.z = angle + Math.PI / 2;
    }
    cylinder(body, 0.35, 0.14, [0, 1.49, 0.48], palette.trim, 12).rotation.x =
      Math.PI / 2;
    orb(body, 0.23, [0, 1.49, 0.62], palette.glow);
    box(head, [0.2, 0.52, 0.66], [0, 0.26, 0], palette.trim, 0.04);
  }
}

/** Tapered armor has a continuous manufactured outline, with a real edge bevel. */
function enemyArmor(
  parent: THREE.Object3D,
  size: number[],
  at: number[],
  tint: number,
  taper = 0.8,
) {
  const [w, h, d] = size;
  const points = [
    [-w * 0.38, h * 0.5],
    [w * 0.38, h * 0.5],
    [w * 0.5, h * 0.3],
    [w * 0.5 * taper, -h * 0.34],
    [w * 0.32 * taper, -h * 0.5],
    [-w * 0.32 * taper, -h * 0.5],
    [-w * 0.5 * taper, -h * 0.34],
    [-w * 0.5, h * 0.3],
  ];
  const shape = new THREE.Shape(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const bevel = Math.min(0.035, d * 0.18);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -d / 2 + bevel);
  const mesh = new THREE.Mesh(geometry, material(tint));
  mesh.position.set(...(at as [number, number, number]));
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function makeEnemy(kind: string, bossTier = 1): Rig {
  const root = new THREE.Group(),
    body = new THREE.Group(),
    head = new THREE.Group();
  root.add(body);
  body.add(head);
  const legs: THREE.Group[] = [],
    arms: THREE.Group[] = [],
    accents: THREE.Object3D[] = [];
  const big = kind === "boss",
    heavy = kind === "brute" || kind === "shielder" || big,
    spider = ["runner", "charger", "splitter"].includes(kind);
  const tier = Number.isFinite(bossTier)
    ? ((Math.max(1, Math.floor(bossTier)) - 1) % 10) + 1
    : 1;
  const palette = BOSS_PALETTES[tier - 1];
  const enemyColors: Record<string, number> = {
    splitter: 0x84966e,
    shielder: 0x768fa2,
    bomber: 0xb7894e,
    medic: 0x8db49d,
    sniper: 0x8796a5,
  };
  const base =
    enemyColors[kind] ??
    (big
      ? palette.armor
      : heavy
        ? 0xa98c77
        : kind === "shooter"
          ? 0xab8794
          : 0x9b7c69);
  const eye = big
    ? palette.glow
    : kind === "medic"
      ? 0xb6f2c0
      : kind === "sniper"
        ? 0xffdfac
        : kind === "shooter"
          ? 0xf5ba85
          : 0xff684b;
  if (spider) {
    enemyArmor(body, [0.78, 0.5, 1], [0, 0.58, 0], base, 0.94);
    box(body, [0.54, 0.22, 0.42], [0, 0.83, 0.16], 0x384045, 0.06);
    cylinder(body, 0.214, 0.16, [0, 0.61, 0.505], 0x29383e, 16).rotation.x =
      Math.PI / 2;
    cylinder(body, 0.16, 0.02, [0, 0.61, 0.594], 0x111d24, 16).rotation.x =
      Math.PI / 2;
    torus(body, 0.165, 0.04, [0, 0.61, 0.607], 0x70868a);
    const lens: THREE.Mesh = cylinder(
      body,
      0.11,
      0.02,
      [0, 0.61, 0.617],
      eye,
      20,
    );
    lens.rotation.x = Math.PI / 2;
    lens.material = glowMaterial(eye);
    accents.push(lens);
    if (kind === "splitter") {
      for (const side of [-1, 1]) {
        cylinder(body, 0.31, 0.15, [side * 0.35, 0.67, -0.07], 0x405044, 12);
        cylinder(
          body,
          0.285,
          0.61,
          [side * 0.35, 0.93, -0.07],
          0xb7c78e,
          12,
          0.22,
        );
        cylinder(
          body,
          0.23,
          0.18,
          [side * 0.35, 1.285, -0.07],
          0x91a67c,
          12,
          0.12,
        );
        for (const y of [0.78, 1.06])
          cylinder(
            body,
            y < 1 ? 0.277 : 0.249,
            0.048,
            [side * 0.35, y, -0.07],
            0x586b54,
            12,
          );
        box(
          body,
          [0.055, 0.35, 0.025],
          [side * 0.35, 0.93, 0.206],
          0x526446,
          0.008,
        );
      }
      box(body, [0.65, 0.15, 0.45], [0, 0.72, -0.07], COLORS.dark, 0.025);
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 2; i++) {
        const l = new THREE.Group();
        l.position.set(side * 0.42, 0.57, (i - 0.5) * 0.58);
        root.add(l);
        const upper = box(
          l,
          [0.55, 0.12, 0.16],
          [side * 0.22, -0.07, 0],
          0x30393e,
        );
        upper.rotation.z = -side * 0.32;
        const lower = box(
          l,
          [0.11, 0.48, 0.14],
          [side * 0.48, -0.28, 0.09],
          base,
        );
        lower.rotation.x = 0.35;
        bake(l);
        legs.push(l);
      }
    bake(body);
  } else {
    const width = heavy ? 1.22 : 0.71;
    if (kind !== "bomber") {
      enemyArmor(
        body,
        [width, heavy ? 1.1 : 0.7, 0.68],
        [0, heavy ? 1.45 : 1.02, 0],
        base,
        heavy ? 0.94 : 0.7,
      );
      enemyArmor(
        body,
        [width * 0.78, heavy ? 0.62 : 0.43, 0.09],
        [0, heavy ? 1.59 : 1.12, 0.39],
        big ? palette.trim : 0xa3a9a3,
        0.72,
      );
    }
    if (kind !== "bomber" && kind !== "medic") {
      const ventY = heavy ? 1.61 : 1.12;
      box(body, [width * 0.5, 0.16, 0.026], [0, ventY, 0.447], 0x34444a, 0.016);
      box(
        body,
        [width * 0.43, 0.095, 0.018],
        [0, ventY, 0.463],
        0x152329,
        0.01,
      );
      for (const side of [-1, 0, 1])
        box(
          body,
          [width * 0.033, 0.1, 0.014],
          [side * width * 0.11, ventY, 0.477],
          0x6b7f81,
          0.004,
        );
    }
    if (heavy) {
      for (const x of [-0.32, 0, 0.32]) {
        box(
          body,
          [0.13, 0.42, 0.1],
          [x, 1.3, 0.45],
          big ? palette.glow : 0xe27b50,
          0.02,
        );
      }
      for (const x of [-0.75, 0.75]) {
        const a = new THREE.Group();
        a.position.set(x, 1.52, 0);
        root.add(a);
        box(a, [0.54, 0.5, 0.65], [0, 0, 0], 0x424548, 0.08);
        if (!(big && tier === 2 && x > 0)) {
          enemyArmor(a, [0.46, 0.64, 0.41], [0, -0.53, 0], base, 0.83);
          box(a, [0.52, 0.26, 0.51], [0, -0.96, 0.13], 0x35393b);
        }
        if (big) bossArm(a, Math.sign(x), tier, palette);
        else if (kind === "shielder" && x < 0) {
          box(a, [0.9, 1.28, 0.2], [-0.03, -0.48, 0.43], 0xc1cdd2, 0.08);
          box(a, [0.69, 1.03, 0.09], [-0.03, -0.46, 0.59], base, 0.05);
          box(a, [0.075, 0.87, 0.07], [-0.03, -0.46, 0.66], 0x9cdded, 0.015);
        }
        bake(a);
        arms.push(a);
      }
    } else {
      for (const x of [-0.5, 0.5]) {
        const a = new THREE.Group();
        a.position.set(x, 1.12, 0);
        root.add(a);
        cylinder(
          a,
          0.105,
          0.22,
          [-Math.sign(x) * 0.13, 0.02, 0],
          0x34464f,
          12,
        ).rotation.z = Math.PI / 2;
        cylinder(a, 0.16, 0.14, [0, 0.02, 0], 0x283842, 12).rotation.z =
          Math.PI / 2;
        enemyArmor(a, [0.25, 0.53, 0.3], [0, -0.24, 0], base, 0.74);
        orb(a, 0.15, [0, -0.58, 0.04], 0x353b3d);
        if (kind === "shooter" && x > 0) {
          enemyArmor(a, [0.35, 0.3, 0.66], [0, -0.32, 0.31], 0x354751, 0.92);
          const barrel = cylinder(a, 0.12, 0.48, [0, -0.3, 0.7], 0x738c8e, 12);
          barrel.rotation.x = Math.PI / 2;
          const muzzle = new THREE.Object3D();
          muzzle.position.set(0, -0.3, 0.95);
          a.add(muzzle);
          root.userData.muzzleObject = muzzle;
          box(a, [0.2, 0.055, 0.4], [0, -0.14, 0.4], eye, 0.018);
        } else if (kind === "sniper" && x > 0) {
          box(a, [0.24, 0.24, 0.77], [0, -0.36, 0.42], COLORS.dark, 0.025);
          cylinder(a, 0.07, 1.07, [0, -0.36, 1.04], 0xb2bbc0, 8).rotation.x =
            Math.PI / 2;
          cylinder(a, 0.12, 0.19, [0, -0.36, 1.62], COLORS.dark, 8).rotation.x =
            Math.PI / 2;
          cylinder(a, 0.09, 0.31, [0, -0.16, 0.44], base, 8).rotation.x =
            Math.PI / 2;
          const muzzle = new THREE.Object3D();
          muzzle.position.set(0, -0.36, 1.72);
          a.add(muzzle);
          root.userData.muzzleObject = muzzle;
        } else if (kind === "medic") {
          box(a, [0.19, 0.46, 0.19], [0, -0.26, 0.17], 0xd0ddca, 0.03);
        }
        bake(a);
        arms.push(a);
      }
    }
    head.position.y = heavy ? 2.18 : 1.62;
    enemyArmor(
      head,
      [heavy ? 0.83 : 0.57, 0.51, 0.56],
      [0, 0, 0],
      big ? palette.armor : 0x677679,
      0.78,
    );
    if (!(big && tier === 6)) {
      box(
        head,
        [heavy ? 0.65 : 0.43, 0.22, 0.075],
        [0, 0.01, 0.307],
        0x101c26,
        0.06,
      );
      const eyeMesh = box(
        head,
        [heavy ? 0.58 : 0.35, 0.12, 0.06],
        [0, 0.005, 0.358],
        eye,
        0.02,
      );
      eyeMesh.material = glowMaterial(eye);
    }
    if (kind === "shooter") {
      box(head, [0.43, 0.08, 0.37], [0, 0.3, -0.02], 0x34464f, 0.023);
      enemyArmor(head, [0.46, 0.24, 0.39], [0, 0.41, -0.03], base, 0.87);
      cylinder(head, 0.084, 0.12, [0, 0.415, 0.22], 0x34464f, 12).rotation.x =
        Math.PI / 2;
      const rangefinder: THREE.Mesh = cylinder(
        head,
        0.055,
        0.014,
        [0, 0.415, 0.289],
        eye,
        16,
      );
      rangefinder.rotation.x = Math.PI / 2;
      rangefinder.material = glowMaterial(eye);
    }
    if (kind === "bomber") {
      cylinder(body, 0.49, 0.91, [0, 1.08, 0], base, 10);
      for (const y of [0.69, 1.05, 1.46])
        cylinder(body, 0.51, 0.1, [0, y, 0], COLORS.dark, 10);
      for (const x of [-0.2, 0, 0.2]) {
        const stripe = box(
          body,
          [0.1, 0.24, 0.08],
          [x, 1.28, 0.47],
          0xf3cb79,
          0.01,
        );
        stripe.rotation.z = -0.38;
      }
      cylinder(head, 0.18, 0.11, [0, 0.31, 0], COLORS.dark, 8);
      orb(head, 0.13, [0, 0.44, 0], 0xff8860, true);
    } else if (kind === "medic") {
      cylinder(head, 0.055, 0.56, [0, 0.45, -0.03], COLORS.steel, 8);
      torus(head, 0.22, 0.055, [0, 0.79, -0.03], 0xc7e4cf);
      orb(head, 0.09, [0, 0.79, -0.03], 0xb6f2c0, true);
      for (const x of [-0.32, 0.32])
        cylinder(body, 0.14, 0.77, [x, 1.14, -0.43], 0xd0ddca, 8);
      box(body, [0.29, 0.12, 0.09], [0, 1.15, 0.45], 0xcdf6d7, 0.02);
      box(body, [0.12, 0.29, 0.09], [0, 1.15, 0.46], 0xcdf6d7, 0.02);
    } else if (kind === "sniper") {
      enemyArmor(head, [0.59, 0.2, 0.6], [0, 0.23, -0.02], base, 0.88);
      enemyArmor(head, [0.16, 0.22, 0.4], [-0.3, 0.19, 0.07], 0x354953, 0.94);
      cylinder(
        head,
        0.065,
        0.08,
        [-0.3, 0.195, 0.31],
        0x778c91,
        12,
      ).rotation.x = Math.PI / 2;
      cylinder(head, 0.04, 0.015, [-0.3, 0.195, 0.358], eye, 12).rotation.x =
        Math.PI / 2;
      cylinder(head, 0.055, 0.08, [0.21, 0.325, -0.2], 0x354953, 10);
      cylinder(head, 0.025, 0.18, [0.21, 0.425, -0.2], 0x8a9c9f, 10);
      box(body, [0.65, 0.71, 0.11], [0, 1.09, -0.43], 0x555f66, 0.025);
    }
    if (big) {
      bossBody(body, head, tier, palette);
    }
    bake(head);
    bake(body);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * (heavy ? 0.4 : 0.25), heavy ? 0.91 : 0.7, 0);
      root.add(leg);
      box(
        leg,
        [heavy ? 0.41 : 0.27, heavy ? 0.77 : 0.56, 0.3],
        [0, heavy ? -0.345 : -0.24, 0],
        0x333b3d,
        0.04,
      );
      enemyArmor(
        leg,
        [heavy ? 0.43 : 0.29, 0.25, 0.1],
        [0, -0.38, 0.205],
        base,
        0.78,
      );
      box(
        leg,
        [heavy ? 0.5 : 0.34, 0.23, 0.58],
        [0, heavy ? -0.8 : -0.59, 0.13],
        0x28343d,
        0.055,
      );
      bake(leg);
      legs.push(leg);
    }
  }
  if (big) {
    root.scale.setScalar(1.8);
    root.userData.bossTier = tier;
    root.userData.visualHeight = new THREE.Box3().setFromObject(root).max.y;
  } else if (kind === "charger") root.scale.setScalar(1.22);
  else if (kind === "runner") root.scale.setScalar(0.82);
  return {
    root,
    body,
    head,
    arms,
    weaponMounts: [],
    legs,
    accents,
    kind,
    recoil: 0,
    lastX: 0,
    lastY: 0,
  };
}
export function animateRig(
  rig: Rig,
  time: number,
  speed: number,
  angle: number,
  dt: number,
  dashing = false,
  hurt = false,
  hurtColor = 0xffd0a8,
  hurtIntensity = 0.22,
) {
  if (rig.root.userData.heroRig) {
    animateHeroRig(
      rig,
      time,
      speed,
      angle,
      dt,
      dashing,
      hurt,
      hurtColor,
      hurtIntensity,
    );
    return;
  }
  const targetMove = Math.min(1, speed / 5);
  rig.moveBlend = THREE.MathUtils.lerp(
    rig.moveBlend ?? targetMove,
    targetMove,
    1 - Math.exp(-dt * 16),
  );
  const move = rig.moveBlend;
  rig.gait =
    (rig.gait ?? 0) +
    dt *
      (rig.kind === "bastion" || rig.kind === "boss" ? 11 : 16) *
      Math.max(0.25, move);
  const stride = Math.sin(rig.gait);
  const targetAngle = Math.PI / 2 - angle;
  const oldAngle = rig.facing ?? targetAngle;
  const difference = Math.atan2(
    Math.sin(targetAngle - oldAngle),
    Math.cos(targetAngle - oldAngle),
  );
  rig.facing =
    oldAngle + difference * (1 - Math.exp(-dt * (dashing ? 40 : 18)));
  rig.root.rotation.y = rig.facing;
  rig.body.position.y =
    (rig.body.userData.restY ?? 0) +
    Math.abs(stride) * 0.075 * move +
    Math.sin(time * 3) * 0.022;
  rig.body.rotation.x = dashing ? 0.4 : 0.09 * move;
  rig.body.rotation.z = Math.cos(time * 17) * 0.04 * move;
  rig.legs.forEach((leg, i) => {
    leg.rotation.x = stride * (i % 2 ? -1 : 1) * 0.65 * move;
    leg.rotation.z = ["runner", "charger", "splitter"].includes(rig.kind)
      ? Math.sin(time * 20 + i) * 0.2 * move
      : 0;
  });
  rig.recoil = Math.max(0, rig.recoil - dt * 7);
  rig.arms.forEach((arm, i) => {
    arm.rotation.x =
      -0.15 - rig.recoil * (i % 2 ? 0.7 : 0.4) + Math.sin(time * 3 + i) * 0.025;
    arm.position.z = (arm.userData.restZ ?? 0) - rig.recoil * 0.13;
  });
  rig.head.rotation.z = Math.sin(time * 1.8) * 0.025;
  if (["volt", "frost", "wisp", "prism"].includes(rig.kind)) {
    rig.body.position.y += 0.18 + Math.sin(time * 4) * 0.07;
    rig.legs.forEach((l) => (l.rotation.x = 0.32));
  }
  if (rig.kind === "ember" && rig.accents[0]) {
    rig.accents[0].rotation.x = 0.15 + move * 0.5 + Math.sin(time * 9) * 0.1;
  }
  if (!rig.flashMaterial) {
    rig.flashMaterial = matte.clone();
    rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === matte)
        o.material = rig.flashMaterial!;
    });
  }
  rig.flashMaterial.emissive.setHex(hurt ? hurtColor : 0x000000);
  rig.flashMaterial.emissiveIntensity = hurt ? hurtIntensity : 0;
}
