import { test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { HEROES, HERO_ORDER } from "../../lib/survival-maxx/content";
import { makeHero, animateHeroRig } from "../../lib/survival-maxx/hero-rigs";
import { matte } from "../../lib/survival-maxx/geometry";
import { exposedSurfaceConflicts } from "./helpers/surface-audit";

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

function localBounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrix();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
}

test("the surface audit detects rear and roof flicker, while ignoring buried internal intersections", () => {
  for (const rotation of [
    [0, Math.PI, 0],
    [-Math.PI / 2, 0, 0],
  ]) {
    const root = new THREE.Group();
    for (const color of [0xff9900, 0x223344])
      root.add(
        new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color }),
        ),
      );
    root.rotation.set(rotation[0], rotation[1], rotation[2]);
    assert.ok(
      exposedSurfaceConflicts(root).length > 0,
      "a differently colored rear/roof overlap must fail",
    );
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xcccccc }),
    );
    cover.position.z = 0.14;
    root.add(cover);
    assert.deepEqual(
      exposedSurfaceConflicts(root),
      [],
      "fully buried faces cannot flicker into view",
    );
  }
});

for (const hero of HERO_ORDER) {
  test(`${HEROES[hero].name}: rear, roof and side surfaces stay clean through standing, turning, walking and dash poses`, () => {
    const rig = makeHero(hero);
    assert.deepEqual(exposedSurfaceConflicts(rig.root), [], "standing mesh");
    for (let frame = 1; frame <= 130; frame++) {
      animateHeroRig(
        rig,
        frame / 60,
        6,
        frame * 0.017,
        1 / 60,
        frame >= 75 && frame <= 85,
      );
      if ([31, 79, 130].includes(frame))
        assert.deepEqual(
          exposedSurfaceConflicts(rig.root),
          [],
          `animated pose ${frame}`,
        );
    }
  });
}

test("all ten crew rigs have finite, correctly oriented geometry and sane physical bounds", () => {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  for (const hero of HERO_ORDER) {
    const rig = makeHero(hero);
    let triangles = 0;
    rig.root.updateMatrixWorld(true);
    for (const mesh of meshes(rig.root)) {
      assert.ok(
        mesh.matrixWorld.determinant() > 0,
        `${hero}: no mirrored render transform`,
      );
      const geometry = mesh.geometry;
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        for (const value of attribute.array)
          assert.ok(Number.isFinite(value), `${hero}: finite ${name}`);
      }
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const indices = geometry.index;
      const count = indices?.count ?? positions.count;
      assert.equal(count % 3, 0, `${hero}: complete triangles`);
      for (let i = 0; i < count; i += 3) {
        const ia = indices?.getX(i) ?? i;
        const ib = indices?.getX(i + 1) ?? i + 1;
        const ic = indices?.getX(i + 2) ?? i + 2;
        a.fromBufferAttribute(positions, ia);
        b.fromBufferAttribute(positions, ib);
        c.fromBufferAttribute(positions, ic);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        if (normal.lengthSq() < 1e-14) continue;
        vertexNormal.fromBufferAttribute(normals, ia);
        vertexNormal.add(new THREE.Vector3().fromBufferAttribute(normals, ib));
        vertexNormal.add(new THREE.Vector3().fromBufferAttribute(normals, ic));
        assert.ok(
          normal.dot(vertexNormal) > -1e-7,
          `${hero}: baked triangle ${i / 3} must face along its normals`,
        );
        triangles++;
      }
    }
    const bounds = new THREE.Box3().setFromObject(rig.root);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(
      bounds.max.y > 2.6 && bounds.max.y < 3.5,
      `${hero}: usable camera framing`,
    );
    assert.ok(size.x > 1.2 && size.x < 2.6, `${hero}: usable silhouette width`);
    assert.ok(
      triangles > 1500 && triangles < 18000,
      `${hero}: bounded model complexity`,
    );
    assert.ok(
      Math.abs(rig.root.userData.visualHeight - bounds.max.y) < 0.001,
      `${hero}: health bars use the real model height`,
    );
  }
});

