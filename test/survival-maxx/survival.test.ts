import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BAG_CAPACITY,
  BOSS_INTERVAL,
  WAVE_CLEAR_BONUS,
  CAMPAIGN_WAVES,
  HEROES,
  HERO_ORDER,
  ITEMS,
  RANKS,
  THREATS,
  WEAPONS,
  rankScale,
  rankStatLines,
  type HeroId,
  type WeaponId,
  type ItemId,
  type FamilyId,
} from "../../lib/survival-maxx/content";
import {
  SurvivalRun,
  type Enemy,
  type ShopOffer,
  type Bullet,
} from "../../lib/survival-maxx/model";
import {
  createReviewPilot,
  purchaseReviewShop,
  prepareFinale,
  prepareReviewWave,
} from "../../lib/survival-maxx/review";

function advance(run: SurvivalRun, seconds: number, input = { x: 0, y: 0 }) {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.step(1 / 60, input);
}
function foe(x: number, y: number, overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 9000,
    kind: "grunt",
    x,
    y,
    hp: 100,
    maxHp: 100,
    angle: 0,
    state: "recover",
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
    ...overrides,
  };
}
function bullet(x: number, y: number, overrides: Partial<Bullet> = {}): Bullet {
  return {
    id: 8000,
    x,
    y,
    vx: 0,
    vy: 0,
    enemy: false,
    weapon: "pistol",
    damage: 10,
    radius: 0.2,
    life: 1,
    angle: 0,
    pierce: 1,
    hitIds: [],
    level: 1,
    age: 0,
    grazed: false,
    returning: false,
    ...overrides,
  };
}
function offer(
  kind: WeaponId | ItemId | "heal",
  level = 1,
  cost = 20,
): ShopOffer {
  return {
    id: 10000,
    kind: kind === "heal" ? "heal" : kind in WEAPONS ? "weapon" : "item",
    contentId: kind,
    title: kind,
    description: "",
    cost,
    baseCost: cost,
    locked: false,
    sold: false,
    rarity: "common",
    level,
  };
}
function shop(hero: HeroId = "ember") {
  const run = new SurvivalRun(hero, 17);
  run.phase = "shop";
  run.wave = 1;
  run.salvage = 100000;
  return run;
}
function buy(run: SurvivalRun, kind: WeaponId | ItemId, level = 1): number {
  run.offers = [offer(kind, level)];
  const before = new Set(run.equipment.map((item) => item.id));
  assert.equal(run.buy(0), true, `buy ${kind} rank ${level}`);
  return run.equipment.find((item) => !before.has(item.id))!.id;
}
function disableWeapons(run: SurvivalRun) {
  for (const weapon of run.weapons) weapon.cooldown = 999;
}
function finishCombat(run: SurvivalRun) {
  const pilot = createReviewPilot();
  for (let frame = 0; frame < 180 * 60 && run.phase === "combat"; frame++) {
    run.step(1 / 60, pilot(run, 1 / 60));
    run.drainEvents();
  }
}

test("fixed-step outcomes and interpolation remain independent of render frequency", () => {
  const a = new SurvivalRun("ember", 872),
    b = new SurvivalRun("ember", 872);
  a.startWave();
  b.startWave();
  for (let i = 0; i < 480; i++) a.step(1 / 60, { x: 0.5, y: 0.2 });
  for (let i = 0; i < 240; i++) b.step(1 / 30, { x: 0.5, y: 0.2 });
  assert.deepEqual(a.player, b.player);
  assert.deepEqual(a.enemies, b.enemies);
  assert.deepEqual(a.bullets, b.bullets);
  const run = new SurvivalRun();
  run.startWave();
  run.step(1 / 120, { x: 1, y: 0 });
  assert.equal(run.renderAlpha, 0.5);
  assert.equal(run.player.x, 0);
  run.step(1 / 120, { x: 1, y: 0 });
  assert.equal(run.player.prevX, 0);
  assert.ok(run.player.x > 0);
  assert.equal(run.renderAlpha, 0);
});

test("diagonals normalize and dash input cannot escape the arena or ignore cooldown", () => {
  const a = new SurvivalRun(),
    b = new SurvivalRun();
  a.startWave();
  b.startWave();
  advance(a, 0.25, { x: 1, y: 0 });
  advance(b, 0.25, { x: 1, y: 1 });
  assert.ok(
    Math.abs(
      Math.hypot(a.player.x, a.player.y) - Math.hypot(b.player.x, b.player.y),
    ) < 1e-9,
  );
  a.player.x = 16.2;
  assert.ok(a.dash({ x: 1, y: 0 }));
  advance(a, 0.25, { x: 1, y: 0 });
  assert.ok(a.player.x <= 16.35);
  assert.equal(a.dash({ x: 1, y: 0 }), false);
});

