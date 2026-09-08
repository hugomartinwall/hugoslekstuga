import { test } from "vitest";
import assert from "node:assert/strict";
import { SurvivalRun } from "../../lib/survival-maxx/model";
import { interpolatedPosition } from "../../lib/survival-maxx/motion";
import { makeEnemy, animateRig } from "../../lib/survival-maxx/meshes";

for (const refreshRate of [30, 60, 120, 144, 165])
  test(`${refreshRate}Hz rendering moves smoothly between 60Hz simulation ticks`, () => {
    const run = new SurvivalRun("ember", 19);
    run.startWave();
    const delta: number[] = [];
    let last = 0;
    for (let i = 0; i < 65; i++) {
      run.step(1 / refreshRate, { x: 1, y: 0 });
      const point = interpolatedPosition(run.player, run.renderAlpha);
      if (i > 3) delta.push(point.x - last);
      last = point.x;
    }
    const expected = run.stats.speed / refreshRate;
    for (const distance of delta)
      assert.ok(
        Math.abs(distance - expected) < 1e-6,
        `render movement ${distance} versus ${expected}`,
      );
  });

test("turning across the angle boundary takes the short path without snapping", () => {
  const rig = makeEnemy("runner");
  animateRig(rig, 0, 3, Math.PI - 0.01, 1 / 144);
  const before = rig.root.rotation.y;
  animateRig(rig, 1 / 144, 3, -Math.PI + 0.01, 1 / 144);
  assert.ok(Math.abs(rig.root.rotation.y - before) < 0.02);
  for (let i = 0; i < 30; i++) animateRig(rig, i / 144, 3, 0, 1 / 144);
  assert.ok((rig.moveBlend ?? 0) > 0.5);
  assert.ok(Number.isFinite(rig.legs[0].rotation.x));
});
