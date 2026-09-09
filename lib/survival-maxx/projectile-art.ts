import * as THREE from "three";
import { WEAPONS, type WeaponId } from "./content";
import { makeEquipment } from "./equipment-art";
import { material } from "./geometry";

/**
 * Projectile looks: a pure registry (no scene import) that names, for every
 * weapon and enemy shot, the instanced shape or pooled group that draws it,
 * its trail, glow and smoke, and the variants a bullet's state switches on.
 * Geometry noses point along local +Z so the scene's `rotation.y = π/2 − angle`
 * keeps aiming them.
 */
export type ShapeClass =
  | "streak"
  | "shard"
  | "ball"
  | "dart"
  | "shell"
  | "pod"
  | "ringlet";
export type ComplexKind = "mine" | "turret" | "ringwave" | "orb" | "singularity";
export type ArtKey =
  | WeaponId
  | "enemy"
  | "enemy-sniper"
  | "enemy-boss"
  | "drone-pistol";
export type VariantKey = "fused" | "returning" | "child" | "stationary" | "grow";

export interface TrailArt {
  /** Distance between trail samples; the trail spans six of them. */
  step: number;
  /** Segment thickness, in bullet radii. */
  width: number;
  color?: number;
}
export interface GlowArt {
  /** Billboard size in bullet radii. */
  size: number;
  color?: number;
  /** Pulse rate, Hz. */
  pulse?: number;
}
export interface PuffArt {
  every: number;
  color: number;
  size: number;
  life: number;
}
export interface ProjectileArt {
  shape: ShapeClass | ComplexKind;
  /** Per-axis scale in bullet radii (z is the flight axis). */
  size: [number, number, number];
  /** Body height above the floor. */
  height: number;
  core: number;
  rim: number;
  /** Rotation about the spin axis, radians per second. */
  spin?: number;
  spinAxis?: "y" | "z";
  /** Vertical bob amplitude. */
  bob?: number;
  /** Scale pulse rate, Hz. */
  pulse?: number;
  trail?: TrailArt;
  glow?: GlowArt;
  puff?: PuffArt;
  variants?: Partial<Record<VariantKey, Partial<ProjectileArt>>>;
}

export const SHAPE_CLASSES: readonly ShapeClass[] = [
  "streak",
  "shard",
  "ball",
  "dart",
  "shell",
  "pod",
  "ringlet",
];
export const COMPLEX_KINDS: readonly ComplexKind[] = [
  "mine",
  "turret",
  "ringwave",
  "orb",
  "singularity",
];
export const isComplex = (shape: ProjectileArt["shape"]): shape is ComplexKind =>
  (COMPLEX_KINDS as readonly string[]).includes(shape);

/** Instances per shape class; the renderer drops trails, then glows, then bodies past these. */
export const SHAPE_BUDGET: Record<ShapeClass, number> = {
  streak: 256,
  shard: 160,
  ball: 160,
  dart: 128,
  shell: 48,
  pod: 32,
  ringlet: 48,
};
export const GLOW_BUDGET = 256;
export const TRAIL_SEGMENTS = 6;
export const TRAIL_SAMPLES = TRAIL_SEGMENTS + 1;
export const TRAIL_BUDGET = 200;
export const COMPLEX_BUDGET: Record<ComplexKind, number> = {
  mine: 16,
  turret: 4,
  ringwave: 4,
  orb: 12,
  singularity: 4,
};
/** Seconds a fresh player bullet slides out of the hand's muzzle. */
export const MUZZLE_LERP = 0.12;

const tint = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
export const weaponHex = (id: string) =>
  id in WEAPONS
    ? parseInt(WEAPONS[id as WeaponId].color.slice(1), 16)
    : 0xffe0a3;
export const brighten = (hex: number, amount: number) =>
  tint.setHex(hex).lerp(WHITE, amount).getHex();
export const darken = (hex: number, factor: number) =>
  tint.setHex(hex).multiplyScalar(factor).getHex();

