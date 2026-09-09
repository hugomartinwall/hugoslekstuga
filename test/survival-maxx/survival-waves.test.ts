import { test } from "vitest";
import assert from "node:assert/strict";
import { SurvivalRun, type Enemy } from "../../lib/survival-maxx/model";
import {
  waveBudget,
  bossAddBudget,
  hordeSize,
  hordeProgress,
  eliteChance,
  ELITE,
  SPAWN_DISTANCE,
  SPAWN_TELEGRAPH,
  HORDE_RING,
  BAG_CAPACITY,
  BAG_SLOT_COST,
  MAX_EXTRA_SLOTS,
  ENEMY_STATS,
  HEROES,
} from "../../lib/survival-maxx/content";

const foe = (
  x: number,
  y: number,
  overrides: Partial<Enemy> = {},
): Enemy => ({
  id: 9000 + Math.round(Math.abs(x) * 100 + Math.abs(y) * 7),
  kind: "grunt",
  x,
  y,
  hp: 100,
  maxHp: 100,
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
  budgeted: true,
  ...overrides,
});
const advance = (run: SurvivalRun, seconds: number, input = { x: 0, y: 0 }) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.step(1 / 60, input);
};
const invulnerable = (run: SurvivalRun) => {
  run.player.hp = 1e9;
  run.player.maxHp = 1e9;
};
const disarm = (run: SurvivalRun) => {
  for (const weapon of run.weapons) weapon.cooldown = 1e9;
};

test("each wave has a fixed budget that the counter drains and the timer still ends", () => {
  assert.equal(waveBudget(1), 34);
  assert.equal(waveBudget(10), 90);
  assert.equal(waveBudget(20), 190);
  assert.equal(bossAddBudget(30), Math.round(waveBudget(30) * 0.55));
  const run = new SurvivalRun("ember", 3);
  run.startWave();
  invulnerable(run);
  disarm(run);
  assert.equal(run.waveBudget, waveBudget(1));
  assert.equal(run.remainingEnemies, run.waveBudget);
  let last = run.remainingEnemies;
  for (let frame = 0; frame < run.waveDuration * 60 - 1; frame++) {
    run.step(1 / 60);
    assert.ok(run.remainingEnemies <= last, "the counter never goes up");
    last = run.remainingEnemies;
  }
  assert.equal(run.phase, "combat");
  assert.equal(
    run.spawnedCount,
    run.waveBudget,
    "the whole budget arrives before the timer runs out",
  );
  assert.ok(run.enemies.length > 0);
  advance(run, 0.05);
  assert.equal(run.phase, "shop");
  assert.equal(run.waveOutcome, "timer");
  assert.equal(run.fullClears, 0);
  assert.equal(run.enemies.length, 0);
  assert.equal(run.pickups.length, 0, "survivors leave no emeralds");
});

test("killing the whole budget ends the wave early and counts a full clear", () => {
  const run = new SurvivalRun("ember", 3);
  run.startWave();
  invulnerable(run);
  disarm(run);
  advance(run, 2);
  for (let frame = 0; frame < 60 * 60 && run.phase === "combat"; frame++) {
    for (const enemy of run.enemies) if (enemy.spawnTime <= 0) enemy.hp = 0;
    run.step(1 / 60);
  }
  assert.equal(run.phase, "shop");
  assert.equal(run.waveOutcome, "clear");
  assert.equal(run.fullClears, 1);
  assert.ok(run.fastestClear < run.waveDuration, "cleared before the timer");
  assert.equal(run.remainingEnemies, 0);
});

test("spawns are telegraphed, land anywhere 5-14 units away, and sometimes behind you", () => {
  const run = new SurvivalRun("volt", 11);
  run.wave = 4;
  run.startWave();
  invulnerable(run);
  disarm(run);
  let behind = 0,
    markers = 0;
  for (let frame = 0; frame < 20 * 60; frame++) {
    const before = new Set(run.spawnQueue.map((m) => m.id));
    run.step(1 / 60, { x: 1, y: 0 });
    for (const marker of run.spawnQueue) {
      if (before.has(marker.id)) continue;
      markers++;
      const d = Math.hypot(marker.x - run.player.x, marker.y - run.player.y);
      if (!marker.horde) {
        assert.ok(d >= SPAWN_DISTANCE.min - 1.3, `marker ${d} too close`);
        assert.ok(d <= SPAWN_DISTANCE.max + 1.3 + 0.5, `marker ${d} too far`);
        if (marker.x < run.player.x - 2) behind++;
      }
      assert.equal(marker.delay > 0, true);
      assert.ok(Math.abs(marker.x) <= 16.2 && Math.abs(marker.y) <= 16.2);
    }
  }
  assert.ok(markers > 20);
  assert.ok(behind / markers >= 0.15, `behind fraction ${behind / markers}`);
});

