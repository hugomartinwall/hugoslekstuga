import assert from "node:assert/strict";
import { test } from "vitest";
import * as THREE from "three";
import { HERO_ORDER, HEROES, WEAPONS } from "../../lib/survival-maxx/content";
import { makeHero, animateHeroRig } from "../../lib/survival-maxx/hero-rigs";
import { makeEquipment } from "../../lib/survival-maxx/equipment-art";
import { poseHeldWeapon, weaponScale } from "../../lib/survival-maxx/weapon-pose";

function bladeVertices(weapon: THREE.Group) {
  const points: THREE.Vector3[] = [];
  weapon.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.updateMatrix();
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(object.matrix);
      if (point.y >= 0.33) points.push(point);
    }
  });
  return points;
}

for (const hero of HERO_ORDER)
  test(`${HEROES[hero].name}: sword geometry clears the chest and head throughout cuts, recovery, movement and dash`, () => {
    for (const rank of [1, 6]) {
      const rig = makeHero(hero);
      const weapons = rig.weaponMounts.map((mount) => {
        const weapon = makeEquipment("blade", rank);
        weapon.scale.setScalar(weaponScale("blade"));
        mount.add(weapon);
        return { weapon, vertices: bladeVertices(weapon) };
      });
      for (let sample = 0; sample <= 60; sample++) {
        animateHeroRig(
          rig,
          sample / 60,
          sample < 10 ? 0 : 6,
          0.3,
          1 / 60,
          sample > 45,
        );
        weapons.forEach(({ weapon }, slot) =>
          poseHeldWeapon(rig, weapon, slot, "blade", sample / 60),
        );
        rig.root.updateMatrixWorld(true);
        const inverse = rig.body.matrixWorld.clone().invert();
        const protectedBounds = [
          rig.body.getObjectByName("pressure-shell")!,
          rig.head,
        ].map((object) => {
          const bounds = new THREE.Box3();
          object.traverse((mesh) => {
            if (!(mesh instanceof THREE.Mesh)) return;
            mesh.geometry.computeBoundingBox();
            bounds.union(
              mesh.geometry
                .boundingBox!.clone()
                .applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)),
            );
          });
          return bounds;
        });
        for (const { weapon, vertices } of weapons)
          for (const vertex of vertices) {
            const world = rig.body.worldToLocal(
              weapon.localToWorld(vertex.clone()),
            );
            assert.ok(
              !protectedBounds.some((bounds) => bounds.containsPoint(world)),
              `${hero} rank ${rank}, phase ${sample}: blade intersects character`,
            );
            assert.ok(
              world.z > 0.4,
              `${hero}: cutting edge passes behind the safe forward plane ${world.z}, phase ${sample}`,
            );
          }
      }
    }
  });

test("the old upright grip violates the forward blade clearance regression", () => {
  const rig = makeHero("ember");
  const weapon = makeEquipment("blade", 1);
  weapon.scale.setScalar(weaponScale("blade"));
  rig.weaponMounts[0].add(weapon);
  rig.arms[0].rotation.x = -0.12 - 1.6;
  rig.arms[0].rotation.z = -0.7;
  rig.root.updateMatrixWorld(true);
  assert.ok(
    bladeVertices(weapon).some(
      (point) => rig.body.worldToLocal(weapon.localToWorld(point)).z < 0.4,
    ),
  );
});

test("all weapons keep a fixed palm grip and finite transforms across every character hand", () => {
  const origin = new THREE.Vector3();
  for (const hero of HERO_ORDER)
    for (const kind of Object.keys(WEAPONS)) {
      const rig = makeHero(hero);
      rig.weaponMounts.forEach((mount, slot) => {
        const weapon = makeEquipment(kind, 6);
        weapon.scale.setScalar(weaponScale(kind));
        mount.add(weapon);
        for (const attack of [0, 1, 0.8, 0.5, 0.2, 0]) {
          poseHeldWeapon(rig, weapon, slot, kind, attack);
          rig.root.updateMatrixWorld(true);
          const palm = mount.getWorldPosition(new THREE.Vector3());
          assert.ok(
            weapon.localToWorld(origin.clone()).distanceTo(palm) < 1e-9,
            `${hero}/${kind}/${slot}: grip detaches from palm`,
          );
          assert.ok(weapon.matrixWorld.elements.every(Number.isFinite));
          if (kind !== "blade" && kind !== "boomerang") {
            const muzzle = rig.body.worldToLocal(
              weapon.localToWorld(weapon.userData.muzzle.clone()),
            );
            const grip = rig.body.worldToLocal(palm);
            assert.ok(
              muzzle.z > grip.z + 0.15,
              `${hero}/${kind}: muzzle points into arm`,
            );
          }
        }
        const rest = weapon.quaternion.clone();
        for (let frame = 0; frame < 300; frame++) {
          animateHeroRig(rig, frame / 60, 6, 0, 1 / 60);
          poseHeldWeapon(rig, weapon, slot, kind, 0);
        }
        assert.ok(
          rest.angleTo(weapon.quaternion) < 1e-6,
          "recoil does not accumulate or inherit walking swing",
        );
        mount.remove(weapon);
      });
    }
});

test("blade cut and return have a continuous seam and end in the ready stance", () => {
  const rig = makeHero("prism");
  rig.weaponMounts.forEach((mount, slot) => {
    const weapon = makeEquipment("blade", 1);
    mount.add(weapon);
    poseHeldWeapon(rig, weapon, slot, "blade", 0);
    const ready = weapon.quaternion.clone();
    poseHeldWeapon(rig, weapon, slot, "blade", 1);
    assert.ok(ready.angleTo(weapon.quaternion) < 1e-6);
    const previous = weapon.quaternion.clone();
    for (let step = 1; step <= 120; step++) {
      poseHeldWeapon(rig, weapon, slot, "blade", 1 - step / 120);
      assert.ok(
        previous.angleTo(weapon.quaternion) < 0.08,
        "no one-frame snap through cut/recovery seam",
      );
      previous.copy(weapon.quaternion);
    }
    assert.ok(ready.angleTo(weapon.quaternion) < 1e-6);
  });
});
