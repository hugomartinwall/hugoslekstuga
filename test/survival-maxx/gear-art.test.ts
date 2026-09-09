import assert from "node:assert/strict";
import { test } from "vitest";
import * as THREE from "three";
import { AudioEngine } from "../../lib/survival-maxx/audio";
import { HERO_ORDER } from "../../lib/survival-maxx/content";
import { DRONE_BUILDERS } from "../../lib/survival-maxx/drone-art-expansion";
import {
  equipmentCameraBounds,
  makeEquipment,
} from "../../lib/survival-maxx/equipment-art";
import {
  EXPANSION_ITEM_ICONS,
  EXPANSION_WEAPON_ICONS,
} from "../../lib/survival-maxx/gear-icons";
import { animateHeroRig, makeHero } from "../../lib/survival-maxx/hero-rigs";
import { ITEM_BUILDERS } from "../../lib/survival-maxx/item-art-expansion";
import { WEAPON_BUILDERS } from "../../lib/survival-maxx/weapon-art-expansion";
import {
  poseHeldWeapon,
  WEAPON_HEAVY,
  weaponRecovery,
  weaponScale,
} from "../../lib/survival-maxx/weapon-pose";
import { exposedSurfaceConflicts } from "./helpers/surface-audit";

const NEW_WEAPONS = [
  "pinball",
  "thumper",
  "mortar",
  "flare",
  "skyfall",
  "tesla_orb",
  "halo",
  "gravity",
  "spore_mine",
  "hive",
  "sentry",
  "shatter",
  "eclipse",
];
const NEW_DRONES = [
  "torch_drone",
  "frost_drone",
  "mortar_drone",
  "aegis_drone",
  "venom_drone",
];
const NEW_ITEMS = [
  "ricochet",
  "split_shot",
  "splash",
  "homing",
  "lifesteal",
  "double_shot",
  "pierce",
  "crit_damage",
  "crit_chance",
  "attack_range",
  "shield",
  "knockback",
  "status_damage",
  "slow_power",
  "momentum",
  "thorns",
  "interest",
  "discount",
  "free_reroll",
  "luck",
  "second_chance",
];
const RANKS = [1, 2, 3, 4, 5, 6];

test("the expansion builder maps cover every new weapon, drone and item id", () => {
  assert.deepEqual(
    Object.keys(WEAPON_BUILDERS).sort(),
    [...NEW_WEAPONS].sort(),
  );
  assert.deepEqual(Object.keys(DRONE_BUILDERS).sort(), [...NEW_DRONES].sort());
  assert.deepEqual(Object.keys(ITEM_BUILDERS).sort(), [...NEW_ITEMS].sort());
});

/** Run a builder straight into a baked group, the way makeEquipment does. */
function built(
  builder: (group: THREE.Group, rank: number) => unknown,
  rank: number,
): THREE.Group {
  const group = new THREE.Group();
  builder(group, rank);
  return group;
}

function audit(model: THREE.Object3D, label: string) {
  let vertices = 0,
    draws = 0;
  model.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    draws++;
    const coordinates = mesh.geometry.getAttribute("position");
    vertices += coordinates.count;
    for (const value of coordinates.array)
      assert.ok(Number.isFinite(value), `${label}: non-finite vertex`);
  });
  assert.ok(vertices < 32000, `${label}: excessive geometry (${vertices})`);
  assert.ok(draws <= 7, `${label}: excessive separate surfaces (${draws})`);
  const bounds = new THREE.Box3().setFromObject(model);
  for (const axis of bounds.getSize(new THREE.Vector3()).toArray())
    assert.ok(
      axis > 0.01 && axis < 3,
      `${label}: unintended spike or collapsed geometry (${axis})`,
    );
  return bounds;
}

test("every expansion weapon rank is finite, compact, gripped at the palm and free of exposed coplanar panels", () => {
  for (const kind of NEW_WEAPONS)
    for (const rank of RANKS) {
      const label = `${kind} rank ${rank}`;
      const model = makeEquipment(kind, rank);
      assert.equal(model.userData.weaponId, kind, `${label}: weapon id`);
      assert.equal(model.userData.grip.length(), 0, `${label}: grip origin`);
      assert.ok(model.userData.muzzle.length() > 0.1, `${label}: muzzle`);
      const bounds = audit(model, label);
      assert.ok(
        bounds.containsPoint(new THREE.Vector3()),
        `${label}: no weapon at the palm origin`,
      );
      const raw = built(WEAPON_BUILDERS[kind], rank);
      const muzzle = new THREE.Vector3().fromArray(
        WEAPON_BUILDERS[kind](new THREE.Group(), rank),
      );
      assert.ok(muzzle.z > 0.5, `${label}: muzzle points along +Z`);
      assert.ok(
        new THREE.Box3()
          .setFromObject(raw)
          .expandByScalar(0.06)
          .containsPoint(muzzle),
        `${label}: muzzle sits at the tip of the model`,
      );
      model.rotation.set(0.17, -0.42, 0.11);
      assert.deepEqual(
        exposedSurfaceConflicts(model),
        [],
        `${label}: no exposed coplanar panels`,
      );
    }
});

