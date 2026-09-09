import { test } from "vitest";
import assert from "node:assert/strict";
import { SurvivalRun, type Enemy } from "../../lib/survival-maxx/model";
import {
  WEAPONS,
  patternCount,
  rankStatLines,
  type WeaponId,
} from "../../lib/survival-maxx/content";

const foe = (x: number, y: number): Enemy => ({
  id: 9000 + Math.round(x * 10 + y),
  kind: "grunt",
  x,
  y,
  hp: 100000,
  maxHp: 100000,
  angle: 0,
  state: "walk",
  telegraph: 0,
  attackTimer: 99,
  stateTime: 99,
  radius: 0.54,
  vx: 0,
  vy: 0,
  hitTime: 0,
  knockX: 0,
  knockY: 0,
  dashHit: -1,
  burnTime: 0,
  burnDamage: 0,
  poisonTime: 0,
  poisonDamage: 0,
  poisonStacks: 0,
  slowTime: 0,
  slowFactor: 1,
  bossTier: 0,
  bossVariant: 0,
  attackCount: 0,
  statusTick: 0,
  spawnTime: 0,
  shield: 0,
  maxShield: 0,
  healTimer: 99,
});

/** Bullets per volley and their pierce, as the hardcoded 0.8 branches produced. */
const LEGACY: Record<
  string,
  { count: (level: number) => number; pierce: (level: number) => number }
> = {
  pistol: { count: () => 2, pierce: (lv) => (lv >= 3 ? 2 : 1) },
  shotgun: { count: (lv) => (lv >= 3 ? 7 : 5), pierce: () => 1 },
  frostgun: { count: () => 3, pierce: () => 1 },
  needle: { count: () => 1, pierce: () => 2 },
  boomerang: { count: () => 1, pierce: () => 20 },
  rocket: { count: () => 1, pierce: () => 1 },
};

test("projectile weapons fire the same volleys as the 0.8 hardcoded branches", () => {
  for (const [kind, legacy] of Object.entries(LEGACY)) {
    for (const level of [1, 3, 6]) {
      const run = new SurvivalRun("ember", 5);
      run.weapons[0].kind = kind as WeaponId;
      run.weapons[0].level = level;
      run.startWave();
      run.enemies = [foe(6, 0)];
      run.step(1 / 60);
      const bullets = run.bullets.filter((b) => !b.enemy);
      assert.equal(bullets.length, legacy.count(level), `${kind} lv${level} count`);
      for (const bullet of bullets)
        assert.equal(bullet.pierce, legacy.pierce(level), `${kind} lv${level} pierce`);
      assert.equal(
        patternCount(WEAPONS[kind as WeaponId].pattern(level)),
        legacy.count(level),
      );
      assert.ok(
        rankStatLines(kind as WeaponId, level)[0].startsWith(
          `${Math.round(WEAPONS[kind as WeaponId].damage * [1, 1.5, 2.25, 3.4, 5.1, 7.7][level - 1])}`,
        ),
      );
    }
  }
  const rocket = new SurvivalRun("ember", 5);
  rocket.weapons[0].kind = "rocket";
  rocket.startWave();
  rocket.enemies = [foe(6, 0)];
  rocket.step(1 / 60);
  assert.equal(rocket.bullets[0].radius, 0.3);
  assert.equal(rocket.bullets[0].behavior?.splash, 2.5 + 0.35);
});

test("every weapon pattern is exhaustive about how it attacks", () => {
  for (const weapon of Object.values(WEAPONS))
    for (let level = 1; level <= 6; level++) {
      const spec = weapon.pattern(level);
      assert.ok(spec.kind, `${weapon.id} has a pattern`);
      assert.ok(patternCount(spec) >= 1);
    }
  assert.equal(WEAPONS.arc.pattern(2).kind, "chain");
  assert.equal(WEAPONS.railgun.pattern(1).kind, "line");
  assert.equal(WEAPONS.flame.pattern(1).kind, "cone");
  assert.equal(WEAPONS.blade.pattern(1).kind, "melee");
});
