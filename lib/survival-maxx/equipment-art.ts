import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ITEMS, RANKS, WEAPONS } from "./content";
import { DRONE_BUILDERS } from "./drone-art-expansion";
import {
  axial,
  bore,
  canister,
  droneHull,
  grip,
  medicalMark,
  moduleBadge,
  optical,
  P,
  plate,
  receiver,
  rankInset,
  sight,
  strip,
  thruster,
  type Point,
} from "./equipment-parts";
import { bake, box, cylinder, torus } from "./geometry";
import { ITEM_BUILDERS } from "./item-art-expansion";
import { WEAPON_BUILDERS } from "./weapon-art-expansion";
function weaponModel(group: THREE.Group, kind: string, rank: number): number[] {
  const expansion = WEAPON_BUILDERS[kind];
  if (expansion) return [...expansion(group, rank)];
  const rankColor = new THREE.Color(RANKS[rank - 1].color).getHex();
  if (kind === "blade") {
    cylinder(group, 0.085, 0.45, [0, 0, 0], P.rubber, 10);
    for (const y of [-0.14, 0, 0.14])
      cylinder(group, 0.088, 0.025, [0, y, 0], P.steel, 10);
    cylinder(group, 0.105, 0.09, [0, -0.27, 0], P.brass, 10);
    plate(
      group,
      [
        [-0.31, 0.2],
        [0.31, 0.2],
        [0.31, 0.32],
        [0.11, 0.37],
        [-0.11, 0.37],
        [-0.31, 0.32],
      ],
      0.17,
      [0, 0, 0],
      P.chassis,
    );
    plate(
      group,
      [
        [-0.19, 0.33],
        [0.19, 0.33],
        [0.185, 1.42],
        [0, 1.91],
        [-0.185, 1.42],
      ],
      0.075,
      [0, 0, 0],
      0xcdd8d9,
      0.014,
    );
    // A bevelled central fuller leaves a real bright edge along the entire blade.
    plate(
      group,
      [
        [-0.075, 0.4],
        [0.075, 0.4],
        [0.075, 1.38],
        [0, 1.68],
        [-0.075, 1.38],
      ],
      0.022,
      [0, 0, 0.049],
      0x688087,
      0.006,
    );
    plate(
      group,
      [
        [-0.075, 0.4],
        [0.075, 0.4],
        [0.075, 1.38],
        [0, 1.68],
        [-0.075, 1.38],
      ],
      0.022,
      [0, 0, -0.049],
      0x688087,
      0.006,
    );
    for (const z of [-0.103, 0.103])
      strip(group, [0.115, 0.045, 0.015], [0, 0.275, z], rankColor, rank === 6);
    if (rank >= 4)
      for (const z of [-0.066, 0.066])
        strip(group, [0.016, 0.82, 0.008], [0, 0.91, z], rankColor, rank === 6);
    return [0, 1.94, 0];
  }
  if (kind === "boomerang") {
    // Two continuous swept blades meet in a gripped hub, not a loose floating fan.
    plate(
      group,
      [
        [-0.82, 0.24],
        [-0.5, 0.24],
        [-0.15, 0],
        [0.15, 0],
        [0.5, 0.24],
        [0.82, 0.24],
        [0.31, -0.19],
        [-0.31, -0.19],
      ],
      0.15,
      [0, 0.16, 0],
      P.edge,
    );
    plate(
      group,
      [
        [-0.71, 0.22],
        [-0.51, 0.2],
        [-0.2, -0.02],
        [0.2, -0.02],
        [0.51, 0.2],
        [0.71, 0.22],
        [0.28, -0.11],
        [-0.28, -0.11],
      ],
      0.03,
      [0, 0.16, 0.095],
      0x568675,
      0.009,
    );
    axial(group, 0.19, 0.21, [0, 0.12, 0], P.chassis, 0.19, 12);
    axial(group, 0.11, 0.018, [0, 0.12, 0.12], rankColor, 0.11, 12);
    return [0, 0.12, 0.24];
  }
  grip(group, kind === "shotgun" || kind === "railgun");
  if (kind === "pistol") {
    receiver(
      group,
      0.29,
      [
        [-0.23, 0.16],
        [0.52, 0.16],
        [0.66, 0.29],
        [0.62, 0.47],
        [-0.18, 0.47],
        [-0.25, 0.4],
      ],
      P.chassis,
      0.022,
    );
    receiver(
      group,
      0.31,
      [
        [-0.2, 0.34],
        [0.57, 0.34],
        [0.59, 0.46],
        [-0.15, 0.51],
        [-0.2, 0.46],
      ],
      P.ceramic,
      0.013,
    );
    axial(group, 0.073, 0.22, [0, 0.285, 0.64], P.steel);
    bore(group, 0, 0.285, 0.763, 0.088);
    sight(group, 0.555, -0.1, 0.48);
    rankInset(group, rank, 0.176, 0.265, 0.16);
    return [0, 0.285, 0.82];
  }
  if (kind === "shotgun") {
    receiver(
      group,
      0.42,
      [
        [-0.25, 0.17],
        [0.48, 0.18],
        [0.59, 0.35],
        [0.34, 0.55],
        [-0.21, 0.55],
      ],
      P.chassis,
      0.025,
    );
    // The green shroud needs a real step beyond the receiver's beveled sides;
    // width 0.44 made both surfaces end at x=±0.235 and flicker together.
    receiver(
      group,
      0.48,
      [
        [-0.2, 0.41],
        [0.3, 0.41],
        [0.42, 0.53],
        [-0.15, 0.59],
      ],
      0xaab995,
      0.015,
    );
    for (const x of [-0.125, 0.125]) {
      axial(group, 0.105, 0.82, [x, 0.35, 0.78], P.steel);
      bore(group, x, 0.35, 1.21, 0.113);
    }
    receiver(
      group,
      0.4,
      [
        [0.33, 0.11],
        [0.76, 0.11],
        [0.81, 0.21],
        [0.77, 0.27],
        [0.3, 0.27],
      ],
      0x718575,
    );
    for (const z of [0.41, 0.54, 0.67])
      strip(group, [0.428, 0.04, 0.025], [0, 0.175, z], P.chassis);
    sight(group, 0.62, -0.07, 0.95);
    rankInset(group, rank, 0.242, 0.31, 0);
    return [0, 0.35, 1.27];
  }
  if (kind === "rocket") {
    receiver(
      group,
      0.58,
      [
        [-0.36, 0.13],
        [0.73, 0.13],
        [0.85, 0.34],
        [0.73, 0.64],
        [-0.28, 0.64],
        [-0.43, 0.4],
      ],
      P.chassis,
      0.025,
    );
    axial(group, 0.295, 1.08, [0, 0.38, 0.24], 0xbb9d83, 0.295, 10);
    axial(group, 0.31, 0.15, [0, 0.38, 0.8], P.steel, 0.31, 10);
    axial(group, 0.24, 0.012, [0, 0.38, 0.883], P.recess, 0.24, 10);
    axial(group, 0.135, 0.09, [0, 0.38, 0.875], 0xdf925f, 0.075, 10);
    axial(group, 0.3, 0.095, [0, 0.38, -0.35], P.steel, 0.3, 10);
    box(group, [0.16, 0.16, 0.33], [0.29, 0.63, -0.04], P.chassis, 0.028);
    strip(group, [0.13, 0.025, 0.16], [0.29, 0.72, -0.04], 0xefb77e);
    rankInset(group, rank, 0.329, 0.34, 0.16);
    return [0, 0.38, 0.99];
  }
  if (kind === "arc") {
    receiver(
      group,
      0.43,
      [
        [-0.24, 0.16],
        [0.39, 0.16],
        [0.62, 0.32],
        [0.35, 0.59],
        [-0.22, 0.59],
        [-0.31, 0.4],
      ],
      P.ceramic,
      0.028,
    );
    axial(group, 0.155, 0.35, [0, 0.37, 0.43], P.recess);
    for (const side of [-1, 1]) {
      axial(group, 0.055, 0.65, [side * 0.21, 0.36, 0.64], P.steel);
      for (const z of [0.41, 0.55, 0.69])
        axial(group, 0.092, 0.058, [side * 0.21, 0.36, z], 0x75949b, 0.092, 12);
      axial(group, 0.072, 0.12, [side * 0.21, 0.36, 0.97], 0xd4e0de);
    }
    axial(group, 0.1, 0.022, [0, 0.37, 0.627], 0x89e1e9).material =
      optical(0x89e1e9);
    strip(group, [0.08, 0.02, 0.24], [0, 0.614, 0], 0x89e1e9, true);
    rankInset(group, rank, 0.244, 0.31, -0.06);
    return [0, 0.36, 1.05];
  }
  if (kind === "flame") {
    receiver(
      group,
      0.44,
      [
        [-0.27, 0.18],
        [0.52, 0.18],
        [0.62, 0.37],
        [0.42, 0.56],
        [-0.22, 0.56],
      ],
      0x9f6250,
      0.024,
    );
    axial(group, 0.135, 0.58, [0, 0.36, 0.76], P.steel);
    axial(group, 0.22, 0.23, [0, 0.36, 0.96], P.chassis, 0.18, 12);
    bore(group, 0, 0.36, 1.093, 0.175, 0x9f775b);
    for (const side of [-1, 1]) {
      cylinder(group, 0.13, 0.45, [side * 0.26, 0.23, -0.07], 0xd29254, 12);
      cylinder(group, 0.135, 0.07, [side * 0.26, 0.005, -0.07], P.chassis, 12);
      cylinder(group, 0.085, 0.11, [side * 0.26, 0.5, -0.07], P.steel, 12);
    }
    box(group, [0.24, 0.1, 0.47], [0, 0.6, 0.12], P.chassis, 0.018);
    strip(group, [0.055, 0.014, 0.28], [0, 0.66, 0.12], rankColor, rank === 6);
    axial(group, 0.026, 0.08, [0, 0.15, 1.06], 0xffb168);
    return [0, 0.36, 1.16];
  }
  if (kind === "frostgun") {
    receiver(
      group,
      0.48,
      [
        [-0.25, 0.15],
        [0.67, 0.2],
        [0.79, 0.36],
        [0.57, 0.6],
        [-0.19, 0.6],
        [-0.32, 0.38],
      ],
      P.ceramic,
      0.023,
    );
    receiver(
      group,
      0.34,
      [
        [0.37, 0.19],
        [0.89, 0.2],
        [1.03, 0.35],
        [0.9, 0.5],
        [0.37, 0.53],
      ],
      0x6e939f,
      0.02,
    );
    for (const side of [-1, 1]) {
      axial(group, 0.11, 0.38, [side * 0.235, 0.35, 0.8], P.steel, 0.08, 12);
      strip(
        group,
        [0.026, 0.08, 0.42],
        [side * 0.266, 0.365, 0.2],
        0x99dce8,
        true,
      );
    }
    axial(group, 0.155, 0.055, [0, 0.35, 1.052], P.recess, 0.155, 8);
    axial(group, 0.092, 0.012, [0, 0.35, 1.085], 0xa3e5f1, 0.092, 8).material =
      optical(0xa3e5f1);
    rankInset(group, rank, 0.271, 0.49, -0.05);
    return [0, 0.35, 1.13];
  }
  if (kind === "needle") {
    receiver(
      group,
      0.33,
      [
        [-0.26, 0.16],
        [0.55, 0.19],
        [0.74, 0.35],
        [0.49, 0.48],
        [-0.2, 0.52],
      ],
      0x789574,
      0.022,
    );
    axial(group, 0.075, 0.84, [0, 0.325, 0.78], P.steel);
    axial(group, 0.1, 0.1, [0, 0.325, 0.83], P.chassis, 0.1, 12);
    bore(group, 0, 0.325, 1.21, 0.079);
    cylinder(group, 0.13, 0.42, [0.25, 0.22, 0.1], 0xb4bf78, 12);
    cylinder(group, 0.14, 0.08, [0.25, 0.47, 0.1], P.chassis, 12);
    cylinder(group, 0.14, 0.06, [0.25, -0.015, 0.1], P.chassis, 12);
    strip(group, [0.09, 0.24, 0.014], [0.25, 0.22, 0.237], 0x6be59a);
    sight(group, 0.58, -0.13, 0.51);
    rankInset(group, rank, 0.196, 0.325, -0.06);
    return [0, 0.325, 1.26];
  }
  if (kind === "railgun") {
    receiver(
      group,
      0.39,
      [
        [-0.3, 0.16],
        [0.63, 0.17],
        [0.77, 0.32],
        [0.55, 0.56],
        [-0.25, 0.56],
      ],
      P.chassis,
      0.022,
    );
    receiver(
      group,
      0.42,
      [
        [-0.21, 0.4],
        [0.4, 0.4],
        [0.52, 0.55],
        [-0.21, 0.59],
      ],
      0xc9b78c,
      0.018,
    );
    for (const side of [-1, 1]) {
      receiver(
        group,
        0.1,
        [
          [0.33, 0.21],
          [1.31, 0.26],
          [1.41, 0.37],
          [1.31, 0.44],
          [0.33, 0.49],
        ],
        P.steel,
      ).position.x = side * 0.14;
      strip(
        group,
        [0.022, 0.035, 0.86],
        [side * 0.076, 0.35, 0.87],
        0xeac477,
        true,
      );
    }
    box(group, [0.38, 0.29, 0.09], [0, 0.35, 1.31], P.chassis, 0.018);
    box(group, [0.17, 0.075, 0.012], [0, 0.35, 1.362], 0xefe1b5, 0.006);
    axial(group, 0.072, 0.4, [0, 0.72, 0], P.chassis);
    axial(group, 0.052, 0.01, [0, 0.72, 0.208], 0x97cac7).material =
      optical(0x97cac7);
    box(group, [0.07, 0.14, 0.13], [0, 0.59, 0], P.steel, 0.012);
    rankInset(group, rank, 0.239, 0.305, 0.02);
    return [0, 0.35, 1.42];
  }
  if (kind === "beam") {
    // Beam emitter: a wide lens and a single suspended barrel inside a closed frame.
    receiver(
      group,
      0.4,
      [
        [-0.28, 0.14],
        [0.57, 0.16],
        [0.7, 0.32],
        [0.49, 0.58],
        [-0.23, 0.58],
      ],
      0x9f93b2,
      0.025,
    );
    axial(group, 0.16, 0.72, [0, 0.35, 0.66], P.chassis, 0.16, 12);
    for (const side of [-1, 1]) {
      receiver(
        group,
        0.09,
        [
          [0.24, 0.15],
          [1.01, 0.19],
          [1.14, 0.35],
          [1.01, 0.53],
          [0.24, 0.58],
        ],
        P.ceramic,
        0.014,
      ).position.x = side * 0.2;
      strip(
        group,
        [0.015, 0.035, 0.49],
        [side * 0.255, 0.36, 0.7],
        0xd1b6ee,
        true,
      );
    }
    axial(group, 0.195, 0.07, [0, 0.35, 1.1], P.steel, 0.195, 12);
    axial(group, 0.143, 0.014, [0, 0.35, 1.144], 0xd0b2e7, 0.143, 16).material =
      optical(0xd0b2e7);
    rankInset(group, rank, 0.229, 0.31, -0.04);
    return [0, 0.35, 1.19];
  }
  // Safe generic sidearm: an unknown id never borrows another weapon's silhouette.
  receiver(
    group,
    0.3,
    [
      [-0.22, 0.16],
      [0.48, 0.16],
      [0.58, 0.3],
      [0.5, 0.46],
      [-0.18, 0.46],
    ],
    P.chassis,
    0.022,
  );
  axial(group, 0.07, 0.3, [0, 0.3, 0.68], P.steel);
  bore(group, 0, 0.3, 0.83, 0.084);
  rankInset(group, rank, 0.181, 0.26, 0.1);
  return [0, 0.3, 0.9];
}