test("physical hands match each hero's gameplay slots and survive animation", () => {
  for (const hero of HERO_ORDER) {
    const rig = makeHero(hero);
    const slots = HEROES[hero].weaponSlots;
    assert.equal(
      rig.arms.length,
      slots,
      `${hero}: one arm for each usable hand`,
    );
    assert.equal(
      rig.weaponMounts.length,
      slots,
      `${hero}: one palm for each weapon slot`,
    );
    assert.equal(
      new Set(rig.weaponMounts).size,
      slots,
      `${hero}: independent mounts`,
    );
    const localTransforms = rig.weaponMounts.map((mount) =>
      mount.position.clone(),
    );
    rig.weaponMounts.forEach((mount, index) => {
      assert.equal(mount.parent, rig.arms[index]);
      assert.equal(mount.userData.slot, index);
      assert.ok(
        mount.position.y < -0.5 && mount.position.y > -1.1,
        `${hero}: grip remains below the shoulder`,
      );
      assert.ok(mount.position.z > 0, `${hero}: palm faces forward`);
      const dummyWeapon = new THREE.Group();
      dummyWeapon.name = `test-weapon-${index}`;
      mount.add(dummyWeapon);
    });
    for (let frame = 0; frame < 180; frame++)
      animateHeroRig(
        rig,
        frame / 60,
        frame < 90 ? 6 : 0,
        frame / 40,
        1 / 60,
        frame > 40 && frame < 50,
      );
    rig.weaponMounts.forEach((mount, index) => {
      assert.ok(
        mount.position.equals(localTransforms[index]),
        `${hero}: animation cannot detach equipment from its grip`,
      );
      assert.equal(mount.children[0]?.name, `test-weapon-${index}`);
    });
    if (hero === "prism") {
      rig.root.updateMatrixWorld(true);
      const upper = rig.weaponMounts[0].getWorldPosition(new THREE.Vector3());
      const lower = rig.weaponMounts[2].getWorldPosition(new THREE.Vector3());
      assert.ok(
        upper.distanceTo(lower) > 0.45,
        "Prism's lower hands must not overlap the upper pair",
      );
    }
  }
});

test("damage illumination is isolated per hero instance and resets cleanly", () => {
  for (const hero of HERO_ORDER) {
    const hurtRig = makeHero(hero);
    const cleanRig = makeHero(hero);
    animateHeroRig(hurtRig, 0, 0, 0, 1 / 60, false, true, 0xff3b36, 0.8);
    animateHeroRig(cleanRig, 0, 0, 0, 1 / 60, false, false);
    assert.ok(hurtRig.flashMaterial);
    assert.ok(cleanRig.flashMaterial);
    assert.notEqual(
      hurtRig.flashMaterial,
      cleanRig.flashMaterial,
      `${hero}: materials must not leak between the menu and arena`,
    );
    assert.notEqual(hurtRig.flashMaterial, matte);
    assert.equal(hurtRig.flashMaterial.emissive.getHex(), 0xff3b36);
    assert.equal(hurtRig.flashMaterial.emissiveIntensity, 0.8);
    assert.equal(cleanRig.flashMaterial.emissiveIntensity, 0);
    assert.equal(matte.emissive.getHex(), 0x000000);
    assert.ok(
      meshes(hurtRig.root).some(
        (mesh) => mesh.material === hurtRig.flashMaterial,
      ),
      `${hero}: damage reaches the visible shell`,
    );
    animateHeroRig(hurtRig, 0.1, 0, 0, 1 / 60, false, false);
    assert.equal(hurtRig.flashMaterial.emissiveIntensity, 0);
    assert.equal(hurtRig.flashMaterial.emissive.getHex(), 0x000000);
  }
});