test("a telegraphed enemy does not exist until the ring closes", () => {
  const run = new SurvivalRun("ember", 5);
  run.startWave();
  invulnerable(run);
  disarm(run);
  advance(run, 0.4);
  const marker = run.spawnQueue[0];
  assert.ok(marker, "the first group is queued right after the opening");
  const wasAlive = run.enemies.some((e) => e.id === marker.id);
  assert.equal(wasAlive, false);
  advance(run, SPAWN_TELEGRAPH - 0.05);
  assert.equal(run.enemies.some((e) => e.id === marker.id), false);
  advance(run, 0.1);
  const enemy = run.enemies.find((e) => e.id === marker.id);
  assert.ok(enemy, "the enemy arrives after the telegraph");
  assert.ok(enemy!.spawnTime <= 0.35);
  assert.equal(enemy!.budgeted, true);
});

test("hordes ring the player at fixed progress points with a longer telegraph", () => {
  const run = new SurvivalRun("ember", 9);
  run.wave = 4;
  run.startWave();
  invulnerable(run);
  disarm(run);
  const [first] = hordeProgress(5);
  run.time = first * run.waveDuration - 1 / 60;
  const before = run.spawnQueue.length;
  run.step(1 / 60);
  const ring = run.spawnQueue.filter((m) => m.horde);
  assert.ok(ring.length >= Math.min(hordeSize(5), 4));
  assert.ok(run.spawnQueue.length > before);
  for (const marker of ring) {
    const d = Math.hypot(marker.x - run.player.x, marker.y - run.player.y);
    assert.ok(d >= HORDE_RING.min - 0.01 && d <= HORDE_RING.max + 0.01, `ring ${d}`);
    assert.ok(marker.delay > SPAWN_TELEGRAPH);
  }
  assert.ok(run.hordeWarning > 0);
  assert.ok(run.drainEvents().some((e) => e.type === "horde"));
  assert.equal(run.hordesFired, 1);
});

test("elites appear at the documented rate and hit harder, faster and richer", () => {
  assert.equal(eliteChance(5), 0);
  assert.ok(Math.abs(eliteChance(10) - 0.064) < 1e-9);
  assert.ok(Math.abs(eliteChance(20) - 0.184) < 1e-9);
  assert.equal(eliteChance(40), 0.3);
  const run = new SurvivalRun("ember", 21);
  run.wave = 24;
  run.startWave();
  invulnerable(run);
  disarm(run);
  let elites = 0,
    total = 0;
  for (let frame = 0; frame < 40 * 60; frame++) {
    run.step(1 / 60);
    for (const enemy of run.enemies) {
      if (enemy.hp <= 0) continue;
      if (!(enemy as { seen?: boolean }).seen) {
        (enemy as { seen?: boolean }).seen = true;
        total++;
        if (enemy.elite) {
          elites++;
          assert.ok(enemy.maxHp > ENEMY_STATS[enemy.kind].hp * ELITE.hp);
          assert.ok(enemy.radius > ENEMY_STATS[enemy.kind].radius);
        }
      }
    }
    if (run.enemies.length > 40) for (const enemy of run.enemies) enemy.hp = 0;
  }
  assert.ok(total > 60);
  const rate = elites / total;
  assert.ok(rate > 0.14 && rate < 0.36, `elite rate ${rate}`);
  const elite = new SurvivalRun("ember", 21);
  elite.startWave();
  elite.enemies = [foe(3, 0, { elite: true, hp: 1 })];
  advance(elite, 0.5);
  const dropped =
    elite.earnedSalvage + elite.pickups.reduce((sum, p) => sum + p.value, 0);
  assert.ok(dropped >= ENEMY_STATS.grunt.salvage * ELITE.salvage, `elite drop ${dropped}`);
});

test("bombers that blow themselves up still drain the counter", () => {
  const run = new SurvivalRun("ember", 2);
  run.wave = 22;
  run.startWave();
  invulnerable(run);
  disarm(run);
  const bomber = foe(1.2, 0, { kind: "bomber", attackTimer: 0, stateTime: 0, hp: 48, maxHp: 48 });
  run.enemies = [bomber];
  run.spawnQueue = [];
  run.waveBudget = run.spawnedCount + 1;
  run.spawnedCount = run.waveBudget;
  const before = run.remainingEnemies;
  advance(run, 2);
  assert.ok(run.remainingEnemies < before);
});

