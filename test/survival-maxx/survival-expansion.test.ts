import { test } from "vitest";
import assert from "node:assert/strict";
import { SurvivalRun, type Enemy, type Equipment } from "../../lib/survival-maxx/model";
import {
  WEAPONS,
  ITEMS,
  FAMILIES,
  FAMILY_ORDER,
  SET_TIERS,
  BAG_CAPACITY,
  type ItemId,
  type WeaponId,
  type FamilyId,
  type HeroId,
} from "../../lib/survival-maxx/content";

const foe = (
  x: number,
  y: number,
  overrides: Partial<Enemy> = {},
): Enemy => ({
  id: 7000 + Math.round(Math.abs(x) * 100 + Math.abs(y) * 13),
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
  ...overrides,
});
const advance = (run: SurvivalRun, seconds: number, input = { x: 0, y: 0 }) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.step(1 / 60, input);
};
let nextId = 50000;
const give = (run: SurvivalRun, kind: ItemId, level = 1): Equipment => {
  const item: Equipment = {
    id: nextId++,
    kind,
    category: ITEMS[kind].category,
    level,
  };
  run.bag.push(item);
  return item;
};
/** A run in its first shop with plenty of emeralds. */
const shop = (hero: HeroId = "ember", seed = 1) => {
  const run = new SurvivalRun(hero, seed);
  run.startWave();
  run.time = run.waveDuration;
  run.step(1 / 60);
  run.salvage = 100000;
  return run;
};
/** A stationary enemy that never touches or attacks: a target dummy. */
const dummy = (x: number, y: number, overrides: Partial<Enemy> = {}) =>
  foe(x, y, { spawnTime: 1e9, ...overrides });
/**
 * A quiet wave: the budget is spent, nothing is queued, and one frozen
 * enemy in a far corner keeps the wave from ending early.
 */
const arena = (
  hero: HeroId = "ember",
  seed = 1,
  setup?: (run: SurvivalRun) => void,
) => {
  const run = new SurvivalRun(hero, seed);
  setup?.(run);
  run.startWave();
  run.enemies = [
    foe(16, 16, { id: 1, state: "recover", stateTime: 1e9, spawnTime: 1e9 }),
  ];
  run.spawnQueue = [];
  run.waveBudget = 4;
  run.player.hp = 1e9;
  run.player.maxHp = 1e9;
  return run;
};
const targets = (run: SurvivalRun, ...list: Enemy[]) => {
  run.enemies = [run.enemies[0], ...list];
};

test("the expansion adds 23 weapons and 45 items with two weapons per family", () => {
  assert.equal(Object.keys(WEAPONS).length, 24);
  assert.equal(Object.keys(ITEMS).length, 45);
  const eclipse = WEAPONS.eclipse;
  assert.equal(eclipse.unique, true);
  assert.deepEqual(eclipse.families, FAMILY_ORDER);
  for (const family of FAMILY_ORDER) {
    const weapons = Object.values(WEAPONS).filter(
      (w) => !w.unique && w.families[0] === family,
    );
    assert.ok(weapons.length >= 2, `${family} has ${weapons.length} weapons`);
  }
  const mods = Object.values(ITEMS).filter((i) => i.category === "mod");
  assert.equal(mods.length, 8);
  assert.equal(Object.values(ITEMS).filter((i) => i.category === "drone").length, 10);
  for (const item of Object.values(ITEMS))
    assert.ok(item.description.endsWith(".") || /%|\+/.test(item.description), item.id);
});

test("every new weapon damages a nearby enemy within two seconds", () => {
  for (const kind of Object.keys(WEAPONS) as WeaponId[]) {
    const run = arena("ember", 4);
    run.weapons[0].kind = kind;
    run.weapons[0].level = WEAPONS[kind].unique ? 6 : 1;
    const target = foe(3, 0);
    targets(run, target);
    advance(run, 3);
    assert.ok(target.hp < 100000, `${kind} deals damage`);
  }
});