function droneModel(group: THREE.Group, kind: string, rank: number): number[] {
  const expansion = DRONE_BUILDERS[kind];
  if (expansion) return [...expansion(group, rank)];
  const tint =
    kind in ITEMS
      ? new THREE.Color(ITEMS[kind as keyof typeof ITEMS].color).getHex()
      : 0xb9c7cc;
  if (kind === "orbit_drone") {
    // Disc cutter: three connected curved blades surround a low, armoured hub.
    cylinder(group, 0.3, 0.2, [0, 0, 0], P.chassis, 16, 0.25);
    cylinder(group, 0.23, 0.1, [0, 0.16, 0], 0xb8acc9, 12, 0.16);
    for (let i = 0; i < 3; i++) {
      const cutter = plate(
        group,
        [
          [0.14, 0.05],
          [0.39, 0.18],
          [0.79, 0.04],
          [0.57, -0.19],
          [0.27, -0.23],
        ],
        0.055,
        [0, 0, 0],
        P.edge,
        0.011,
      );
      cutter.quaternion.setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2,
      );
      cutter.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          (i * Math.PI * 2) / 3,
        ),
      );
    }
    cylinder(
      group,
      0.11,
      0.015,
      [0, 0.225, 0],
      new THREE.Color(RANKS[rank - 1].color).getHex(),
      12,
    );
    thruster(group, 0, 0, tint, -0.17);
    return [0, 0, 0.65];
  }
  const hullColor =
    kind === "gun_drone"
      ? 0xc2aa83
      : kind === "shock_drone"
        ? 0x91b7ba
        : kind === "repair_drone"
          ? 0xc5d4bc
          : 0xb7a780;
  droneHull(group, hullColor, tint);
  if (kind === "gun_drone") {
    axial(group, 0.115, 0.74, [0, -0.14, 0.36], P.steel);
    receiver(
      group,
      0.26,
      [
        [-0.09, -0.3],
        [0.41, -0.3],
        [0.55, -0.17],
        [0.37, -0.01],
        [-0.09, -0.01],
      ],
      hullColor,
      0.018,
    );
    bore(group, 0, -0.14, 0.76, 0.125);
    axial(
      group,
      0.13,
      0.14,
      [0.23, -0.13, 0.04],
      P.chassis,
      0.13,
      12,
    ).rotation.y = Math.PI / 2;
  } else if (kind === "shock_drone") {
    for (const side of [-1, 1]) {
      cylinder(group, 0.053, 0.38, [side * 0.24, 0.4, 0.07], P.steel, 12);
      for (const y of [0.28, 0.4, 0.52])
        cylinder(group, 0.105, 0.05, [side * 0.24, y, 0.07], 0x84a5ab, 12);
      cylinder(group, 0.085, 0.09, [side * 0.24, 0.6, 0.07], P.edge, 12, 0.045);
    }
  } else if (kind === "repair_drone") {
    for (const side of [-1, 1]) {
      cylinder(group, 0.13, 0.38, [side * 0.17, -0.25, 0.04], 0x98b999, 12);
      cylinder(group, 0.138, 0.08, [side * 0.17, -0.45, 0.04], P.chassis, 12);
      strip(group, [0.055, 0.19, 0.015], [side * 0.17, -0.24, 0.18], 0xcde4c3);
    }
    medicalMark(group, [0, 0.197, 0.294], 0.8);
  } else if (kind === "magnet_drone") {
    // Collector has a lowered, open magnetic fork — immediately distinct from a gun.
    box(group, [0.5, 0.16, 0.15], [0, -0.2, 0.2], P.steel, 0.025);
    for (const side of [-1, 1]) {
      receiver(
        group,
        0.135,
        [
          [0.18, -0.3],
          [0.68, -0.3],
          [0.76, -0.17],
          [0.68, -0.11],
          [0.18, -0.12],
        ],
        hullColor,
        0.017,
      ).position.x = side * 0.22;
      box(
        group,
        [0.15, 0.14, 0.1],
        [side * 0.22, -0.2, 0.74],
        side < 0 ? 0xb47265 : 0x80adb8,
        0.018,
      );
    }
  } else {
    // Generic hull for an unknown drone id: a sensor pod, nothing borrowed.
    box(group, [0.22, 0.12, 0.3], [0, 0.36, 0.02], P.steel, 0.02);
    axial(group, 0.06, 0.12, [0, 0.36, 0.22], P.recess, 0.05, 12);
  }
  rankInset(group, rank, 0.275, 0.052, -0.02);
  return [
    0,
    kind === "gun_drone" ? -0.14 : 0,
    kind === "gun_drone" ? 0.83 : 0.52,
  ];
}

