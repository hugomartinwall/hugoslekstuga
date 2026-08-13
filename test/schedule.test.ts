import { describe, expect, it } from "vitest";
import {
  KIND_CORRUPTER,
  KIND_FORTRESS,
  KIND_NURSERY,
  KIND_RIFT,
  KIND_SIPHON,
  KIND_STANDARD,
  KIND_VAULT,
  NEUTRAL,
  PLAYER,
  WORLD_H,
  WORLD_W,
  hashState,
  type NodeKind,
} from "../lib/overrun/sim/state";
import {
  DEFAULT_BOOSTS,
  TWIST_LEVELS,
  createLevel,
  introNoteForLevel,
  isBossLevel,
  kindsUnlockedAt,
  levelParams,
  objectiveTypeForLevel,
  personasForLevel,
} from "../lib/overrun/sim/level";
import { BALANCED, WARDEN } from "../lib/overrun/sim/ai";
import { bandFor, screenLevel, seedSequence } from "../lib/overrun/sim/screen";

/**
 * The objective SCHEDULE: which level plays which archetype, and the board
 * dressing that makes it real. The archetype mechanics themselves are tested
 * in objectives.test.ts on hand-built boards; this file pins the mapping onto
 * real generated levels — the part a balance tweak can silently break.
 */

/** Objective levels with dressed boards, enumerated once for the sweeps. */
const AUTHORED_OBJECTIVE_LEVELS = [6, 8, 11, 16, 19, 22, 25] as const;