test("ricochet, split shot, pierce and homing change the bullets themselves", () => {
  const ricochet = arena();
  give(ricochet, "ricochet", 1);
  targets(ricochet, dummy(3, 0), dummy(3, 3), dummy(3, -3));
  advance(ricochet, 0.9);
  const hits = ricochet.enemies.slice(1).filter((e) => e.hp < 100000).length;
  assert.ok(hits >= 2, `ricochet reached ${hits} enemies`);

  const split = arena();
  give(split, "split_shot", 1);
  split.weapons[0].kind = "needle";
  targets(split, dummy(3, 0));
  advance(split, 0.2);
  assert.ok(split.bullets.some((b) => b.child), "fragments spawned on hit");
  assert.ok(split.bullets.filter((b) => b.child).every((b) => !b.splits));

  const pierce = arena();
  give(pierce, "pierce", 6);
  targets(pierce, dummy(4, 0));
  pierce.step(1 / 60);
  assert.ok(pierce.bullets.every((b) => b.pierce >= 5), "pierce added");

  const homing = arena();
  give(homing, "homing", 3);
  homing.weapons[0].kind = "needle";
  const off = dummy(4, 3);
  targets(homing, off);
  homing.step(1 / 60);
  const bullet = homing.bullets[0];
  const before = Math.atan2(bullet.vy, bullet.vx);
  advance(homing, 0.1);
  assert.ok(homing.bullets[0].vy > 0.01 || homing.bullets.length === 0, `steered ${before}`);
});

test("splash, lifesteal and double shot act on hits and attacks", () => {
  const splash = arena();
  give(splash, "splash", 1);
  const near = dummy(3, 0),
    beside = dummy(3.9, 0.4);
  targets(splash, near, beside);
  advance(splash, 0.3);
  assert.ok(beside.hp < 100000, "splash reached the neighbour");

  const leech = arena();
  give(leech, "lifesteal", 6);
  leech.player.maxHp = 200;
  leech.player.hp = 50;
  targets(leech, dummy(3, 0));
  advance(leech, 1);
  assert.ok(leech.player.hp > 50, "lifesteal heals");

  const echo = arena("ember", 7);
  give(echo, "double_shot", 6);
  assert.ok(echo.stats.echo >= 0.6);
  targets(echo, dummy(4, 0));
  advance(echo, 1);
  const fires = echo.drainEvents().filter((e) => e.type === "fire" && !e.enemy && e.id === echo.weapons[0].id).length;
  assert.ok(fires > 1 / 0.36 + 1, `double shot fired ${fires} times in a second`);
});

test("passives: attack range, shield, thorns, momentum, crit chance and crit damage", () => {
  const range = new SurvivalRun("ember", 1);
  give(range, "attack_range", 1);
  assert.ok(Math.abs(range.stats.range - 1.12) < 1e-9);

  const shield = arena();
  give(shield, "shield", 1);
  advance(shield, 12.5);
  assert.equal(shield.player.barrier, 1);
  shield.player.hp = 100;
  shield.player.maxHp = 100;
  targets(shield, foe(0.6, 0));
  advance(shield, 0.25);
  assert.equal(shield.player.hp, 100, "the shield absorbed the hit");
  assert.equal(shield.player.barrier, 0);

  const thorns = arena();
  give(thorns, "thorns", 1);
  thorns.player.hp = 1000;
  thorns.player.maxHp = 1000;
  for (const weapon of thorns.weapons) weapon.cooldown = 1e9;
  const toucher = foe(0.6, 0);
  targets(thorns, toucher);
  advance(thorns, 0.9);
  assert.ok(toucher.poisonStacks > 0, "thorns poisoned the attacker");

  const momentum = new SurvivalRun("ember", 1);
  give(momentum, "momentum", 1);
  momentum.startWave();
  const still = momentum.stats.damage;
  advance(momentum, 0.7, { x: 1, y: 0 });
  assert.ok(momentum.stats.damage > still, "moving adds damage");

  const crit = new SurvivalRun("ember", 1);
  give(crit, "crit_chance", 1);
  give(crit, "crit_damage", 1);
  // Pistol plus two Physical items is already a two-piece set: 10% + 8%.
  assert.ok(Math.abs(crit.stats.critChance - 0.18) < 1e-9);
  assert.ok(Math.abs(crit.stats.critDamage - 0.9) < 1e-9);
});

