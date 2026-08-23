import { describe, expect, it } from "vitest";
import { cloneRtState, createRtState, hashRt } from "../../lib/greyrot/sim/rt/state";
import { addBystander, rtStep, type RtCommand } from "../../lib/greyrot/sim/rt/step";
import { createSimWorld, type SimWorld } from "../../lib/greyrot/sim/world";
import { STAGES, foundBitsThroughStage, type StageDef } from "../../lib/greyrot/content";
import { applyResume, buildScenario } from "../../lib/greyrot/sim/scenario";

/**
 * Determinism is the load-bearing property of the whole architecture
 * (`CLAUDE.md` §4): replay, headless balance testing, reproducible bug reports
 * and the marketing capture rig all rest on same-seed + same-commands ⇒
 * same-state. These tests are the oracle.
 *
 * Re-pointed at `rtStep`/`hashRt` when the turn engine and its exploration sim
 * were deleted. The script now includes CASTING, which the movement-only
 * version could not: a cast draws no randomness itself but the foes it kills
 * do, so a script that only walks would have left the RNG stream — the one
 * genuinely fragile part — almost untested.
 */

const SEED = 1337;
const WATER = -1.2;

function world(): SimWorld {
  return createSimWorld({ seed: SEED, waterLevel: WATER });
}

/**
 * A deterministic command script: tick → commands.
 *
 * Walks, fights, and mixes elements, so the run exercises movement, the RNG
 * stream (foe weave), projectiles, the ground field and status ticking rather
 * than only the integrator.
 */
function scriptedCommand(tick: number): RtCommand[] {
  if (tick === 40) return [{ type: "spawn", kindId: "rotling", x: 6, z: 6 }];
  if (tick === 41) return [{ type: "spawn", kindId: "seeper", x: -5, z: 7 }];
  if (tick === 42) return [{ type: "spawnBystander", x: 3, z: 3, name: "Sella" }];
  // A sopling too, so the WATER drip participates in the hashed streams the
  // same way the seeper's oil does.
  if (tick === 43) return [{ type: "spawn", kindId: "sopling", x: 7, z: -5 }];

  // THE DEFEAT CYCLE. The script crosses the whole Phase 4 recovery surface —
  // a pack big enough to actually down the hero, the full 5 s window running
  // out, a `revive`, then later a `restartStage` — because "a revive replays"
  // is a claim, and the only test that can carry it is one whose replay
  // includes a revive. Tick 700: the pack (the hero stands still from 600, so
  // four chargers at close range will finish 100 hp well before the window
  // check at 1000). Tick 1000: by now the hero has been down or defeated for a
  // while; revive them. Tick 1100: restart, exercising the marker/foe wipe.
  // Three waves, not one, and the number was measured rather than chosen: a
  // single pack of four clustered on one hero killed EACH OTHER with their own
  // melee splash (each blow catches everything within 0.9 m, and the hero's
  // iframes cap what the hero takes) — the run stabilised at 45 hp with the
  // pack dead around it and the down state never exercised. Spread along the
  // hero's line of travel; they stand near x≈73 from tick 600.
  if (tick === 700 || tick === 780 || tick === 860) {
    const dz = tick === 700 ? 0 : tick === 780 ? 4 : -4;
    return [
      { type: "spawn", kindId: "rotling", x: 64, z: dz },
      { type: "spawn", kindId: "rotling", x: 68, z: dz + 3 },
      { type: "spawn", kindId: "rotling", x: 72, z: dz - 3 },
      { type: "spawn", kindId: "rotling", x: 78, z: dz },
    ];
  }
  if (tick === 1000) return [{ type: "revive" }];
  if (tick === 1100) return [{ type: "restartStage", x: 0, z: 0 }];

  // A cast every 90 ticks, cycling the mix so different spells resolve.
  const phase = tick % 90;
  if (phase === 0) return [{ type: "queue", element: "fire" }];
  if (phase === 2) return [{ type: "queue", element: tick % 180 === 0 ? "oil" : "lightning" }];
  if (phase === 4) return [{ type: "cast", form: "aimed", aimX: 6, aimZ: 6 }];

  if (tick < 600) return [{ type: "move", dx: 1, dz: 0 }];
  if (tick < 1200) return []; // stand in the pack; see the defeat cycle above
  if (tick < 1500) return [{ type: "move", dx: 0, dz: 1 }];
  return []; // idle tail
}

function run(w: SimWorld, ticks: number): ReturnType<typeof createRtState> {
  const s = createRtState(SEED);
  for (let t = 0; t < ticks; t++) rtStep(w, s, scriptedCommand(t));
  return s;
}

