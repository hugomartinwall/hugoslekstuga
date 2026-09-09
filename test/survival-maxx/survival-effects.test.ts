import { test } from "vitest";
import assert from "node:assert/strict";
import {
  SurvivalRun,
  type Enemy,
  type Equipment,
  type GameEvent,
} from "../../lib/survival-maxx/model";
import { AudioEngine } from "../../lib/survival-maxx/audio";
import { ITEMS, type HeroId, type ItemId } from "../../lib/survival-maxx/content";

/*
 * Every signature-effect event the scene draws (Part B of 0.9.1) fires from
 * the simulation under a scripted scenario, with the payload the scene reads.
 */

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
/** A stationary enemy that never touches or attacks: a target dummy. */
const dummy = (x: number, y: number, overrides: Partial<Enemy> = {}) =>
  foe(x, y, { spawnTime: 1e9, ...overrides });
const advance = (run: SurvivalRun, seconds: number, input = { x: 0, y: 0 }) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.step(1 / 60, input);
};
/** Steps the run and returns every event in order, tagged with its step. */
type Tagged = GameEvent & { step: number };
const collect = (run: SurvivalRun, seconds: number): Tagged[] => {
  const out: Tagged[] = [];
  run.drainEvents();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    run.step(1 / 60, { x: 0, y: 0 });
    for (const e of run.drainEvents()) out.push({ ...e, step: i });
  }
  return out;
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
/** Turns a started run into a quiet wave with one frozen far enemy. */
const quiet = (run: SurvivalRun) => {
  run.enemies = [
    foe(16, 16, { id: 1, state: "recover", stateTime: 1e9, spawnTime: 1e9 }),
  ];
  run.spawnQueue = [];
  run.waveBudget = 4;
  run.player.hp = 1e9;
  run.player.maxHp = 1e9;
  return run;
};
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
  return quiet(run);
};
const targets = (run: SurvivalRun, ...list: Enemy[]) => {
  run.enemies = [run.enemies[0], ...list];
};
/** Buys one item through the shop, then starts a quiet wave with it. */
const bought = (kind: ItemId, hero: HeroId = "ember") => {
  const run = new SurvivalRun(hero, 2);
  run.startWave();
  run.time = run.waveDuration;
  run.step(1 / 60);
  assert.equal(run.phase, "shop");
  run.salvage = 1000;
  run.offers = [
    {
      id: 1,
      kind: "item",
      contentId: kind,
      title: ITEMS[kind].name,
      description: "",
      cost: 10,
      baseCost: 10,
      sold: false,
      locked: false,
      rarity: "common",
      level: 1,
    },
  ];
  assert.ok(run.buy(0), `${kind} bought`);
  run.startWave();
  quiet(run);
  for (const weapon of run.weapons) weapon.cooldown = 1e9;
  return run;
};
const only = (list: Tagged[], type: GameEvent["type"]) =>
  list.filter((e) => e.type === type);

test("pinball emits a bounce with its new heading when it ricochets", () => {
  const run = arena();
  run.weapons[0].kind = "pinball";
  const first = dummy(3, 0),
    second = dummy(3, 3);
  targets(run, first, second);
  // The ball knocks the first foe back, so compare against where it stood.
  const at = { x: first.x, y: first.y };
  const bounces = only(collect(run, 1), "bounce");
  assert.ok(bounces.length >= 1, "the ball bounced");
  const b = bounces[0];
  assert.equal(b.weapon, "pinball");
  assert.ok(typeof b.id === "number");
  assert.ok(typeof b.angle === "number");
  assert.ok(Math.abs(b.x - at.x) < 1.2 && Math.abs(b.y - at.y) < 1.2, `at ${b.x},${b.y}`);
  assert.ok(b.angle! > 0.5 && b.angle! < 2.5, `heads toward the second foe: ${b.angle}`);
});

test("shatter and hive bursts carry the child count and spread", () => {
  const shatter = arena();
  shatter.weapons[0].kind = "shatter";
  targets(shatter, dummy(3, 0));
  const shards = only(collect(shatter, 0.5), "burst");
  assert.ok(shards.length >= 1, "shatter burst");
  assert.equal(shards[0].weapon, "shatter");
  assert.equal(shards[0].amount, 6);
  assert.equal(shards[0].radius, 1);

  const hive = arena();
  hive.weapons[0].kind = "hive";
  targets(hive, dummy(3, 0));
  const pods = only(collect(hive, 0.6), "burst");
  assert.ok(pods.length >= 1, "hive burst");
  assert.equal(pods[0].weapon, "hive");
  assert.equal(pods[0].amount, 5);
  assert.equal(pods[0].radius, 0);
});