function itemModel(group: THREE.Group, kind: string, rank: number) {
  const expansion = ITEM_BUILDERS[kind];
  if (expansion) {
    expansion(group, rank);
    return;
  }
  const tint =
    kind in ITEMS
      ? new THREE.Color(ITEMS[kind as keyof typeof ITEMS].color).getHex()
      : 0x99c7a2;
  if (kind === "plating") {
    const shield: Point[] = [
      [-0.46, 0.44],
      [0.46, 0.44],
      [0.49, 0.05],
      [0.32, -0.36],
      [0, -0.55],
      [-0.32, -0.36],
      [-0.49, 0.05],
    ];
    plate(group, shield, 0.2, [0, 0, 0], P.chassis, 0.035);
    plate(
      group,
      shield.map(([x, y]) => [x * 0.86, y * 0.86] as Point),
      0.09,
      [0, 0.01, 0.16],
      P.ceramic,
      0.025,
    );
    plate(
      group,
      [
        [-0.28, 0.3],
        [0.28, 0.3],
        [0.27, -0.03],
        [0, -0.25],
        [-0.27, -0.03],
      ],
      0.027,
      [0, 0, 0.224],
      0x8ca782,
      0.013,
    );
    moduleBadge(group, rank, [0, 0.16, 0.25]);
  } else if (kind === "stride") {
    // Twin servo pistons and an integrated ankle yoke communicate movement hardware.
    for (const side of [-1, 1]) {
      canister(group, side * 0.26, 0.08, 0, 0x839d99, 0.105, 0.53);
      cylinder(group, 0.055, 0.34, [side * 0.26, -0.32, 0], P.edge, 12);
    }
    box(group, [0.74, 0.17, 0.27], [0, 0.45, 0], P.chassis, 0.033);
    box(group, [0.73, 0.16, 0.37], [0, -0.49, 0.05], P.ceramic, 0.03);
    axial(group, 0.22, 0.22, [0, -0.02, 0.055], P.chassis, 0.22, 12);
    axial(group, 0.125, 0.04, [0, -0.02, 0.185], 0xa5cfc5, 0.125, 12);
    moduleBadge(group, rank, [0, 0.46, 0.154]);
  } else if (kind === "magnet") {
    plate(
      group,
      [
        [-0.46, 0.43],
        [-0.2, 0.43],
        [-0.2, -0.12],
        [-0.12, -0.22],
        [0.12, -0.22],
        [0.2, -0.12],
        [0.2, 0.43],
        [0.46, 0.43],
        [0.46, -0.24],
        [0.25, -0.48],
        [-0.25, -0.48],
        [-0.46, -0.24],
      ],
      0.25,
      [0, 0, 0],
      0xad9365,
      0.025,
    );
    for (const side of [-1, 1])
      box(
        group,
        [0.295, 0.2, 0.285],
        [side * 0.33, 0.36, 0],
        side < 0 ? 0xbb7f70 : 0x7dabbc,
        0.018,
      );
    moduleBadge(group, rank, [0, -0.345, 0.157]);
  } else if (kind === "mending" || kind === "heal") {
    box(group, [0.8, 0.69, 0.36], [0, -0.02, 0], P.chassis, 0.055);
    box(group, [0.7, 0.6, 0.17], [0, 0, 0.22], 0x8faa8c, 0.04);
    plate(
      group,
      [
        [-0.23, 0.29],
        [-0.23, 0.48],
        [-0.15, 0.56],
        [0.15, 0.56],
        [0.23, 0.48],
        [0.23, 0.29],
        [0.135, 0.29],
        [0.135, 0.42],
        [-0.135, 0.42],
        [-0.135, 0.29],
      ],
      0.12,
      [0, 0, 0],
      P.steel,
      0.012,
    );
    medicalMark(group, [0, 0.045, 0.325], 1.6);
    for (const x of [-0.31, 0.31])
      box(group, [0.095, 0.14, 0.43], [x, -0.12, 0.035], P.chassis, 0.012);
    moduleBadge(group, rank, [0, -0.21, 0.325]);
  } else if (kind === "vitality") {
    // The paired chambers, manifold and monitor make this a mechanical second heart.
    canister(group, -0.23, 0, 0, 0xbb7d84, 0.2, 0.6);
    canister(group, 0.23, 0.06, 0, 0xd59b9c, 0.2, 0.6);
    box(group, [0.64, 0.16, 0.24], [0, -0.35, 0], P.steel, 0.026);
    box(group, [0.46, 0.25, 0.18], [0, 0.02, 0.22], P.chassis, 0.026);
    strip(group, [0.3, 0.1, 0.015], [0, 0.02, 0.32], 0xdab0a9);
    medicalMark(group, [0, 0.027, 0.335], 0.55);
    moduleBadge(group, rank, [0, -0.35, 0.147]);
  } else if (kind === "power") {
    // Contained reactor: warm ceramic core inside four anchored protection ribs.
    canister(group, 0, 0, 0, 0xd9915f, 0.26, 0.65);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x = Math.cos(angle) * 0.31,
        z = Math.sin(angle) * 0.31;
      box(group, [0.09, 0.82, 0.09], [x, 0, z], P.steel, 0.017);
    }
    for (const y of [-0.41, 0.41])
      cylinder(group, 0.38, 0.095, [0, y, 0], P.chassis, 12);
    strip(group, [0.095, 0.36, 0.022], [0, 0, 0.271], 0xf7ad68, true);
    moduleBadge(group, rank, [0, -0.41, 0.37]);
  } else if (kind === "haste") {
    axial(group, 0.45, 0.25, [0, 0, 0], P.chassis, 0.45, 16);
    axial(group, 0.38, 0.08, [0, 0, 0.17], 0xb49d68, 0.38, 16);
    axial(group, 0.3, 0.024, [0, 0, 0.225], P.recess, 0.3, 16);
    torus(group, 0.23, 0.035, [0, 0, 0.255], 0xdcc792);
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const spoke = strip(
        group,
        [0.045, 0.26, 0.04],
        [Math.sin(angle) * 0.12, Math.cos(angle) * 0.12, 0.25],
        P.steel,
      );
      spoke.rotation.z = -angle;
    }
    axial(group, 0.09, 0.055, [0, 0, 0.265], 0xe2cea0, 0.09, 12);
    box(group, [0.27, 0.11, 0.16], [0, 0.47, 0], P.steel, 0.016);
    moduleBadge(group, rank, [0, -0.38, 0.23]);
  } else if (kind === "focus") {
    axial(group, 0.41, 0.37, [0, 0, 0], P.chassis, 0.36, 12);
    axial(group, 0.37, 0.085, [0, 0, 0.21], 0x9098b2, 0.37, 12);
    axial(group, 0.29, 0.012, [0, 0, 0.26], P.recess, 0.29, 12);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const vane = plate(
        group,
        [
          [-0.035, 0.1],
          [0.08, 0.1],
          [0.15, 0.25],
          [0.05, 0.23],
        ],
        0.025,
        [0, 0, 0.285],
        0xa8b8d0,
        0.006,
      );
      vane.rotation.z = a;
    }
    axial(group, 0.115, 0.075, [0, 0, 0.31], 0xc6cdec, 0.07, 12);
    for (const x of [-0.34, 0.34])
      box(group, [0.15, 0.43, 0.14], [x, -0.03, -0.07], P.steel, 0.025);
    moduleBadge(group, rank, [0, -0.355, 0.28]);
  } else if (kind === "kinetic_core") {
    // A flywheel set in a two-piece bearing bracket.
    torus(group, 0.36, 0.085, [0, 0, 0], 0xb59a70);
    axial(group, 0.14, 0.35, [0, 0, 0], P.steel, 0.14, 12);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const spoke = box(
        group,
        [0.11, 0.28, 0.115],
        [Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0],
        P.steel,
        0.012,
      );
      spoke.rotation.z = -a;
    }
    for (const x of [-0.42, 0.42])
      box(group, [0.15, 0.52, 0.31], [x, -0.07, 0], P.chassis, 0.023);
    box(group, [0.85, 0.16, 0.33], [0, -0.39, 0], P.chassis, 0.025);
    moduleBadge(group, rank, [0, -0.39, 0.18]);
  } else if (kind === "thermal_core") {
    box(group, [0.47, 0.71, 0.37], [0, 0, 0], 0xa3644c, 0.045);
    for (const y of [-0.28, -0.14, 0, 0.14, 0.28])
      box(group, [0.8, 0.05, 0.57], [0, y, 0], P.steel, 0.009);
    for (const x of [-0.25, 0.25])
      cylinder(group, 0.052, 0.81, [x, 0, 0.24], 0xc19569, 10);
    strip(group, [0.06, 0.47, 0.021], [0, 0, 0.3], 0xf2a072, true);
    moduleBadge(group, rank, [0, -0.37, 0.2]);
  } else if (kind === "storm_core") {
    cylinder(group, 0.14, 0.8, [0, 0, 0], P.chassis, 12);
    for (const y of [-0.25, -0.125, 0, 0.125, 0.25])
      cylinder(group, 0.31, 0.055, [0, y, 0], 0x8ca8a9, 16);
    for (const y of [-0.43, 0.43])
      cylinder(group, 0.28, 0.13, [0, y, 0], P.chassis, 12, 0.23);
    cylinder(group, 0.14, 0.16, [0, 0.57, 0], 0xd4dcd5, 12, 0.08);
    strip(group, [0.045, 0.4, 0.02], [0, 0, 0.321], 0x9bdddf, true);
    moduleBadge(group, rank, [0, -0.43, 0.276]);
  } else if (kind === "frost_core") {
    canister(group, 0, 0, 0, 0x85afbd, 0.27, 0.76);
    for (const side of [-1, 1])
      box(group, [0.11, 0.71, 0.21], [side * 0.285, 0, 0], P.ceramic, 0.024);
    strip(group, [0.13, 0.48, 0.025], [0, 0.02, 0.279], 0xb6e1e7);
    for (const y of [-0.12, 0, 0.12])
      strip(group, [0.09, 0.022, 0.015], [0, y, 0.3], P.steel);
    cylinder(group, 0.11, 0.07, [0, 0.55, 0], 0x617a87, 12);
    moduleBadge(group, rank, [0, -0.38, 0.293]);
  } else if (kind === "toxic_core") {
    for (const side of [-1, 1])
      canister(group, side * 0.22, 0, 0, 0x98a66c, 0.155, 0.67);
    box(group, [0.71, 0.115, 0.32], [0, -0.39, 0], P.chassis, 0.019);
    box(group, [0.66, 0.11, 0.29], [0, 0.45, 0], P.steel, 0.018);
    plate(
      group,
      [
        [0, 0.18],
        [0.17, -0.11],
        [-0.17, -0.11],
      ],
      0.045,
      [0, 0.03, 0.215],
      0xd4cc85,
      0.01,
    );
    strip(group, [0.028, 0.11, 0.018], [0, 0.03, 0.251], P.chassis);
    moduleBadge(group, rank, [0, -0.38, 0.19]);
  } else if (kind === "drone_core") {
    // A radio/controller card with one integral ceramic antenna and pin connector.
    box(group, [0.66, 0.7, 0.2], [0, 0, 0], P.chassis, 0.035);
    box(group, [0.54, 0.52, 0.065], [0, 0.035, 0.145], 0x817897, 0.019);
    box(group, [0.245, 0.245, 0.055], [-0.055, 0.035, 0.21], P.recess, 0.014);
    strip(group, [0.135, 0.035, 0.015], [-0.055, 0.035, 0.248], 0xc7b1e9, true);
    for (let i = 0; i < 4; i++)
      box(
        group,
        [0.065, 0.16, 0.07],
        [-0.165 + i * 0.11, -0.398, 0],
        P.brass,
        0.009,
      );
    cylinder(group, 0.035, 0.34, [0.24, 0.51, 0], P.steel, 10);
    cylinder(group, 0.055, 0.22, [0.24, 0.66, 0], P.ceramic, 10);
    moduleBadge(group, rank, [0, -0.25, 0.172]);
  } else {
    // Visible safe fallback for review tools; unknown ids never create invalid geometry.
    box(group, [0.65, 0.65, 0.3], [0, 0, 0], P.chassis, 0.06);
    plate(
      group,
      [
        [0, 0.23],
        [0.23, 0],
        [0, -0.23],
        [-0.23, 0],
      ],
      0.055,
      [0, 0, 0.185],
      tint,
    );
    moduleBadge(group, rank, [0, 0, 0.231]);
  }
}

