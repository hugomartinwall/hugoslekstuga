import { test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SurvivalScene } from "../../lib/survival-maxx/scene";
import { ProjectileRenderer } from "../../lib/survival-maxx/projectiles";
import { makeHero, makeEnemy, makeEquipment } from "../../lib/survival-maxx/meshes";
import { poseHeldWeapon, weaponScale } from "../../lib/survival-maxx/weapon-pose";
import type {
  Bullet,
  Enemy,
  EventKind,
  GameEvent,
  SurvivalRun,
} from "../../lib/survival-maxx/model";
import {
  HERO_ORDER,
  WEAPONS,
  type HeroId,
  type WeaponId,
} from "../../lib/survival-maxx/content";

/*
 * Part B of 0.9.1: every simulation event has a scene handler, the handlers
 * never throw for any weapon, the ring and particle caps hold, and the
 * continuous effects (wells, status auras, player bubble) come and go with
 * the state that drives them. Everything runs without WebGL or a DOM.
 */

// Damage labels bake a canvas texture; a no-op 2D context lets that run headless.
function installCanvasStub() {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target ? target[key] : () => undefined,
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
}

/** Adding a kind to EventKind without a row here fails to compile; the matrix below walks the keys. */
const KINDS: Record<EventKind, true> = {
  spawn: true,
  fire: true,
  hit: true,
  kill: true,
  hurt: true,
  dash: true,
  pickup: true,
  explosion: true,
  arc: true,
  slash: true,
  waveStart: true,
  waveEnd: true,
  buy: true,
  upgrade: true,
  boss: true,
  lost: true,
  won: true,
  telegraph: true,
  weave: true,
  status: true,
  heal: true,
  shieldBreak: true,
  spawnMark: true,
  horde: true,
  pull: true,
  bounce: true,
  burst: true,
  crush: true,
  strike: true,
  barrier: true,
};
const EVENT_KINDS = Object.keys(KINDS) as EventKind[];
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

// The public surface plus the private methods the tests drive directly (a mapped Pick drops the private declarations).
type Probe = Pick<SurvivalScene, keyof SurvivalScene> & {
  updateBulletFx(run: SurvivalRun, dt: number, t: number, alpha: number): void;
  updateEnemyStatus(
    e: Enemy,
    r: ReturnType<typeof makeEnemy>,
    x: number,
    z: number,
    dt: number,
    t: number,
  ): { hurt: boolean; color: number; intensity: number };
  strain(
    r: ReturnType<typeof makeEnemy>,
    e: { x: number; y: number; angle: number },
    x: number,
    z: number,
    dt: number,
  ): void;
  updatePlayerFx(run: SurvivalRun, dt: number, t: number, x: number, z: number): void;
  updateLobs(dt: number): void;
  materialPool: { normal: THREE.MeshBasicMaterial[]; additive: THREE.MeshBasicMaterial[] };
};