test("purchases create distinct instances and only explicit merges upgrade equipment", () => {
  const run = shop(),
    original = run.weapons[0].id,
    second = buy(run, "pistol"),
    spare = buy(run, "pistol");
  assert.equal(run.weapons.length, 2);
  assert.equal(run.bag.length, 1);
  assert.equal(new Set(run.equipment.map((item) => item.id)).size, 3);
  assert.ok(run.equipment.every((item) => item.level === 1));
  const money = run.salvage;
  assert.equal(run.mergeEquipment(spare), true);
  assert.equal(run.salvage, money);
  assert.equal(run.equipmentById(original), undefined);
  assert.equal(run.weapons.find((item) => item.id === spare)?.level, 2);
  assert.equal(run.weapons.find((item) => item.id === spare)?.slot, 0);
  assert.equal(run.equipmentById(second)?.level, 1);
  assert.equal(
    run.mergeEquipment(spare),
    false,
    "different ranks do not merge",
  );
});

test("merges preserve selected hand, item category and max rank atomically", () => {
  const run = shop(),
    a = buy(run, "pistol"),
    b = run.weapons[0].id;
  assert.ok(run.mergeEquipment(a));
  assert.equal(run.weapons[0].id, a);
  assert.equal(run.weapons[0].slot, 1);
  assert.equal(run.equipmentById(b), undefined);
  const x = buy(run, "power", 5),
    y = buy(run, "power", 5);
  assert.ok(run.mergeEquipment(x));
  assert.equal(run.equipmentById(x)?.level, 6);
  assert.equal(run.equipmentById(y), undefined);
  buy(run, "power", 6);
  const before = JSON.stringify({ gear: run.equipment, money: run.salvage });
  assert.equal(run.canMergeEquipment(x), false);
  assert.equal(run.mergeEquipment(x), false);
  assert.equal(run.mergeEquipment(-1), false);
  assert.equal(
    JSON.stringify({ gear: run.equipment, money: run.salvage }),
    before,
  );
  run.phase = "combat";
  assert.equal(run.mergeEquipment(a), false);
  assert.equal(run.sellEquipment(a), false);
});

test("full bag rejects purchases without losing money or gear and supports held swaps", () => {
  const run = shop();
  buy(run, "shotgun");
  const spare = buy(run, "arc");
  for (let i = 1; i < BAG_CAPACITY; i++) buy(run, "power");
  run.offers = [offer("rocket")];
  const before = JSON.stringify({
    gear: run.equipment,
    money: run.salvage,
    offer: run.offers[0],
  });
  assert.equal(run.canBuy(0), false);
  assert.equal(run.buy(0), false);
  assert.equal(
    JSON.stringify({
      gear: run.equipment,
      money: run.salvage,
      offer: run.offers[0],
    }),
    before,
  );
  const held = run.weapons[0].id;
  assert.equal(run.canUnequipWeapon(held), false);
  assert.equal(run.unequipWeapon(held), false);
  assert.equal(run.equipWeapon(spare, 0), true);
  assert.equal(run.bag.length, BAG_CAPACITY);
  assert.ok(run.bag.some((item) => item.id === held));
  assert.equal(run.weapons[0].id, spare);
  assert.equal(run.equipWeapon(spare, 1), true);
  assert.equal(run.weapons.find((w) => w.id === spare)?.slot, 1);
  assert.equal(run.equipWeapon(spare, 2), false);
  assert.equal(run.equipWeapon(-1, 0), false);
});

