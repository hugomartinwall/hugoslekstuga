import assert from "node:assert/strict";
import { test } from "vitest";
import * as THREE from "three";
import { ITEMS, WEAPONS } from "../../lib/survival-maxx/content";
import {
  equipmentCameraBounds,
  makeEquipment,
} from "../../lib/survival-maxx/equipment-art";
import { HEROES, HERO_ORDER } from "../../lib/survival-maxx/content";
import { animateHeroRig, makeHero } from "../../lib/survival-maxx/hero-rigs";
import { weaponScale } from "../../lib/survival-maxx/weapon-pose";
import { exposedSurfaceConflicts } from "./helpers/surface-audit";

test("every equipment rank has separated visible surfaces from rear, side and roof angles", () => {
  for (const kind of [...Object.keys(WEAPONS), ...Object.keys(ITEMS), "heal"]) {
    for (const rank of [1, 2, 3, 4, 5, 6]) {
      const model = makeEquipment(kind, rank);
      model.rotation.set(0.17, -0.42, 0.11);
      assert.deepEqual(
        exposedSurfaceConflicts(model),
        [],
        `${kind} rank ${rank}: no exposed coplanar panels`,
      );
    }
  }
});

test("each starter loadout remains free of surface conflicts while equipped and moving", () => {
  for (const hero of HERO_ORDER) {
    for (const rank of [1, 6]) {
      const rig = makeHero(hero);
      const kind = HEROES[hero].weapon;
      const weapon = makeEquipment(kind, rank);
      weapon.scale.setScalar(weaponScale(kind));
      rig.weaponMounts[0].add(weapon);
      assert.deepEqual(
        exposedSurfaceConflicts(rig.root),
        [],
        `${hero}: equipped ${kind} rank ${rank}`,
      );
      for (let frame = 0; frame < 80; frame++)
        animateHeroRig(rig, frame / 60, 6, frame / 40, 1 / 60, frame > 70);
      assert.deepEqual(
        exposedSurfaceConflicts(rig.root),
        [],
        `${hero}: moving ${kind} rank ${rank}`,
      );
    }
  }
});

test("every equipment model stays finite and compact through all six ranks", () => {
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.1, -1.1, 0.1, 30);
  camera.position.set(3.3, 2.1, 4.8);
  camera.lookAt(0, 0, 0);
  for (const kind of [...Object.keys(WEAPONS), ...Object.keys(ITEMS), "heal"]) {
    for (const rank of [1, 2, 3, 4, 5, 6]) {
      const model = makeEquipment(kind, rank);
      let vertices = 0,
        draws = 0;
      model.traverse((mesh) => {
        if (!(mesh instanceof THREE.Mesh)) return;
        draws++;
        const coordinates = mesh.geometry.getAttribute("position");
        vertices += coordinates.count;
        for (const value of coordinates.array)
          assert.ok(Number.isFinite(value), `${kind}: non-finite vertex`);
      });
      assert.ok(vertices < 32000, `${kind}: excessive geometry`);
      assert.ok(draws <= 7, `${kind}: excessive separate surfaces`);
      const bounds = new THREE.Box3().setFromObject(model);
      for (const axis of bounds.getSize(new THREE.Vector3()).toArray())
        assert.ok(
          axis > 0.01 && axis < 3,
          `${kind}: unintended spike or collapsed geometry`,
        );
      if (kind in WEAPONS) {
        assert.ok(
          bounds.containsPoint(new THREE.Vector3()),
          `${kind}: no weapon at the palm origin`,
        );
        assert.equal(model.userData.grip.length(), 0);
        assert.ok(model.userData.muzzle.length() > 0.1);
        assert.equal(model.userData.weaponId, kind);
      }
      model.rotation.y =
        kind in WEAPONS && kind !== "blade" && kind !== "boomerang"
          ? -0.43
          : -0.15;
      const projected = equipmentCameraBounds(model, camera);
      assert.ok(!projected.isEmpty(), `${kind}: portrait has no geometry`);
      assert.ok(
        projected.getSize(new THREE.Vector2()).toArray().every(Number.isFinite),
      );
    }
  }
});

test("invalid equipment rank input cannot produce broken geometry", () => {
  for (const input of [NaN, Infinity, -Infinity, -8, 0, 7, 100.5]) {
    for (const kind of ["pistol", "blade", "power", "gun_drone"]) {
      const model = makeEquipment(kind, input);
      assert.ok(model.userData.level >= 1 && model.userData.level <= 6);
      assert.ok(Number.isInteger(model.userData.level));
      assert.ok(
        new THREE.Box3()
          .setFromObject(model)
          .getSize(new THREE.Vector3())
          .toArray()
          .every(Number.isFinite),
      );
    }
  }
});
