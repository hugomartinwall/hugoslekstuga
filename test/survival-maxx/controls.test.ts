import { test } from "vitest";
import assert from "node:assert/strict";
import { PointerNavigation } from "../../lib/survival-maxx/controls";

test("a stationary held pointer follows the moving camera", () => {
  const pointer = new PointerNavigation();
  let cameraX = 0;
  const project = (x: number, y: number) => ({ x: x + cameraX, y });
  pointer.begin(10, 0, project);
  assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 1, y: 0 });

  cameraX = 6;
  assert.deepEqual(pointer.input({ x: 10, y: 0 }, project), { x: 1, y: 0 });
  assert.deepEqual(pointer.target, { x: 16, y: 0 });

  pointer.move(6, 8);
  assert.deepEqual(pointer.input({ x: 6, y: 0 }, project), { x: 0.6, y: 0.8 });
});

test("a released click keeps its world destination as the camera moves", () => {
  const pointer = new PointerNavigation();
  let cameraX = 0;
  let projections = 0;
  const project = (x: number, y: number) => {
    projections++;
    return { x: x + cameraX, y };
  };
  pointer.begin(10, 0, project);
  pointer.end();
  cameraX = 20;
  pointer.move(100, 100);
  assert.equal(pointer.held, false);
  assert.deepEqual(pointer.input({ x: 5, y: 0 }, project), { x: 1, y: 0 });
  assert.deepEqual(pointer.target, { x: 10, y: 0 });
  assert.equal(projections, 1);

  assert.deepEqual(pointer.input({ x: 9.8, y: 0 }, project), { x: 0, y: 0 });
  assert.equal(pointer.target, null);
});

test("cancel and clear remove held and click movement", () => {
  const pointer = new PointerNavigation();
  const project = (x: number, y: number) => ({ x, y });
  for (const reset of [() => pointer.end(true), () => pointer.clear()]) {
    pointer.begin(10, 10, project);
    reset();
    assert.equal(pointer.held, false);
    assert.equal(pointer.target, null);
    assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 0, y: 0 });
  }
  pointer.begin(10, 10, project);
  pointer.end();
  pointer.clear();
  assert.equal(pointer.target, null);
});

test("held input recovers after keyboard precedence clears its target", () => {
  const pointer = new PointerNavigation();
  const project = (x: number, y: number) => ({ x, y });
  pointer.begin(10, 10, project);
  pointer.target = null;
  assert.deepEqual(pointer.input({ x: 10, y: 0 }, project), { x: 0, y: 1 });
  assert.deepEqual(pointer.target, { x: 10, y: 10 });
});

test("held input resumes after arrival or a temporarily missing ground projection", () => {
  const pointer = new PointerNavigation();
  let available = true;
  let cameraX = 0;
  const project = (x: number, y: number) =>
    available ? { x: x + cameraX, y } : null;
  pointer.begin(0.3, 0, project);
  assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 0, y: 0 });
  assert.equal(pointer.target, null);
  cameraX = 2;
  assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 1, y: 0 });

  available = false;
  assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 0, y: 0 });
  assert.equal(pointer.target, null);
  available = true;
  assert.deepEqual(pointer.input({ x: 0, y: 0 }, project), { x: 1, y: 0 });
});