test("economy items: interest, discount, free reroll, luck and second chance", () => {
  const interest = new SurvivalRun("ember", 1);
  give(interest, "interest", 1);
  interest.startWave();
  interest.salvage = 200;
  interest.time = interest.waveDuration;
  interest.step(1 / 60);
  assert.ok(interest.salvage >= 200 + 10 + 9 + 2, `interest banked ${interest.salvage}`);

  const discount = shop();
  const before = discount.offers.map((o) => o.cost);
  give(discount, "discount", 6);
  discount.reroll();
  assert.ok(discount.offers.every((o) => o.cost <= o.baseCost));
  assert.ok(discount.offers.some((o) => o.cost < o.baseCost), `discounted ${before}`);

  const reroll = shop();
  give(reroll, "free_reroll", 1);
  assert.equal(reroll.rerollCost, 0);
  reroll.reroll();
  assert.ok(reroll.rerollCost > 0);

  const luck = new SurvivalRun("ember", 3);
  give(luck, "luck", 6);
  for (let wave = 0; wave < 12; wave++) {
    luck.startWave();
    luck.time = luck.waveDuration;
    luck.step(1 / 60);
    assert.ok(luck.offers.every((o) => o.level <= 5), "luck never offers rank VI");
  }

  const second = arena();
  give(second, "second_chance", 1);
  second.player.maxHp = 100;
  second.player.hp = 30;
  targets(second, foe(0.6, 0));
  advance(second, 0.9);
  assert.ok(second.player.hp > 40, `second chance healed to ${second.player.hp}`);
});

test("the five new drones attack, guard or poison from the bag", () => {
  for (const kind of ["torch_drone", "frost_drone", "mortar_drone", "venom_drone"] as const) {
    const run = arena("ember", 2, (r) => give(r, kind, 1));
    for (const weapon of run.weapons) weapon.cooldown = 1e9;
    const target = dummy(2.5, 0);
    targets(run, target);
    advance(run, 3);
    assert.ok(target.hp < 100000, `${kind} damaged its target`);
    if (kind === "frost_drone") assert.ok(target.slowTime > 0 || target.slowFactor < 1);
    if (kind === "venom_drone") assert.ok(target.poisonStacks > 0);
  }
  const aegis = arena("ember", 2, (r) => give(r, "aegis_drone", 1));
  advance(aegis, 0.2);
  assert.ok(aegis.player.barrier >= 1, "aegis grants a shield charge");
  const wisp = new SurvivalRun("wisp", 1);
  wisp.bag = [];
  give(wisp, "torch_drone", 1);
  wisp.startWave();
  assert.equal(wisp.canUnequipWeapon(wisp.weapons[0].id), false);
});

test("player-owned hazards never hurt the player", () => {
  const run = arena();
  run.weapons[0].kind = "mortar";
  run.player.hp = 100;
  run.player.maxHp = 100;
  targets(run, dummy(0.9, 0));
  advance(run, 1.2);
  assert.ok(run.hazards.length > 0 || run.drainEvents().some((e) => e.type === "explosion"));
  assert.equal(run.player.hp, 100);
  const flare = arena();
  flare.weapons[0].kind = "flare";
  flare.player.hp = 100;
  flare.player.maxHp = 100;
  targets(flare, dummy(1.5, 0));
  advance(flare, 2);
  assert.ok(flare.hazards.every((h) => h.owner === "player"));
  assert.equal(flare.player.hp, 100);
});

