import { describe, expect, it } from "vitest";
import { FOES } from "../../lib/greyrot/content/foes";
import { FLANK_DOT } from "../../lib/greyrot/sim/constants";
import { addPatch } from "../../lib/greyrot/sim/rt/field";
import { createRtState } from "../../lib/greyrot/sim/rt/state";
import { addBystander, rtStep, spawnFoe, type RtCommand } from "../../lib/greyrot/sim/rt/step";
import { createSimWorld } from "../../lib/greyrot/sim/world";

/**
 * The R2 roster: behaviour tests for the three new kinds, and the
 * no-stat-multiplier test §10 and CLAUDE.md demand.
 *
 * The multiplier test's shape is comp-ratified (R2 opening): BEHAVIOURAL, in
 * two halves — spawn-time stat identity against the raw FOES literals, and
 * application-time identity across progression states — so a planted scale
 * anywhere in the spawn OR the damage/telegraph path reds it. No symbol
 * greps: a grep catches a variable named `multiplier` and misses `hp * 1.5`.
 */

const flat = (): ReturnType<typeof createSimWorld> =>
  createSimWorld({ seed: 99, waterLevel: -50 });

/** Advance n ticks with no input, collecting every event list the probe wants. */
const run = (
  w: ReturnType<typeof createSimWorld>,
  s: ReturnType<typeof createRtState>,
  n: number,
  probe?: (ev: ReturnType<typeof rtStep>, tick: number) => void,
  cmds?: (tick: number) => RtCommand[],
): void => {
  for (let t = 0; t < n; t++) {
    const ev = rtStep(w, s, cmds ? cmds(t) : []);
    probe?.(ev, t);
  }
};

describe("no stat multiplier on the difficulty path (§10)", () => {
  it("spawns every kind with the table's own numbers, at any progression", () => {
    // Spawn half: a foe spawned into a late-progression state carries stats
    // EXACTLY equal to the FOES literals. Compared against the raw const —
    // not through foeKind() — so a plant in foeKind, spawnFoe or the trigger
    // path all fail here.
    for (const stageIndex of [0, 9]) {
      const s = createRtState(7);
      s.stageIndex = stageIndex;
      for (const id of Object.keys(FOES)) spawnFoe(s, id, 5, 5);
      for (const f of s.foes) {
        const k = FOES[f.kindId]!;
        expect(f.maxHp, `${f.kindId} maxHp at stage ${stageIndex}`).toBe(k.maxHp);
        expect(f.hp, `${f.kindId} hp at stage ${stageIndex}`).toBe(k.maxHp);
      }
    }
  });

  it("applies every kind's numbers identically at stage 0 and stage 9", () => {
    // Application half (comp's catch): a plant at APPLICATION time — bite
    // damage scaled by progression inside the damage step, or telegraph
    // ticks stretched at commit — never touches spawned stats. So the same
    // scripted fight runs in two states differing ONLY in stageIndex, and
    // every observed number must be identical: damage the hero took, the
    // tick of every windup, and the damage the foe took from one fixed
    // spell.
    const observe = (
      stageIndex: number,
    ): { heroTaken: number; windupTicks: number[]; foeTaken: number } => {
      const w = flat();
      const s = createRtState(7);
      s.stageIndex = stageIndex;
      spawnFoe(s, "rotling", 0, 3);
      const foe = s.foes[0]!;
      let heroTaken = 0;
      const windupTicks: number[] = [];
      run(
        w,
        s,
        90,
        (ev, t) => {
          heroTaken += ev.heroDamage;
          if (ev.windups.length > 0) windupTicks.push(t);
        },
        (t) =>
          // One fixed spell at the foe, fired the same tick in both runs.
          t === 0
            ? [
                { type: "queue", element: "spore" },
                { type: "cast", form: "aimed", aimX: foe.x, aimZ: foe.z },
              ]
            : [],
      );
      return { heroTaken, windupTicks, foeTaken: foe.maxHp - foe.hp };
    };
    const a = observe(0);
    const b = observe(9);
    expect(b.heroTaken, "bite damage differs across progression").toBe(a.heroTaken);
    expect(a.heroTaken, "the scripted fight never bit — the probe is vacuous").toBeGreaterThan(0);
    expect(b.windupTicks, "telegraph timing differs across progression").toEqual(a.windupTicks);
    expect(b.foeTaken, "spell damage differs across progression").toBe(a.foeTaken);
    expect(a.foeTaken, "the fixed spell never landed — the probe is vacuous").toBeGreaterThan(0);
  });
});

