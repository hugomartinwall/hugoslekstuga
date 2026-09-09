import { test } from "vitest";
import assert from "node:assert/strict";
import { SurvivalRun } from "../../lib/survival-maxx/model";
import {
  MAPS,
  MAP_COUNT,
  MAP_ORDER,
  mapById,
  mapRamp,
  mapStatLines,
  mapThreatSchedule,
  THREATS,
} from "../../lib/survival-maxx/content";

test("map 1 is the base curve: no multipliers, no rule, identical simulation", () => {
  const base = MAPS[0];
  assert.equal(base.id, 1);
  assert.equal(base.rule.id, "none");
  assert.deepEqual(base.tuning, {
    hp: 1,
    damage: 1,
    speedBonus: 0,
    spawnGroup: 0,
    budget: 1,
    bossHp: 1,
    salvage: 1,
    prices: 1,
    threatShift: 0,
  });
  const a = new SurvivalRun("ember", 17),
    b = new SurvivalRun("ember", 17, 1);
  a.startWave();
  b.startWave();
  for (let frame = 0; frame < 600; frame++) {
    const input = { x: Math.sin(frame / 40), y: Math.cos(frame / 55) };
    a.step(1 / 60, input);
    b.step(1 / 60, input);
  }
  assert.equal(a.player.hp, b.player.hp);
  assert.equal(a.kills, b.kills);
  assert.equal(a.salvage, b.salvage);
  assert.equal(a.enemies.length, b.enemies.length);
});

test("maps are ordered, get harder, and describe themselves from data", () => {
  assert.equal(MAPS.length, MAP_COUNT);
  assert.deepEqual(
    MAPS.map((m) => m.id),
    MAP_ORDER,
  );
  for (let index = 1; index < MAPS.length; index++) {
    const prev = MAPS[index - 1].tuning,
      next = MAPS[index].tuning;
    assert.ok(next.hp >= prev.hp && next.damage >= prev.damage);
    assert.ok(next.budget >= prev.budget && next.bossHp >= prev.bossHp);
  }
  assert.equal(new Set(MAPS.map((m) => m.rule.id)).size, MAPS.length);
  assert.equal(new Set(MAPS.map((m) => m.key)).size, MAPS.length);
  assert.equal(mapById(0).id, 1);
  assert.equal(mapById(99).id, MAP_COUNT);
  assert.equal(mapById(NaN).id, 1);
  assert.deepEqual(mapStatLines(MAPS[0]), ["Base difficulty"]);
  assert.ok(mapStatLines(MAPS[9]).some((line) => line.includes("Enemy health")));
  assert.deepEqual(
    mapThreatSchedule(MAPS[2]).map((t) => t.wave),
    THREATS.map((t) => Math.max(1, t.wave - 3)),
  );
  assert.equal(mapRamp(1), 0.375);
  assert.equal(mapRamp(6), 1);
  assert.equal(mapRamp(30), 1);
  for (const map of MAPS) {
    assert.ok(map.name && map.tagline && map.rule.title && map.rule.description);
    assert.ok(map.palette.fogDensity > 0);
  }
});

const disarm = (run: SurvivalRun) => {
  for (const weapon of run.weapons) weapon.cooldown = 1e9;
};
const invulnerable = (run: SurvivalRun) => {
  run.player.hp = 1e9;
  run.player.maxHp = 1e9;
};
const advance = (run: SurvivalRun, seconds: number, input = { x: 0, y: 0 }) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.step(1 / 60, input);
};
const firstGrunt = (run: SurvivalRun) => {
  for (let frame = 0; frame < 600; frame++) {
    run.step(1 / 60);
    const grunt = run.enemies.find((e) => e.kind === "grunt" && e.hp > 0);
    if (grunt) return grunt;
  }
  throw new Error("no grunt spawned");
};
const atWave = (map: number, wave: number, hero: "ember" | "volt" = "ember") => {
  const run = new SurvivalRun(hero, 5, map);
  run.wave = wave - 1;
  run.startWave();
  invulnerable(run);
  disarm(run);
  return run;
};