test("six pieces of one family reach tier three and its capstone", () => {
  const cores: Record<FamilyId, ItemId> = {
    kinetic: "kinetic_core",
    thermal: "thermal_core",
    storm: "storm_core",
    frost: "frost_core",
    toxic: "toxic_core",
    drone: "drone_core",
  };
  for (const family of FAMILY_ORDER) {
    const run = new SurvivalRun("ember", 1);
    for (let i = 0; i < 6; i++) give(run, cores[family], 1);
    const set = run.synergies.find((s) => s.id === family)!;
    assert.equal(set.count, 6 + (family === "kinetic" ? 1 : 0));
    assert.equal(set.tier, 3);
    assert.equal(set.next, null);
    assert.equal(set.description, FAMILIES[family].thresholds[6]);
    const stats = run.stats;
    if (family === "kinetic") {
      assert.ok(Math.abs(stats.critChance - 0.3) < 1e-9);
      assert.equal(stats.pierce, 2);
      assert.ok(Math.abs(stats.critDamage - 1) < 1e-9);
    }
    if (family === "thermal") {
      assert.ok(stats.burnDamage >= 20);
      assert.ok(stats.burnExplode > 0);
    }
    if (family === "storm") {
      assert.ok(Math.abs(stats.shockChance - 0.35) < 1e-9);
      assert.equal(stats.shockDepth, 2);
    }
    if (family === "frost") {
      assert.ok(stats.slowFactor <= 0.5);
      assert.ok(stats.frostBonus > 0);
    }
    if (family === "toxic") {
      assert.equal(stats.poisonStacks, 5);
      assert.equal(stats.toxicHealing, 4);
      assert.ok(stats.plagueSpread > 0);
    }
    if (family === "drone") {
      assert.equal(stats.droneRate, 2);
      assert.equal(stats.droneDamage, 1.5);
    }
  }
  assert.deepEqual([...SET_TIERS], [2, 4, 6]);
});

test("the shop respects minimum waves, weights and the unique Eclipse rule", () => {
  let insaneSeen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const run = new SurvivalRun("ember", seed);
    for (let wave = 1; wave <= 26; wave++) {
      run.startWave();
      if (run.isBossWave) {
        advance(run, 2);
        run.enemies = [];
        run.bossDefeated = true;
      }
      run.time = run.waveDuration;
      run.step(1 / 60);
      assert.equal(run.phase, "shop", `wave ${wave} ends`);
      for (const offer of run.offers) {
        const definition =
          offer.kind === "weapon"
            ? WEAPONS[offer.contentId as WeaponId]
            : offer.kind === "item"
              ? ITEMS[offer.contentId as ItemId]
              : null;
        if (definition && "minWave" in definition && definition.minWave)
          assert.ok(wave >= definition.minWave, `${offer.contentId} offered on wave ${wave}`);
        if (offer.contentId === "eclipse") {
          assert.ok(wave >= 20);
          assert.equal(offer.rarity, "insane");
          assert.equal(offer.level, 6);
          insaneSeen++;
        }
      }
      assert.equal(new Set(run.offers.map((o) => o.contentId)).size, run.offers.length);
    }
  }
  assert.ok(insaneSeen > 0, "Eclipse shows up for some seeds after wave 20");
  const owner = new SurvivalRun("ember", 5);
  owner.wave = 21;
  owner.startWave();
  owner.time = owner.waveDuration;
  owner.step(1 / 60);
  owner.salvage = 1e6;
  owner.bag.push({ id: 1, kind: "eclipse", category: "weapon", level: 6 });
  for (let i = 0; i < 60; i++) {
    owner.reroll();
    assert.ok(!owner.offers.some((o) => o.contentId === "eclipse"), "owned Eclipse never re-offered");
  }
  owner.bag.push({ id: 2, kind: "eclipse", category: "weapon", level: 6 });
  assert.equal(owner.canMergeEquipment(1), false, "Eclipse cannot merge");
  assert.ok(owner.bag.length <= BAG_CAPACITY);
});