function harness(hero: HeroId = "ember", reducedMotion = false) {
  installCanvasStub();
  const scene = Object.create(SurvivalScene.prototype) as unknown as Probe;
  const fx = new THREE.Group();
  const actors = new THREE.Group();
  const player = makeHero(hero);
  actors.add(player.root);
  // One held weapon (id 100) and one drone (id 500) so muzzle lookups have real targets.
  const heldWeapons = new Map<number, THREE.Group>();
  const weapon = makeEquipment(WEAPONS[WEAPON_IDS[0]].id, 1);
  weapon.scale.setScalar(weaponScale(WEAPON_IDS[0]));
  player.weaponMounts[0].add(weapon);
  poseHeldWeapon(player, weapon, 0, WEAPON_IDS[0]);
  heldWeapons.set(100, weapon);
  const drones = new Map<number, THREE.Group>();
  const drone = makeEquipment("gun_drone", 1);
  drone.position.set(2, 1.2, 1);
  actors.add(drone);
  drones.set(500, drone);
  const enemies = new Map();
  const grunt = makeEnemy("grunt");
  enemies.set(900, grunt);
  const ringGeometry = new THREE.RingGeometry(0.91, 1, 64);
  const thickRingGeometry = new THREE.RingGeometry(0.84, 1, 64);
  const hazardDisc = new THREE.CircleGeometry(1, 48);
  const discGeometry = new THREE.CircleGeometry(1, 40);
  const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1)
    .rotateX(Math.PI / 2)
    .translate(0, 0, 0.5);
  const sweepGeometry = new THREE.RingGeometry(0.56, 0.84, 36, 1, -0.92, 1.84);
  const aura = (col: number) =>
    Object.assign(
      new THREE.Mesh(
        thickRingGeometry,
        new THREE.MeshBasicMaterial({ color: col, transparent: true }),
      ),
      { visible: false },
    );
  Object.assign(scene, {
    fx,
    actors,
    player,
    heroId: hero,
    reducedMotion,
    time: 0,
    shake: 0,
    damageFlash: 0,
    punch: 0,
    viewPunch: 0,
    lastEmber: 0,
    particles: [],
    particleMesh: new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial(),
      900,
    ),
    rings: [],
    labels: [],
    labelTextures: new Map(),
    enemies,
    drones,
    heldWeapons,
    weaponMotion: new Map(),
    flashes: [],
    flashPool: [],
    flashConeGeometry: new THREE.ConeGeometry(0.5, 1, 8, 1, true),
    ringGeometry,
    thickRingGeometry,
    hazardDisc,
    discGeometry,
    segmentGeometry,
    sweepGeometry,
    bubbleGeometry: new THREE.SphereGeometry(1, 8, 6),
    shardGeometry: new THREE.OctahedronGeometry(0.16),
    shellGeometry: new THREE.SphereGeometry(0.17, 8, 6),
    sharedGeometries: new Set([
      ringGeometry,
      thickRingGeometry,
      hazardDisc,
      discGeometry,
      segmentGeometry,
      sweepGeometry,
    ]),
    materialPool: { normal: [], additive: [] },
    bulletFx: new Map(),
    statusRings: new Map(),
    shieldBubbles: new Map(),
    lobs: [],
    lobPool: [],
    playerBubble: Object.assign(
      new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16 }),
      ),
      { visible: false },
    ),
    barrierShards: [],
    abilityRing: aura(0x8ef2ff),
    bloodRing: aura(0x9b1030),
    wells: [],
    projectiles: new ProjectileRenderer(actors),
  });
  actors.updateMatrixWorld(true);
  return { scene, player, grunt };
}

/** A full payload for one kind: every optional field a handler might read. */
function payload(
  type: EventKind,
  weapon: WeaponId | "enemy",
  enemy: boolean,
  id: number | undefined,
): GameEvent {
  return {
    type,
    x: 1.5,
    y: -2,
    targetX: 4,
    targetY: 3,
    targetId: 900,
    amount: type === "strike" ? 0.7 : 12,
    radius: 3,
    angle: 0.7,
    weapon,
    kind: "grunt",
    enemy,
    level: 3,
    critical: type === "hit",
    status: type === "status" ? "poison" : undefined,
    id,
  };
}

test("every event kind, weapon and owner runs through handleEvents without throwing", () => {
  for (const hero of ["ember", "volt", "prism"] as HeroId[]) {
    const { scene } = harness(hero);
    for (const type of EVENT_KINDS)
      for (const weapon of [...WEAPON_IDS, "enemy" as const])
        for (const enemy of [false, true])
          // No owner, a held weapon, a drone, an enemy rig, the player (0) and an unknown id.
          for (const id of [undefined, 100, 500, 900, 0, 4242])
            scene.handleEvents([payload(type, weapon, enemy, id)]);
    assert.ok(scene.rings.length > 0, `${hero}: rings drawn`);
    assert.ok(scene.particles.length > 0, `${hero}: particles drawn`);
    assert.ok(scene.rings.length <= 160, `${hero}: ring cap`);
    assert.ok(scene.particles.length <= 850, `${hero}: particle cap`);
    scene.projectiles.dispose();
  }
});