test("map multipliers scale health, damage, bosses, budget, emeralds and prices after the ramp", () => {
  const base = atWave(1, 12),
    hard = atWave(10, 12),
    t = MAPS[9].tuning;
  assert.equal(hard.enemies[0].maxHp, base.enemies[0].maxHp * t.hp);
  assert.equal(hard.waveBudget, Math.round(base.waveBudget * t.budget));
  assert.equal(hard.groupSize, base.groupSize + t.spawnGroup);
  assert.equal(hard.enemyCap, base.enemyCap + 6 * t.spawnGroup);
  const baseBoss = atWave(1, 12);
  advance(baseBoss, 1.6);
  const hardBoss = atWave(10, 12);
  advance(hardBoss, 1.6);
  assert.ok(baseBoss.boss && hardBoss.boss);
  assert.ok(
    Math.abs(hardBoss.boss!.maxHp / baseBoss.boss!.maxHp - t.bossHp) < 1e-9,
  );
  // Contact damage against an unarmoured hero.
  const hurt = (run: SurvivalRun) => {
    run.player.hp = 1000;
    run.player.maxHp = 1000;
    run.enemies = [
      { ...run.enemies[0], x: 0.6, y: 0, spawnTime: 0, state: "walk", stateTime: 99, attackTimer: 99 },
    ];
    run.spawnQueue = [];
    run.waveBudget = run.spawnedCount;
    advance(run, 0.9);
    return 1000 - run.player.hp;
  };
  const baseHit = hurt(atWave(1, 12)),
    hardHit = hurt(atWave(10, 12));
  assert.ok(baseHit > 0);
  assert.ok(Math.abs(hardHit / baseHit - t.damage) < 1e-6, `${hardHit / baseHit}`);
  // Salvage and prices, on a timer wave.
  const shopBase = atWave(1, 13),
    shopHard = atWave(10, 13);
  for (const run of [shopBase, shopHard]) {
    run.enemies = [];
    run.spawnQueue = [];
    run.time = run.waveDuration;
    run.step(1 / 60);
  }
  assert.ok(Math.abs(shopHard.salvage - shopBase.salvage * t.salvage) <= 1);
  assert.equal(shopHard.rerollCost, Math.ceil(shopBase.rerollCost * t.prices));
  assert.ok(shopHard.offers[0].cost > shopBase.offers[0].cost);
  // The ramp softens the opening.
  const early = atWave(10, 1),
    earlyBase = atWave(1, 1);
  assert.ok(
    Math.abs(early.enemies[0].maxHp / earlyBase.enemies[0].maxHp - (1 + (t.hp - 1) * mapRamp(1))) < 1e-9,
  );
});

test("Early Threats shifts every new enemy three waves sooner", () => {
  const run = atWave(3, 1);
  assert.equal(run.waveThreat?.kind, "runner");
  const schedule = mapThreatSchedule(MAPS[2]);
  assert.deepEqual(
    schedule.map((t) => t.wave),
    [1, 4, 7, 10, 13, 16, 19, 22, 25],
  );
  advance(run, 2);
  assert.ok(run.enemies.some((e) => e.kind === "runner") || run.spawnQueue.some((m) => m.kind === "runner"));
});

test("Stampede brings runners from wave one", () => {
  const run = atWave(2, 1);
  advance(run, 8);
  assert.ok(
    run.enemies.some((e) => e.kind === "runner") || run.spawnQueue.some((m) => m.kind === "runner"),
    "runners appear on Salt Flats wave 1",
  );
  const plain = atWave(1, 1);
  advance(plain, 8);
  assert.ok(plain.enemies.every((e) => e.kind === "grunt"));
});

test("Warded Bosses spawn shielded and regrow their ward", () => {
  const run = atWave(4, 3);
  advance(run, 1.6);
  const boss = run.boss!;
  assert.ok(Math.abs(boss.shield / boss.maxHp - 0.3) < 1e-9);
  assert.equal(boss.maxShield, boss.shield);
});

