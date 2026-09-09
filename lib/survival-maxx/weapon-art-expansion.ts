import * as THREE from "three";
import {
  axial,
  bore,
  canister,
  grip,
  optical,
  P,
  plate,
  rankColor,
  rankInset,
  receiver,
  sight,
  strip,
} from "./equipment-parts";
import { box, cylinder, material, torus } from "./geometry";

// Expansion weapons. Every builder draws a hand weapon with its grip centred
// on the origin and its bore along +Z, then returns the muzzle point. Rank
// insets are installed exactly like the core set so ranks 1-6 read the same.
export type WeaponBuilder = (
  group: THREE.Group,
  rank: number,
) => [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** Cylinder whose axis is pitched `angle` radians above +Z (muzzle end is `top`). */
function tilted(
  group: THREE.Group,
  radius: number,
  length: number,
  base: readonly [number, number, number],
  along: number,
  angle: number,
  color: number,
  top = radius,
  segments = 16,
) {
  const axis = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
  const centre = new THREE.Vector3(...base).addScaledVector(
    axis,
    along + length / 2,
  );
  const mesh = cylinder(
    group,
    radius,
    length,
    centre.toArray(),
    color,
    segments,
    top,
  );
  mesh.quaternion.setFromUnitVectors(UP, axis);
  return mesh;
}

/** Smooth glass sphere kept as its own optical draw. */
function glassOrb(
  group: THREE.Group,
  radius: number,
  at: readonly [number, number, number],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 2),
    optical(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function ball(
  group: THREE.Group,
  radius: number,
  at: readonly [number, number, number],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    material(color),
  );
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export const WEAPON_BUILDERS: Record<string, WeaponBuilder> = {
  pinball(group, rank) {
    // Drum-fed ball launcher: a brass ball shows through both drum windows.
    grip(group);
    receiver(
      group,
      0.32,
      [
        [-0.22, 0.16],
        [0.5, 0.16],
        [0.62, 0.3],
        [0.55, 0.46],
        [-0.18, 0.46],
        [-0.24, 0.38],
      ],
      0x8d7a5a,
      0.022,
    );
    const drum = cylinder(group, 0.19, 0.3, [0, 0.55, 0.1], P.chassis, 16);
    drum.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const window = cylinder(
        group,
        0.13,
        0.024,
        [side * 0.158, 0.55, 0.1],
        P.recess,
        16,
      );
      window.rotation.z = Math.PI / 2;
      ball(group, 0.085, [side * 0.11, 0.55, 0.1], P.brass);
    }
    box(group, [0.12, 0.14, 0.2], [0, 0.42, 0.36], P.steel, 0.012);
    axial(group, 0.1, 0.42, [0, 0.3, 0.72], P.steel);
    bore(group, 0, 0.3, 0.92, 0.115);
    strip(
      group,
      [0.05, 0.02, 0.2],
      [0, 0.745, 0.1],
      rankColor(rank),
      rank === 6,
    );
    rankInset(group, rank, 0.191, 0.27, -0.02);
    return [0, 0.3, 0.97];
  },
  thumper(group, rank) {
    // Piston hammer: an accumulator drives a rod into a wide ribbed foot plate.
    grip(group, true);
    receiver(
      group,
      0.4,
      [
        [-0.28, 0.16],
        [0.4, 0.16],
        [0.5, 0.3],
        [0.42, 0.56],
        [-0.22, 0.56],
        [-0.3, 0.4],
      ],
      P.chassis,
      0.025,
    );
    axial(group, 0.17, 0.5, [0, 0.36, 0.6], 0x8a6e52, 0.17, 12);
    axial(group, 0.08, 0.5, [0, 0.36, 1.0], P.steel);
    for (const side of [-1, 1])
      axial(group, 0.03, 0.62, [side * 0.2, 0.5, 0.55], P.brass, 0.03, 8);
    plate(
      group,
      [
        [-0.3, -0.26],
        [0.3, -0.26],
        [0.36, 0],
        [0.3, 0.26],
        [-0.3, 0.26],
        [-0.36, 0],
      ],
      0.1,
      [0, 0.36, 1.28],
      P.steel,
      0.02,
    );
    for (const y of [-0.12, 0.12])
      strip(group, [0.5, 0.05, 0.03], [0, 0.36 + y, 1.34], P.recess);
    cylinder(group, 0.09, 0.2, [0, 0.66, 0.1], P.steel, 12);
    strip(
      group,
      [0.06, 0.02, 0.3],
      [0, 0.59, 0.15],
      rankColor(rank),
      rank === 6,
    );
    rankInset(group, rank, 0.234, 0.3, -0.05);
    return [0, 0.36, 1.36];
  },
  mortar(group, rank) {
    // Lobber: a stubby tube pitched 30 degrees up on a folding bipod.
    const pitch = Math.PI / 6;
    const base = [0, 0.38, 0.2] as const;
    grip(group, true);
    receiver(
      group,
      0.36,
      [
        [-0.28, 0.16],
        [0.36, 0.16],
        [0.46, 0.3],
        [0.34, 0.5],
        [-0.22, 0.5],
        [-0.3, 0.38],
      ],
      P.chassis,
      0.024,
    );
    tilted(group, 0.17, 0.7, base, 0, pitch, 0x6f7d66, 0.17, 16);
    tilted(group, 0.19, 0.09, base, 0.615, pitch, P.steel, 0.19, 16);
    tilted(group, 0.13, 0.012, base, 0.706, pitch, P.recess, 0.13, 16);
    tilted(group, 0.19, 0.08, base, -0.06, pitch, P.steel, 0.19, 16);
    box(group, [0.5, 0.08, 0.08], [0, 0.42, 0.55], P.steel, 0.012);
    for (const side of [-1, 1]) {
      const leg = box(
        group,
        [0.05, 0.5, 0.05],
        [side * 0.2, 0.17, 0.55],
        P.steel,
        0.01,
      );
      leg.rotation.z = -side * 0.35;
      box(group, [0.1, 0.05, 0.1], [side * 0.3, -0.07, 0.55], P.rubber, 0.01);
    }
    box(group, [0.08, 0.14, 0.06], [0.15, 0.6, -0.02], P.chassis, 0.01);
    strip(
      group,
      [0.05, 0.02, 0.24],
      [0, 0.53, -0.05],
      rankColor(rank),
      rank === 6,
    );
    rankInset(group, rank, 0.213, 0.28, -0.05);
    return [0, 0.38 + Math.sin(pitch) * 0.7, 0.2 + Math.cos(pitch) * 0.7];
  },
  flare(group, rank) {
    // Flare pistol: break-action hinge, a wide short bore and a slung canister.
    grip(group);
    receiver(
      group,
      0.3,
      [
        [-0.2, 0.16],
        [0.36, 0.16],
        [0.44, 0.3],
        [0.36, 0.44],
        [-0.16, 0.44],
        [-0.22, 0.36],
      ],
      0xc4603f,
      0.022,
    );
    axial(group, 0.16, 0.34, [0, 0.32, 0.55], P.steel, 0.15, 12);
    bore(group, 0, 0.32, 0.72, 0.17, 0xc4603f);
    const hinge = cylinder(group, 0.06, 0.36, [0, 0.24, 0.32], P.steel, 12);
    hinge.rotation.z = Math.PI / 2;
    canister(group, 0, 0.05, 0.5, 0xd9d0b0, 0.09, 0.28);
    sight(group, 0.49, -0.08, 0.38);
    rankInset(group, rank, 0.181, 0.27, 0.05);
    return [0, 0.32, 0.8];
  },
  skyfall(group, rank) {
    // Skyfall: an antenna dish on a short grip; the strike is called from the dish centre.
    grip(group);
    receiver(
      group,
      0.3,
      [
        [-0.2, 0.16],
        [0.3, 0.16],
        [0.36, 0.28],
        [0.3, 0.44],
        [-0.16, 0.44],
        [-0.22, 0.36],
      ],
      P.chassis,
      0.022,
    );
    axial(group, 0.05, 0.3, [0, 0.4, 0.4], P.steel);
    axial(group, 0.12, 0.16, [0, 0.4, 0.6], 0xd8ded5, 0.42, 16);
    axial(group, 0.36, 0.02, [0, 0.4, 0.685], P.recess, 0.36, 16);
    axial(group, 0.04, 0.3, [0, 0.4, 0.8], P.steel);
    torus(group, 0.09, 0.02, [0, 0.4, 0.93], P.edge);
    axial(group, 0.05, 0.03, [0, 0.4, 0.955], 0x9fd4ff).material =
      optical(0x9fd4ff);
    for (const side of [-1, 1])
      cylinder(group, 0.02, 0.3, [side * 0.1, 0.55, -0.1], P.edge, 8);
    strip(group, [0.1, 0.02, 0.2], [0, 0.47, 0.1], 0x9fd4ff, true);
    rankInset(group, rank, 0.181, 0.27, 0);
    return [0, 0.4, 0.72];
  },
  tesla_orb(group, rank) {
    // Tesla orb: twin copper-wound forks cradle a glass discharge sphere.
    grip(group);
    receiver(
      group,
      0.34,
      [
        [-0.22, 0.16],
        [0.34, 0.16],
        [0.44, 0.3],
        [0.36, 0.5],
        [-0.18, 0.5],
        [-0.26, 0.38],
      ],
      P.ceramic,
      0.024,
    );
    for (const side of [-1, 1]) {
      axial(group, 0.05, 0.6, [side * 0.16, 0.36, 0.7], P.steel);
      for (const z of [0.5, 0.6, 0.7])
        axial(group, 0.085, 0.05, [side * 0.16, 0.36, z], 0xb08a5a, 0.085, 12);
      const tip = cylinder(
        group,
        0.04,
        0.1,
        [side * 0.19, 0.36, 0.95],
        P.edge,
        12,
      );
      tip.rotation.z = Math.PI / 2;
    }
    axial(group, 0.1, 0.1, [0, 0.36, 0.78], P.chassis, 0.14, 12);
    glassOrb(group, 0.17, [0, 0.36, 0.95], 0x8ce6f0);
    strip(group, [0.08, 0.02, 0.3], [0, 0.53, 0.05], 0x8ce6f0, true);
    rankInset(group, rank, 0.203, 0.3, -0.02);
    return [0, 0.36, 1.13];
  },
  halo(group, rank) {
    // Ice halo: a ring emitter with six frost nodes; the shot leaves through the ring.
    grip(group);
    receiver(
      group,
      0.3,
      [
        [-0.2, 0.16],
        [0.3, 0.16],
        [0.38, 0.3],
        [0.3, 0.46],
        [-0.16, 0.46],
        [-0.22, 0.38],
      ],
      P.ceramic,
      0.022,
    );
    axial(group, 0.05, 0.3, [0, 0.2, 0.47], P.steel);
    torus(group, 0.36, 0.06, [0, 0.56, 0.62], 0x7fb9cf);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const node = box(
        group,
        [0.07, 0.07, 0.14],
        [Math.sin(a) * 0.36, 0.56 + Math.cos(a) * 0.36, 0.62],
        0xcfeaf5,
        0.01,
      );
      node.rotation.z = -a;
    }
    strip(group, [0.08, 0.02, 0.24], [0, 0.49, 0.05], 0xa9e3f5, true);
    rankInset(group, rank, 0.181, 0.28, 0);
    return [0, 0.56, 0.7];
  },
  gravity(group, rank) {
    // Gravity well: a compact cannon with three field rings clamped around the barrel.
    grip(group);
    receiver(
      group,
      0.36,
      [
        [-0.24, 0.16],
        [0.42, 0.16],
        [0.52, 0.32],
        [0.42, 0.52],
        [-0.2, 0.52],
        [-0.28, 0.4],
      ],
      0x4d4a66,
      0.024,
    );
    axial(group, 0.1, 0.7, [0, 0.34, 0.8], P.chassis, 0.1, 12);
    for (const z of [0.62, 0.8, 0.98])
      torus(group, 0.2, 0.045, [0, 0.34, z], 0x8f86b8);
    for (const y of [0.14, 0.54])
      box(group, [0.06, 0.08, 0.5], [0, y, 0.8], 0x8f86b8, 0.01);
    axial(group, 0.13, 0.06, [0, 0.34, 1.16], P.steel, 0.13, 12);
    axial(group, 0.09, 0.012, [0, 0.34, 1.196], 0xb59df0, 0.09, 12).material =
      optical(0xb59df0);
    strip(group, [0.07, 0.02, 0.28], [0, 0.55, 0.05], 0xb59df0, true);
    rankInset(group, rank, 0.213, 0.3, -0.04);
    return [0, 0.34, 1.21];
  },
  spore_mine(group, rank) {
    // Spore mine: a drum dispenser feeds a chute; the next mine hangs underneath.
    grip(group);
    receiver(
      group,
      0.36,
      [
        [-0.24, 0.16],
        [0.4, 0.16],
        [0.48, 0.3],
        [0.4, 0.5],
        [-0.2, 0.5],
        [-0.26, 0.4],
      ],
      0x6f8a5a,
      0.024,
    );
    cylinder(group, 0.19, 0.34, [0, 0.62, 0.12], P.chassis, 16);
    cylinder(group, 0.2, 0.05, [0, 0.8, 0.12], P.steel, 16);
    cylinder(group, 0.2, 0.05, [0, 0.47, 0.12], P.steel, 16);
    for (const side of [-1, 1])
      strip(group, [0.03, 0.2, 0.03], [side * 0.19, 0.62, 0.12], 0xa9c96f);
    axial(group, 0.11, 0.4, [0, 0.32, 0.65], P.steel);
    bore(group, 0, 0.32, 0.85, 0.12, 0x6f8a5a);
    cylinder(group, 0.14, 0.08, [0, 0.1, 0.62], 0xa9c96f, 12);
    cylinder(group, 0.06, 0.04, [0, 0.04, 0.62], P.recess, 12);
    box(group, [0.1, 0.2, 0.08], [0, 0.22, 0.62], P.chassis, 0.01);
    strip(group, [0.05, 0.22, 0.03], [0, 0.62, 0.31], 0xa9c96f, true);
    rankInset(group, rank, 0.213, 0.3, -0.06);
    return [0, 0.32, 0.9];
  },
  hive(group, rank) {
    // Hive launcher: a hexagonal pod with seven armed cells.
    grip(group);
    receiver(
      group,
      0.36,
      [
        [-0.26, 0.16],
        [0.36, 0.16],
        [0.44, 0.3],
        [0.36, 0.54],
        [-0.2, 0.54],
        [-0.3, 0.4],
      ],
      0xb08e4a,
      0.024,
    );
    axial(group, 0.26, 0.7, [0, 0.4, 0.55], P.chassis, 0.26, 6);
    for (const z of [0.35, 0.75])
      axial(group, 0.28, 0.06, [0, 0.4, z], P.steel, 0.28, 6);
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI) / 3;
      const x = i < 6 ? Math.sin(a) * 0.15 : 0;
      const y = 0.4 + (i < 6 ? Math.cos(a) * 0.15 : 0);
      axial(group, 0.07, 0.03, [x, y, 0.905], P.recess, 0.07, 6);
      axial(group, 0.04, 0.05, [x, y, 0.915], 0xb08e4a, 0.04, 6);
    }
    box(group, [0.14, 0.08, 0.46], [0, 0.68, 0.47], P.steel, 0.012);
    strip(
      group,
      [0.06, 0.02, 0.32],
      [0, 0.72, 0.47],
      rankColor(rank),
      rank === 6,
    );
    rankInset(group, rank, 0.213, 0.3, -0.06);
    return [0, 0.4, 0.95];
  },
  sentry(group, rank) {
    // Sentry pod: a folded tripod turret carried on its handle.
    grip(group);
    receiver(
      group,
      0.36,
      [
        [-0.24, 0.16],
        [0.3, 0.16],
        [0.38, 0.28],
        [0.3, 0.4],
        [-0.2, 0.4],
        [-0.26, 0.32],
      ],
      P.chassis,
      0.022,
    );
    cylinder(group, 0.2, 0.5, [0, 0.62, 0.25], 0x8a9a7a, 12);
    cylinder(group, 0.21, 0.06, [0, 0.86, 0.25], P.steel, 12);
    cylinder(group, 0.12, 0.1, [0, 0.93, 0.25], P.chassis, 12);
    axial(group, 0.05, 0.03, [0, 0.93, 0.37], 0xff8f5a).material =
      optical(0xff8f5a);
    axial(group, 0.05, 0.4, [0, 0.62, 0.55], P.steel);
    bore(group, 0, 0.62, 0.75, 0.06);
    for (const a of [Math.PI / 3, Math.PI, (Math.PI * 5) / 3]) {
      const leg = box(
        group,
        [0.06, 0.55, 0.06],
        [Math.sin(a) * 0.22, 0.6, 0.25 + Math.cos(a) * 0.22],
        P.steel,
        0.01,
      );
      leg.rotation.y = a;
    }
    rankInset(group, rank, 0.211, 0.26, -0.04);
    return [0, 0.62, 0.8];
  },
  shatter(group, rank) {
    // Shatter cannon: a crystal rides between twin rails behind a faceted tip.
    grip(group, true);
    receiver(
      group,
      0.38,
      [
        [-0.28, 0.16],
        [0.5, 0.17],
        [0.62, 0.32],
        [0.44, 0.54],
        [-0.22, 0.54],
        [-0.3, 0.4],
      ],
      P.chassis,
      0.022,
    );
    for (const side of [-1, 1])
      receiver(
        group,
        0.08,
        [
          [0.3, 0.22],
          [1.1, 0.26],
          [1.18, 0.35],
          [1.1, 0.44],
          [0.3, 0.48],
        ],
        P.steel,
        0.018,
      ).position.x = side * 0.13;
    plate(
      group,
      [
        [0, 0.15],
        [0.06, 0],
        [0, -0.15],
        [-0.06, 0],
      ],
      0.5,
      [0, 0.35, 0.7],
      0xa8e0ea,
      0.01,
    ).material = optical(0xa8e0ea);
    axial(group, 0.11, 0.12, [0, 0.35, 1.0], P.steel, 0.11, 6);
    axial(group, 0.09, 0.22, [0, 0.35, 1.16], 0xa8e0ea, 0.012, 6);
    box(group, [0.16, 0.28, 0.22], [0, 0.06, 0.4], P.steel, 0.014);
    for (const side of [-1, 1])
      strip(group, [0.02, 0.18, 0.16], [side * 0.085, 0.06, 0.4], 0xa8e0ea);
    strip(group, [0.06, 0.02, 0.34], [0, 0.565, 0.05], 0xa8e0ea, true);
    rankInset(group, rank, 0.221, 0.3, -0.06);
    return [0, 0.35, 1.28];
  },
  eclipse(group, rank) {
    // Eclipse: an obsidian long cannon, a floating violet ring and a black
    // event-horizon sphere at the muzzle. Always the top of the roster.
    const violet = 0xb27cff;
    grip(group, true);
    receiver(
      group,
      0.44,
      [
        [-0.34, 0.14],
        [0.62, 0.16],
        [0.78, 0.32],
        [0.6, 0.62],
        [-0.26, 0.62],
        [-0.4, 0.42],
      ],
      0x141018,
      0.028,
    );
    receiver(
      group,
      0.36,
      [
        [-0.2, 0.5],
        [0.5, 0.5],
        [0.58, 0.6],
        [-0.15, 0.66],
      ],
      0x2a1f33,
      0.016,
    );
    axial(group, 0.13, 1.2, [0, 0.38, 1.0], 0x141018, 0.13, 12);
    for (const z of [0.7, 1.0, 1.3])
      axial(group, 0.16, 0.12, [0, 0.38, z], 0x2a1f33, 0.16, 12);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const fin = box(
        group,
        [0.04, 0.12, 0.5],
        [Math.sin(a) * 0.19, 0.38 + Math.cos(a) * 0.19, 1.05],
        0x2a1f33,
        0.008,
      );
      fin.rotation.z = -a;
    }
    torus(group, 0.22, 0.025, [0, 0.38, 0.62], 0x6b4b9a);
    torus(group, 0.3, 0.035, [0, 0.38, 1.45], violet, true);
    glassOrb(group, 0.16, [0, 0.38, 1.64], 0x08060c);
    axial(group, 0.06, 0.5, [0, 0.76, 0.1], 0x2a1f33, 0.06, 12);
    axial(group, 0.045, 0.012, [0, 0.76, 0.356], P.recess, 0.045, 12);
    strip(group, [0.05, 0.02, 0.9], [0, 0.52, 1.0], violet);
    for (const side of [-1, 1])
      strip(
        group,
        [0.02, 0.04, 0.7],
        [side * 0.258, 0.4, 0.2],
        rankColor(rank),
        rank === 6,
      );
    rankInset(group, rank, 0.257, 0.32, -0.08);
    return [0, 0.38, 1.8];
  },
};