test("every expansion drone rank is a compact airframe with a forward emitter", () => {
  for (const kind of NEW_DRONES)
    for (const rank of RANKS) {
      const label = `${kind} rank ${rank}`;
      const model = makeEquipment(kind, rank);
      assert.equal(model.userData.weaponId, undefined, `${label}: not a gun`);
      assert.ok(model.userData.muzzle instanceof THREE.Vector3, label);
      assert.ok(model.userData.muzzle.z > 0.2, `${label}: emitter forward`);
      audit(model, label);
      model.rotation.set(0.17, -0.42, 0.11);
      assert.deepEqual(
        exposedSurfaceConflicts(model),
        [],
        `${label}: no exposed coplanar panels`,
      );
    }
});

test("every expansion item rank is finite, compact and free of exposed coplanar panels", () => {
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.1, -1.1, 0.1, 30);
  camera.position.set(3.3, 2.1, 4.8);
  camera.lookAt(0, 0, 0);
  for (const kind of NEW_ITEMS)
    for (const rank of RANKS) {
      const label = `${kind} rank ${rank}`;
      const model = makeEquipment(kind, rank);
      assert.equal(model.userData.weaponId, undefined, `${label}: not a gun`);
      audit(model, label);
      model.rotation.set(0.17, -0.42, 0.11);
      assert.deepEqual(
        exposedSurfaceConflicts(model),
        [],
        `${label}: no exposed coplanar panels`,
      );
      model.rotation.set(0, -0.15, 0);
      const projected = equipmentCameraBounds(model, camera);
      assert.ok(!projected.isEmpty(), `${label}: portrait has no geometry`);
    }
});

test("ranks read progressively richer: a rank-6 model lights its inset and never loses geometry", () => {
  for (const kind of [...NEW_WEAPONS, ...NEW_DRONES, ...NEW_ITEMS]) {
    const count = (rank: number) => {
      let glow = 0;
      const model = makeEquipment(kind, rank);
      model.traverse((mesh) => {
        if (!(mesh instanceof THREE.Mesh)) return;
        if (mesh.material instanceof THREE.MeshBasicMaterial) glow++;
      });
      const size = new THREE.Box3()
        .setFromObject(model)
        .getSize(new THREE.Vector3());
      return { glow, size };
    };
    const low = count(1),
      top = count(6);
    assert.ok(top.glow > low.glow, `${kind}: rank 6 lights its inset`);
    assert.ok(
      top.size.distanceTo(low.size) < 0.02,
      `${kind}: ranks share one silhouette`,
    );
  }
});

test("eclipse is always a weapon and its rank-6 model stays within the draw budget", () => {
  const model = makeEquipment("eclipse", 6);
  assert.equal(model.userData.weaponId, "eclipse");
  assert.equal(model.userData.level, 6);
  let draws = 0;
  model.traverse((mesh) => {
    if (mesh instanceof THREE.Mesh) draws++;
  });
  assert.ok(draws <= 7 && draws >= 4, `eclipse draws: ${draws}`);
});

test("expansion weapons keep their muzzle forward in every hand and never accumulate recoil", () => {
  const origin = new THREE.Vector3();
  for (const hero of HERO_ORDER)
    for (const kind of NEW_WEAPONS) {
      const rig = makeHero(hero);
      rig.weaponMounts.forEach((mount, slot) => {
        const weapon = makeEquipment(kind, 6);
        weapon.scale.setScalar(weaponScale(kind));
        mount.add(weapon);
        for (const attack of [0, 1, 0.8, 0.5, 0.2, 0]) {
          poseHeldWeapon(rig, weapon, slot, kind, attack);
          rig.root.updateMatrixWorld(true);
          const palm = mount.getWorldPosition(new THREE.Vector3());
          assert.ok(
            weapon.localToWorld(origin.clone()).distanceTo(palm) < 1e-9,
            `${hero}/${kind}/${slot}: grip detaches from palm`,
          );
          assert.ok(weapon.matrixWorld.elements.every(Number.isFinite));
          const muzzle = rig.body.worldToLocal(
            weapon.localToWorld(weapon.userData.muzzle.clone()),
          );
          const grip = rig.body.worldToLocal(palm);
          assert.ok(
            muzzle.z > grip.z + 0.15,
            `${hero}/${kind}: muzzle points into arm`,
          );
        }
        const rest = weapon.quaternion.clone();
        for (let frame = 0; frame < 300; frame++) {
          animateHeroRig(rig, frame / 60, 6, 0, 1 / 60);
          poseHeldWeapon(rig, weapon, slot, kind, 0);
        }
        assert.ok(
          rest.angleTo(weapon.quaternion) < 1e-6,
          `${hero}/${kind}: recoil accumulates or inherits walking swing`,
        );
        mount.remove(weapon);
      });
    }
});