test("the same seed reproduces spawns and the counter exactly", () => {
  const a = new SurvivalRun("thorn", 31),
    b = new SurvivalRun("thorn", 31);
  a.startWave();
  b.startWave();
  for (let frame = 0; frame < 900; frame++) {
    const input = { x: Math.sin(frame / 30), y: Math.cos(frame / 45) };
    a.step(1 / 60, input);
    b.step(1 / 60, input);
    assert.equal(a.remainingEnemies, b.remainingEnemies);
  }
  assert.deepEqual(
    a.spawnQueue.map((m) => [m.x, m.y, m.kind]),
    b.spawnQueue.map((m) => [m.x, m.y, m.kind]),
  );
});

test("extra bag slots cost 2000 emeralds each, up to four, and Flux starts with two", () => {
  const run = new SurvivalRun("ember", 1);
  run.startWave();
  run.time = run.waveDuration;
  run.step(1 / 60);
  assert.equal(run.phase, "shop");
  assert.equal(run.bagCapacity, BAG_CAPACITY);
  run.salvage = BAG_SLOT_COST - 1;
  assert.equal(run.canBuySlot(), false);
  assert.equal(run.buySlot(), false);
  run.salvage = BAG_SLOT_COST * 10;
  for (let i = 1; i <= MAX_EXTRA_SLOTS; i++) {
    assert.ok(run.buySlot());
    assert.equal(run.bagCapacity, BAG_CAPACITY + i);
  }
  assert.equal(run.canBuySlot(), false);
  assert.equal(run.salvage, BAG_SLOT_COST * (10 - MAX_EXTRA_SLOTS));
  const flux = new SurvivalRun("flux", 1);
  assert.equal(flux.bagCapacity, BAG_CAPACITY + 2);
  assert.equal(flux.extraSlots, 2);
});

test("hero signatures and downsides shape their numbers", () => {
  const rook = new SurvivalRun("ember", 1);
  rook.startWave();
  const near = foe(2, 0, { hp: 1e6, maxHp: 1e6 }),
    far = foe(9, 0, { hp: 1e6, maxHp: 1e6 });
  rook.enemies = [near];
  advance(rook, 0.4);
  const nearDamage = 1e6 - near.hp;
  const rook2 = new SurvivalRun("ember", 1);
  rook2.startWave();
  rook2.enemies = [far];
  advance(rook2, 0.8);
  const farDamage = 1e6 - far.hp;
  assert.ok(farDamage > nearDamage * 1.15, `far ${farDamage} vs near ${nearDamage}`);

  const bastion = new SurvivalRun("bastion", 1);
  assert.ok(bastion.stats.damage > 1.07 && bastion.stats.damage < 1.09);
  assert.ok(bastion.stats.attackSpeed < 0.86);

  const cinder = new SurvivalRun("cinder", 1);
  assert.equal(HEROES.cinder.setPiece[0], "thermal");
  assert.equal(cinder.synergies.find((s) => s.id === "thermal")!.count, 2);

  const frost = new SurvivalRun("frost", 1);
  frost.startWave();
  const target = foe(3, 0, { hp: 1e6, maxHp: 1e6 });
  frost.enemies = [target];
  advance(frost, 0.4);
  assert.ok(target.slowFactor < 0.8, "Frost's slows are stronger");
  assert.ok(frost.stats.attackSpeed < 0.86);

  const thorn = new SurvivalRun("thorn", 1);
  assert.equal(thorn.stats.poisonStacks, 5);

  const wisp = new SurvivalRun("wisp", 1);
  assert.equal(wisp.synergies.find((s) => s.id === "drone")!.count, 2);

  const flux = new SurvivalRun("flux", 1);
  flux.startWave();
  flux.time = flux.waveDuration;
  flux.step(1 / 60);
  assert.equal(flux.rerollCost, Math.ceil((4 + 1) * 0.5));

  const reaper = new SurvivalRun("reaper", 1);
  reaper.startWave();
  reaper.enemies = [foe(2, 0, { hp: 1 }), foe(2.5, 0.5, { hp: 1 })];
  reaper.step(1 / 60);
  assert.ok(reaper.stats.attackSpeed > 1.03, "kills build Bloodlust");

  const prism = new SurvivalRun("prism", 1);
  assert.equal(prism.stats.maxHp, Math.round(HEROES.prism.maxHp * 0.85));
  prism.bag.push({ id: 999, kind: "pistol", category: "weapon", level: 1 });
  assert.equal(prism.synergies.find((s) => s.id === "kinetic")!.count, 1);
});