export function makeEquipment(kind: string, level = 1): THREE.Group {
  const group = new THREE.Group();
  const rank = Number.isFinite(level)
    ? THREE.MathUtils.clamp(Math.floor(level), 1, RANKS.length)
    : 1;
  group.name = `equipment-${kind}`;
  group.userData.kind = kind;
  group.userData.level = rank;
  group.userData.grip = new THREE.Vector3();
  if (kind in WEAPONS || kind in WEAPON_BUILDERS) {
    group.userData.weaponId = kind;
    group.userData["weapon-id"] = kind;
    group.userData.muzzle = new THREE.Vector3().fromArray(
      weaponModel(group, kind, rank),
    );
  } else if (
    kind in DRONE_BUILDERS ||
    (kind in ITEMS && ITEMS[kind as keyof typeof ITEMS].category === "drone")
  ) {
    group.userData.muzzle = new THREE.Vector3().fromArray(
      droneModel(group, kind, rank),
    );
  } else itemModel(group, kind, rank);
  bake(group);
  return group;
}

/** Camera-plane fitting also serves the geometry audit: no subjective scale constants. */
export function equipmentCameraBounds(
  item: THREE.Group,
  camera: THREE.Camera,
): THREE.Box2 {
  item.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const bounds = new THREE.Box2();
  const point = new THREE.Vector3();
  const transform = new THREE.Matrix4();
  item.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    if (!positions) return;
    transform.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      bounds.expandByPoint(new THREE.Vector2(point.x, point.y));
    }
  });
  return bounds;
}