describe("simulation determinism", () => {
  it("same seed + same commands → same hash at tick 1800", () => {
    const a = run(world(), 1800);
    const b = run(world(), 1800);
    expect(hashRt(a)).toBe(hashRt(b));
    expect(a.tick).toBe(1800);
    // And something actually HAPPENED — a sim that never moves and never
    // fights would pass every equality test while testing nothing.
    expect(Math.hypot(a.hero.x, a.hero.z)).toBeGreaterThan(5);
    expect(a.rng.drawn).toBeGreaterThan(0);
  });

  it("the scripted run actually crosses the defeat cycle it claims to", () => {
    // The script's whole value as a determinism probe is WHAT it exercises. If
    // a balance change ever makes the tick-700 pack survivable, the revive at
    // tick 1000 becomes a no-op and the run silently stops covering the
    // recovery surface — a green check measuring nothing, again. So the claim
    // is pinned: the hero must genuinely go down before the revive fires.
    const w = world();
    const s = createRtState(SEED);
    let wentDown = false;
    let revived = false;
    for (let t = 0; t < 1200; t++) {
      const ev = rtStep(w, s, scriptedCommand(t));
      wentDown ||= ev.heroDown;
      revived ||= ev.heroRevived;
    }
    expect(wentDown, "the tick-700 pack no longer downs the hero").toBe(true);
    expect(revived, "the revive never fired").toBe(true);
    expect(s.hero.defeated).toBe(false);
  });

  it("a different seed reaches a different state", () => {
    const w = world();
    const a = createRtState(SEED);
    const b = createRtState(SEED + 1);
    for (let t = 0; t < 900; t++) {
      rtStep(w, a, scriptedCommand(t));
      rtStep(w, b, scriptedCommand(t));
    }
    expect(hashRt(a)).not.toBe(hashRt(b));
  });

  it("a serialised state resumes to an identical continuation", () => {
    const w = world();
    const full = run(w, 1800);

    // Run to the midpoint, snapshot through JSON (the save path), resume.
    const s = createRtState(SEED);
    for (let t = 0; t < 900; t++) rtStep(w, s, scriptedCommand(t));
    const resumed = JSON.parse(JSON.stringify(s)) as typeof s;
    for (let t = 900; t < 1800; t++) rtStep(w, resumed, scriptedCommand(t));

    expect(hashRt(resumed)).toBe(hashRt(full));
  });

  it("an idle sim is hash-stable, not drifting", () => {
    const w = world();
    const s = createRtState(SEED);
    for (let t = 0; t < 100; t++) rtStep(w, s, []);
    const h100 = { ...s.hero };
    for (let t = 0; t < 900; t++) rtStep(w, s, []);
    // Idle means EXACTLY still — friction snaps to zero, nothing accumulates.
    expect(s.hero).toEqual(h100);
  });

  it("rebuilding the world from the seed gives identical obstacles", () => {
    const a = world();
    const b = world();
    expect(a.obstacles.list.length).toBeGreaterThan(500);
    expect(a.obstacles.list).toEqual(b.obstacles.list);
  });

  it("state clones do not alias the original", () => {
    const s = createRtState(SEED);
    const c = cloneRtState(s);
    c.hero.x = 99;
    expect(s.hero.x).toBe(0);
  });

  it("hash is sensitive to each hero field", () => {
    const base = createRtState(SEED);
    const h0 = hashRt(base);
    for (const key of ["x", "z", "vx", "vz", "fx", "fz"] as const) {
      const s = cloneRtState(base);
      s.hero[key] += 0.01;
      expect(hashRt(s), `hash ignores hero.${key}`).not.toBe(h0);
    }
  });

  it("hash is sensitive to every field that decides FUTURE behaviour", () => {
    // The first version of `hashRt` claimed to cover everything and did not:
    // `casting`, `statusDebt`, `nextId` and the whole projectile payload were
    // missing, so two states could hash equal and diverge on the next tick —
    // exactly what the oracle exists to rule out.
    const w = world();
    const base = createRtState(SEED);
    for (let t = 0; t < 60; t++) rtStep(w, base, scriptedCommand(t));
    const h0 = hashRt(base);

    const mutate: [string, (s: typeof base) => void][] = [
      ["hero.statusDebt", (s) => (s.hero.statusDebt += 0.3)],
      ["nextId", (s) => (s.nextId += 1)],
      ["friendlyFire", (s) => (s.friendlyFire = !s.friendlyFire)],
      ["foe.drip", (s) => (s.foes[0]!.drip += 1)],
      ["foe.statusDebt", (s) => (s.foes[0]!.statusDebt += 0.3)],
      ["loot", (s) => (s.loot += 1)],
      // Phase 4's fields. Every one of these decides future behaviour — a
      // downed hero moves differently, a leashed foe walks the other way, a
      // lock clamps positions, a stage index gates which fights can wake — so
      // every one must be able to split the hash. Asserted the day they landed
      // rather than after the first divergence they would have hidden.
      ["hero.downTicks", (s) => (s.hero.downTicks += 30)],
      ["hero.defeated", (s) => (s.hero.defeated = !s.hero.defeated)],
      // The buffered follow-up cast fires a spell the tick the root ends —
      // future behaviour by definition.
      ["hero.buffered", (s) => (s.hero.buffered = { form: "aimed", aimX: 1, aimZ: 2 })],
      // Recovery decides whether the next cast command commits or buffers.
      ["hero.castCd", (s) => (s.hero.castCd += 6)],
      ["castCooldown", (s) => (s.castCooldown += 4)],
      ["foe.leashed", (s) => (s.foes[0]!.leashed = !s.foes[0]!.leashed)],
      // R4: a douser steers at the braziers instead of the hero next tick.
      ["foe.douser", (s) => (s.foes[0]!.douser = !s.foes[0]!.douser)],
      // R4 boss layer: which behaviour set runs, and when the coat re-wets.
      ["foe.phase", (s) => (s.foes[0]!.phase += 1)],
      ["foe.rewet", (s) => (s.foes[0]!.rewet += 7)],
      ["stageIndex", (s) => (s.stageIndex += 1)],
      [
        "stages[].cleared",
        (s) => {
          s.stages.push({ id: "t", exitX: 0, exitZ: 9, exitR: 2, cleared: false });
        },
      ],
      ["lock null->ring", (s) => (s.lock = { x: 1, z: 2, r: 5 })],
      ["selfDamage", (s) => (s.selfDamage += 0.1)],
      // The nova dial: two states differing only here deal different damage
      // on the next self-cast.
      ["selfPower", (s) => (s.selfPower -= 0.3)],
      // R1's crossing debounce: two states differing only in a held-crossing
      // counter fire the seam (or the rescue) on different ticks.
      ["gateCrossTicks", (s) => (s.gateCrossTicks += 3)],
      // R2's flanker: the stalk counter gates its windup commit.
      ["foe.flank", (s) => (s.foes[0]!.flank += 5)],
      [
        "bystander.crossTicks",
        (s) => {
          addBystander(s, 40, 40, "T");
          const b = s.bystanders[s.bystanders.length - 1]!;
          const h1 = hashRt(s);
          b.crossTicks += 2;
          // Assert against the WITH-bystander hash, so this measures the
          // counter rather than the push.
          expect(hashRt(s), "hash ignores bystander.crossTicks").not.toBe(h1);
        },
      ],
      [
        // R4.5, pairwise against the WITH-bystander hash, so each of these
        // measures the field and not the push. Every one decides where a body
        // is standing on the next tick: `holdStage` chooses between the hero
        // and the post RIGHT NOW, and `home` is where the next `newRun`
        // command puts her back.
        "bystander.holdStage / homeX / homeZ",
        (s) => {
          addBystander(s, 40, 40, "T", 3);
          const b = s.bystanders[s.bystanders.length - 1]!;
          const h1 = hashRt(s);
          b.holdStage = 4;
          expect(hashRt(s), "hash ignores bystander.holdStage").not.toBe(h1);
          b.holdStage = 3;
          expect(hashRt(s), "the holdStage probe did not restore").toBe(h1);
          b.homeX += 1.5;
          expect(hashRt(s), "hash ignores bystander.homeX").not.toBe(h1);
          b.homeX -= 1.5;
          b.homeZ += 1.5;
          expect(hashRt(s), "hash ignores bystander.homeZ").not.toBe(h1);
        },
      ],
      [
        // R5's valve: two states differing only in how long a fight has run,
        // or in how many arrivals it has left, spawn a body on different
        // ticks. Pairwise against the WITH-marker hash so each measures its
        // own field rather than the push.
        "marker.fightTicks / reinforceLeft",
        (s) => {
          s.markers.push({
            id: 77, stage: 0, x: 0, z: 9, radius: 2, arena: 6, foes: [],
            triggered: true, cleared: false,
            reinforce: { after: 10, every: 5, budget: 4, kindId: "rotling", from: [{ dx: 1, dz: 1 }] },
            fightTicks: 3, reinforceLeft: 4, composed: false,
          });
          const m = s.markers[s.markers.length - 1]!;
          const h1 = hashRt(s);
          m.fightTicks += 1;
          expect(hashRt(s), "hash ignores marker.fightTicks").not.toBe(h1);
          m.fightTicks -= 1;
          expect(hashRt(s), "the fightTicks probe did not restore").toBe(h1);
          m.reinforceLeft -= 1;
          expect(hashRt(s), "hash ignores marker.reinforceLeft").not.toBe(h1);
        },
      ],
      [
        "hutFires[].lit",
        (s) => {
          s.hutFires.push({ id: 900, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: false, lit0: true, stage0: -1 });
        },
      ],
      // An untaken pickup grants power on contact; two states differing only
      // in `taken` accept different queue commands two ticks later.
      [
        "pickups[].taken",
        (s) => {
          s.pickups.push({ id: 0, stage: 0, kind: "water", x: 1, z: 2, taken: false });
        },
      ],
      [
        "marker.stage",
        (s) => {
          s.markers.push({
            id: 9,
            stage: 1,
            x: 0,
            z: 9,
            radius: 2,
            arena: 6,
            foes: [],
            triggered: false,
            cleared: false,
            reinforce: null,
            fightTicks: 0,
            reinforceLeft: 0,
            composed: false,
          });
        },
      ],
    ];
    for (const [label, fn] of mutate) {
      const s = cloneRtState(base);
      fn(s);
      expect(hashRt(s), `hash ignores ${label}`).not.toBe(h0);
    }

    // The lock's RADIUS too, not just its existence — a wider ring is a
    // different playable area, and "mixed only when non-null" is exactly the
    // shape of hole the first hashRt shipped with.
    const withLock = cloneRtState(base);
    withLock.lock = { x: 1, z: 2, r: 5 };
    const h1 = hashRt(withLock);
    const widerLock = cloneRtState(withLock);
    widerLock.lock = { x: 1, z: 2, r: 6 };
    expect(hashRt(widerLock), "hash ignores lock.r").not.toBe(h1);

    // A fire's STAGE binding, pairwise: two states identical except for which
    // stage a fire gates open that stage's seam on different ticks. "In the
    // list" is not enough — the field itself has to split the hash.
    const gated = cloneRtState(base);
    gated.hutFires.push({ id: 900, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: false, lit0: true, stage0: -1 });
    const hFire = hashRt(gated);
    const rebound = cloneRtState(base);
    rebound.hutFires.push({ id: 900, x: 1, z: 1, r: 2, lit: true, stage: 0, keepLit: false, lit0: true, stage0: -1 });
    expect(hashRt(rebound), "hash ignores hutFires[].stage").not.toBe(hFire);

    // R6a pairwise: two states identical except a projectile's patchScale
    // lay different ground at the same impact — Deluge has to split the
    // hash on its own.
    const mkBolt = (scale: number) => ({
      id: 800,
      x: 1,
      z: 1,
      vx: 0.3,
      vz: 0.3,
      targetX: 5,
      targetZ: 5,
      ticksLeft: 20,
      fromHero: true,
      element: "water" as const,
      damage: 4,
      radius: 1.3,
      knockback: 0.4,
      pierces: false,
      hitIds: [],
      status: "wet",
      patch: "water",
      patchScale: scale,
      name: "t",
    });
    const bolt1 = cloneRtState(base);
    bolt1.projectiles.push(mkBolt(1));
    const hBolt = hashRt(bolt1);
    const bolt15 = cloneRtState(base);
    bolt15.projectiles.push(mkBolt(1.5));
    expect(hashRt(bolt15), "hash ignores projectile.patchScale").not.toBe(hBolt);

    // R4 pairwise: two states identical except a fire's keepLit flag clear
    // (or refuse) the same seam and answer the same fire bolt differently —
    // the brazier inversion has to split the hash on its own.
    const bowl = cloneRtState(base);
    bowl.hutFires.push({ id: 901, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: false, lit0: true, stage0: -1 });
    const hBowl = hashRt(bowl);
    const bowlKeep = cloneRtState(base);
    bowlKeep.hutFires.push({ id: 901, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    expect(hashRt(bowlKeep), "hash ignores hutFires[].keepLit").not.toBe(hBowl);

    // R4 pairwise: what the next newRun restores a fire to (the boss bowls'
    // authored state vs the pyres') has to split the hash on its own.
    const bowlLit0 = cloneRtState(base);
    bowlLit0.hutFires.push({ id: 902, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    const hLit0 = hashRt(bowlLit0);
    const bowlDark0 = cloneRtState(base);
    bowlDark0.hutFires.push({ id: 902, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: true, lit0: false, stage0: -1 });
    expect(hashRt(bowlDark0), "hash ignores hutFires[].lit0").not.toBe(hLit0);

    // R4 recut pairwise: which stage's RETRY re-arms a tactical bowl (the
    // pinata-path fix) — two states differing only in `stage0` answer the
    // same restartStage command differently.
    const bowlHome = cloneRtState(base);
    bowlHome.hutFires.push({ id: 903, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: true, lit0: false, stage0: 4 });
    const hHome = hashRt(bowlHome);
    const bowlAway = cloneRtState(base);
    bowlAway.hutFires.push({ id: 903, x: 1, z: 1, r: 2, lit: true, stage: -1, keepLit: true, lit0: false, stage0: 5 });
    expect(hashRt(bowlAway), "hash ignores hutFires[].stage0").not.toBe(hHome);

    // And a marker's stage assignment on an EXISTING marker: same marker list
    // length, different gating.
    const restaged = cloneRtState(base);
    if (restaged.markers.length === 0) {
      restaged.markers.push({
        id: 9,
        stage: 0,
        x: 0,
        z: 9,
        radius: 2,
        arena: 6,
        foes: [],
        triggered: false,
        cleared: false,
        reinforce: null,
        fightTicks: 0,
        reinforceLeft: 0,
        composed: false,
      });
    }
    const h2 = hashRt(restaged);
    const moved = cloneRtState(restaged);
    moved.markers[0]!.stage += 1;
    expect(hashRt(moved), "hash ignores an existing marker's stage").not.toBe(h2);
  });
});

describe("the arrival ring is inside the hash — and ch1-hash cannot see it", () => {
  /**
   * ⚠️ THE REASON THIS EXISTS. Moving five of the Dry Gulch's eight arrival
   * entry points — a deliberate change to where bodies enter a fight —
   * produced **byte-identical `ch1-hash` checkpoints**: 1202339208 /
   * 824844390 / 2840837534, unchanged at every tick.
   *
   * That is not the change being invisible to the SIM. `ch1-hash.mjs` drives
   * the **no-input path** ("autorun carries the hero into stage 1 and the sim
   * does whatever it deterministically does"), and the valve only opens after
   * a fight has run 150 ticks with no mix cast — which a hero issuing no
   * commands never reaches. **The oracle is structurally blind to every
   * mechanic that needs a player**, and a green baseline across a real change
   * says nothing about it. Recorded rather than quietly banked: an unmoved
   * number is exactly as suspect as an unexplained one when nobody has
   * checked whether the instrument reaches the subject.
   *
   * So the sensitivity is asserted HERE, where a driver can force the valve.
   *
   * ── CURRENT STATE ── PASSES. REGRESSION GUARD.
   */
  const gulchTo = (from: readonly (readonly [number, number])[]): number => {
    const list = structuredClone(STAGES) as unknown as StageDef[];
    const gi = list.findIndex((st) => st.markers.some((m) => m.reinforce));
    (list[gi]!.markers[0] as { reinforce: { from: unknown } }).reinforce.from = from;
    const { world: w, state: s } = buildScenario(list);
    applyResume(s, gi, foundBitsThroughStage(gi));
    const m = s.markers.find((k) => k.stage === gi)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    let arrivals = 0;
    for (let t = 0; t < 400; t++) {
      const ev = rtStep(w, s, []);
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      s.hero.hp = s.hero.maxHp;
      arrivals += ev.reinforced.length;
    }
    expect(arrivals, "no arrival landed — this measures nothing").toBeGreaterThan(0);
    return hashRt(s);
  };

  const RING_A = [
    [0, 7.0], [-6.1, 3.4], [6.1, 3.4], [-7.0, 0],
    [7.0, 0], [-6.1, -3.4], [6.1, -3.4], [0, -7.0],
  ] as const;
  const RING_B = [
    [-1.22, 6.89], [0, 7.0], [1.22, 6.89], [2.39, 6.58],
    [3.5, 6.06], [4.5, 5.36], [5.36, 4.5], [6.1, 3.4],
  ] as const;

  it("two rings that differ produce different hashes", () => {
    expect(gulchTo(RING_A)).not.toBe(gulchTo(RING_B));
  });

  it("the same ring twice produces the same hash — the vacuity guard", () => {
    // Without this the test above passes on any source of nondeterminism at
    // all, and would be measuring the harness rather than the ring.
    expect(gulchTo(RING_B)).toBe(gulchTo(RING_B));
  });
});
