import * as THREE from "three";
import {
  axial,
  medicalMark,
  moduleBadge,
  optical,
  P,
  plate,
  strip,
  type Point,
} from "./equipment-parts";
import { box, cylinder, material, torus } from "./geometry";

// Expansion items. Weapon mods share one cartridge chassis with a distinct
// insert in the window; passives and economy modules are their own objects.
// Every model installs the rank badge exactly like the core set.
export type ItemBuilder = (group: THREE.Group, rank: number) => void;

function orb(
  group: THREE.Group,
  radius: number,
  at: readonly [number, number, number],
  color: number,
  detail = 1,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, detail),
    material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

const HEART: Point[] = [
  [0, -0.15],
  [0.15, 0],
  [0.15, 0.08],
  [0.08, 0.14],
  [0, 0.08],
  [-0.08, 0.14],
  [-0.15, 0.08],
  [-0.15, 0],
];

/** Mod cartridge: armoured body, steel cap, brass contacts and a recessed window. */
function cartridge(group: THREE.Group, rank: number) {
  box(group, [0.62, 0.78, 0.26], [0, 0, 0], P.chassis, 0.04);
  box(group, [0.5, 0.2, 0.3], [0, 0.34, 0], P.steel, 0.02);
  for (const x of [-0.2, 0.2])
    box(group, [0.07, 0.14, 0.28], [x, -0.44, 0], P.brass, 0.01);
  box(group, [0.44, 0.44, 0.06], [0, -0.04, 0.14], P.recess, 0.012);
  moduleBadge(group, rank, [0, 0.34, 0.16]);
}