test("last-weapon protections and Wisp's offensive-drone exception match UI checks", () => {
  const run = shop(),
    id = run.weapons[0].id;
  assert.equal(run.canSellEquipment(id), false);
  assert.equal(run.sellEquipment(id), false);
  assert.equal(run.canUnequipWeapon(id), false);
  assert.equal(run.unequipWeapon(id), false);
  const second = buy(run, "arc");
  assert.ok(run.canUnequipWeapon(second));
  assert.ok(run.unequipWeapon(second));
  const value = run.equipmentSellValue(second),
    money = run.salvage;
  assert.ok(run.canSellEquipment(second));
  assert.ok(run.sellEquipment(second));
  assert.equal(run.salvage, money + value);
  const wisp = shop("wisp"),
    gun = wisp.weapons[0].id,
    drone = wisp.drones[0].id;
  assert.equal(wisp.weaponSlots, 1);
  assert.ok(wisp.canUnequipWeapon(gun));
  assert.ok(wisp.unequipWeapon(gun));
  assert.equal(wisp.canSellEquipment(drone), false);
  assert.equal(wisp.sellEquipment(drone), false);
  assert.ok(wisp.equipWeapon(gun, 0));
  assert.ok(wisp.sellEquipment(drone));
  assert.equal(wisp.canSellEquipment(gun), false);
  const prism = shop("prism");
  for (const kind of ["pistol", "arc", "blade"] as const) buy(prism, kind);
  assert.equal(prism.weapons.length, 4);
  buy(prism, "rocket");
  assert.equal(prism.bag.length, 1);
});

test("bag passives apply rank-scaled stats, while stored weapons remain inactive", () => {
  const run = shop(),
    initial = run.stats.damage;
  const item = buy(run, "power", 2);
  assert.equal(
    run.stats.damage,
    initial + ITEMS.power.passiveStats.damage! * rankScale(2),
  );
  buy(run, "arc");
  const before = run.synergies.map((set) => set.count);
  buy(run, "rocket", 6);
  assert.deepEqual(
    run.synergies.map((set) => set.count),
    before,
  );
  assert.ok(run.sellEquipment(item));
  assert.equal(run.stats.damage, initial);
  const vitality = buy(run, "vitality", 4);
  assert.equal(run.player.hp, run.player.maxHp);
  assert.ok(run.sellEquipment(vitality));
  assert.equal(run.player.hp, HEROES.ember.maxHp);
  assert.equal(run.player.maxHp, HEROES.ember.maxHp);
});

test("six ranks expose actual numeric effects and never regress at rank four", () => {
  assert.equal(RANKS.length, 6);
  assert.equal(RANKS[5].name, "Legendary");
  for (const kind of [...Object.keys(WEAPONS), ...Object.keys(ITEMS)] as (
    WeaponId | ItemId
  )[]) {
    assert.ok(rankStatLines(kind, 1).length);
    assert.ok(rankStatLines(kind, 6).length);
  }
  for (let level = 2; level <= 6; level++)
    assert.ok(rankScale(level) > rankScale(level - 1));
  for (const kind of ["pistol", "shotgun"] as const) {
    const counts: number[] = [];
    for (const level of [3, 4, 6]) {
      const run = new SurvivalRun();
      run.weapons[0].kind = kind;
      run.weapons[0].level = level;
      run.startWave();
      run.enemies = [foe(4, 0, { hp: 10000 })];
      run.step(1 / 60);
      counts.push(run.bullets.length);
      if (kind === "pistol") assert.ok(run.bullets.every((b) => b.pierce >= 2));
    }
    assert.ok(counts[1] >= counts[0]);
    assert.ok(counts[2] >= counts[0]);
  }
});

test("locked offers keep price and identity while rerolls provide distinct choices", () => {
  const run = prepareReviewWave("ember", 2);
  run.salvage = 10000;
  run.reroll();
  run.lockShop(0);
  const saved = { ...run.offers[0] };
  for (let roll = 0; roll < 12; roll++) {
    const money = run.salvage,
      cost = run.rerollCost;
    assert.ok(run.reroll());
    assert.equal(run.salvage, money - cost);
    assert.deepEqual(run.offers[0], saved);
    assert.equal(new Set(run.offers.map((o) => o.contentId)).size, 4);
  }
  run.lockShop();
  const money = run.salvage;
  assert.equal(run.reroll(), false);
  assert.equal(run.salvage, money);
});

test("each active instance contributes one family piece regardless of rank", () => {
  for (const family of [
    "kinetic",
    "thermal",
    "storm",
    "frost",
    "toxic",
    "drone",
  ] as FamilyId[]) {
    const run = shop();
    const kind = `${family}_core` as ItemId;
    const initial = run.synergies.find((set) => set.id === family)!.count;
    const one = buy(run, kind, 5);
    buy(run, kind, 5);
    assert.equal(
      run.synergies.find((set) => set.id === family)!.count,
      initial + 2,
    );
    assert.ok(run.synergies.find((set) => set.id === family)!.tier >= 1);
    buy(run, kind);
    buy(run, kind);
    assert.equal(run.synergies.find((set) => set.id === family)!.tier, 2);
    assert.ok(run.mergeEquipment(one));
    assert.equal(
      run.synergies.find((set) => set.id === family)!.count,
      initial + 3,
    );
    assert.equal(run.equipmentById(one)?.level, 6);
    if (family === "kinetic") {
      assert.equal(run.stats.critChance, 0.2);
      assert.equal(run.stats.pierce, 1);
    }
  }
});