test("hero signatures: dash, ability explosions and heals draw for every hero", () => {
  for (const hero of HERO_ORDER) {
    const { scene } = harness(hero);
    const abilityWeapons: Array<WeaponId | "enemy"> = ["arc", "flame", "frostgun", "blade", "boomerang", "flare", "pistol"];
    scene.handleEvents([
      payload("dash", "pistol", false, undefined),
      ...abilityWeapons.map((w) => ({ ...payload("explosion", w, false, undefined), id: undefined })),
      { ...payload("heal", "pistol", false, 0), id: 0 },
      { ...payload("shieldBreak", "pistol", false, 0), id: 0 },
      payload("waveStart", "pistol", false, undefined),
      payload("boss", "pistol", false, undefined),
      payload("won", "pistol", false, undefined),
      payload("lost", "pistol", false, undefined),
    ]);
    assert.ok(scene.rings.length >= 8, `${hero}: ${scene.rings.length} rings`);
    scene.projectiles.dispose();
  }
});

test("kinds without a visual are explicit no-ops", () => {
  const { scene } = harness();
  for (const type of ["buy", "upgrade", "telegraph"] as EventKind[])
    scene.handleEvents([payload(type, "pistol", false, 100)]);
  assert.equal(scene.rings.length, 0);
  assert.equal(scene.particles.length, 0);
  assert.equal(scene.labels.length, 0);
});

test("ring and particle caps hold under 300 explosions, and retired materials return to the pool", () => {
  const { scene } = harness();
  const events: GameEvent[] = [];
  for (let i = 0; i < 300; i++)
    events.push({
      ...payload("explosion", i % 3 ? "eclipse" : "rocket", false, 7000 + i),
      x: (i % 17) - 8,
      y: (i % 11) - 5,
    });
  scene.handleEvents(events);
  assert.equal(scene.rings.length, 160, "ring cap");
  assert.ok(scene.particles.length <= 850, `particles ${scene.particles.length}`);
  assert.ok(scene.fx.children.length <= 160 + 24 + 8, "retired rings leave the scene graph");
  // Nothing in the ring list owns a geometry of its own.
  for (const r of scene.rings) assert.ok(scene.sharedGeometries.has(r.mesh.geometry));
  for (let i = 0; i < 150; i++) scene.tickEffects(1 / 60);
  assert.equal(scene.rings.length, 0, "rings expire");
  assert.equal(scene.particles.length, 0, "particles expire");
  const pooled = scene.materialPool.normal.length + scene.materialPool.additive.length;
  assert.ok(pooled >= 160, `pooled materials ${pooled}`);
  // A second burst reuses the pool instead of allocating.
  scene.handleEvents(events.slice(0, 100));
  const after = scene.materialPool.normal.length + scene.materialPool.additive.length;
  assert.ok(after < pooled, "materials taken from the pool");
});

const bullet = (overrides: Partial<Bullet>): Bullet =>
  ({
    id: 31,
    x: 2,
    y: 3,
    vx: 0,
    vy: 0,
    enemy: false,
    weapon: "gravity",
    damage: 10,
    radius: 0.5,
    life: 5,
    angle: 0,
    pierce: 0,
    hitIds: [],
    level: 3,
    age: 1,
    grazed: false,
    returning: false,
    fused: true,
    timer: 2,
    behavior: {
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 0,
      life: 5,
      pierce: 0,
      pull: { radius: 4.5, force: 10, duration: 3 },
    },
    ...overrides,
  }) as Bullet;

