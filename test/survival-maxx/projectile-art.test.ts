import { test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PROJECTILE_ART,
  SHAPE_GEOMETRY,
  SHAPE_CLASSES,
  SHAPE_BUDGET,
  COMPLEX_BUDGET,
  COMPLEX_KINDS,
  GLOW_BUDGET,
  TRAIL_BUDGET,
  TRAIL_SEGMENTS,
  MUZZLE_LERP,
  FLASH_CLASS,
  MUZZLE_FLASH,
  artKeyFor,
  resolveArt,
  glowTexture,
  makeComplexProjectile,
  isComplex,
  type ArtKey,
} from "../../lib/survival-maxx/projectile-art";
import {
  ProjectileRenderer,
  type RenderBullet,
  type ProjectileContext,
} from "../../lib/survival-maxx/projectiles";
import { SurvivalScene } from "../../lib/survival-maxx/scene";
import { SurvivalRun, type Enemy } from "../../lib/survival-maxx/model";
import { makeHero } from "../../lib/survival-maxx/hero-rigs";
import { makeEquipment } from "../../lib/survival-maxx/equipment-art";
import { poseHeldWeapon, weaponScale } from "../../lib/survival-maxx/weapon-pose";
import {
  WEAPONS,
  HEROES,
  HERO_ORDER,
  ITEMS,
  type HeroId,
  type WeaponId,
} from "../../lib/survival-maxx/content";

const EXTRA_KEYS: ArtKey[] = ["enemy", "enemy-sniper", "enemy-boss", "drone-pistol"];
const finite = (v: THREE.Vector3) => [v.x, v.y, v.z].every(Number.isFinite);

test("the projectile registry covers every weapon plus the enemy and drone rows", () => {
  const keys = new Set(Object.keys(PROJECTILE_ART));
  for (const id of Object.keys(WEAPONS)) assert.ok(keys.has(id), `art for ${id}`);
  for (const key of EXTRA_KEYS) assert.ok(keys.has(key), `art for ${key}`);
  assert.equal(keys.size, Object.keys(WEAPONS).length + EXTRA_KEYS.length);
  for (const [key, art] of Object.entries(PROJECTILE_ART)) {
    assert.ok(
      (SHAPE_CLASSES as readonly string[]).includes(art.shape) ||
        (COMPLEX_KINDS as readonly string[]).includes(art.shape),
      `${key} names a shape`,
    );
    assert.ok(art.size.every((n) => n > 0 && Number.isFinite(n)), `${key} size`);
    assert.ok(Number.isFinite(art.height) && art.height >= 0, `${key} height`);
    assert.ok(Number.isInteger(art.core) && Number.isInteger(art.rim), `${key} colours`);
  }
  // The signature bodies from the plan.
  assert.equal(PROJECTILE_ART.thumper.shape, "ringwave");
  assert.equal(PROJECTILE_ART.tesla_orb.shape, "orb");
  assert.equal(PROJECTILE_ART.gravity.shape, "singularity");
  assert.equal(PROJECTILE_ART.eclipse.shape, "singularity");
  assert.equal(PROJECTILE_ART.spore_mine.shape, "mine");
  assert.equal(PROJECTILE_ART.sentry.shape, "turret");
  assert.ok(PROJECTILE_ART.rocket.puff, "rockets smoke");
  assert.ok(PROJECTILE_ART["enemy-sniper"].trail, "sniper tracers trail");
  // Flash tables are total too.
  for (const id of Object.keys(WEAPONS)) assert.ok(FLASH_CLASS[id as WeaponId], `flash class for ${id}`);
  for (const spec of Object.values(MUZZLE_FLASH)) assert.ok(spec.particles >= 0 && spec.force > 0);
});