test("all ten operator passives affect combat or economy as described", () => {
  assert.equal(new SurvivalRun("ember").stats.damage, 1.1);
  // Volt's Live wire plus its own Lightning piece next to the Arc coil.
  assert.equal(new SurvivalRun("volt").stats.shockChance, 0.25);
  assert.equal(new SurvivalRun("volt").stats.maxHp, 84);
  assert.equal(new SurvivalRun("bastion").stats.armor, 8);
  for (const hero of ["cinder", "frost", "thorn"] as const) {
    const run = new SurvivalRun(hero);
    run.weapons[0].kind = "pistol";
    run.startWave();
    const target = foe(3, 0, { hp: 10000, maxHp: 10000 });
    run.enemies = [target];
    advance(run, 0.35);
    if (hero === "cinder") assert.ok(target.burnTime > 0);
    if (hero === "frost")
      assert.ok(Math.abs(target.slowFactor - 0.7) < 1e-9, "Frost slows harder");
    if (hero === "thorn") assert.ok(target.poisonStacks > 0);
  }
  const wisp = new SurvivalRun("wisp");
  assert.equal(wisp.drones.length, 1);
  assert.equal(wisp.drones[0].kind, "gun_drone");
  const flux = new SurvivalRun("flux");
  flux.startWave();
  flux.pickups = [{ id: 77, x: 0, y: 0, kind: "salvage", value: 20, age: 0 }];
  flux.step(1 / 60);
  assert.equal(flux.salvage, 25);
  assert.equal(flux.stats.magnet, 3.8 * 1.5);
  const reaper = new SurvivalRun("reaper");
  reaper.startWave();
  reaper.player.hp = 100;
  reaper.enemies = [foe(2, 0, { hp: 1 })];
  reaper.step(1 / 60);
  assert.equal(reaper.player.hp, 102);
  const prism = shop("prism");
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9);
  close(prism.stats.damage, 1.05);
  buy(prism, "pistol");
  close(prism.stats.damage, 1.1);
  buy(prism, "pistol");
  close(prism.stats.damage, 1.1);
});

test("all weapons deal damage and each hand emits its own stable equipment id", () => {
  for (const kind of Object.keys(WEAPONS) as WeaponId[]) {
    const run = new SurvivalRun();
    run.weapons[0].kind = kind;
    run.startWave();
    // Mines are laid at your feet; everything else reaches out.
    const target = foe(kind === "spore_mine" ? 0.9 : 3, 0, {
      hp: 10000,
      maxHp: 10000,
    });
    run.enemies = [target];
    // Mortars, wells and turrets need a moment; direct weapons hit at once.
    advance(run, 2.5);
    assert.ok(target.hp < 10000, `${kind} deals damage`);
    assert.ok(
      run.events.some(
        (e) =>
          ["fire", "slash", "arc"].includes(e.type) &&
          e.id === run.weapons[0].id,
      ),
      `${kind} identifies its physical hand`,
    );
  }
});

test("offensive drones fire from their real interpolated positions and preserve aim", () => {
  for (const kind of ["gun_drone", "shock_drone", "orbit_drone"] as const) {
    const run = shop();
    const id = buy(run, kind, 2);
    run.startWave();
    disableWeapons(run);
    const target = foe(3, 0, { hp: 10000, maxHp: 10000 });
    run.enemies = [target];
    advance(run, 0.4);
    const drone = run.drones.find((d) => d.id === id)!;
    assert.ok(target.hp < 10000, `${kind} deals damage`);
    assert.ok(Number.isFinite(drone.prevX));
    assert.ok(Number.isFinite(drone.prevY));
    const shot = run.events.find(
      (e) => ["fire", "arc", "slash"].includes(e.type) && e.id === id,
    )!;
    assert.ok(shot);
    assert.ok(
      Math.hypot(shot.x, shot.y) > 1.7,
      "shot originates at drone, not player",
    );
    const aim = drone.aimAngle;
    run.enemies = [];
    drone.cooldown = 99;
    advance(run, 0.1);
    assert.equal(drone.aimAngle, aim);
  }
});