test("a fused pull bullet gets a well group that is disposed when the bullet disappears", () => {
  const { scene } = harness();
  const run = { bullets: [bullet({})] } as unknown as SurvivalRun;
  scene.updateBulletFx(run, 1 / 60, 0.5, 1);
  assert.equal(scene.bulletFx.size, 1);
  const well = scene.bulletFx.get(31)!;
  assert.equal(well.kind, "well");
  assert.equal(well.group.children.length, 3, "dark disc, rim and inner rim");
  assert.equal(well.group.parent, scene.fx);
  assert.deepEqual(
    scene.wells.map((w) => [w.x, w.y, w.radius, w.eclipse]),
    [[2, 3, 4.5, false]],
  );
  for (let i = 0; i < 30; i++) scene.updateBulletFx(run, 1 / 60, 0.5 + i / 60, 1);
  const [disc] = well.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  assert.ok(disc.visible && disc.scale.x > 1, "the dark floor grows once fused");
  assert.ok(scene.particles.length > 0, "spiralling streaks");
  // Unfused: the floor hides, accretion continues.
  const flying = { bullets: [bullet({ fused: false })] } as unknown as SurvivalRun;
  scene.updateBulletFx(flying, 1 / 60, 2, 1);
  assert.equal(disc.visible, false);
  assert.equal(scene.wells.length, 0);
  // Gone: the group leaves the scene and its materials return to the pool.
  const before = scene.materialPool.normal.length + scene.materialPool.additive.length;
  scene.updateBulletFx({ bullets: [] } as unknown as SurvivalRun, 1 / 60, 3, 1);
  assert.equal(scene.bulletFx.size, 0);
  assert.equal(well.group.parent, null);
  assert.equal(scene.materialPool.normal.length + scene.materialPool.additive.length, before + 3);
});

test("Eclipse wells report as eclipse; tesla orbs, turrets and halos keep their own fx", () => {
  const { scene } = harness();
  const run = {
    bullets: [
      bullet({ id: 1, weapon: "eclipse" }),
      bullet({ id: 2, weapon: "tesla_orb", behavior: undefined }),
      bullet({ id: 3, weapon: "sentry", behavior: { kind: "bullet", count: 1, spread: 0, speed: 0, life: 9, pierce: 0, stationary: true } }),
      bullet({ id: 4, weapon: "halo", behavior: undefined }),
      bullet({ id: 5, weapon: "pistol", behavior: undefined }),
      bullet({ id: 6, weapon: "enemy", enemy: true, behavior: undefined }),
    ],
  } as unknown as SurvivalRun;
  for (let i = 0; i < 12; i++) scene.updateBulletFx(run, 1 / 60, i / 60, 1);
  assert.deepEqual(
    [...scene.bulletFx.entries()].map(([id, fx]) => [id, fx.kind, fx.eclipse]),
    [
      [1, "well", true],
      [2, "hum", false],
      [3, "base", false],
      [4, "hum", false],
    ],
  );
  assert.equal(scene.bulletFx.get(4)!.group.visible, false, "halo only sheds particles");
  assert.equal(scene.wells[0].eclipse, true);
  assert.ok(scene.particles.length > 0);
});

const foe = (overrides: Partial<Enemy>): Enemy =>
  ({
    id: 900,
    kind: "grunt",
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    angle: 0,
    state: "walk",
    telegraph: 0,
    attackTimer: 1,
    stateTime: 0,
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
    healTimer: 0,
    ...overrides,
  }) as Enemy;

test("status auras tint by priority and come and go with the status; elites keep a gold ring", () => {
  const { scene, grunt } = harness();
  const plain = scene.updateEnemyStatus(foe({}), grunt, 0, 0, 1 / 60, 1);
  assert.equal(plain.hurt, false);
  assert.equal(scene.statusRings.size, 0, "no ring without a status");
  const burning = scene.updateEnemyStatus(foe({ burnTime: 2, poisonTime: 2 }), grunt, 0, 0, 1 / 60, 1);
  assert.equal(burning.color, 0xff8a3a, "burn outranks poison");
  assert.equal(scene.statusRings.size, 1);
  const ring = scene.statusRings.get(900)!;
  assert.equal(ring.status.visible, true);
  assert.equal(ring.elite.visible, false);
  const frozen = scene.updateEnemyStatus(foe({ burnTime: 2, freezeTime: 1 }), grunt, 0, 0, 1 / 60, 1);
  assert.equal(frozen.color, 0x9eeaff, "frozen outranks burn");
  assert.ok(frozen.intensity > burning.intensity);
  const hit = scene.updateEnemyStatus(foe({ freezeTime: 1, hitTime: 0.1 }), grunt, 0, 0, 1 / 60, 1);
  assert.equal(hit.color, 0xffd0a8, "a fresh hit outranks every status");
  // Burn embers accumulate over time; budget-gated.
  for (let i = 0; i < 30; i++) scene.updateEnemyStatus(foe({ burnTime: 2 }), grunt, 0, 0, 1 / 60, i / 60);
  assert.ok(scene.particles.length > 0, "embers");
  scene.updateEnemyStatus(foe({ elite: true }), grunt, 0, 0, 1 / 60, 1);
  assert.equal(scene.statusRings.get(900)!.elite.visible, true);
  assert.equal(scene.statusRings.get(900)!.status.visible, false);
  scene.updateEnemyStatus(foe({}), grunt, 0, 0, 1 / 60, 1);
  assert.equal(scene.statusRings.size, 0, "the ring retires with the status");
  // Shield bubbles for any enemy with a shield pool.
  scene.updateEnemyStatus(foe({ maxShield: 40, shield: 20 }), grunt, 0, 0, 1 / 60, 1);
  const bubble = scene.shieldBubbles.get(900)!;
  assert.ok(bubble && bubble.visible);
  scene.updateEnemyStatus(foe({ maxShield: 40, shield: 0 }), grunt, 0, 0, 1 / 60, 1);
  assert.equal(bubble.visible, false, "hidden once broken");
});