export const ITEM_BUILDERS: Record<string, ItemBuilder> = {
  ricochet(group, rank) {
    cartridge(group, rank);
    orb(group, 0.07, [0.08, -0.06, 0.2], P.brass);
    const left = strip(
      group,
      [0.04, 0.22, 0.05],
      [-0.12, -0.04, 0.2],
      0xd0d8d8,
    );
    left.rotation.z = 0.5;
    const right = strip(group, [0.04, 0.18, 0.05], [0.13, 0.1, 0.2], 0xd0d8d8);
    right.rotation.z = -0.6;
  },
  split_shot(group, rank) {
    cartridge(group, rank);
    strip(group, [0.05, 0.2, 0.05], [0, -0.14, 0.2], 0xd0d8d8);
    for (const side of [-1, 1]) {
      const arm = strip(
        group,
        [0.05, 0.22, 0.05],
        [side * 0.08, 0.06, 0.2],
        0xd0d8d8,
      );
      arm.rotation.z = -side * 0.6;
    }
  },
  splash(group, rank) {
    cartridge(group, rank);
    torus(group, 0.14, 0.02, [0, -0.06, 0.2], 0x7fc4e6);
    torus(group, 0.07, 0.018, [0, -0.06, 0.205], 0x7fc4e6);
    orb(group, 0.04, [0, -0.06, 0.21], 0xa9dcf5);
  },
  homing(group, rank) {
    cartridge(group, rank);
    plate(
      group,
      [
        [0, 0.16],
        [0.14, -0.02],
        [0.05, -0.02],
        [0.05, -0.16],
        [-0.05, -0.16],
        [-0.05, -0.02],
        [-0.14, -0.02],
      ],
      0.05,
      [0, -0.04, 0.2],
      0xe0c070,
      0.008,
    );
    torus(group, 0.17, 0.015, [0, -0.04, 0.19], P.steel);
  },
  lifesteal(group, rank) {
    cartridge(group, rank);
    plate(group, HEART, 0.05, [0, -0.04, 0.2], 0xd25a5a, 0.008);
    cylinder(group, 0.02, 0.2, [0.16, 0.05, 0.2], P.edge, 8);
  },
  double_shot(group, rank) {
    cartridge(group, rank);
    for (const x of [-0.07, 0.07]) {
      cylinder(group, 0.04, 0.22, [x, -0.04, 0.2], P.brass, 12);
      cylinder(group, 0.04, 0.07, [x, 0.105, 0.2], P.edge, 12, 0.01);
    }
  },
  pierce(group, rank) {
    cartridge(group, rank);
    const spear = cylinder(group, 0.025, 0.4, [0, -0.04, 0.2], P.edge, 8);
    spear.rotation.z = 0.7;
    const target = plate(
      group,
      [
        [-0.1, 0.1],
        [0.1, 0.1],
        [0.1, -0.1],
        [-0.1, -0.1],
      ],
      0.03,
      [0.02, -0.04, 0.19],
      0x8899a0,
      0.006,
    );
    target.rotation.z = 0.7;
  },
  crit_damage(group, rank) {
    cartridge(group, rank);
    const star: Point[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? 0.07 : 0.17;
      star.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
    plate(group, star, 0.05, [0, -0.04, 0.2], 0xf2c14e, 0.006);
    orb(group, 0.04, [0, -0.04, 0.23], P.edge);
  },
  crit_chance(group, rank) {
    // Targeting lens with a steel crosshair.
    axial(group, 0.4, 0.28, [0, 0, 0], P.chassis, 0.4, 16);
    axial(group, 0.34, 0.08, [0, 0, 0.16], 0x8a8f9a, 0.34, 16);
    axial(group, 0.27, 0.04, [0, 0, 0.21], 0xe8c27a, 0.27, 16).material =
      optical(0xe8c27a);
    strip(group, [0.56, 0.018, 0.02], [0, 0, 0.238], P.steel);
    strip(group, [0.018, 0.56, 0.02], [0, 0, 0.238], P.steel);
    box(group, [0.2, 0.16, 0.3], [0, -0.44, 0], P.steel, 0.02);
    moduleBadge(group, rank, [0, -0.44, 0.16]);
  },
  attack_range(group, rank) {
    // Long barrel extension with cooling ribs and a muzzle brake.
    axial(group, 0.11, 0.95, [0, 0, 0], P.steel, 0.11, 12);
    for (const z of [-0.3, -0.1, 0.1, 0.3])
      axial(group, 0.14, 0.06, [0, 0, z], P.chassis, 0.14, 12);
    axial(group, 0.15, 0.14, [0, 0, 0.44], P.chassis, 0.15, 12);
    axial(group, 0.085, 0.012, [0, 0, 0.515], P.recess, 0.085, 12);
    box(group, [0.4, 0.4, 0.1], [0, 0, -0.46], P.chassis, 0.03);
    box(group, [0.08, 0.06, 0.6], [0, 0.14, -0.05], P.chassis, 0.01);
    moduleBadge(group, rank, [0, -0.28, -0.4]);
  },
  shield(group, rank) {
    // Barrier cell: a hexagonal frame around a glowing field core.
    axial(group, 0.42, 0.2, [0, 0, 0], P.chassis, 0.42, 6);
    axial(group, 0.34, 0.06, [0, 0, 0.12], 0x6fb0c8, 0.34, 6);
    axial(group, 0.22, 0.03, [0, 0, 0.16], 0x9fdcf0, 0.22, 6).material =
      optical(0x9fdcf0);
    for (const x of [-0.4, 0.4])
      box(group, [0.12, 0.5, 0.26], [x, 0, 0], P.steel, 0.02);
    box(group, [0.5, 0.12, 0.3], [0, -0.42, 0], P.steel, 0.02);
    moduleBadge(group, rank, [0, -0.42, 0.16]);
  },
  knockback(group, rank) {
    // Thruster plate: three forward nozzles on an armoured hex plate.
    plate(
      group,
      [
        [-0.42, 0.3],
        [0.42, 0.3],
        [0.48, 0],
        [0.42, -0.3],
        [-0.42, -0.3],
        [-0.48, 0],
      ],
      0.16,
      [0, 0, 0],
      P.chassis,
      0.018,
    );
    for (const x of [-0.24, 0, 0.24]) {
      axial(group, 0.1, 0.2, [x, 0, 0.14], P.steel, 0.12, 12);
      axial(group, 0.08, 0.012, [x, 0, 0.245], 0xf0a860, 0.08, 12);
    }
    box(group, [0.6, 0.08, 0.1], [0, 0.33, 0], P.steel, 0.012);
    moduleBadge(group, rank, [0, -0.24, 0.085]);
  },
  status_damage(group, rank) {
    // Catalyst vial in a steel frame.
    cylinder(group, 0.16, 0.5, [0, 0.02, 0], 0xc8f06a, 12).material =
      optical(0xc8f06a);
    cylinder(group, 0.18, 0.1, [0, 0.31, 0], P.chassis, 12);
    cylinder(group, 0.18, 0.1, [0, -0.28, 0], P.chassis, 12);
    for (const x of [-0.2, 0.2])
      box(group, [0.06, 0.66, 0.06], [x, 0.02, 0], P.steel, 0.01);
    box(group, [0.52, 0.08, 0.3], [0, -0.36, 0], P.steel, 0.016);
    strip(group, [0.1, 0.16, 0.02], [0, 0.02, 0.165], 0xe5f5a0);
    moduleBadge(group, rank, [0, -0.36, 0.16]);
  },
  slow_power(group, rank) {
    // Frost core: a cryo sphere held in a three-ring cage.
    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 2),
      optical(0xa9e6f2),
    );
    group.add(sphere);
    torus(group, 0.3, 0.03, [0, 0, 0], P.steel);
    torus(group, 0.3, 0.03, [0, 0, 0], P.steel).rotation.x = Math.PI / 2;
    torus(group, 0.3, 0.03, [0, 0, 0], P.steel).rotation.y = Math.PI / 2;
    cylinder(group, 0.07, 0.16, [0, 0.36, 0], P.chassis, 12);
    cylinder(group, 0.07, 0.16, [0, -0.36, 0], P.chassis, 12);
    box(group, [0.44, 0.08, 0.3], [0, -0.46, 0], P.chassis, 0.016);
    moduleBadge(group, rank, [0, -0.46, 0.16]);
  },
  momentum(group, rank) {
    // Gyro: three gimbal rings around a flywheel on a single axle.
    torus(group, 0.36, 0.04, [0, 0, 0], 0xb59a70);
    torus(group, 0.28, 0.035, [0, 0, 0], P.steel).rotation.y = Math.PI / 2;
    torus(group, 0.2, 0.03, [0, 0, 0], P.edge).rotation.x = Math.PI / 2;
    cylinder(group, 0.1, 0.14, [0, 0, 0], P.chassis, 12);
    cylinder(group, 0.03, 0.7, [0, 0, 0], P.edge, 8);
    box(group, [0.5, 0.1, 0.3], [0, -0.46, 0], P.chassis, 0.016);
    moduleBadge(group, rank, [0, -0.46, 0.16]);
  },
  thorns(group, rank) {
    // Spiked plate: five hardened spikes on a layered armour plate.
    const outline: Point[] = [
      [-0.4, 0.4],
      [0.4, 0.4],
      [0.44, 0],
      [0.3, -0.4],
      [-0.3, -0.4],
      [-0.44, 0],
    ];
    plate(group, outline, 0.18, [0, 0, 0], P.chassis, 0.03);
    plate(
      group,
      outline.map(([x, y]) => [x * 0.8, y * 0.8] as Point),
      0.08,
      [0, 0, 0.12],
      0x8ca782,
      0.018,
    );
    for (const [x, y] of [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
      [0, 0],
    ])
      axial(group, 0.05, 0.22, [x, y, 0.26], P.edge, 0.008, 8);
    moduleBadge(group, rank, [0, -0.36, 0.1]);
  },
  interest(group, rank) {
    // Vault door with two coin stacks on the tray.
    box(group, [0.7, 0.7, 0.36], [0, 0, -0.1], P.chassis, 0.05);
    axial(group, 0.22, 0.06, [0, 0.02, 0.1], P.steel, 0.22, 16);
    torus(group, 0.11, 0.022, [0, 0.02, 0.14], P.brass);
    for (let i = 0; i < 3; i++) {
      const spoke = strip(group, [0.026, 0.2, 0.026], [0, 0.02, 0.14], P.brass);
      spoke.rotation.z = (i * Math.PI) / 3;
    }
    box(group, [0.7, 0.08, 0.5], [0, -0.39, 0.1], P.steel, 0.016);
    for (const [x, count] of [
      [0.2, 5],
      [-0.2, 3],
    ])
      for (let i = 0; i < count; i++)
        cylinder(
          group,
          i % 2 ? 0.105 : 0.11,
          0.04,
          [x, -0.33 + i * 0.04, 0.22],
          i % 2 ? 0xd8b46a : P.brass,
          16,
        );
    moduleBadge(group, rank, [0, -0.39, 0.36]);
  },
  discount(group, rank) {
    // Licence card in a clip: perforated edge, stripe and a percent mark.
    box(group, [0.8, 0.5, 0.06], [0, 0, 0], 0xe0d6b0, 0.02);
    strip(group, [0.82, 0.1, 0.03], [0, 0.14, 0.02], 0xc46b4a);
    for (const y of [-0.12, 0, 0.12])
      axial(group, 0.04, 0.1, [-0.4, y, 0], P.recess, 0.04, 12);
    strip(group, [0.3, 0.025, 0.02], [0.15, -0.05, 0.035], P.chassis);
    strip(group, [0.2, 0.025, 0.02], [0.1, -0.13, 0.035], P.chassis);
    axial(group, 0.035, 0.05, [-0.2, -0.05, 0.04], P.chassis, 0.035, 12);
    axial(group, 0.035, 0.05, [-0.06, -0.16, 0.04], P.chassis, 0.035, 12);
    const slash = strip(
      group,
      [0.03, 0.22, 0.04],
      [-0.13, -0.1, 0.04],
      P.chassis,
    );
    slash.rotation.z = -0.6;
    box(group, [0.2, 0.1, 0.16], [0, 0.28, 0], P.steel, 0.016);
    box(group, [0.5, 0.08, 0.3], [0, -0.28, 0], P.chassis, 0.016);
    moduleBadge(group, rank, [0, -0.29, 0.16]);
  },
  free_reroll(group, rank) {
    // Die in a cradle: five, three and four pips.
    box(group, [0.5, 0.5, 0.5], [0, 0.06, 0], P.ceramic, 0.07);
    for (const [x, y] of [
      [-0.12, -0.12],
      [0.12, -0.12],
      [-0.12, 0.12],
      [0.12, 0.12],
      [0, 0],
    ])
      axial(group, 0.04, 0.03, [x, 0.06 + y, 0.26], P.recess, 0.04, 12);
    for (const d of [-0.12, 0, 0.12])
      cylinder(group, 0.04, 0.03, [d, 0.32, -d], P.recess, 12);
    for (const [y, z] of [
      [-0.12, -0.12],
      [0.12, -0.12],
      [-0.12, 0.12],
      [0.12, 0.12],
    ])
      cylinder(
        group,
        0.04,
        0.03,
        [0.26, 0.06 + y, z],
        P.recess,
        12,
      ).rotation.z = Math.PI / 2;
    box(group, [0.62, 0.1, 0.62], [0, -0.25, 0], P.chassis, 0.02);
    for (const x of [-0.29, 0.29])
      for (const z of [-0.29, 0.29])
        box(group, [0.08, 0.3, 0.08], [x, -0.1, z], P.steel, 0.01);
    moduleBadge(group, rank, [0, -0.25, 0.32]);
  },
  luck(group, rank) {
    // Clover coin on a stand.
    axial(group, 0.4, 0.1, [0, 0, 0], P.brass, 0.4, 24);
    torus(group, 0.38, 0.03, [0, 0, 0.05], 0xd8b46a);
    for (const x of [-0.11, 0.11])
      for (const y of [-0.11, 0.11])
        axial(group, 0.11, 0.03, [x, y, 0.065], 0x6fbf6a, 0.11, 16);
    const stem = strip(group, [0.03, 0.16, 0.03], [0.05, -0.2, 0.07], 0x4f9a4c);
    stem.rotation.z = 0.5;
    box(group, [0.36, 0.1, 0.3], [0, -0.44, 0], P.chassis, 0.016);
    moduleBadge(group, rank, [0, -0.44, 0.16]);
  },
  second_chance(group, rank) {
    // Medkit with a heart on the case and a cross on the lid.
    box(group, [0.74, 0.5, 0.32], [0, -0.04, 0], 0xd9d3c2, 0.04);
    box(group, [0.76, 0.12, 0.34], [0, 0.24, 0], 0xc95a4a, 0.02);
    for (const x of [-0.12, 0.12])
      box(group, [0.05, 0.12, 0.08], [x, 0.33, 0], P.chassis, 0.01);
    box(group, [0.32, 0.05, 0.09], [0, 0.4, 0], P.chassis, 0.01);
    plate(group, HEART, 0.05, [0, -0.04, 0.17], 0xd25a5a, 0.008);
    medicalMark(group, [0, 0.24, 0.18], 0.5);
    for (const x of [-0.25, 0.25])
      box(group, [0.08, 0.1, 0.06], [x, 0.14, 0.17], P.steel, 0.008);
    moduleBadge(group, rank, [0, -0.24, 0.17]);
  },
};