test("grounded heroes keep their boots planted through a complete idle cycle", () => {
  for (const hero of HERO_ORDER.filter((id) => id !== "wisp")) {
    const rig = makeHero(hero);
    assert.equal(rig.legs.length, 2);
    const start = rig.legs.map(
      (leg) => new THREE.Box3().setFromObject(leg).min.y,
    );
    for (let frame = 0; frame < 300; frame++) {
      animateHeroRig(rig, frame / 60, 0, Math.PI / 2, 1 / 60);
      rig.root.updateMatrixWorld(true);
      rig.legs.forEach((leg, index) => {
        const bottom = new THREE.Box3().setFromObject(leg).min.y;
        assert.ok(
          bottom >= 0 && bottom < 0.04,
          `${hero}: boot sole remains at floor level`,
        );
        assert.ok(
          Math.abs(bottom - start[index]) < 1e-5,
          `${hero}: idle cannot lift or sink the legs`,
        );
      });
      assert.ok(
        Math.abs(rig.body.position.y) < 0.02,
        `${hero}: upper-body breathing stays subtle`,
      );
    }
  }
  const wisp = makeHero("wisp");
  assert.equal(
    wisp.legs.length,
    0,
    "Wisp's hover chassis has no decorative legs",
  );
  for (let frame = 0; frame < 180; frame++) {
    animateHeroRig(wisp, frame / 60, 0, 0, 1 / 60);
    const bottom = new THREE.Box3().setFromObject(wisp.root).min.y;
    assert.ok(
      bottom > 0.7 && bottom < 1.0,
      "Wisp maintains intentional hover clearance",
    );
  }
});

test("movement remains finite and continuous across facing wrap, stop/start and a delayed frame", () => {
  for (const hero of HERO_ORDER) {
    const rig = makeHero(hero);
    animateHeroRig(rig, 0, 0, Math.PI - 0.01, 1 / 60);
    const beforeWrap = rig.root.rotation.y;
    animateHeroRig(rig, 1 / 60, 0, -Math.PI + 0.01, 1 / 60);
    assert.ok(
      Math.abs(rig.root.rotation.y - beforeWrap) < 0.03,
      `${hero}: take the short turn across ±π`,
    );
    let previousBodyY = rig.body.position.y;
    let previousFacing = rig.root.rotation.y;
    for (let frame = 0; frame < 240; frame++) {
      const dt = frame === 80 ? 0.12 : 1 / 60;
      const speed = frame < 30 || frame > 180 ? 0 : 7;
      animateHeroRig(
        rig,
        frame / 60,
        speed,
        -Math.PI + frame * 0.005,
        dt,
        frame > 70 && frame < 76,
      );
      assert.ok(Number.isFinite(rig.root.rotation.y));
      assert.ok(Number.isFinite(rig.body.position.y));
      assert.ok(
        Math.abs(rig.body.position.y - previousBodyY) < 0.04,
        `${hero}: no vertical pop`,
      );
      const turn = Math.atan2(
        Math.sin(rig.root.rotation.y - previousFacing),
        Math.cos(rig.root.rotation.y - previousFacing),
      );
      assert.ok(Math.abs(turn) < 0.08, `${hero}: no facing snap`);
      for (const arm of rig.arms)
        assert.ok(
          Math.abs(arm.rotation.x) < 0.4,
          `${hero}: bounded unarmed motion`,
        );
      previousBodyY = rig.body.position.y;
      previousFacing = rig.root.rotation.y;
    }
  }
});

test("walking maintains a planted stance foot, lifts the swing foot and keeps both soles level", () => {
  for (const hero of HERO_ORDER.filter((id) => id !== "wisp")) {
    const rig = makeHero(hero);
    let time = 0;
    let highestLift = 0;
    for (let frame = 0; frame < 420; frame++) {
      const dt = frame % 3 === 0 ? 1 / 30 : 1 / 120;
      time += dt;
      const speed = frame > 320 ? 0 : 6;
      animateHeroRig(
        rig,
        time,
        speed,
        time * 0.6,
        dt,
        frame > 150 && frame < 164,
      );
      rig.root.updateMatrixWorld(true);
      const soles = rig.legs.map((leg) => {
        const ankle = leg.userData.ankle as THREE.Group;
        assert.ok(
          ankle,
          `${hero}: an articulated ankle separates the foot from the shin`,
        );
        const soleY = new THREE.Box3().setFromObject(ankle).min.y;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
          ankle.getWorldQuaternion(new THREE.Quaternion()),
        );
        assert.ok(
          up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-5,
          `${hero}: a shin cannot tilt its boot into the floor`,
        );
        assert.ok(soleY >= 0.0149, `${hero}: no boot penetration (${soleY})`);
        assert.ok(soleY < 0.14, `${hero}: no excessive hop (${soleY})`);
        highestLift = Math.max(highestLift, soleY);
        return soleY;
      });
      assert.ok(
        Math.min(...soles) < 0.0151,
        `${hero}: at least one foot stays in contact through every stride`,
      );
    }
    assert.ok(
      highestLift > 0.1,
      `${hero}: the swing foot visibly clears the floor`,
    );
  }
});