test("variants resolve by bullet state and are memoised", () => {
  const base = { weapon: "boomerang", enemy: false, returning: false };
  const plain = resolveArt("boomerang", base);
  assert.equal(plain, PROJECTILE_ART.boomerang);
  const back = resolveArt("boomerang", { ...base, returning: true });
  assert.notEqual(back.core, plain.core);
  assert.ok((back.spin ?? 0) > (plain.spin ?? 0));
  assert.equal(resolveArt("boomerang", { ...base, returning: true }), back, "memoised");
  const wasp = resolveArt("hive", { weapon: "hive", enemy: false, child: true });
  assert.equal(wasp.shape, "dart");
  assert.ok(wasp.trail);
  const fragment = resolveArt("pistol", { weapon: "pistol", enemy: false, child: true });
  assert.ok(fragment.size[0] < PROJECTILE_ART.pistol.size[0], "generic fragments shrink");
  const fusedWell = resolveArt("gravity", { weapon: "gravity", enemy: false, fused: true });
  assert.ok((fusedWell.spin ?? 0) > (PROJECTILE_ART.gravity.spin ?? 0));
  // Key selection: enemy kinds and drone shots.
  assert.equal(artKeyFor({ weapon: "enemy", enemy: true, source: "sniper" }), "enemy-sniper");
  assert.equal(artKeyFor({ weapon: "enemy", enemy: true, source: "boss" }), "enemy-boss");
  assert.equal(artKeyFor({ weapon: "enemy", enemy: true, source: "grunt" }), "enemy");
  assert.equal(artKeyFor({ weapon: "pistol", enemy: false, ownerId: 9 }, (id) => id === 9), "drone-pistol");
  assert.equal(artKeyFor({ weapon: "pistol", enemy: false, ownerId: 9 }, () => false), "pistol");
  assert.equal(artKeyFor({ weapon: "nonsense", enemy: false }), "pistol");
});

test("shape geometries are finite, centred on the flight axis and taper toward +Z", () => {
  for (const shape of SHAPE_CLASSES) {
    const geometry = SHAPE_GEOMETRY[shape]();
    const position = geometry.getAttribute("position");
    assert.ok(position.count > 0, `${shape} has vertices`);
    let minZ = Infinity,
      maxZ = -Infinity,
      noseRadius = 0,
      tailRadius = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i),
        y = position.getY(i),
        z = position.getZ(i);
      assert.ok([x, y, z].every(Number.isFinite), `${shape} finite`);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getY(i));
      const z = position.getZ(i);
      if (z > maxZ - 1e-3) noseRadius = Math.max(noseRadius, r);
      if (z < minZ + 1e-3) tailRadius = Math.max(tailRadius, r);
    }
    assert.ok(maxZ > 0 && minZ < 0, `${shape} spans the flight axis`);
    assert.ok(Math.abs(maxZ + minZ) < 0.05, `${shape} is centred (${minZ}, ${maxZ})`);
    if (shape === "streak" || shape === "dart")
      assert.ok(noseRadius < tailRadius, `${shape} nose (${noseRadius}) narrower than tail (${tailRadius})`);
    geometry.dispose();
  }
  const texture = glowTexture();
  assert.equal(texture.image.width, 32);
  assert.equal(glowTexture(), texture, "one shared glow texture");
  const data = texture.image.data as Uint8Array;
  assert.ok(data[(16 * 32 + 16) * 4 + 3] > 200, "bright centre");
  assert.equal(data[3], 0, "transparent corner");
});