function row(
  id: string,
  shape: ProjectileArt["shape"],
  size: [number, number, number],
  extra: Partial<ProjectileArt> = {},
): ProjectileArt {
  const core = extra.core ?? weaponHex(id);
  return {
    shape,
    size,
    height: 1.1,
    core,
    rim: extra.rim ?? brighten(core, 0.45),
    ...extra,
  };
}

const SMOKE = 0x8f8780;
export const PROJECTILE_ART: Record<ArtKey, ProjectileArt> = {
  pistol: row("pistol", "streak", [1.3, 1.3, 3.4], {
    trail: { step: 0.24, width: 0.5 },
    glow: { size: 2.4 },
  }),
  shotgun: row("shotgun", "streak", [1.2, 1.2, 2.2], {
    trail: { step: 0.2, width: 0.42 },
  }),
  arc: row("arc", "streak", [1, 1, 2.6], { glow: { size: 2 } }),
  blade: row("blade", "shard", [1.2, 1.2, 1.8], { spin: 12 }),
  rocket: row("rocket", "shell", [1.1, 1.1, 1.5], {
    core: 0xd9c4a7,
    rim: 0xffa24a,
    trail: { step: 0.2, width: 0.95, color: 0xff9a3c },
    glow: { size: 3.2, color: 0xffb56a },
    puff: { every: 0.035, color: SMOKE, size: 0.75, life: 0.6 },
  }),
  flame: row("flame", "ball", [1.4, 1.4, 1.4], {
    core: 0xffb060,
    rim: 0xff7a30,
    pulse: 12,
    glow: { size: 3 },
  }),
  frostgun: row("frostgun", "shard", [1.3, 1.3, 2.4], {
    core: 0xcdf3ff,
    rim: 0x7ad0ff,
    spin: 9,
    trail: { step: 0.22, width: 0.5, color: 0x7ad0ff },
    glow: { size: 2.2, color: 0x9fe0ff },
  }),
  needle: row("needle", "streak", [0.75, 0.75, 4.2], {
    spin: 30,
    trail: { step: 0.22, width: 0.32 },
  }),
  railgun: row("railgun", "streak", [1, 1, 5], { glow: { size: 2.2 } }),
  boomerang: row("boomerang", "ringlet", [3, 1, 3], {
    height: 1.2,
    spin: 18,
    spinAxis: "y",
    trail: { step: 0.3, width: 0.55 },
    glow: { size: 2.6 },
    variants: {
      returning: {
        core: brighten(weaponHex("boomerang"), 0.5),
        spin: 30,
        glow: { size: 3.4 },
        trail: { step: 0.24, width: 0.7 },
      },
    },
  }),
  beam: row("beam", "streak", [1, 1, 3], { glow: { size: 2 } }),
  pinball: row("pinball", "ball", [1.1, 1.1, 1.1], {
    core: 0xdba75a,
    rim: 0xffe2a3,
    spin: 10,
    spinAxis: "y",
    trail: { step: 0.5, width: 0.55 },
    glow: { size: 2.4 },
  }),
  thumper: row("thumper", "ringwave", [1, 1, 1], {
    height: 0.12,
    core: 0xe9c79a,
    rim: 0xffd9a8,
    variants: { grow: { rim: 0xffe4b8 } },
  }),
  mortar: row("mortar", "shell", [1.1, 1.1, 1.4], {
    puff: { every: 0.05, color: SMOKE, size: 0.6, life: 0.5 },
    glow: { size: 2.6 },
  }),
  flare: row("flare", "ball", [1.2, 1.2, 1.5], {
    core: 0xffcf7a,
    rim: 0xff7a30,
    pulse: 14,
    trail: { step: 0.18, width: 0.7, color: 0xff7a30 },
    glow: { size: 3.4, color: 0xff9a4a, pulse: 7 },
    puff: { every: 0.06, color: 0xff8f5a, size: 0.45, life: 0.4 },
  }),
  skyfall: row("skyfall", "streak", [1, 1, 4], { glow: { size: 2.4 } }),
  tesla_orb: row("tesla_orb", "orb", [1, 1, 1], {
    core: 0xdff6ff,
    rim: 0x8ad4f5,
    pulse: 5,
    glow: { size: 3.6, color: 0x9fdcff, pulse: 5 },
  }),
  halo: row("halo", "shard", [0.7, 2.4, 0.7], {
    height: 1.3,
    core: 0xe4f6ff,
    rim: 0xbde8ff,
    spin: 4,
    spinAxis: "y",
    bob: 0.18,
    glow: { size: 1.8 },
  }),
  gravity: row("gravity", "singularity", [1, 1, 1], {
    core: 0x0a0814,
    rim: 0xb9c8ff,
    spin: 5,
    variants: { fused: { spin: 16 } },
  }),
  spore_mine: row("spore_mine", "mine", [1, 1, 1], {
    height: 0.1,
    core: 0x8fb04a,
    rim: 0xd8f57a,
  }),
  hive: row("hive", "pod", [1.1, 1.1, 1.4], {
    core: 0xe1e27a,
    rim: 0xfff7a8,
    spin: 6,
    glow: { size: 2.8 },
    variants: {
      child: {
        shape: "dart",
        size: [0.8, 0.8, 2.4],
        core: 0xf1f2a6,
        spin: 40,
        spinAxis: "z",
        glow: undefined,
        trail: { step: 0.15, width: 0.35 },
      },
    },
  }),
  sentry: row("sentry", "turret", [1, 1, 1], {
    height: 0,
    core: 0xd9c39a,
    rim: 0xfff0c8,
  }),
  shatter: row("shatter", "shard", [1.3, 1.3, 2.1], {
    core: 0xe9f2ff,
    rim: 0xc9dcf2,
    spin: 6,
    glow: { size: 2.4 },
    variants: {
      child: {
        size: [0.8, 0.8, 1.7],
        spin: 25,
        glow: undefined,
        trail: { step: 0.2, width: 0.4 },
      },
    },
  }),
  eclipse: row("eclipse", "singularity", [1, 1, 1], {
    core: 0x0a0410,
    rim: 0xff3df0,
    spin: 7,
    variants: { fused: { spin: 22 } },
  }),
  enemy: row("enemy", "ball", [1, 1, 1], {
    height: 0.9,
    core: 0xff7355,
    rim: 0xff9a80,
    pulse: 10,
    glow: { size: 2.8, color: 0xff5a3c, pulse: 10 },
  }),
  "enemy-sniper": row("enemy-sniper", "streak", [0.8, 0.8, 4], {
    height: 0.9,
    core: 0xfff1ee,
    rim: 0xff5040,
    trail: { step: 0.35, width: 0.4, color: 0xff6a50 },
    glow: { size: 2, color: 0xff8070 },
  }),
  "enemy-boss": row("enemy-boss", "ball", [1.4, 1.4, 1.4], {
    height: 0.95,
    core: 0xffd0c0,
    rim: 0xff4a30,
    pulse: 8,
    spin: 9,
    spinAxis: "y",
    glow: { size: 4.2, color: 0xff3a2a, pulse: 8 },
    trail: { step: 0.3, width: 0.5, color: 0xff5a40 },
  }),
  "drone-pistol": row("drone-pistol", "streak", [1, 1, 2.8], {
    core: 0xe6d8ff,
    rim: 0xc7b0ed,
    trail: { step: 0.24, width: 0.4, color: 0xc7b0ed },
  }),
};