test("support drones heal or attract emeralds and Wisp overdrive accelerates fire", () => {
  const run = shop();
  buy(run, "repair_drone", 2);
  buy(run, "magnet_drone", 2);
  assert.ok(run.stats.magnet > 3.8);
  assert.ok(run.passiveStats.salvage! > 0);
  run.startWave();
  run.player.hp = 50;
  run.enemies = [];
  advance(run, 0.1);
  assert.equal(run.player.hp, 53);
  const a = new SurvivalRun("wisp"),
    b = new SurvivalRun("wisp");
  for (const r of [a, b]) {
    r.startWave();
    disableWeapons(r);
    r.enemies = [foe(8, 0, { hp: 100000, maxHp: 100000 })];
  }
  b.dash({ x: 0, y: 1 });
  advance(a, 2);
  advance(b, 2);
  const shots = (r: SurvivalRun) =>
    r.events.filter((e) => e.type === "fire" && e.id === r.drones[0].id).length;
  assert.ok(shots(b) > shots(a) * 1.8);
});

test("burn and poison persist after shots stop and then expire", () => {
  for (const hero of ["cinder", "thorn"] as const) {
    const run = new SurvivalRun(hero);
    run.weapons[0].kind = "pistol";
    run.startWave();
    const target = foe(3, 0, { hp: 10000, maxHp: 10000 });
    run.enemies = [target];
    advance(run, 1.2);
    disableWeapons(run);
    run.bullets = [];
    const hp = target.hp;
    advance(run, 0.5);
    assert.ok(target.hp < hp);
    if (hero === "thorn") assert.equal(target.poisonStacks, 5);
    advance(run, 4);
    assert.equal(target.burnTime, 0);
    assert.equal(target.poisonTime, 0);
  }
});

test("three moving near misses activate brief Overdrive and shop stats shed transient buffs", () => {
  const run = new SurvivalRun();
  run.startWave();
  run.enemies = [];
  run.player.hurtTime = 0;
  const original = run.stats.damage;
  run.bullets = Array.from({ length: 3 }, (_, i) =>
    bullet(0, 1.05, { id: 800 + i, vx: 20, enemy: true, weapon: "enemy" }),
  );
  run.step(1 / 60, { x: 1, y: 0 });
  assert.equal(run.weaveTime, 3.5);
  assert.equal(run.stats.damage, original * 1.25);
  run.time = run.waveDuration - 0.01;
  run.step(1 / 60);
  assert.equal(run.phase, "shop");
  assert.equal(run.weaveTime, 0);
  assert.equal(run.stats.damage, original);
});

test("the nine threats appear at their chapter boundary and never before it", () => {
  assert.deepEqual(
    THREATS.map((t) => t.wave),
    [4, 7, 10, 13, 16, 19, 22, 25, 28],
  );
  for (const threat of THREATS) {
    const run = new SurvivalRun();
    run.wave = threat.wave - 1;
    run.startWave();
    disableWeapons(run);
    // The intro enemy is telegraphed at 0.8 s and arrives after the ring closes.
    advance(run, 1.6);
    assert.equal(run.waveThreat?.kind, threat.kind);
    assert.ok(run.enemies.some((e) => e.kind === threat.kind));
    for (const enemy of run.enemies)
      if (enemy.kind !== "grunt")
        assert.ok(THREATS.find((t) => t.kind === enemy.kind)!.wave <= run.wave);
  }
  const opening = new SurvivalRun();
  opening.startWave();
  disableWeapons(opening);
  advance(opening, 10);
  assert.ok(opening.enemies.every((e) => e.kind === "grunt"));
});

test("splitters spawn three children with a contact grace period", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  run.enemies = [foe(1.4, 0, { kind: "splitter", hp: 1 })];
  run.bullets = [bullet(1.4, 0)];
  run.step(1 / 60);
  const children = run.enemies.filter((e) => e.kind === "runner");
  assert.equal(children.length, 3);
  assert.ok(children.every((e) => e.spawnTime > 0.5));
  const hp = run.player.hp;
  run.player.x = children[0].x;
  run.player.y = children[0].y;
  run.step(1 / 60);
  assert.equal(run.player.hp, hp);
});

test("shielders protect nearby allies until their breakable shield falls", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  const ally = foe(4, 0),
    shielder = foe(4, 2, {
      id: 9001,
      kind: "shielder",
      shield: 10,
      maxShield: 10,
    });
  run.enemies = [ally, shielder];
  run.bullets = [bullet(4, 0, { damage: 20 })];
  run.step(1 / 60);
  assert.equal(ally.hp, 87);
  run.bullets = [bullet(shielder.x, shielder.y, { damage: 20 })];
  run.step(1 / 60);
  assert.equal(shielder.shield, 0);
  assert.equal(shielder.hp, 90);
  assert.ok(run.events.some((e) => e.type === "shieldBreak"));
  run.bullets = [bullet(ally.x, ally.y, { damage: 20 })];
  run.step(1 / 60);
  assert.equal(ally.hp, 67);
});