test("boot toe armor and sole do not expose overlapping coplanar colored faces", () => {
  type Face = { z: number; color: string; points: THREE.Vector2[] };
  const overlaps = (a: Face, b: Face) => {
    for (const face of [a, b]) {
      for (let i = 0; i < 3; i++) {
        const edge = face.points[(i + 1) % 3].clone().sub(face.points[i]);
        const axis = new THREE.Vector2(-edge.y, edge.x).normalize();
        const pa = a.points.map((point) => point.dot(axis));
        const pb = b.points.map((point) => point.dot(axis));
        if (
          Math.min(Math.max(...pa), Math.max(...pb)) -
            Math.max(Math.min(...pa), Math.min(...pb)) <=
          1e-7
        )
          return false;
      }
    }
    return true;
  };
  for (const hero of HERO_ORDER.filter((id) => id !== "wisp")) {
    const rig = makeHero(hero);
    for (const leg of rig.legs) {
      const faces: Face[] = [];
      for (const mesh of meshes(leg.userData.ankle)) {
        const positions = mesh.geometry.getAttribute("position");
        const normals = mesh.geometry.getAttribute("normal");
        const colors = mesh.geometry.getAttribute("color");
        const indices = mesh.geometry.index;
        for (
          let offset = 0;
          offset < (indices?.count ?? positions.count);
          offset += 3
        ) {
          const vertices = [0, 1, 2].map(
            (i) => indices?.getX(offset + i) ?? offset + i,
          );
          if (!vertices.every((i) => normals.getZ(i) > 0.999)) continue;
          const z = positions.getZ(vertices[0]);
          if (!vertices.every((i) => Math.abs(positions.getZ(i) - z) < 1e-7))
            continue;
          const i = vertices[0];
          faces.push({
            z,
            color: [colors.getX(i), colors.getY(i), colors.getZ(i)]
              .map((value) => value.toFixed(5))
              .join(","),
            points: vertices.map(
              (index) =>
                new THREE.Vector2(positions.getX(index), positions.getY(index)),
            ),
          });
        }
      }
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          if (
            faces[i].color === faces[j].color ||
            Math.abs(faces[i].z - faces[j].z) > 1e-6
          )
            continue;
          assert.equal(
            overlaps(faces[i], faces[j]),
            false,
            `${hero}: contrasting boot panels must have real depth separation`,
          );
        }
      }
    }
  }
});

test("visor lights sit in front of their optical housing with real depth separation", () => {
  for (const hero of HERO_ORDER) {
    const rig = makeHero(hero);
    const opticalParts = meshes(rig.head);
    const housing = opticalParts.find(
      (mesh) => mesh.material instanceof THREE.MeshPhysicalMaterial,
    );
    // Thorn has a pair of projecting circular goggle assemblies instead.
    if (hero === "thorn") {
      const goggles = opticalParts.filter(
        (mesh) => mesh.material instanceof THREE.MeshBasicMaterial,
      );
      assert.ok(goggles.length >= 2);
      for (const goggle of goggles) assert.ok(localBounds(goggle).min.z > 0.4);
      continue;
    }
    assert.ok(housing, `${hero}: integrated optical housing`);
    const housingBounds = localBounds(housing);
    const lenses = opticalParts.filter((mesh) => {
      if (!(mesh.material instanceof THREE.MeshBasicMaterial)) return false;
      const bounds = localBounds(mesh);
      const center = bounds.getCenter(new THREE.Vector3());
      return (
        center.x > housingBounds.min.x &&
        center.x < housingBounds.max.x &&
        center.y > housingBounds.min.y &&
        center.y < housingBounds.max.y
      );
    });
    assert.ok(lenses.length > 0, `${hero}: a readable lit optic`);
    for (const lens of lenses) {
      const depthGap = localBounds(lens).min.z - housingBounds.max.z;
      assert.ok(
        depthGap > 0.002,
        `${hero}: lens must not become coplanar with the face (${depthGap})`,
      );
    }
  }
});