export interface BulletLook {
  weapon: string;
  enemy: boolean;
  child?: boolean;
  fused?: boolean;
  returning?: boolean;
  source?: string;
  ownerId?: number;
  behavior?: { stationary?: boolean; grow?: number };
}
/** The registry row for a bullet; drones' pistol shots and enemy kinds get their own. */
export function artKeyFor(
  bullet: BulletLook,
  isDrone?: (ownerId: number) => boolean,
): ArtKey {
  if (bullet.enemy)
    return bullet.source === "sniper"
      ? "enemy-sniper"
      : bullet.source === "boss"
        ? "enemy-boss"
        : "enemy";
  if (
    bullet.weapon === "pistol" &&
    bullet.ownerId !== undefined &&
    isDrone?.(bullet.ownerId)
  )
    return "drone-pistol";
  return bullet.weapon in PROJECTILE_ART
    ? (bullet.weapon as ArtKey)
    : "pistol";
}
export function variantMask(bullet: BulletLook) {
  return (
    (bullet.fused ? 1 : 0) |
    (bullet.returning ? 2 : 0) |
    (bullet.child ? 4 : 0) |
    (bullet.behavior?.stationary ? 8 : 0) |
    (bullet.behavior?.grow ? 16 : 0)
  );
}
const VARIANT_BITS: Array<[number, VariantKey]> = [
  [8, "stationary"],
  [16, "grow"],
  [1, "fused"],
  [2, "returning"],
  [4, "child"],
];
const resolved = new Map<string, ProjectileArt>();
/** The base row with the bullet's active variants layered on, memoised by (key, mask). */
export function resolveArt(key: ArtKey, bullet: BulletLook): ProjectileArt {
  const mask = variantMask(bullet);
  const base = PROJECTILE_ART[key] ?? PROJECTILE_ART.pistol;
  if (!mask) return base;
  const memo = `${key}:${mask}`;
  let art = resolved.get(memo);
  if (art) return art;
  art = { ...base };
  let childStyled = false;
  for (const [bit, name] of VARIANT_BITS) {
    if (!(mask & bit)) continue;
    const variant = base.variants?.[name];
    if (!variant) continue;
    if (name === "child") childStyled = true;
    for (const [field, value] of Object.entries(variant))
      (art as unknown as Record<string, unknown>)[field] = value;
  }
  if (mask & 4 && !childStyled) {
    // Split fragments of any weapon: a smaller body without its glow.
    art.size = [art.size[0] * 0.75, art.size[1] * 0.75, art.size[2] * 0.75];
    art.glow = undefined;
    if (isComplex(art.shape)) art.shape = "ball";
  }
  delete art.variants;
  resolved.set(memo, art);
  return art;
}