test("rigs lean toward a well; never under reduced motion", () => {
  const { scene, grunt } = harness();
  scene.wells.push({ x: 3, y: 0, radius: 5, eclipse: false });
  grunt.body.rotation.set(0, 0, 0);
  scene.strain(grunt, { x: 0, y: 0, angle: 0 }, 0, 0, 1 / 60);
  assert.ok(grunt.body.rotation.x > 0.1, "leans forward toward a well ahead");
  grunt.body.rotation.set(0, 0, 0);
  scene.strain(grunt, { x: 0, y: 0, angle: Math.PI / 2 }, 0, 0, 1 / 60);
  assert.ok(Math.abs(grunt.body.rotation.x) < 1e-6 && grunt.body.rotation.z < -0.1, "a well to the right leans sideways");
  grunt.body.rotation.set(0, 0, 0);
  scene.strain(grunt, { x: 0, y: 0, angle: 0 }, 9, 9, 1 / 60);
  assert.equal(grunt.body.rotation.x, 0, "outside the radius nothing moves");
  scene.reducedMotion = true;
  scene.strain(grunt, { x: 0, y: 0, angle: 0 }, 0, 0, 1 / 60);
  assert.equal(grunt.body.rotation.x, 0, "reduced motion: no lean");
});

test("player bubble, barrier shards, Swarm ring and blood ring follow the run state", () => {
  const { scene } = harness("reaper");
  const run = (barrier: number, abilityTime = 0, stacks = 0) =>
    ({
      player: { barrier, abilityTime, dashTime: 0 },
      bloodlustStacks: stacks,
    }) as unknown as SurvivalRun;
  scene.updatePlayerFx(run(0), 1 / 60, 1, 0, 0);
  assert.equal(scene.playerBubble.visible, false);
  assert.equal(scene.bloodRing.visible, false);
  scene.updatePlayerFx(run(2, 0, 4), 1 / 60, 1, 1, 2);
  assert.equal(scene.playerBubble.visible, true);
  assert.equal(scene.barrierShards.filter((s) => s.visible).length, 2);
  assert.equal(scene.bloodRing.visible, true);
  assert.ok(scene.bloodRing.scale.x > 1.5);
  scene.updatePlayerFx(run(1, 0, 0), 1 / 60, 1.1, 1, 2);
  assert.equal(scene.barrierShards.filter((s) => s.visible).length, 1);
  assert.equal(scene.barrierShards.length, 2, "shards are kept, not rebuilt");
  assert.equal(scene.bloodRing.visible, false);
  assert.equal(scene.abilityRing.visible, false, "Swarm ring is Wisp's");
  scene.heroId = "wisp";
  scene.updatePlayerFx(run(0, 3), 1 / 60, 1.2, 1, 2);
  assert.equal(scene.abilityRing.visible, true);
  assert.equal(scene.playerBubble.visible, false);
});