test("medics repair nearby allies but cannot heal themselves or distant targets", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  const medic = foe(8, 0, { kind: "medic", hp: 40, healTimer: 0 }),
    near = foe(8, 2, { id: 9001, hp: 40 }),
    far = foe(-8, 0, { id: 9002, hp: 40 });
  run.enemies = [medic, near, far];
  run.step(1 / 60);
  assert.equal(near.hp, 48);
  assert.equal(far.hp, 40);
  assert.equal(medic.hp, 40);
  assert.ok(run.events.some((e) => e.type === "heal" && e.id === near.id));
});

test("stacked medics cannot multiply repairs against a boss-sized health pool", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  const boss = foe(9, 0, { id: 9100, kind: "boss", hp: 50000, maxHp: 100000 });
  const medics = [-1, 0, 1].map((y, i) =>
    foe(8, y, {
      id: 9110 + i,
      kind: "medic",
      hp: 500,
      maxHp: 500,
      healTimer: 0,
    }),
  );
  run.enemies = [...medics, boss];
  run.step(1 / 60);
  assert.equal(
    boss.hp,
    50110,
    "one caster-strength pulse, rather than three boss-percentage heals",
  );
  assert.equal(
    run
      .drainEvents()
      .filter((event) => event.type === "heal" && event.id === boss.id).length,
    1,
  );
  for (const medic of medics) medic.healTimer = 0;
  run.step(1 / 60);
  assert.equal(
    boss.hp,
    50110,
    "an overlapping repair cannot bypass the target's interval",
  );
});

test("opening grunts survive one starter volley without bloating late-wave health", () => {
  const run = new SurvivalRun("ember", 1);
  run.startWave();
  const first = run.enemies[0];
  advance(run, 0.55);
  assert.ok(
    first.hp > 0 && first.hp < first.maxHp,
    "the first enemy visibly absorbs a hit before dying",
  );
  advance(run, 0.5);
  assert.ok(first.hp <= 0, "a second committed volley still kills promptly");
  const late = new SurvivalRun("ember", 1);
  // The last timer wave of the campaign; the fixed +26 opening buffer is
  // about 8% of a grunt's health there and must not compound.
  const lateAge = CAMPAIGN_WAVES - 2;
  late.wave = lateAge;
  late.startWave();
  const oldLateHealth =
    24 *
    (1 + lateAge * 0.3 + lateAge * lateAge * 0.02) *
    (1 + Math.max(0, CAMPAIGN_WAVES - 2 - 9) * 0.05);
  assert.ok(
    late.enemies[0].maxHp < oldLateHealth * 1.1,
    "early pressure cannot multiply late grunt durability",
  );
});

test("early pressure punishes idle play while deliberate circling clears the opening", () => {
  for (const seed of [1, 17, 73]) {
    for (const moving of [false, true]) {
      const run = new SurvivalRun("ember", seed);
      let openingDamage = 0;
      while (
        (run.phase === "ready" || run.phase === "shop") &&
        run.wave < (moving ? BOSS_INTERVAL - 1 : BOSS_INTERVAL)
      ) {
        assert.ok(run.startWave());
        for (
          let frame = 0;
          frame < 100 * 60 && (run.phase as SurvivalRun["phase"]) === "combat";
          frame++
        ) {
          const angle = run.time * 0.5;
          const dx = Math.cos(angle) * 9 - run.player.x,
            dy = Math.sin(angle) * 9 - run.player.y;
          const distance = Math.hypot(dx, dy) || 1;
          run.step(
            1 / 60,
            moving ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 },
          );
          for (const event of run.drainEvents())
            if (run.wave === 1 && event.type === "hurt")
              openingDamage += event.amount ?? 0;
        }
        if (run.phase === "shop") purchaseReviewShop(run);
      }
      if (moving) {
        assert.equal(
          run.phase,
          "shop",
          `seed ${seed}: basic movement survives`,
        );
        assert.equal(run.wave, BOSS_INTERVAL - 1);
      } else {
        assert.ok(
          openingDamage >= 40,
          `seed ${seed}: standing still has a visible cost from wave one`,
        );
        assert.equal(
          run.phase,
          "lost",
          `seed ${seed}: a passive build cannot coast past the first boss`,
        );
      }
    }
  }
});