test("Eclipse pulls, crushes, collapses and storms in that order", () => {
  const run = arena();
  run.weapons[0].kind = "eclipse";
  run.weapons[0].level = 6;
  targets(run, dummy(3, 0, { hp: 1e6, maxHp: 1e6 }));
  const events = collect(run, 4);
  const pull = only(events, "pull").find((e) => e.weapon === "eclipse"),
    collapse = only(events, "explosion").find((e) => e.weapon === "eclipse"),
    storm = only(events, "arc").find((e) => e.weapon === "eclipse");
  assert.ok(pull, "pull");
  assert.ok(collapse, "collapse explosion");
  assert.ok(storm, "storm bolt");
  // The orb crushes every 0.25 s from launch; the pull phase alone lasts 3 s.
  const crushes = only(events, "crush").filter(
    (e) => e.weapon === "eclipse" && e.step > pull!.step,
  );
  assert.ok(crushes.length >= 8, `crushes after the pull: ${crushes.length}`);
  for (const c of crushes) {
    assert.equal(c.radius, 2.2);
    assert.ok(typeof c.id === "number");
  }
  assert.ok(crushes[crushes.length - 1].step <= collapse!.step, "crush before collapse");
  assert.ok(collapse!.step <= storm!.step, "collapse before the storm");
});

test("mortar shells emit a strike from the player to the landing point", () => {
  const run = arena();
  run.weapons[0].kind = "mortar";
  const target = dummy(3, 0);
  targets(run, target);
  const strikes = only(collect(run, 0.5), "strike");
  assert.ok(strikes.length >= 1, "strike");
  const s = strikes[0];
  assert.equal(s.weapon, "mortar");
  assert.equal(s.amount, 0.7);
  assert.equal(s.id, run.weapons[0].id);
  assert.ok(Math.hypot(s.targetX! - target.x, s.targetY! - target.y) < 1.5);
  assert.ok(Math.hypot(s.x - run.player.x, s.y - run.player.y) < 0.01);
});

test("mortar and venom drones emit strikes with their own ids", () => {
  const mortar = bought("mortar_drone");
  targets(mortar, dummy(2.5, 0));
  const shells = only(collect(mortar, 3), "strike");
  assert.ok(shells.length >= 1, "mortar drone fired");
  assert.equal(shells[0].id, mortar.drones[0].id);
  assert.equal(shells[0].weapon, "mortar");
  assert.equal(shells[0].amount, 0.8);
  assert.equal(shells[0].radius, 2);

  const venom = bought("venom_drone");
  targets(venom, dummy(2.5, 0));
  const sprays = only(collect(venom, 3), "strike");
  assert.ok(sprays.length >= 1, "venom drone fired");
  assert.equal(sprays[0].id, venom.drones[0].id);
  assert.equal(sprays[0].weapon, "needle");
  assert.equal(sprays[0].amount, 0);
  assert.equal(sprays[0].radius, 1.6);
});

test("barrier charges from the Aegis drone and the Shield item, and break on a hit", () => {
  const aegis = bought("aegis_drone");
  const guard = only(collect(aegis, 0.5), "barrier");
  assert.ok(guard.length >= 1, "aegis barrier");
  assert.equal(guard[0].id, aegis.drones[0].id);
  assert.ok(guard[0].amount! >= 1);
  assert.ok(!only(collect(aegis, 0.01), "pickup").some((e) => e.amount === 0));

  const shield = arena("ember", 1, (r) => give(r, "shield", 1));
  shield.player.barrier = 0;
  shield.player.barrierTimer = 0.95;
  const charges = only(collect(shield, 1.5), "barrier");
  assert.ok(charges.length >= 1, "shield item barrier");
  assert.equal(charges[0].id, 0);
  assert.ok(charges[0].amount! >= 1);

  shield.player.barrier = 1;
  shield.drainEvents();
  (shield as unknown as { hurtPlayer(d: number, o: { x: number; y: number }): void })
    .hurtPlayer(10, { x: 1, y: 0 });
  const broken = shield.drainEvents().filter((e) => e.type === "shieldBreak");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].id, 0);
  assert.equal(shield.player.barrier, 0);
});