test("strikes lob a shell from the muzzle to the target and land within the delay", () => {
  const { scene } = harness();
  scene.handleEvents([
    { ...payload("strike", "mortar", false, 100), amount: 0.7 },
    { ...payload("strike", "needle", false, 500), amount: 0 },
  ]);
  assert.equal(scene.lobs.length, 2);
  assert.equal(scene.lobs[1].duration, 0.3, "spray lobs still take a visible moment");
  const start = scene.lobs[0].mesh.position.clone();
  scene.updateLobs(0.35);
  const mid = scene.lobs[0].mesh.position;
  assert.ok(mid.y > start.y + 0.5, "arcs upward");
  assert.equal(scene.lobs.length, 1, "the spray droplet has landed");
  scene.updateLobs(0.4);
  assert.equal(scene.lobs.length, 0);
  assert.equal(scene.lobPool.length, 2, "shells return to the pool");
});

test("reduced motion emits fewer particles and never shakes or punches", () => {
  // A modest batch, well under the particle cap on either side.
  const events: GameEvent[] = [
    payload("explosion", "eclipse", false, 7),
    payload("fire", "thumper", false, 100),
    payload("hit", "pistol", false, 100),
    payload("dash", "pistol", false, undefined),
    payload("kill", "pistol", false, 900),
    payload("hurt", "enemy", true, undefined),
    payload("pull", "gravity", false, 7),
    payload("burst", "shatter", false, 7),
  ];
  const full = harness("volt", false);
  full.scene.handleEvents(events);
  const reduced = harness("volt", true);
  reduced.scene.handleEvents(events);
  assert.ok(full.scene.shake > 0);
  assert.equal(reduced.scene.shake, 0, "no shake");
  assert.equal(reduced.scene.punch, 0, "no view punch");
  assert.ok(full.scene.punch > 0, "Eclipse punches the view");
  assert.ok(
    reduced.scene.particles.length < full.scene.particles.length * 0.7,
    `${reduced.scene.particles.length} reduced vs ${full.scene.particles.length}`,
  );
  assert.ok(reduced.scene.rings.length > 0, "rings stay: they carry information");
});

test("reset clears every effect container and dispose is safe afterwards", () => {
  const { scene } = harness();
  scene.handleEvents([
    payload("explosion", "eclipse", false, 7),
    payload("strike", "mortar", false, 100),
  ]);
  const run = { bullets: [bullet({})] } as unknown as SurvivalRun;
  scene.updateBulletFx(run, 1 / 60, 1, 1);
  scene.updateEnemyStatus(foe({ burnTime: 1, maxShield: 10, shield: 5 }), makeEnemy("grunt"), 0, 0, 1 / 60, 1);
  scene.updatePlayerFx({ player: { barrier: 3, abilityTime: 0, dashTime: 0 }, bloodlustStacks: 0 } as unknown as SurvivalRun, 1 / 60, 1, 0, 0);
  assert.ok(scene.rings.length && scene.lobs.length && scene.bulletFx.size && scene.statusRings.size && scene.shieldBubbles.size);
  // reset() also drains the Part A containers; give the harness what it touches.
  Object.assign(scene, {
    enemyPools: new Map(),
    healthBack: { count: 0 },
    healthFill: { count: 0 },
    shieldFill: { count: 0 },
    pickupMeshes: new Map(),
    telegraphs: new Map(),
    particleMesh: { count: 0 },
    hazardMeshes: new Map(),
    spawnMarkerMeshes: new Map(),
    enemyAuras: new Map(),
    equipmentPool: new Map(),
  });
  scene.reset();
  assert.equal(scene.rings.length, 0);
  assert.equal(scene.lobs.length, 0);
  assert.equal(scene.bulletFx.size, 0);
  assert.equal(scene.statusRings.size, 0);
  assert.equal(scene.shieldBubbles.size, 0);
  assert.equal(scene.wells.length, 0);
  assert.equal(scene.playerBubble.visible, false);
  assert.ok(scene.barrierShards.every((s) => !s.visible));
  assert.equal(scene.punch, 0);
  assert.equal(scene.fx.children.filter((c) => c.visible && !(c instanceof THREE.Group)).length, 0, "nothing visible lingers in fx");
});