describe("the schedule's shape", () => {
  it("L1-L8 already spans three experiences; L1-L16 spans five", () => {
    // The variety gate: the archetypes must land where the players are, not
    // pool in the late game. Counting annihilation as an experience.
    const span = (lo: number, hi: number) => {
      const seen = new Set<string>();
      for (let L = lo; L <= hi; L++) seen.add(objectiveTypeForLevel(L) ?? "annihilation");
      return seen;
    };
    const early = span(1, 8);
    expect(early.size).toBeGreaterThanOrEqual(3);
    expect(early.has("crown"), "crown debuts at L6").toBe(true);
    expect(early.has("hold"), "hold debuts at L8").toBe(true);

    const teen = span(1, 16);
    expect(teen.size).toBeGreaterThanOrEqual(5);
    expect(teen.has("outlast"), "outlast debuts at L11").toBe(true);
    expect(teen.has("claim"), "claim debuts at L16").toBe(true);
  });

  it("no two consecutive levels share a non-annihilation objective", () => {
    // Objectives season the run; two crowns back to back is a mode, not a
    // season. Annihilation may repeat freely — it is the home key.
    for (let L = 2; L <= 120; L++) {
      const cur = objectiveTypeForLevel(L);
      if (cur === null) continue;
      expect(cur, `L${L - 1}→L${L} repeat ${cur}`).not.toBe(objectiveTypeForLevel(L - 1));
    }
  });

  it("bosses and twists stay annihilation; L1-5 carry no objective at all", () => {
    for (let L = 1; L <= 120; L++) {
      if (isBossLevel(L) || TWIST_LEVELS[L]) {
        expect(objectiveTypeForLevel(L), `set piece L${L}`).toBeNull();
      }
    }
    for (const L of [1, 2, 3, 4, 5]) {
      expect(objectiveTypeForLevel(L), `teaching L${L}`).toBeNull();
      expect(createLevel(L).cfg.objective, `teaching L${L} cfg`).toBeUndefined();
    }
  });

  it("claim only ever lands on 4-way boards", () => {
    for (let L = 1; L <= 120; L++) {
      if (objectiveTypeForLevel(L) === "claim") {
        expect(createLevel(L).cfg.factionCount, `L${L}`).toBe(4);
      }
    }
  });

  it("annihilation keeps roughly half the late rotation (40-55% over L27-60)", () => {
    // The rotation's two annihilation slots plus the bosses plus the claim
    // conversions. Measured at wiring time: 14/34 = 41%. The band is a guard
    // against the rotation drifting into all-gimmick or all-annihilation.
    let ann = 0;
    for (let L = 27; L <= 60; L++) if (objectiveTypeForLevel(L) === null) ann++;
    const share = ann / 34;
    expect(share, `${ann}/34 annihilation`).toBeGreaterThanOrEqual(0.4);
    expect(share, `${ann}/34 annihilation`).toBeLessThanOrEqual(0.55);
  });

  it("every archetype keeps recurring after L27 — the boss cadence eats no slot", () => {
    // The regression this pins: the draft rotation put OUTLAST on
    // (L-27)%6 === 5, which is exactly where every boss level falls (L ≡ 2
    // mod 6), so outlast would have vanished from the entire post-25 game.
    const seen = new Map<string, number>();
    for (let L = 27; L <= 60; L++) {
      const t = objectiveTypeForLevel(L);
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const t of ["crown", "hold", "outlast", "claim"]) {
      expect(seen.get(t) ?? 0, `${t} occurrences in L27-60`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("board dressing", () => {
  it("crown levels mark faction 2's home and the player's, and the L6 crown reads defended", () => {
    for (const L of [6, 22]) {
      const s = createLevel(L);
      const obj = s.cfg.objective!;
      expect(obj.type, `L${L}`).toBe("crown");
      const crown = s.nodes[obj.targetNodeId!]!;
      const own = s.nodes[obj.playerCrownId!]!;
      expect(crown.owner, `L${L} crown owner`).toBe(2);
      expect(own.owner, `L${L} player crown owner`).toBe(PLAYER);
    }
    // L6: +4 standing garrison so the crown reads defended from first glance.
    // L22: deliberately exposed — the mirror assassination.
    const p6 = levelParams(6);
    const p22 = levelParams(22);
    const crownUnits = (L: number) => {
      const s = createLevel(L);
      return s.nodes[s.cfg.objective!.targetNodeId!]!.units;
    };
    expect(crownUnits(6)).toBe(p6.enemyStart + 4);
    expect(crownUnits(22)).toBe(p22.enemyStart);
  });

  it("hold levels put the hill on the neutral nearest the world centre, armored", () => {
    for (const [L, ticks] of [
      [8, 600],
      [19, 900],
    ] as const) {
      const s = createLevel(L);
      const obj = s.cfg.objective!;
      expect(obj.type, `L${L}`).toBe("hold");
      expect(obj.requiredTicks, `L${L}`).toBe(ticks);
      const hill = s.nodes[obj.targetNodeId!]!;
      expect(hill.owner, `L${L} hill starts neutral`).toBe(NEUTRAL);
      // Nearest NEUTRAL to the centre (ids may tie across a mirror pair; the
      // lowest id wins, so no other neutral may be STRICTLY nearer).
      const d = (n: { x: number; y: number }) => Math.hypot(n.x - WORLD_W / 2, n.y - WORLD_H / 2);
      for (const n of s.nodes) {
        if (n.owner !== NEUTRAL) continue;
        expect(d(n), `L${L} node ${n.id} nearer than the hill`).toBeGreaterThanOrEqual(
          d(hill) - 1e-9,
        );
      }
      // Defensive centrepiece: a plain roll became a fortress; a special roll
      // keeps its kind (the dressing never overwrites a mechanic).
      expect(hill.kind, `L${L} hill kind`).not.toBe(KIND_STANDARD);
    }
    expect(createLevel(8).cfg.objective!.targetNodeId).toBeDefined();
    // The L8 hill specifically rolled standard on the shipped board — pin the
    // fortress upgrade so the "defensive centrepiece" claim stays true.
    const hill8 = createLevel(8).nodes[createLevel(8).cfg.objective!.targetNodeId!]!;
    expect(hill8.kind).toBe(KIND_FORTRESS);
  });

  it("the L11 siege starts +40% heavy with relentless knobs; L25 runs long with the strong brake", () => {
    const s11 = createLevel(11);
    expect(s11.cfg.objective).toMatchObject({ type: "outlast", requiredTicks: 1800 });
    const p11 = levelParams(11);
    const rival = s11.nodes.find((n) => n.owner === 2)!;
    // 1.4, not the spec draft's 1.6 — see the measured back-off note in
    // applyObjective (retry-stream fallbacks at 1.6/1.5, none at 1.4).
    expect(rival.units).toBe(Math.round(p11.enemyStart * 1.4));
    expect(s11.cfg.aiFirstMoveTick).toBe(45);
    expect(s11.cfg.aiIntervalTicks).toBe(60);
    expect(s11.cfg.aiKillPlayerBias).toBe(1.5);

    const s25 = createLevel(25);
    expect(s25.cfg.objective).toMatchObject({ type: "outlast", requiredTicks: 2400 });
    expect(s25.cfg.aiKillPlayerBias).toBe(1.6);
    // No unit bump at this depth — tier 6 carries the pressure.
    const rival25 = s25.nodes.find((n) => n.owner === 2)!;
    expect(rival25.units).toBe(levelParams(25).enemyStart);
  });

  it("the L16 claim quota is just over half the board, with the racing knobs", () => {
    const s = createLevel(16);
    const obj = s.cfg.objective!;
    expect(obj.type).toBe("claim");
    expect(obj.quota).toBe(Math.ceil(s.nodes.length * 0.55));
    expect(obj.quota!).toBeGreaterThan(s.nodes.length / 2);
    expect(obj.quota!).toBeLessThan(s.nodes.length);
    expect(s.cfg.aiKillPlayerBias).toBe(0.8);
    expect(s.cfg.aiFirstMoveTick).toBe(150); // the race gets a beat to read
    // The scripted race: every rival's opening lands before the first wake.
    for (const o of s.cfg.openings!) {
      expect(o.tick, `faction ${o.faction} opening`).toBeLessThan(s.cfg.aiFirstMoveTick);
    }
  });

  it("dressing is deterministic — an objective board hashes identically twice", () => {
    // The RNG-free contract, asserted on the dressed boards explicitly (the
    // determinism test's levels are all annihilation).
    for (const L of AUTHORED_OBJECTIVE_LEVELS) {
      const a = createLevel(L);
      const b = createLevel(L);
      expect(hashState(a), `L${L}`).toBe(hashState(b));
      expect(a.rng.s, `L${L} rng`).toBe(b.rng.s);
    }
  });

  it("gauntlet is never scheduled — it is an authored-board archetype only", () => {
    for (let L = 1; L <= 200; L++) {
      expect(objectiveTypeForLevel(L), `L${L}`).not.toBe("gauntlet");
    }
  });
});

describe("personas on the schedule", () => {
  it("hold levels cast the WARDEN in the hill-keeper slot", () => {
    // L19 by hand; the rotated holds by the pool rule. Faction 2 is the slot
    // whose home ties nearest the hill on every symmetric topology.
    expect(personasForLevel(19)[0]).toBe(WARDEN);
    for (let L = 27; L <= 60; L++) {
      if (objectiveTypeForLevel(L) !== "hold") continue;
      expect(personasForLevel(L)[0], `L${L}`).toBe(WARDEN);
    }
  });

  it("late duels each get a real personality, and not all the same one", () => {
    const seen = new Set<unknown>();
    for (let L = 27; L <= 60; L++) {
      const s = createLevel(L);
      if (s.cfg.factionCount !== 2) continue;
      const personas = personasForLevel(L);
      expect(personas, `L${L}`).toHaveLength(1);
      expect(personas[0], `L${L} fell back to BALANCED`).not.toBe(BALANCED);
      seen.add(personas[0]);
    }
    expect(seen.size, "every late duel drew the same persona").toBeGreaterThan(1);
  });
});

describe("kind compression", () => {
  it("all twelve kinds are in play by L29", () => {
    // 11 rollable kinds + KIND_STANDARD = the full set of 12.
    const pool = kindsUnlockedAt(29);
    expect(new Set(pool).size).toBe(11);
    for (const k of [KIND_NURSERY, KIND_VAULT, KIND_SIPHON, KIND_CORRUPTER, KIND_RIFT]) {
      expect(pool, `kind ${k}`).toContain(k);
    }
  });

  it("each non-boss debut is hand-staged on its level and announced", () => {
    const debuts: ReadonlyArray<readonly [number, NodeKind, string]> = [
      [18, KIND_NURSERY, "NURSERY"],
      [21, KIND_VAULT, "VAULT"],
      [24, KIND_SIPHON, "SIPHON"],
      [27, KIND_CORRUPTER, "CORRUPTER"],
      [29, KIND_RIFT, "RIFT"],
    ];
    for (const [L, kind, name] of debuts) {
      const s = createLevel(L);
      const carriers = s.nodes.filter((n) => n.kind === kind);
      // The scripted orbit guarantees one per faction sphere: the picker
      // prefers non-centre orbits (the centre is the symmetry group's fixed
      // point — an orbit of ONE), so a full orbit lands whatever the rolls did.
      expect(carriers.length, `L${L} ${name}`).toBeGreaterThanOrEqual(s.cfg.factionCount);
      expect(introNoteForLevel(L), `L${L} intro`).toContain(name);
      // And never a level earlier — the unlock gate holds.
      expect(kindsUnlockedAt(L - 1), `L${L - 1} pool`).not.toContain(kind);
    }
  });
});

describe("objective levels pass the screen", () => {
  it("finds an in-band, winnable board for every scheduled objective level", () => {
    // The gate that makes the dressing honest: screening probes play the
    // DRESSED board (applyObjective runs inside createLevel), so an accepted
    // board is one the reference portfolio beat with the objective active.
    // Measured at wiring time (attempt 0): L6 9/12, L8 10/12, L11 6/12,
    // L16 5/12, L19 9/12, L22 4/12, L25 6/12 — all accepted within budget.
    for (const L of AUTHORED_OBJECTIVE_LEVELS) {
      const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      const band = bandFor(L);
      expect(r.accepted, `L${L} fell back (wins ${r.wins}/12)`).toBe(true);
      expect(r.wins, `L${L}`).toBeGreaterThanOrEqual(band.minWins);
      expect(r.carelessWins, `L${L}`).toBeLessThanOrEqual(band.maxCarelessWins);
      expect(r.state.cfg.objective?.type, `L${L} objective survived screening`).toBe(
        objectiveTypeForLevel(L),
      );
    }
  });
});