test("bombers warn before their blast and snipers commit their long windup aim", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  const bomber = foe(2, 0, {
    kind: "bomber",
    state: "walk",
    attackTimer: 0,
    angle: Math.PI,
  });
  run.enemies = [bomber];
  run.step(1 / 60);
  assert.equal(bomber.state, "windup");
  const hp = run.player.hp;
  advance(run, 0.7);
  assert.equal(run.player.hp, hp);
  advance(run, 0.4);
  assert.ok(run.player.hp < hp);
  assert.ok(!run.enemies.includes(bomber));
  const sniperRun = new SurvivalRun();
  sniperRun.startWave();
  disableWeapons(sniperRun);
  const sniper = foe(10, 0, {
    kind: "sniper",
    state: "walk",
    attackTimer: 0,
    angle: Math.PI,
  });
  sniperRun.enemies = [sniper];
  sniperRun.step(1 / 60);
  const aim = sniper.angle;
  advance(sniperRun, 1, { x: 0, y: 1 });
  assert.equal(sniper.angle, aim);
  assert.equal(sniperRun.bullets.length, 0);
  advance(sniperRun, 0.65);
  assert.ok(sniperRun.bullets.some((b) => b.enemy && b.pierce === 3));
});

test("sniper projectiles persist through contact but cannot repeatedly damage one player", () => {
  const run = new SurvivalRun();
  run.startWave();
  disableWeapons(run);
  run.enemies = [];
  const shot = bullet(0, 0, {
    enemy: true,
    weapon: "enemy",
    pierce: 3,
    life: 3,
  });
  run.bullets = [shot];
  run.step(1 / 60);
  const hp = run.player.hp;
  assert.equal(shot.pierce, 2);
  assert.ok(run.bullets.includes(shot));
  advance(run, 1);
  assert.equal(run.player.hp, hp);
});