test("complex bodies build for every kind, animate through their cues and expose the turret muzzle", () => {
  for (const kind of COMPLEX_KINDS) {
    const art = Object.values(PROJECTILE_ART).find((a) => a.shape === kind)!;
    const body = makeComplexProjectile(kind, art, 3);
    assert.equal(body.kind, kind);
    assert.ok(body.group.children.length > 0);
    for (let i = 0; i < 30; i++)
      body.animate(
        { radius: 0.5, age: i / 60, life: 12 - i / 60, angle: 1, timer: 1.2 - i / 30, fused: i > 10 },
        art,
        i / 60,
        1 / 60,
        i % 2 === 0,
      );
    body.group.updateMatrixWorld(true);
    body.group.traverse((o) => {
      assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${kind} finite matrices`);
    });
    if (kind === "turret") {
      const out = new THREE.Vector3();
      assert.ok(body.muzzle, "turrets expose a muzzle");
      body.muzzle!(out);
      assert.ok(finite(out) && out.y > 0.2, `turret muzzle above the floor (${out.y})`);
      const bounds = new THREE.Box3().setFromObject(body.group);
      assert.ok(bounds.min.y > -0.05, "the turret stands on the floor");
    }
    body.dispose();
  }
});

function context(overrides: Partial<ProjectileContext> = {}): ProjectileContext {
  return {
    alpha: 1,
    time: 0,
    dt: 1 / 60,
    cameraQuaternion: new THREE.Quaternion(),
    reducedMotion: false,
    muzzleWorld: () => false,
    isDrone: () => false,
    puff: () => undefined,
    ...overrides,
  };
}
function synth(id: number, key: ArtKey, overrides: Partial<RenderBullet> = {}): RenderBullet {
  const art = PROJECTILE_ART[key];
  const complex = isComplex(art.shape);
  return {
    id,
    x: (id % 20) - 10,
    y: Math.floor(id / 20) - 10,
    angle: id * 0.37,
    radius: 0.2,
    age: 0.2,
    life: 3,
    level: 1 + (id % 6),
    enemy: key.startsWith("enemy"),
    weapon: key.startsWith("enemy") ? "enemy" : key === "drone-pistol" ? "pistol" : key,
    source: key === "enemy-sniper" ? "sniper" : key === "enemy-boss" ? "boss" : undefined,
    behavior: complex && key !== "gravity" && key !== "eclipse" && key !== "tesla_orb" ? { stationary: true } : undefined,
    ...overrides,
  };
}

test("400 bullets over 40 frames stay within every budget, and dead bullets return to the pools", () => {
  const parent = new THREE.Group();
  const renderer = new ProjectileRenderer(parent);
  const keys = Object.keys(PROJECTILE_ART) as ArtKey[];
  const bullets: RenderBullet[] = [];
  for (let i = 0; i < 400; i++) bullets.push(synth(i + 1, keys[i % keys.length]));
  // Weight the complex kinds past their pools so the fallbacks engage.
  for (let i = 0; i < 30; i++) bullets.push(synth(1001 + i, "spore_mine"));
  for (let i = 0; i < 10; i++) bullets.push(synth(2001 + i, "sentry"));
  for (let i = 0; i < 10; i++) bullets.push(synth(3001 + i, "gravity", { fused: true, timer: 0.2 }));
  let puffs = 0;
  const ctx = context({ puff: () => puffs++ });
  for (let frame = 0; frame < 40; frame++) {
    ctx.time = frame / 60;
    for (const b of bullets) {
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += Math.cos(b.angle) * 0.3;
      b.y += Math.sin(b.angle) * 0.3;
      b.age += 1 / 60;
    }
    renderer.update(bullets, ctx);
    const stats = renderer.stats();
    for (const shape of SHAPE_CLASSES)
      assert.ok(stats.instances[shape] <= SHAPE_BUDGET[shape], `${shape} ${stats.instances[shape]} <= ${SHAPE_BUDGET[shape]}`);
    assert.ok(stats.glows <= GLOW_BUDGET);
    assert.ok(stats.trails <= TRAIL_BUDGET * TRAIL_SEGMENTS);
    for (const kind of COMPLEX_KINDS)
      assert.ok(stats.complex[kind] <= COMPLEX_BUDGET[kind], `${kind} ${stats.complex[kind]} <= ${COMPLEX_BUDGET[kind]}`);
    assert.equal(stats.states, bullets.length);
  }
  const stats = renderer.stats();
  assert.equal(stats.complex.mine, COMPLEX_BUDGET.mine);
  assert.equal(stats.complex.turret, COMPLEX_BUDGET.turret);
  assert.ok(stats.fallbacks > 0, "overflowing complex bodies fell back to balls");
  assert.ok(stats.trails > 0 && stats.glows > 0);
  assert.ok(puffs > 0, "rockets and flares puffed smoke");
  for (const shape of SHAPE_CLASSES) {
    const mesh = renderer.shapes[shape];
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      assert.ok(m.elements.every(Number.isFinite), `${shape} instance ${i} finite`);
    }
  }
  renderer.update([], ctx);
  assert.equal(renderer.stats().states, 0);
  for (const kind of COMPLEX_KINDS) assert.equal(renderer.stats().complex[kind], 0);
  assert.ok(renderer.complexPools.get("mine")!.length === COMPLEX_BUDGET.mine, "mines returned to their pool");
  // Reduced motion draws bodies only.
  renderer.update(bullets, context({ reducedMotion: true }));
  assert.equal(renderer.stats().trails, 0);
  assert.equal(renderer.stats().glows, 0);
  assert.ok(renderer.stats().instances.streak > 0);
  renderer.dispose();
  assert.equal(parent.children.length, 0);
});

test("a fresh player bullet slides out of its owner's muzzle over the first 0.12 s", () => {
  const renderer = new ProjectileRenderer(new THREE.Group());
  const muzzle = new THREE.Vector3(5, 1.6, -3);
  const ctx = context({ muzzleWorld: (id, out) => (id === 4 ? (out.copy(muzzle), true) : false) });
  const bullet = synth(1, "pistol", { x: 0, y: 0, age: 0, ownerId: 4, radius: 0.12 });
  const at = () => {
    const m = new THREE.Matrix4();
    renderer.shapes.streak.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  renderer.update([bullet], ctx);
  assert.ok(at().distanceTo(muzzle) < 0.05, "born at the muzzle");
  bullet.age = MUZZLE_LERP / 2;
  renderer.update([bullet], ctx);
  const mid = at();
  assert.ok(mid.distanceTo(muzzle) > 0.5 && mid.distanceTo(new THREE.Vector3(0, PROJECTILE_ART.pistol.height, 0)) > 0.5, "halfway between");
  bullet.age = MUZZLE_LERP + 0.01;
  renderer.update([bullet], ctx);
  assert.ok(at().distanceTo(new THREE.Vector3(0, PROJECTILE_ART.pistol.height, 0)) < 1e-6, "then on the simulation");
  // Children, stationary and enemy bullets never lerp.
  for (const other of [
    synth(2, "pistol", { x: 0, y: 0, age: 0, ownerId: 4, child: true }),
    synth(3, "spore_mine", { x: 0, y: 0, age: 0, ownerId: 4 }),
    synth(4, "enemy", { x: 0, y: 0, age: 0, ownerId: 4 }),
  ]) {
    renderer.update([other], ctx);
    const stats = renderer.stats();
    const shape = SHAPE_CLASSES.find((s) => stats.instances[s] > 0);
    if (!shape) continue;
    const m = new THREE.Matrix4();
    renderer.shapes[shape].getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    assert.ok(Math.hypot(p.x, p.z) < 1e-6, `bullet ${other.id} stays on the simulation`);
  }
  renderer.dispose();
});

type MuzzleProbe = Pick<SurvivalScene, "muzzleWorld" | "heldWeapons" | "drones" | "projectiles"> & {
  eventMuzzle(event: { type: "fire"; x: number; y: number; id?: number; enemy?: boolean; source?: number }, out?: THREE.Vector3): THREE.Vector3;
};
function sceneHarness(hero: HeroId) {
  const scene = Object.create(SurvivalScene.prototype) as unknown as MuzzleProbe;
  const actors = new THREE.Group();
  const player = makeHero(hero);
  actors.add(player.root);
  const heldWeapons = new Map<number, THREE.Group>();
  const kind = HEROES[hero].weapon;
  player.weaponMounts.forEach((mount, slot) => {
    const mesh = makeEquipment(kind, 1);
    mesh.scale.setScalar(weaponScale(kind));
    mount.add(mesh);
    poseHeldWeapon(player, mesh, slot, kind);
    heldWeapons.set(100 + slot, mesh);
  });
  const drones = new Map<number, THREE.Group>();
  const drone = makeEquipment("gun_drone", 1);
  drone.position.set(3, 1.2, 2);
  actors.add(drone);
  drones.set(500, drone);
  Object.assign(scene, {
    actors,
    player,
    heldWeapons,
    drones,
    enemies: new Map(),
    projectiles: new ProjectileRenderer(actors),
  });
  actors.updateMatrixWorld(true);
  return { scene, player };
}

test("muzzleWorld is finite for every hero's hands, distinct across Prism's four, and falls through to drones and turrets", () => {
  for (const hero of HERO_ORDER) {
    const { scene, player } = sceneHarness(hero);
    const points: THREE.Vector3[] = [];
    player.weaponMounts.forEach((_, slot) => {
      const out = new THREE.Vector3();
      assert.ok(scene.muzzleWorld(100 + slot, out), `${hero} hand ${slot}`);
      assert.ok(finite(out), `${hero} hand ${slot} finite`);
      assert.ok(out.y > 0.3, `${hero} hand ${slot} above the floor`);
      points.push(out);
    });
    if (hero === "prism") {
      assert.equal(points.length, 4);
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++)
          assert.ok(points[i].distanceTo(points[j]) > 0.15, `Prism hands ${i} and ${j} differ`);
    }
    const droneOut = new THREE.Vector3();
    assert.ok(scene.muzzleWorld(500, droneOut));
    assert.ok(finite(droneOut) && droneOut.distanceTo(new THREE.Vector3(3, 1.2, 2)) < 1.5);
    assert.equal(scene.muzzleWorld(999, droneOut), false);
    // A deployed turret answers for its own bullet id through the renderer.
    const turret = synth(77, "sentry", { x: 6, y: -4, ownerId: 100, age: 1, radius: 0.4 });
    scene.projectiles.update([turret], context());
    const turretOut = new THREE.Vector3();
    assert.ok(scene.muzzleWorld(77, turretOut), "turret muzzle by bullet id");
    assert.ok(Math.hypot(turretOut.x - 6, turretOut.z + 4) < 1, "at the turret");
    assert.ok(turretOut.y > 0.2 && turretOut.y < 1, "turret barrel height");
    const flash = scene.eventMuzzle({ type: "fire", x: 6, y: -4, id: 100, source: 77 });
    assert.ok(flash.distanceTo(turretOut) < 1e-6, "fire events prefer the turret over the hand");
    const hand = scene.eventMuzzle({ type: "fire", x: 0, y: 0, id: 100 });
    assert.ok(hand.distanceTo(points[0]) < 1e-6, "without a source the hand flashes");
    const fallback = scene.eventMuzzle({ type: "fire", x: 2, y: 3, id: 4242 });
    assert.deepEqual(fallback.toArray(), [2, 1.45, 3]);
    scene.projectiles.dispose();
  }
});

// Model plumbing: turret shots, drone shots and enemy tracers identify their origin.
const foe = (x: number, y: number, overrides: Partial<Enemy> = {}): Enemy => ({
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
  spawnTime: 1e9,
  shield: 0,
  maxShield: 0,
  healTimer: 99,
  ...overrides,
});
const quiet = (run: SurvivalRun) => {
  run.enemies = [foe(16, 16, { id: 1, state: "recover", stateTime: 1e9 })];
  run.spawnQueue = [];
  run.waveBudget = 4;
  run.player.hp = 1e9;
  run.player.maxHp = 1e9;
  return run;
};

test("sentry turret shots carry the turret bullet as their fire source", () => {
  const run = new SurvivalRun("ember", 1);
  run.startWave();
  quiet(run);
  run.weapons[0].kind = "sentry";
  run.weapons[0].level = 1;
  run.enemies.push(foe(4, 0));
  const fires = [];
  let tracers = false;
  for (let i = 0; i < 240; i++) {
    run.step(1 / 60, { x: 0, y: 0 });
    fires.push(...run.drainEvents().filter((e) => e.type === "fire" && e.weapon === "sentry"));
    tracers ||= run.bullets.some((b) => b.weapon === "sentry" && b.child && b.ownerId === run.weapons[0].id);
  }
  const deploy = fires.filter((e) => e.source === undefined);
  const shots = fires.filter((e) => e.source !== undefined);
  assert.ok(deploy.length >= 1, "placing the turret flashes the hand");
  assert.ok(shots.length >= 3, `the turret fired (${shots.length})`);
  for (const shot of shots) {
    assert.equal(shot.id, run.weapons[0].id);
    assert.equal(shot.level, 1);
    assert.ok(Number.isFinite(shot.angle));
  }
  const turret = run.bullets.find((b) => b.weapon === "sentry" && b.behavior?.stationary);
  assert.ok(turret, "a turret stands");
  assert.ok(shots.some((s) => s.source === turret!.id), "shots name the standing turret");
  assert.ok(tracers, "its tracers are children of the weapon");
});

test("drone gun bullets are owned by the drone, and sniper bullets record their kind", () => {
  const run = new SurvivalRun("ember", 1);
  run.bag.push({ id: 5100, kind: "gun_drone", category: ITEMS.gun_drone.category, level: 1 });
  run.startWave();
  quiet(run);
  for (const weapon of run.weapons) weapon.cooldown = 1e9;
  run.enemies.push(foe(3, 1));
  assert.equal(run.drones.length, 1);
  let droneShot;
  for (let i = 0; i < 240 && !droneShot; i++) {
    run.step(1 / 60, { x: 0, y: 0 });
    droneShot = run.bullets.find((b) => b.weapon === "pistol" && !b.enemy);
  }
  assert.ok(droneShot, "the gun drone fired");
  assert.equal(droneShot!.ownerId, run.drones[0].id);
  assert.equal(droneShot!.source, undefined);

  const sniperRun = new SurvivalRun("ember", 1);
  sniperRun.startWave();
  quiet(sniperRun);
  for (const weapon of sniperRun.weapons) weapon.cooldown = 1e9;
  sniperRun.enemies = [foe(10, 0, { kind: "sniper", attackTimer: 0, angle: Math.PI, spawnTime: 0 })];
  let tracer;
  for (let i = 0; i < 240 && !tracer; i++) {
    sniperRun.step(1 / 60, { x: 0, y: 0 });
    tracer = sniperRun.bullets.find((b) => b.enemy);
  }
  assert.ok(tracer, "the sniper fired");
  assert.equal(tracer!.source, "sniper");
  assert.equal(artKeyFor(tracer!), "enemy-sniper");
});