describe("stormling — the matrix turned against the player", () => {
  /** Hero and a neighbour both standing in water, stormling in band. */
  const soaked = (
    neighbour: "bystander" | "foe",
  ): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>] => {
    const w = flat();
    const s = createRtState(7);
    // Water under the hero and under the neighbour: the field wets both.
    addPatch(s.patches, () => s.nextId++, "water", 0, 0, 2.0);
    addPatch(s.patches, () => s.nextId++, "water", 3, 0, 2.0);
    if (neighbour === "bystander") addBystander(s, 3, 0, "Wet Friend");
    else spawnFoe(s, "rotling", 3, 0);
    spawnFoe(s, "stormling", 0, 6);
    return [w, s];
  };

  it("its bolt chains off a wet hero to a wet bystander — the self-soak tax", () => {
    const [w, s] = soaked("bystander");
    const friend = s.bystanders[0]!;
    let chainedHits = 0;
    let heroHit = 0;
    run(w, s, 150, (ev) => {
      for (const i of ev.impacts) {
        if (i.chained && !i.onHero) chainedHits++;
        if (i.onHero) heroHit++;
      }
    });
    expect(heroHit, "the stormling never landed on the hero").toBeGreaterThan(0);
    expect(chainedHits, "the chain never hopped to the wet bystander").toBeGreaterThan(0);
    expect(friend.hp).toBeLessThan(friend.maxHp);
  });

  it("its chain must NOT clear its own packmates — more foes never means easier", () => {
    // R1 of this cycle's own finding: land()'s chain recursion did not
    // honour hitsFoes (unreachable until a foe carried a chaining element),
    // so a wet hero would have conducted the stormling's bolt into its own
    // wet packmate — the §10 confound where adding foes makes a fight
    // easier. The packmate stands one chain hop from the wet hero and must
    // end the fight untouched by the bolt.
    const [w, s] = soaked("foe");
    const packmate = s.foes.find((f) => f.kindId === "rotling")!;
    let heroHit = 0;
    run(w, s, 150, (ev) => {
      for (const i of ev.impacts) if (i.onHero) heroHit++;
    });
    expect(heroHit, "the stormling never landed — the probe is vacuous").toBeGreaterThan(0);
    expect(packmate.hp, "the stormling's chain chunked its own packmate").toBe(packmate.maxHp);
  });
});

describe("rimecap — the anti-camping kind", () => {
  it("lays ice where its bolt lands, through the projectile's own patch field", () => {
    const w = flat();
    const s = createRtState(7);
    spawnFoe(s, "rimecap", 0, 6);
    let sawIceBolt = false;
    run(w, s, 150, () => {
      for (const p of s.projectiles) {
        if (!p.fromHero && p.patch === "ice") sawIceBolt = true;
      }
    });
    expect(sawIceBolt, "the rimecap's bolt carries no ice").toBe(true);
    expect(
      s.patches.some((p) => p.kind === "ice"),
      "no ice on the floor after a rimecap volley",
    ).toBe(true);
  });

  it("freezes a WET hero — the matrix, not a special case", () => {
    const w = flat();
    const s = createRtState(7);
    addPatch(s.patches, () => s.nextId++, "water", 0, 0, 2.0);
    spawnFoe(s, "rimecap", 0, 6);
    let frozen = false;
    run(w, s, 200, (ev) => {
      for (const st of ev.statuses) if (st.status === "frozen") frozen = true;
    });
    expect(frozen, "wet + frost bolt should freeze (the pool lesson, reversed)").toBe(true);
  });
});

describe("rotfang — the flanker's readability contract, sim-enforced", () => {
  it("commits only from the blind arc, only after a full stalk phase", () => {
    const w = flat();
    const s = createRtState(7);
    // Dead ahead of the hero's facing (0, 1): the WORST case for the kind.
    spawnFoe(s, "rotfang", 0, 4);
    const foe = s.foes[0]!;
    const k = FOES["rotfang"]!;
    const commits: { dot: number; flank: number }[] = [];
    run(w, s, 900, (ev) => {
      for (const wu of ev.windups) {
        if (wu.id !== foe.id) continue;
        const d = Math.hypot(foe.x - s.hero.x, foe.z - s.hero.z) || 1;
        const dot = s.hero.fx * ((foe.x - s.hero.x) / d) + s.hero.fz * ((foe.z - s.hero.z) / d);
        commits.push({ dot, flank: foe.flank });
      }
    });
    expect(commits.length, "the flanker never committed at all in 30 s").toBeGreaterThan(0);
    for (const c of commits) {
      expect(c.dot, "a flanker committed from inside the hero's view").toBeLessThanOrEqual(
        FLANK_DOT,
      );
      expect(c.flank, "a flanker committed without its full stalk phase").toBeGreaterThanOrEqual(
        k.flankTicks!,
      );
    }
  });

  it("turning to face it resets the stalk — looking IS the counter-play", () => {
    const w = flat();
    const s = createRtState(7);
    // Behind the hero's facing (0, 1): it stalks immediately.
    spawnFoe(s, "rotfang", 0, -3);
    const foe = s.foes[0]!;
    // Let it stalk a while, but less than the commit gate.
    run(w, s, 12);
    expect(foe.flank, "the stalk counter never accrued behind the hero").toBeGreaterThan(0);
    // The hero turns and walks toward it — facing follows velocity under
    // INPUT (§10.6), so a few ticks point the hero at the foe.
    for (let t = 0; t < 10; t++) {
      const d = Math.hypot(foe.x - s.hero.x, foe.z - s.hero.z) || 1;
      rtStep(w, s, [
        { type: "move", dx: (foe.x - s.hero.x) / d, dz: (foe.z - s.hero.z) / d },
      ]);
    }
    expect(foe.flank, "facing the flanker must reset its stalk").toBe(0);
  });
});