test("hits carry the weapon and status ticks carry their status", () => {
  const run = arena("cinder");
  run.weapons[0].kind = "pistol";
  targets(run, dummy(3, 0));
  const hits = only(collect(run, 1.2), "hit");
  assert.ok(hits.some((e) => e.weapon === "pistol" && !e.status), "direct pistol hit");
  assert.ok(hits.some((e) => e.status === "burn"), "Cinder burn ticks");
});

test("Cinder spreads burn with a flame arc when a burning enemy dies", () => {
  const run = arena("cinder");
  run.weapons[0].kind = "pistol";
  const victim = dummy(3, 0, { hp: 1, maxHp: 1 }),
    neighbour = dummy(4.5, 0);
  targets(run, victim, neighbour);
  const arcs = only(collect(run, 1), "arc").filter((e) => e.weapon === "flame");
  assert.ok(arcs.length >= 1, "flame arc");
  assert.equal(arcs[0].targetId, neighbour.id);
  assert.ok(Math.abs(arcs[0].x - victim.x) < 0.5);
  assert.ok(neighbour.burnTime > 0, "neighbour burns");
});

test("Thorn's contagion emits a poison status with the spread radius", () => {
  const run = arena("thorn");
  for (const weapon of run.weapons) weapon.cooldown = 1e9;
  const victim = dummy(3, 0, {
      hp: 1,
      maxHp: 1,
      poisonTime: 3,
      poisonDamage: 100,
      poisonStacks: 1,
    }),
    neighbour = dummy(4.5, 0);
  targets(run, victim, neighbour);
  const spread = only(collect(run, 0.5), "status").filter(
    (e) => e.status === "poison" && e.radius === 2.5,
  );
  assert.ok(spread.length >= 1, "contagion status");
  assert.equal(spread[0].id, victim.id);
  assert.ok(neighbour.poisonTime > 0, "neighbour poisoned");
});

test("Reaper's bloodlust stacks on kills and fades after three seconds", () => {
  const run = arena("reaper");
  run.weapons[0].kind = "pistol";
  assert.equal(run.bloodlustStacks, 0);
  targets(run, dummy(3, 0, { hp: 1, maxHp: 1 }));
  advance(run, 1);
  assert.ok(run.bloodlustStacks >= 1, "stacked on the kill");
  advance(run, 3.2);
  assert.equal(run.bloodlustStacks, 0, "reset after 3 s");
});

/** A Web Audio stand-in that records what the engine schedules. */
function fakeAudioContext() {
  let created = 0;
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  const node = () => ({
    frequency: param(),
    gain: param(),
    Q: param(),
    type: "sine",
    buffer: null,
    loop: false,
    onended: null as null | (() => void),
    connect() {},
    disconnect() {},
    start() {},
    stop() {
      this.onended?.();
    },
  });
  const ctx = {
    currentTime: 0,
    state: "running",
    sampleRate: 48000,
    createOscillator() {
      created++;
      return node();
    },
    createGain: node,
    createBiquadFilter: node,
    createBufferSource() {
      created++;
      return node();
    },
    createBuffer: () => ({ getChannelData: () => new Float32Array(16) }),
  };
  return {
    ctx,
    scheduled: () => created,
    reset: () => {
      created = 0;
    },
  };
}

test("audio: the effect voices schedule and respect their limits", () => {
  const audio = new AudioEngine();
  const fake = fakeAudioContext();
  Object.assign(audio, {
    ctx: fake.ctx,
    effects: { gain: { value: 1 }, connect() {} },
    music: { gain: { value: 1 }, connect() {}, setTargetAtTime() {} },
    noiseBuffer: {},
  });
  for (const name of ["bounce", "pop", "chime", "eclipse-collapse", "eclipse"]) {
    fake.reset();
    fake.ctx.currentTime += 5;
    assert.doesNotThrow(() => audio.play(name), name);
    assert.ok(fake.scheduled() > 0, `${name}: resolves to a synth case`);
  }
  for (const [name, limit] of [
    ["bounce", 0.04],
    ["pop", 0.06],
    ["chime", 0.2],
    ["eclipse-collapse", 1],
  ] as const) {
    fake.ctx.currentTime += 5;
    audio.play(name);
    fake.reset();
    fake.ctx.currentTime += limit - 0.01;
    audio.play(name);
    assert.equal(fake.scheduled(), 0, `${name}: limited inside ${limit}s`);
    fake.ctx.currentTime += 0.02;
    audio.play(name);
    assert.ok(fake.scheduled() > 0, `${name}: plays again after the limit`);
  }
});
