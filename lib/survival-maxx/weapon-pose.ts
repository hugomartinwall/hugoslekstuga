import * as THREE from "three";
import type { Rig } from "./geometry";

const rotation = new THREE.Euler(0, 0, 0, "YXZ");
const orientation = new THREE.Quaternion();
const smooth = (t: number) => t * t * (3 - 2 * t);

export const weaponScale = (kind: string): number =>
  kind === "pistol"
    ? 0.92
    : kind === "blade"
      ? 0.85
      : kind === "railgun" || kind === "rocket"
        ? 0.68
        : 0.76;

export const weaponRecovery = (kind: string): number =>
  kind === "blade"
    ? 0.38
    : kind === "boomerang"
      ? 0.3
      : kind === "shotgun" || kind === "rocket"
        ? 0.22
        : 0.15;

/** Palm stays attached. The wrist counters the shoulder instead of aiming into it.
 * `attack` falls from 1 to 0 after a real attack event; zero is the ready pose.
 * Shared by combat, menu models and the visible animation inspector.
 */
export function poseHeldWeapon(
  rig: Rig,
  mesh: THREE.Object3D,
  slot: number,
  kind: string,
  attack = 0,
): void {
  const arm = rig.arms[slot];
  if (!arm) return;
  const side = Math.sign(arm.position.x) || 1;
  const lower = rig.kind === "prism" && slot >= 2;
  const rest = arm.userData.restAngleZ ?? 0;
  const impulse = Math.max(0, Math.min(1, attack));
  mesh.position.set(0, 0, 0);
  arm.position.z = arm.userData.restZ ?? 0;

  if (kind === "blade") {
    // A forward guard, a quick cross-body cut IN FRONT of the chest, then a
    // lifted recovery. It never inherits the walking arm swing or points back.
    const phase = 1 - impulse;
    const cutting = phase < 0.42;
    const cut = cutting
      ? smooth(phase / 0.42)
      : 1 - smooth((phase - 0.42) / 0.58);
    const lift = cutting
      ? 0
      : Math.sin(((phase - 0.42) / 0.58) * Math.PI) * 0.43;
    const elevation = (lower ? 0.08 : 0.32) - cut * 0.23 + lift;
    const yaw = side * (0.62 - cut * 1.28 + (lower ? 0.2 : 0));
    arm.rotation.set(-0.9 - cut * 0.12, side * 0.08, rest + side * 0.17);
    rotation.set(Math.PI / 2 - elevation, yaw, 0, "YXZ");
  } else if (kind === "boomerang") {
    // Carry the long edge along the outside of the forearm, then flick forward.
    const flick = Math.sin((1 - impulse) * Math.PI) * impulse;
    arm.rotation.set(-0.86 - flick * 0.25, side * 0.1, rest + side * 0.15);
    rotation.set(0.15 - flick * 0.3, (side * Math.PI) / 2, 0, "YXZ");
  } else {
    const kick = impulse * impulse;
    const heavy = kind === "shotgun" || kind === "rocket" || kind === "railgun";
    arm.rotation.set(
      -0.4 + kick * (heavy ? 0.14 : 0.075),
      0,
      rest + side * 0.12,
    );
    // Upper/lower hands on Prism have separate lanes. Muzzles remain forward.
    rotation.set(
      -kick * (heavy ? 0.06 : 0.035),
      side * (lower ? 0.12 : 0.025),
      0,
      "YXZ",
    );
  }
  orientation.setFromEuler(rotation);
  mesh.quaternion.copy(arm.quaternion).invert().multiply(orientation);
}

export function poseEquippedWeapons(rig: Rig): void {
  rig.weaponMounts.forEach((mount, slot) => {
    for (const mesh of mount.children)
      if (mesh.userData.kind)
        poseHeldWeapon(rig, mesh, slot, mesh.userData.kind);
  });
}