test("Elites are at least one in five on Ember Vault", () => {
  const run = atWave(5, 4);
  assert.ok(run.eliteChance >= 0.2);
  assert.equal(atWave(1, 4).eliteChance, 0);
});

test("Scorched Floor burns you for standing still, never for moving", () => {
  const still = atWave(6, 2);
  still.player.hp = 100;
  still.player.maxHp = 100;
  still.enemies = [];
  still.spawnQueue = [];
  still.waveBudget = 1e6;
  advance(still, 2.2);
  assert.ok(still.player.hp < 100, "standing still burns");
  const moving = atWave(6, 2);
  moving.player.hp = 100;
  moving.player.maxHp = 100;
  moving.enemies = [];
  moving.spawnQueue = [];
  moving.waveBudget = 1e6;
  advance(moving, 2.2, { x: 1, y: 0 });
  assert.equal(moving.player.hp, 100, "moving is safe");
});

test("Volatile grunts leave a blast that hurts a player who stays", () => {
  const run = atWave(7, 2);
  run.player.hp = 500;
  run.player.maxHp = 500;
  const grunt = firstGrunt(run);
  advance(run, 0.6);
  grunt.x = run.player.x + 0.8;
  grunt.y = run.player.y;
  grunt.hp = 0.001;
  // A frozen enemy far away keeps the wave, and its hazards, alive.
  run.enemies = [
    grunt,
    { ...grunt, id: 1, x: 16, y: 16, hp: 1e6, maxHp: 1e6, state: "recover", stateTime: 1e9, spawnTime: 1e9 },
  ];
  run.spawnQueue = [];
  run.waveBudget = run.spawnedCount;
  for (const weapon of run.weapons) weapon.cooldown = 0;
  advance(run, 0.3);
  assert.ok(run.hazards.length > 0, "a burst is telegraphed");
  advance(run, 0.6);
  assert.ok(run.player.hp < 500, "the burst hurt the player");
});

test("Fog shortens weapon and drone reach by a quarter", () => {
  const foggy = atWave(8, 2);
  for (const weapon of foggy.weapons) weapon.cooldown = 0;
  foggy.weapons[0].kind = "railgun";
  const far = { ...foggy.enemies[0], x: 16, y: 0, hp: 1e6, maxHp: 1e6 };
  foggy.enemies = [far];
  foggy.spawnQueue = [];
  foggy.waveBudget = foggy.spawnedCount;
  advance(foggy, 0.5);
  assert.equal(far.hp, 1e6, "19 reach becomes 14.25 in fog");
  far.x = 13;
  advance(foggy, 1.5);
  assert.ok(far.hp < 1e6, "closer targets are hit");
});

test("Boss Gauntlet has a boss every two waves without inflating boss health", () => {
  const run = atWave(9, 2);
  assert.equal(run.isBossWave, true);
  assert.equal(run.waveDuration, 60);
  advance(run, 1.6);
  assert.ok(run.boss);
  const standard = atWave(1, 3);
  advance(standard, 1.6);
  assert.ok(run.boss!.maxHp < standard.boss!.maxHp, "a wave-2 boss is younger than a wave-3 boss");
  const names = [2, 4, 6].map((wave) => atWave(9, wave).bossName);
  assert.equal(new Set(names).size, 3);
  const endless = new SurvivalRun("ember", 5, 9);
  endless.endless = true;
  endless.wave = 31;
  endless.startWave();
  assert.equal(endless.isBossWave, true);
});

test("Twin Finale needs both bosses dead before wave 30 ends", () => {
  const run = atWave(10, 30);
  advance(run, 1.6);
  const bosses = run.enemies.filter((e) => e.kind === "boss");
  assert.equal(bosses.length, 2);
  assert.notEqual(bosses[0].bossVariant, bosses[1].bossVariant);
  bosses[0].hp = 0;
  run.bossDefeated = true;
  run.step(1 / 60);
  assert.equal(run.phase, "combat", "one boss down is not enough");
  bosses[1].hp = 0;
  run.step(1 / 60);
  assert.equal(run.phase, "won");
});