/** Unit geometries (one bullet radius wide, nose along +Z). */
export const SHAPE_GEOMETRY: Record<ShapeClass, () => THREE.BufferGeometry> = {
  streak: () => new THREE.CylinderGeometry(0.14, 0.55, 2, 6).rotateX(Math.PI / 2),
  shard: () => new THREE.OctahedronGeometry(1, 0).scale(0.75, 0.75, 1),
  ball: () => new THREE.SphereGeometry(1, 10, 8),
  dart: () => new THREE.ConeGeometry(0.5, 2, 5).rotateX(Math.PI / 2),
  shell: () => new THREE.CapsuleGeometry(0.5, 1.2, 3, 8).rotateX(Math.PI / 2),
  pod: () => new THREE.CylinderGeometry(0.85, 0.85, 1.4, 6).rotateX(Math.PI / 2),
  ringlet: () => new THREE.TorusGeometry(0.8, 0.22, 6, 16).rotateX(Math.PI / 2),
};

let glow: THREE.DataTexture | undefined;
/** A 32×32 radial falloff, built from data so tests and workers can use it. */
export function glowTexture() {
  if (glow) return glow;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5,
        dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = (1 - d) * (1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  glow = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glow.needsUpdate = true;
  return glow;
}

const additive = new Map<number, THREE.MeshBasicMaterial>();
/** Shared additive material per colour; never disposed per user. */
export function additiveMaterial(hex: number) {
  let m = additive.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    additive.set(hex, m);
  }
  return m;
}