test("ten boss variants occur every three waves and timeout cannot skip a boss", () => {
  const variants = [];
  for (let wave = BOSS_INTERVAL; wave <= CAMPAIGN_WAVES; wave += BOSS_INTERVAL) {
    const run = new SurvivalRun();
    run.wave = wave - 1;
    run.startWave();
    disableWeapons(run);
    run.time = run.waveDuration;
    run.step(1 / 60);
    assert.equal(run.phase, "combat");
    assert.ok(run.boss);
    assert.equal(run.boss.bossTier, wave / BOSS_INTERVAL);
    variants.push(run.boss.bossVariant);
  }
  assert.deepEqual(variants, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const run = new SurvivalRun();
  run.endless = true;
  run.wave = 97;
  run.startWave();
  assert.equal(run.isBossWave, false);
  disableWeapons(run);
  const target = foe(15, 0, { kind: "runner", hp: 100000, state: "walk" });
  run.enemies = [target];
  advance(run, 1);
  assert.ok(
    Math.hypot(target.vx, target.vy) <= 3.5 * 1.85 + 0.01,
    "ordinary enemy speed stays capped in Endless",
  );
});

test("wave transition banks drops once, clears danger and keeps purchases shop-only", () => {
  const run = new SurvivalRun();
  run.startWave();
  run.pickups = [{ id: 888, x: 16, y: 16, kind: "salvage", value: 17, age: 0 }];
  run.time = run.waveDuration - 0.01;
  run.step(1 / 60);
  assert.equal(run.phase, "shop");
  assert.ok(run.salvage >= 17 + Math.floor(WAVE_CLEAR_BONUS(1)));
  assert.equal(
    run.enemies.length +
      run.bullets.length +
      run.pickups.length +
      run.hazards.length,
    0,
  );
  const money = run.salvage;
  advance(run, 10);
  assert.equal(run.salvage, money);
  assert.ok(run.startWave());
  assert.equal(run.startWave(), false);
  assert.equal(run.buy(0), false);
});

test(
  "all ten earned 30-wave campaigns clear ten bosses and carry real equipment into Endless",
  { timeout: 240000 },
  () => {
    for (const hero of HERO_ORDER) {
      const run = prepareFinale(hero);
      assert.equal(run.phase, "shop");
      assert.equal(run.wave, CAMPAIGN_WAVES - 1);
      assert.equal(run.bossesDefeated, 9);
      assert.ok(run.earnedSalvage > 1000);
      assert.ok(run.weapons.length <= HEROES[hero].weaponSlots);
      assert.ok(run.bag.length <= run.bagCapacity);
      assert.ok(
        run.equipment.some((item) => item.level === 6),
        `${hero} can deliberately build Legendary equipment`,
      );
      assert.ok(run.startWave());
      finishCombat(run);
      assert.equal(run.phase, "won", `${hero} earned campaign`);
      assert.equal(run.bossesDefeated, 10);
      const gear = structuredClone(run.equipment),
        hp = run.player.hp;
      assert.ok(run.continueEndless());
      assert.equal(run.phase, "shop");
      assert.equal(run.continueEndless(), false);
      assert.deepEqual(run.equipment, gear);
      assert.equal(run.player.hp, hp);
      purchaseReviewShop(run);
      assert.ok(run.startWave());
      assert.equal(run.wave, CAMPAIGN_WAVES + 1);
      finishCombat(run);
      assert.equal(run.phase, "shop", `${hero} first Endless wave`);
    }
  },
);

test("mixed workshop transactions conserve equipment through merges and swaps", () => {
  const run = shop("prism");
  let randomState = 777;
  const random = () =>
    (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) /
    2 ** 32;
  const material = () =>
    run.equipment.reduce((sum, item) => sum + 2 ** (item.level - 1), 0);
  for (let turn = 0; turn < 400; turn++) {
    const gear = run.equipment,
      chosen = gear[Math.floor(random() * gear.length)];
    const action = Math.floor(random() * 5),
      before = material(),
      money = run.salvage;
    let expected = before;
    if (action === 0) {
      const kind = (["pistol", "arc", "power", "gun_drone"] as const)[
        Math.floor(random() * 4)
      ];
      const level = 1 + Math.floor(random() * 3);
      run.offers = [offer(kind, level, 3)];
      const bought = run.buy(0);
      expected += bought ? 2 ** (level - 1) : 0;
      assert.equal(run.salvage, money - (bought ? 3 : 0));
    } else if (action === 1) {
      run.mergeEquipment(chosen.id);
      assert.equal(run.salvage, money);
    } else if (action === 2) {
      run.equipWeapon(chosen.id, Math.floor(random() * 4));
      assert.equal(run.salvage, money);
    } else if (action === 3) {
      run.unequipWeapon(chosen.id);
      assert.equal(run.salvage, money);
    } else {
      const value = run.equipmentSellValue(chosen.id),
        sold = run.sellEquipment(chosen.id);
      expected -= sold ? 2 ** (chosen.level - 1) : 0;
      assert.equal(run.salvage, money + (sold ? value : 0));
    }
    assert.equal(material(), expected);
    assert.ok(run.bag.length <= 12);
    assert.ok(run.weapons.length > 0 && run.weapons.length <= 4);
    assert.equal(
      new Set(run.equipment.map((item) => item.id)).size,
      run.equipment.length,
    );
    assert.equal(
      new Set(run.weapons.map((item) => item.slot)).size,
      run.weapons.length,
    );
    assert.ok(
      run.equipment.every((item) => item.level >= 1 && item.level <= 6),
    );
  }
});

test("the fifth boss does not reveal the following chapter's splitter early", () => {
  const run = new SurvivalRun();
  run.wave = BOSS_INTERVAL * 5 - 1;
  run.startWave();
  disableWeapons(run);
  advance(run, 4);
  assert.ok(run.boss);
  assert.ok(run.enemies.every((enemy) => enemy.kind !== "splitter"));
});

test("hero dash effects apply distinct statuses and remain invulnerable during escape", () => {
  for (const hero of HERO_ORDER) {
    const run = new SurvivalRun(hero);
    run.startWave();
    disableWeapons(run);
    run.player.hurtTime = 0;
    const target = foe(0.8, 0, { hp: 10000, maxHp: 10000 });
    run.enemies = [target];
    assert.ok(run.dash({ x: 1, y: 0 }));
    run.step(1 / 60, { x: 1, y: 0 });
    assert.equal(run.player.hp, run.player.maxHp);
    if (hero === "cinder") assert.ok(target.burnTime > 0);
    if (hero === "frost") assert.equal(target.slowFactor, 0.4);
    if (hero === "thorn")
      assert.ok(run.bullets.some((b) => b.weapon === "needle"));
    if (hero === "prism")
      assert.ok(run.bullets.some((b) => b.weapon === "beam"));
    if (hero === "wisp") assert.ok(run.player.abilityTime > 3.9);
    if (hero === "volt") assert.ok(run.events.some((e) => e.type === "arc"));
    if (hero === "bastion") assert.ok(target.hp < 10000);
  }
});