test("pose tables: ordnance shrinks to the palm, heavy weapons kick harder and recover slower", () => {
  for (const kind of ["mortar", "sentry", "eclipse", "railgun", "rocket"])
    assert.equal(weaponScale(kind), 0.68, kind);
  assert.equal(weaponScale("halo"), 0.8);
  assert.equal(weaponScale("pinball"), 0.76);
  for (const kind of ["mortar", "thumper", "eclipse", "shotgun", "rocket"])
    assert.equal(weaponRecovery(kind), 0.22, kind);
  assert.equal(weaponRecovery("flare"), 0.15);
  for (const kind of [
    "shotgun",
    "rocket",
    "railgun",
    "mortar",
    "thumper",
    "eclipse",
  ])
    assert.ok(WEAPON_HEAVY.has(kind), `${kind} is heavy`);
  assert.ok(!WEAPON_HEAVY.has("pistol"));
  // A heavy weapon's shot kicks the shoulder further than a sidearm's.
  const rig = makeHero("ember");
  const kick = (kind: string) => {
    const weapon = makeEquipment(kind, 1);
    rig.weaponMounts[0].add(weapon);
    poseHeldWeapon(rig, weapon, 0, kind, 1);
    const angle = rig.arms[0].rotation.x;
    rig.weaponMounts[0].remove(weapon);
    return angle;
  };
  assert.ok(kick("thumper") > kick("pinball"));
});

test("every new weapon, item and drone has an icon glyph in the ui.ts style", () => {
  const largest = (glyph: string) =>
    Math.max(
      ...(
        glyph.replace(/rotate\([^)]*\)/g, "").match(/\d+(\.\d+)?/g) ?? []
      ).map(Number),
    );
  for (const kind of NEW_WEAPONS) {
    const glyph = EXPANSION_WEAPON_ICONS[kind];
    assert.ok(glyph && /^<(path|circle|rect|ellipse)\b/.test(glyph), kind);
    assert.ok(!/(<svg|viewBox|stroke=)/.test(glyph), `${kind}: bare glyph`);
    const extent = largest(glyph);
    assert.ok(extent > 30 && extent <= 64, `${kind}: drawn in the 64 grid`);
  }
  for (const kind of [...NEW_ITEMS, ...NEW_DRONES]) {
    const glyph = EXPANSION_ITEM_ICONS[kind];
    assert.ok(glyph && /^<(path|circle|rect|ellipse)\b/.test(glyph), kind);
    assert.ok(!/(<svg|viewBox|stroke=)/.test(glyph), `${kind}: bare glyph`);
    assert.ok(largest(glyph) <= 24, `${kind}: stays inside the 24 grid`);
  }
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
    // Voices end straight away so the engine's 64-voice cap never fills.
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

test("audio: every expansion weapon alias resolves to a synthesized case and the new cases play", () => {
  const audio = new AudioEngine();
  const fake = fakeAudioContext();
  Object.assign(audio, {
    ctx: fake.ctx,
    effects: { gain: { value: 1 }, connect() {} },
    music: { gain: { value: 1 }, connect() {}, setTargetAtTime() {} },
    noiseBuffer: {},
  });
  const names = [
    ...NEW_WEAPONS.filter((kind) => kind !== "eclipse"),
    "thump",
    "eclipse",
    "horde",
  ];
  for (const name of names) {
    fake.reset();
    fake.ctx.currentTime += 5; // clear every rate limit
    assert.doesNotThrow(() => audio.play(name), name);
    assert.ok(fake.scheduled() > 0, `${name}: resolves to a synth case`);
  }
  fake.reset();
  fake.ctx.currentTime += 5;
  audio.play("no_such_sound");
  assert.equal(fake.scheduled(), 0, "unknown names stay silent");
  // Eclipse and horde are rate-limited so repeated triggers cannot stack.
  for (const [name, limit] of [
    ["eclipse", 1.2],
    ["horde", 1.5],
  ] as const) {
    fake.ctx.currentTime += 5;
    audio.play(name);
    fake.reset();
    fake.ctx.currentTime += limit - 0.05;
    audio.play(name);
    assert.equal(fake.scheduled(), 0, `${name}: limited inside ${limit}s`);
    fake.ctx.currentTime += 0.1;
    audio.play(name);
    assert.ok(fake.scheduled() > 0, `${name}: plays again after the limit`);
  }
});