/** What a complex body sees of its bullet each frame. */
export interface ComplexView {
  radius: number;
  age: number;
  life: number;
  angle: number;
  timer?: number;
  fused?: boolean;
  stationary?: boolean;
  grow?: number;
}
export interface ComplexBody {
  kind: ComplexKind;
  level: number;
  group: THREE.Group;
  animate(view: ComplexView, art: ProjectileArt, time: number, dt: number, reduced: boolean): void;
  /** World muzzle for turrets. */
  muzzle?(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

function ownedMaterial(m: THREE.Material) {
  m.userData.owned = true;
  return m;
}
function disposeOwned(group: THREE.Object3D) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.owned) object.geometry.dispose();
    const m = object.material as THREE.Material;
    if (m.userData.owned) m.dispose();
  });
}
const shared = new Map<string, THREE.BufferGeometry>();
function geometry(key: string, make: () => THREE.BufferGeometry) {
  let g = shared.get(key);
  if (!g) {
    g = make();
    shared.set(key, g);
  }
  return g;
}

function makeMine(art: ProjectileArt, level: number): ComplexBody {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    geometry("mine-disc", () => new THREE.CylinderGeometry(1, 1.08, 0.24, 6)),
    material(art.core),
  );
  disc.castShadow = true;
  disc.position.y = 0.12;
  const coreMaterial = ownedMaterial(
    new THREE.MeshBasicMaterial({ color: art.rim, toneMapped: false }),
  ) as THREE.MeshBasicMaterial;
  const core = new THREE.Mesh(
    geometry("mine-core", () => new THREE.SphereGeometry(0.42, 8, 6)),
    coreMaterial,
  );
  core.position.y = 0.3;
  group.add(disc, core);
  return {
    kind: "mine",
    level,
    group,
    animate(view, current, time) {
      group.scale.setScalar(view.radius * 0.72);
      const rate = view.life < 2 ? 18 : 6;
      const on = Math.sin(time * rate * Math.PI * 2) > 0;
      coreMaterial.color.setHex(on ? current.rim : darken(current.core, 0.5));
      core.scale.setScalar(on ? 1.15 : 0.9);
    },
    dispose: () => disposeOwned(group),
  };
}
function makeTurret(level: number): ComplexBody {
  const group = new THREE.Group();
  const model = makeEquipment("sentry", level);
  model.scale.setScalar(0.45);
  const bounds = new THREE.Box3().setFromObject(model);
  model.position.y = -bounds.min.y;
  group.add(model);
  const muzzle = model.userData.muzzle as THREE.Vector3;
  let yaw = 0;
  return {
    kind: "turret",
    level,
    group,
    animate(view, _art, _time, dt) {
      const target = Math.PI / 2 - view.angle;
      let delta = target - yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      yaw += delta * Math.min(1, dt * 14);
      group.rotation.y = yaw;
      // Spin-up: the turret unfolds over its first quarter second.
      const rise = Math.min(1, view.age / 0.25);
      group.scale.setScalar(0.3 + 0.7 * rise);
    },
    muzzle(out) {
      model.updateWorldMatrix(true, false);
      return model.localToWorld(out.copy(muzzle));
    },
    dispose: () => disposeOwned(group),
  };
}
function makeRingwave(art: ProjectileArt, level: number): ComplexBody {
  const group = new THREE.Group();
  const ringMaterial = ownedMaterial(
    new THREE.MeshBasicMaterial({
      color: art.rim,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  ) as THREE.MeshBasicMaterial;
  const ring = new THREE.Mesh(
    geometry("ringwave", () => new THREE.RingGeometry(0.8, 1, 48)),
    ringMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  const inner = new THREE.Mesh(
    geometry("ringwave-inner", () => new THREE.RingGeometry(0.5, 0.62, 40)),
    ringMaterial,
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  group.add(ring, inner);
  return {
    kind: "ringwave",
    level,
    group,
    animate(view, current) {
      group.scale.setScalar(Math.max(0.05, view.radius));
      const total = Math.max(0.05, view.age + Math.max(0, view.life));
      const fade = Math.max(0, 1 - view.age / total);
      ringMaterial.color.setHex(current.rim).multiplyScalar(0.25 + fade * 0.75);
      ringMaterial.opacity = 0.3 + fade * 0.7;
    },
    dispose: () => disposeOwned(group),
  };
}
function makeOrb(art: ProjectileArt, level: number): ComplexBody {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    geometry("orb-core", () => new THREE.SphereGeometry(0.62, 12, 10)),
    ownedMaterial(new THREE.MeshBasicMaterial({ color: art.core, toneMapped: false })),
  );
  const halo = new THREE.Mesh(
    geometry("orb-torus", () => new THREE.TorusGeometry(1.25, 0.1, 6, 28)),
    additiveMaterial(art.rim),
  );
  const halo2 = new THREE.Mesh(halo.geometry, additiveMaterial(art.rim));
  halo2.rotation.x = Math.PI / 2;
  halo2.scale.setScalar(0.85);
  group.add(core, halo, halo2);
  return {
    kind: "orb",
    level,
    group,
    animate(view, current, time, _dt, reduced) {
      group.scale.setScalar(view.radius);
      const pulse = reduced ? 1 : 1 + Math.sin(time * (current.pulse ?? 5) * Math.PI * 2) * 0.12;
      core.scale.setScalar(pulse);
      if (!reduced) {
        halo.rotation.set(time * 2.1, time * 3.4, 0);
        halo2.rotation.set(Math.PI / 2 + time * 1.7, 0, time * 2.6);
      }
    },
    dispose: () => disposeOwned(group),
  };
}
function makeSingularity(art: ProjectileArt, level: number): ComplexBody {
  const group = new THREE.Group();
  const coreMaterial = ownedMaterial(
    new THREE.MeshBasicMaterial({ color: art.core, toneMapped: false }),
  ) as THREE.MeshBasicMaterial;
  const core = new THREE.Mesh(
    geometry("singularity-core", () => new THREE.SphereGeometry(0.7, 14, 12)),
    coreMaterial,
  );
  const rimMaterial = ownedMaterial(
    new THREE.MeshBasicMaterial({
      color: art.rim,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  ) as THREE.MeshBasicMaterial;
  const accretion = new THREE.Mesh(
    geometry("singularity-torus", () => new THREE.TorusGeometry(1.5, 0.22, 8, 36)),
    rimMaterial,
  );
  accretion.rotation.x = Math.PI / 2 - 0.35;
  const disc = new THREE.Mesh(
    geometry("singularity-disc", () => new THREE.RingGeometry(0.75, 1.9, 36)),
    rimMaterial,
  );
  disc.rotation.x = -Math.PI / 2 + 0.35;
  group.add(core, accretion, disc);
  return {
    kind: "singularity",
    level,
    group,
    animate(view, current, time, _dt, reduced) {
      group.scale.setScalar(view.radius);
      const spin = reduced ? 0 : (current.spin ?? 5) * time;
      accretion.rotation.z = spin;
      disc.rotation.z = -spin * 0.6;
      // Collapse cue: the accretion ring falls into the core over the last 0.3 s.
      const collapse =
        view.fused && view.timer !== undefined
          ? Math.max(0.12, Math.min(1, view.timer / 0.3))
          : 1;
      accretion.scale.setScalar(collapse);
      disc.scale.setScalar(collapse);
      rimMaterial.color.setHex(current.rim).multiplyScalar(view.fused ? 1.2 - collapse * 0.4 : 0.85);
      rimMaterial.opacity = 0.55 + (1 - collapse) * 0.45;
      coreMaterial.color.setHex(current.core);
    },
    dispose: () => disposeOwned(group),
  };
}
export function makeComplexProjectile(
  kind: ComplexKind,
  art: ProjectileArt,
  level = 1,
): ComplexBody {
  switch (kind) {
    case "mine":
      return makeMine(art, level);
    case "turret":
      return makeTurret(level);
    case "ringwave":
      return makeRingwave(art, level);
    case "orb":
      return makeOrb(art, level);
    default:
      return makeSingularity(art, level);
  }
}

/** Muzzle flashes: one look per weapon family, scaled by rank. */
export type FlashClass =
  | "gun"
  | "scatter"
  | "launcher"
  | "heavy"
  | "beam"
  | "coil"
  | "flame"
  | "thrower"
  | "caster"
  | "sky"
  | "melee"
  | "enemy"
  | "boss";
export interface FlashSpec {
  particles: number;
  force: number;
  size: number;
  /** Half-angle of the spark cone, radians; π for a full burst. */
  spread: number;
  /** Additive disc sprite scale at the muzzle. */
  disc?: number;
  /** Additive cone length along the shot. */
  cone?: number;
  /** Floor ring radius. */
  ring?: number;
  smoke?: number;
  inward?: boolean;
  upward?: boolean;
  shake?: number;
  life?: number;
}
export const FLASH_CLASS: Record<WeaponId | "enemy" | "enemy-boss" | "drone", FlashClass> = {
  pistol: "gun",
  shotgun: "scatter",
  arc: "coil",
  blade: "melee",
  rocket: "launcher",
  flame: "flame",
  frostgun: "gun",
  needle: "gun",
  railgun: "heavy",
  boomerang: "thrower",
  beam: "beam",
  pinball: "gun",
  thumper: "heavy",
  mortar: "launcher",
  flare: "thrower",
  skyfall: "sky",
  tesla_orb: "coil",
  halo: "caster",
  gravity: "caster",
  spore_mine: "caster",
  hive: "caster",
  sentry: "caster",
  shatter: "gun",
  eclipse: "caster",
  enemy: "enemy",
  "enemy-boss": "boss",
  drone: "gun",
};
export const MUZZLE_FLASH: Record<FlashClass, FlashSpec> = {
  gun: { particles: 3, force: 2.2, size: 0.45, spread: 0.35, disc: 0.55, cone: 0.7 },
  scatter: { particles: 9, force: 2.8, size: 0.5, spread: 0.6, disc: 0.75, cone: 0.9, shake: 0.04 },
  launcher: { particles: 5, force: 2, size: 0.6, spread: 0.5, disc: 0.85, ring: 0.9, smoke: 4, shake: 0.03 },
  heavy: { particles: 8, force: 3.5, size: 0.55, spread: 0.3, disc: 1.1, cone: 1.4, ring: 1.1, smoke: 3, shake: 0.08 },
  beam: { particles: 4, force: 1.5, size: 0.4, spread: 0.2, disc: 0.8, cone: 1.2 },
  coil: { particles: 6, force: 2.4, size: 0.4, spread: Math.PI, disc: 0.7, inward: true },
  flame: { particles: 6, force: 2.6, size: 0.7, spread: 0.45, disc: 0.6, life: 0.5 },
  thrower: { particles: 3, force: 1.6, size: 0.45, spread: 0.7, disc: 0.5 },
  caster: { particles: 8, force: 2.2, size: 0.45, spread: Math.PI, disc: 0.9, inward: true },
  sky: { particles: 8, force: 4, size: 0.45, spread: 0.4, disc: 0.7, upward: true },
  melee: { particles: 2, force: 1.5, size: 0.4, spread: 0.8 },
  enemy: { particles: 3, force: 1.8, size: 0.45, spread: 0.5, disc: 0.5 },
  boss: { particles: 10, force: 3, size: 0.6, spread: Math.PI, disc: 1.3, ring: 1.6, shake: 0.06 },
};
/** The flash class for a fire event's weapon and side. */
export function flashClassFor(weapon: string | undefined, enemy: boolean, boss = false, drone = false): FlashClass {
  if (enemy) return boss ? "boss" : "enemy";
  if (drone) return "gun";
  return FLASH_CLASS[(weapon ?? "pistol") as WeaponId] ?? "gun";
}
