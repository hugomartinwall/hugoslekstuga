import { test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SurvivalScene } from "../../lib/survival-maxx/scene";

function layoutHarness() {
  // Exercise the production projection methods without constructing WebGL or DOM.
  const scene = Object.create(SurvivalScene.prototype) as SurvivalScene;
  const container = { clientWidth: 821, clientHeight: 462 };
  const rect = { left: 0, top: 0, width: 821, height: 462 };
  const sizes: Array<[number, number]> = [];
  Object.assign(scene, {
    container,
    renderer: {
      setSize: (width: number, height: number) => sizes.push([width, height]),
      domElement: { getBoundingClientRect: () => rect },
    },
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 130),
    viewSize: 24,
    pointer: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    point: new THREE.Vector3(),
  });
  scene.resize();
  scene.camera.position.set(0, 31, 23);
  scene.camera.lookAt(0, 0, 0);
  scene.camera.updateMatrixWorld(true);
  return { scene, container, rect, sizes };
}

test("renderer size and camera aspect follow the game container", () => {
  const { scene, container, sizes } = layoutHarness();
  assert.deepEqual(sizes, [[821, 462]]);
  assert.equal(scene.camera.right, (12 * 821) / 462);
  assert.equal(scene.camera.left, (-12 * 821) / 462);
  assert.equal(scene.camera.top, 12);
  assert.equal(scene.camera.bottom, -12);

  container.clientWidth = 907;
  container.clientHeight = 510;
  scene.resize();
  assert.deepEqual(sizes.at(-1), [907, 510]);
  assert.equal(scene.camera.right, (12 * 907) / 510);
});

test("hidden containers keep finite projection and recover when shown", () => {
  const { scene, container, sizes } = layoutHarness();
  container.clientWidth = container.clientHeight = 0;
  scene.resize();
  assert.deepEqual(sizes.at(-1), [1, 1]);
  assert.ok(scene.camera.projectionMatrix.elements.every(Number.isFinite));

  container.clientWidth = 821;
  container.clientHeight = 462;
  scene.resize();
  assert.deepEqual(sizes.at(-1), [821, 462]);
  assert.equal(scene.camera.right, (12 * 821) / 462);
});

test("pointer projection follows canvas offsets and CSS scaling", () => {
  const { scene, rect } = layoutHarness();
  for (const [u, v] of [
    [0.5, 0.5],
    [0.2, 0.2],
    [0.8, 0.7],
  ]) {
    Object.assign(rect, { left: 0, top: 0, width: 821, height: 462 });
    const expected = scene.worldPoint(u * rect.width, v * rect.height)!;
    for (const scale of [1, 1.3]) {
      Object.assign(rect, {
        left: 43,
        top: 27,
        width: 821 * scale,
        height: 462 * scale,
      });
      const actual = scene.worldPoint(
        rect.left + u * rect.width,
        rect.top + v * rect.height,
      );
      assert.ok(actual);
      assert.ok(
        Math.hypot(expected.x - actual.x, expected.y - actual.y) < 1e-10,
        `world target changed at normalized (${u}, ${v}), scale ${scale}`,
      );
    }
  }
});

test("a zero-width or zero-height canvas has no pointer target", () => {
  const { scene, rect } = layoutHarness();
  rect.width = 0;
  assert.equal(scene.worldPoint(43, 27), null);
  rect.width = 821;
  rect.height = 0;
  assert.equal(scene.worldPoint(43, 27), null);
});