export function equipmentPortraits(): Record<string, string> {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(384, 264);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const studio = pmrem.fromScene(room, 0.04);
  scene.environment = studio.texture;
  scene.environmentIntensity = 0.38;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe7eff0, 0x39434d, 2));
  const key = new THREE.DirectionalLight(0xfff3e5, 3.2);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb1c7df, 2.1);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.1, -1.1, 0.1, 30);
  camera.position.set(3.3, 2.1, 4.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const art: Record<string, string> = {};
  const occupancy = 0.77;
  const aspect = 384 / 264;
  for (const kind of [...Object.keys(WEAPONS), ...Object.keys(ITEMS), "heal"]) {
    const item = makeEquipment(kind);
    // Broadside enough to read gun receivers; a gentler angle keeps item symbols visible.
    item.rotation.y =
      kind in WEAPONS && kind !== "blade" && kind !== "boomerang"
        ? -0.43
        : -0.15;
    scene.add(item);
    const bounds = equipmentCameraBounds(item, camera);
    const center = bounds.getCenter(new THREE.Vector2());
    const size = bounds.getSize(new THREE.Vector2());
    const halfHeight =
      Math.max(size.y, size.x / aspect, 0.01) / (2 * occupancy);
    camera.left = center.x - halfHeight * aspect;
    camera.right = center.x + halfHeight * aspect;
    camera.top = center.y + halfHeight;
    camera.bottom = center.y - halfHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    art[kind] = renderer.domElement.toDataURL("image/png");
    scene.remove(item);
  }
  studio.dispose();
  renderer.dispose();
  // dispose() frees the GPU objects; the context itself only goes away with
  // forceContextLoss, and browsers cap live contexts at roughly sixteen.
  renderer.forceContextLoss();
  return art;
}
