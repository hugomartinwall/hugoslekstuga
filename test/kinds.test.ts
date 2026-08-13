import { describe, expect, it } from "vitest";
import type { Faction, Node, NodeKind } from "../lib/overrun/sim/state";
import {
  KIND_BEACON,
  KIND_CORRUPTER,
  KIND_NURSERY,
  KIND_RELAY,
  KIND_RIFT,
  KIND_SIPHON,
  KIND_STANDARD,
  KIND_TURRET,
  KIND_VAULT,
  KIND_VOLATILE,
  NEUTRAL,
} from "../lib/overrun/sim/state";
import { prodInterval, startFlow, tick } from "../lib/overrun/sim/tick";
import {
  BEACON_FACTOR,
  CORRUPT_EVERY,
  CORRUPT_RANGE,
  RIFT_TRAVEL_TICKS,
  NURSERY_NEUTRAL_INTERVAL,
  PACKET_SPEED,
  PROD_INTERVAL,
  RELAY_PACKET_SPEED,
  SIPHON_EVERY,
  SIPHON_RANGE,
  UNIT_CAP,
  VAULT_CAP,
  VOLATILE_DAMAGE,
  VOLATILE_RADIUS,
  unitCap,
} from "../lib/overrun/sim/constants";
import {
  BOSS_KINDS,
  FIRST_BOSS_LEVEL,
  bossKindForLevel,
  createLevel,
  isBossLevel,
  kindsUnlockedAt,
  worldScaleForLevel,
} from "../lib/overrun/sim/level";
import { BALANCED } from "../lib/overrun/sim/ai";
import { authoredBoardFor } from "../lib/overrun/sim/authored";
import { fires, makeState, run } from "./sim-harness";

/**
 * Phase 3A.3: the six boss kinds.
 *
 * Each mechanic gets a focused hand-built board rather than a level sweep, so
 * a failure names the mechanic instead of "something on L32 changed".
 */

/**
 * Every board needs a live player AND a live rival, or updateStatus ends the
 * game on tick 0 and `run` returns immediately — which silently turns a
 * mechanic test into an assertion about nothing. Both are parked in far
 * corners, at least 60 wu from any test node, so they are outside every kind's
 * radius (the largest is VOLATILE_RADIUS/BEACON_RANGE at 26).
 *
 * Appended LAST so the interesting nodes keep the ids the tests refer to.
 */
const RIVAL = { x: 150, y: 82, owner: 2 as Faction, units: 20 };
const HERO = { x: 10, y: 8, owner: 1 as Faction, units: 20 };

describe("relay", () => {
  it("packets launched from a relay arrive sooner over the same distance", () => {
    const arrival = (kind: NodeKind): number => {
      // 40 wu apart: 40 ticks at PACKET_SPEED 1.0, 23 at RELAY_PACKET_SPEED 1.8.
      const s = makeState([
        { x: 20, y: 45, owner: 1, units: 20, kind },
        { x: 60, y: 45, owner: NEUTRAL, units: 99 },
        RIVAL,
      ]);
      run(s, 1, (i) => (i === 0 ? [{ type: "sendUnits", from: 0, to: 1 }] : []));
      const p = s.packets[0]!;
      return p.arriveTick - p.departTick;
    };
    const std = arrival(KIND_STANDARD);
    const relay = arrival(KIND_RELAY);
    expect(std).toBe(Math.ceil(40 / PACKET_SPEED));
    expect(relay).toBe(Math.ceil(40 / RELAY_PACKET_SPEED));
    expect(relay).toBeLessThan(std);
  });

  it("only the SOURCE kind matters — sending TO a relay is normal speed", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 20 },
      { x: 60, y: 45, owner: NEUTRAL, units: 99, kind: KIND_RELAY },
      RIVAL,
    ]);
    run(s, 1, (i) => (i === 0 ? [{ type: "sendUnits", from: 0, to: 1 }] : []));
    const p = s.packets[0]!;
    expect(p.arriveTick - p.departTick).toBe(Math.ceil(40 / PACKET_SPEED));
  });
});

describe("volatile", () => {
  /** Board: a volatile at (60,45) about to flip, one node in blast, one out. */
  const blastBoard = () =>
    makeState([
      { x: 20, y: 45, owner: 1, units: 30 }, // attacker, 40 wu — outside
      { x: 60, y: 45, owner: NEUTRAL, units: 1, kind: KIND_VOLATILE },
      { x: 70, y: 45, owner: 1, units: 20 }, // 10 wu from blast — inside
      { x: 60, y: 80, owner: 1, units: 20 }, // 35 wu from blast — outside
      RIVAL,
    ]);

  it("detonates on capture, damaging nodes in radius and sparing those outside", () => {
    expect(VOLATILE_RADIUS).toBeGreaterThan(10);
    expect(VOLATILE_RADIUS).toBeLessThan(35);
    const s = blastBoard();
    run(s, 200, (i) => (i === 0 ? [{ type: "sendUnits", from: 0, to: 1 }] : []));
    expect(s.nodes[1]!.owner).toBe(1); // captured
    // Node 2 is inside the blast; node 3 is outside. Both produce, so compare
    // against a run where the same board never detonates.
    const control = blastBoard();
    control.nodes[1]!.kind = KIND_STANDARD;
    run(control, 200, (i) => (i === 0 ? [{ type: "sendUnits", from: 0, to: 1 }] : []));
    expect(control.nodes[1]!.owner).toBe(1);
    expect(s.nodes[2]!.units).toBe(control.nodes[2]!.units - VOLATILE_DAMAGE);
    expect(s.nodes[3]!.units).toBe(control.nodes[3]!.units);
  });

  it("re-arms: a second capture detonates again", () => {
    // Node 2 is the blast witness AND the second attacker, so it eats its own
    // detonation — which is exactly the trade the kind is meant to impose.
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 6 }, // 40 wu — outside the blast
      { x: 60, y: 45, owner: NEUTRAL, units: 1, kind: KIND_VOLATILE },
      { x: 70, y: 45, owner: 2 as Faction, units: 60 }, // 10 wu — inside
    ]);
    const flips: number[] = [];
    let prevOwner = s.nodes[1]!.owner;
    for (let i = 0; i < 400; i++) {
      const before2 = s.nodes[2]!.units;
      // The rival's counter-attack goes through startFlow, not a sendUnits
      // command — applyCommands rejects any source the PLAYER does not own,
      // and that guard is deliberate ("never trust input").
      if (i === 150) startFlow(s, 2, 1);
      tick(s, i === 0 ? [{ type: "sendUnits" as const, from: 0, to: 1 }] : []);
      const owner = s.nodes[1]!.owner;
      if (owner !== prevOwner) {
        prevOwner = owner;
        // On a flip tick node 2 can also lose 1 to emission and gain 1 to
        // production, so a drop of >= VOLATILE_DAMAGE is only reachable via
        // the blast.
        if (before2 - s.nodes[2]!.units >= VOLATILE_DAMAGE) flips.push(i);
      }
    }
    expect(s.nodes[1]!.kind).toBe(KIND_VOLATILE); // kind survives capture
    expect(flips.length, `blast ticks: ${flips.join(",")}`).toBeGreaterThanOrEqual(2);
  });
});

describe("beacon", () => {
  it("speeds a friendly node in range and leaves an enemy's alone", () => {
    const s = makeState([
      { x: 60, y: 45, owner: 1, units: 5, kind: KIND_BEACON },
      { x: 70, y: 45, owner: 1, units: 5 }, // friendly, 10 wu — in range
      { x: 60, y: 80, owner: 1, units: 5 }, // friendly, 35 wu — out of range
      { x: 70, y: 50, owner: 2 as Faction, units: 5 }, // enemy in range
    ]);
    const base = PROD_INTERVAL[1];
    expect(prodInterval(s, s.nodes[1]!)).toBe(Math.round(base * BEACON_FACTOR));
    expect(prodInterval(s, s.nodes[2]!)).toBe(base);
    expect(prodInterval(s, s.nodes[3]!)).toBe(base);
    // And it lifts itself.
    expect(prodInterval(s, s.nodes[0]!)).toBe(Math.round(base * BEACON_FACTOR));
  });

  it("a neutral beacon lifts nobody", () => {
    const s = makeState([
      { x: 60, y: 45, owner: NEUTRAL, units: 5, kind: KIND_BEACON },
      { x: 70, y: 45, owner: 1, units: 5 },
      RIVAL,
    ]);
    expect(prodInterval(s, s.nodes[1]!)).toBe(PROD_INTERVAL[1]);
  });
});

describe("siphon", () => {
  it("steals exactly one unit per SIPHON_EVERY from the nearest hostile in range", () => {
    const s = makeState([
      { x: 60, y: 45, owner: 1, units: 10, kind: KIND_SIPHON },
      { x: 70, y: 45, owner: 2 as Faction, units: 30 }, // 10 wu — nearest
      { x: 78, y: 45, owner: 2 as Faction, units: 30 }, // 18 wu — also in range
    ]);
    expect(SIPHON_RANGE).toBeGreaterThan(18);
    const before = [s.nodes[0]!.units, s.nodes[1]!.units, s.nodes[2]!.units];
    const ticks = SIPHON_EVERY * 3 + 1;
    run(s, ticks);
    const drains = fires(ticks, SIPHON_EVERY);
    const grown = fires(ticks, PROD_INTERVAL[1]);
    const delta = (n: Node, u0: number) => n.units - u0;
    // Only the NEAREST hostile in range is drained — one unit per cadence.
    expect(delta(s.nodes[1]!, before[1]!)).toBe(grown - drains);
    expect(delta(s.nodes[2]!, before[2]!)).toBe(grown);
    // And the stolen units land on the siphon.
    expect(delta(s.nodes[0]!, before[0]!)).toBe(grown + drains);
  });

  it("stops at its own cap — a siphon cannot mint units forever", () => {
    /**
     * Regression. Without the cap check the drain is not a transfer, it is
     * creation: the victim tops itself back up from production while the
     * siphon accumulates without limit. Measured at 834 units after 20 minutes
     * against a cap of 50, which makes the node untakeable (effDef feeds
     * killCost) and prints a three-digit label in a two-digit circle.
     */
    const s = makeState([
      { x: 60, y: 45, owner: 1, units: 10, kind: KIND_SIPHON },
      { x: 70, y: 45, owner: 2 as Faction, units: 40, size: 2 },
    ]);
    run(s, 30 * 60 * 20); // 20 minutes at 30 Hz
    expect(s.nodes[0]!.units).toBeLessThanOrEqual(unitCap(1, KIND_SIPHON));
    // And the victim is not farmed to nothing either — it keeps producing.
    expect(s.nodes[1]!.units).toBeGreaterThan(0);
  });

  it("is dormant while neutral", () => {
    const s = makeState([
      { x: 60, y: 45, owner: NEUTRAL, units: 10, kind: KIND_SIPHON },
      { x: 70, y: 45, owner: 1, units: 30 },
      RIVAL,
    ]);
    const before = s.nodes[1]!.units;
    const ticks = SIPHON_EVERY * 3 + 1;
    run(s, ticks);
    // Only production changed the victim; nothing was drained.
    expect(s.nodes[1]!.units).toBe(before + fires(ticks, PROD_INTERVAL[1]));
    expect(s.nodes[0]!.units).toBe(10); // neutral, and not a nursery — static
  });

  it("does not drain out of range", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 10, kind: KIND_SIPHON },
      { x: 90, y: 45, owner: 2 as Faction, units: 30 }, // 70 wu away
    ]);
    const before = s.nodes[1]!.units;
    const ticks = SIPHON_EVERY * 2 + 1;
    run(s, ticks);
    expect(s.nodes[1]!.units).toBe(before + fires(ticks, PROD_INTERVAL[1]));
  });
});

describe("vault", () => {
  it("has a higher cap and fills it more slowly", () => {
    expect(unitCap(1, KIND_VAULT)).toBe(VAULT_CAP[1]);
    expect(unitCap(1, KIND_STANDARD)).toBe(UNIT_CAP[1]);
    expect(VAULT_CAP[1]).toBeGreaterThan(UNIT_CAP[1]);
    const s = makeState([
      { x: 60, y: 45, owner: 1, units: UNIT_CAP[1] - 1, kind: KIND_VAULT },
      RIVAL,
    ]);
    expect(prodInterval(s, s.nodes[0]!)).toBeGreaterThan(PROD_INTERVAL[1]);
    run(s, 5000);
    // A standard node would have stopped at UNIT_CAP; the vault keeps going.
    expect(s.nodes[0]!.units).toBeGreaterThan(UNIT_CAP[1]);
    expect(s.nodes[0]!.units).toBeLessThanOrEqual(VAULT_CAP[1]);
  });
});

describe("nursery", () => {
  it("grows while neutral, where a standard neutral does not", () => {
    const s = makeState([
      { x: 40, y: 45, owner: NEUTRAL, units: 5, kind: KIND_NURSERY },
      { x: 90, y: 45, owner: NEUTRAL, units: 5, kind: KIND_STANDARD },
      HERO,
      RIVAL,
    ]);
    const ticks = NURSERY_NEUTRAL_INTERVAL * 4 + 1;
    run(s, ticks);
    expect(s.nodes[0]!.units).toBe(5 + fires(ticks, NURSERY_NEUTRAL_INTERVAL));
    expect(s.nodes[1]!.units).toBe(5);
  });

  it("stops at the size cap like anything else", () => {
    const s = makeState([
      { x: 40, y: 45, owner: NEUTRAL, units: UNIT_CAP[1] - 1, kind: KIND_NURSERY },
      HERO,
      RIVAL,
    ]);
    run(s, NURSERY_NEUTRAL_INTERVAL * 10);
    expect(s.nodes[0]!.units).toBe(UNIT_CAP[1]);
  });

  it("the AI still takes a growing nursery — it does not stall against it", () => {
    // The growth term in killCost/scoreTarget exists so the AI commits enough
    // to beat a target that is bigger on arrival than it was at launch. Without
    // it the AI under-sends and the wave dies short, leaving the node neutral.
    const s = makeState(
      [
        { x: 20, y: 45, owner: 2 as Faction, units: 60 },
        { x: 60, y: 45, owner: NEUTRAL, units: 12, kind: KIND_NURSERY },
        HERO,
      ],
      { ais: [{ faction: 2, persona: BALANCED, firstMoveTick: 0 }], tier: 3, interval: 30 },
    );
    run(s, 900);
    expect(s.nodes[1]!.owner).toBe(2);
  });
});

describe("boss level schedule", () => {
  it("debuts one kind every six levels from L14, and nowhere else", () => {
    const bosses: number[] = [];
    for (let L = 1; L <= 80; L++) if (isBossLevel(L)) bosses.push(L);
    expect(bosses).toEqual([14, 20, 26, 32, 38, 44, 50, 56]);
    expect(bosses.map((L) => bossKindForLevel(L))).toEqual([...BOSS_KINDS]);
    expect(bossKindForLevel(13)).toBeNull();
    expect(bossKindForLevel(62)).toBeNull(); // the schedule ends with the kinds
  });

  it("the debuting kind is present, on the contested centre, on every boss level", () => {
    for (const L of [14, 20, 26, 32, 38, 44, 50, 56]) {
      const st = createLevel(L);
      const boss = bossKindForLevel(L)!;
      const carriers = st.nodes.filter((n) => n.kind === boss);
      expect(carriers.length, `L${L}`).toBeGreaterThanOrEqual(2);
      const centre = st.nodes.find((n) => Math.abs(n.x - 80) < 1e-6 && Math.abs(n.y - 45) < 1e-6);
      expect(centre, `L${L} has a contested centre`).toBeDefined();
      expect(centre!.kind, `L${L} centre carries the boss kind`).toBe(boss);
    }
  });

  it("boss kinds carry across their whole symmetry orbit (fairness)", () => {
    // Same image construction as factions.test.ts's twin-size sweep: every
    // node's images must exist AND carry the same kind, or one faction faces a
    // mechanic another does not.
    // Boss levels no longer all share a topology: the faction rotation is 7 long
    // and bosses arrive every 6, coprime on purpose, so they walk through duels,
    // triads and quads. The image set therefore has to follow the board instead
    // of assuming Klein reflections — which is what this test used to do, and
    // which silently passed only because every boss happened to be a 4-way.
    const imagesFor = (n: { x: number; y: number }, factions: number) => {
      if (factions === 2) return [{ x: 160 - n.x, y: 90 - n.y }];
      if (factions === 3) {
        const rot = (k: number) => {
          const a = (k * 2 * Math.PI) / 3;
          const dx = n.x - 80;
          const dy = n.y - 45;
          return {
            x: 80 + dx * Math.cos(a) - dy * Math.sin(a),
            y: 45 + dx * Math.sin(a) + dy * Math.cos(a),
          };
        };
        return [rot(1), rot(2)];
      }
      return [
        { x: 160 - n.x, y: n.y },
        { x: n.x, y: 90 - n.y },
        { x: 160 - n.x, y: 90 - n.y },
      ];
    };
    const mismatches: string[] = [];
    for (const L of [14, 20, 26, 32, 38, 44, 50, 56]) {
      const st = createLevel(L);
      for (const n of st.nodes) {
        for (const img of imagesFor(n, st.cfg.factionCount)) {
          // A rotation is float maths, unlike the exact 160-x of a reflection,
          // so the tolerance has to clear fp error. 1e-3 is still four orders
          // below MIN_SPACING, so it cannot match the wrong node.
          const twin = st.nodes.find(
            (m) => Math.abs(m.x - img.x) < 1e-3 && Math.abs(m.y - img.y) < 1e-3,
          );
          if (!twin)
            mismatches.push(
              `L${L} (${st.cfg.factionCount}-way) node ${n.id} has no image at ${img.x.toFixed(2)},${img.y.toFixed(2)}`,
            );
          else if (twin.kind !== n.kind)
            mismatches.push(`L${L} node ${n.id} kind ${n.kind} vs twin ${twin.kind}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("a kind never appears before the level that debuts it", () => {
    // Authored gauntlets are exempt BY DESIGN: a puzzle built around a kind
    // IS that kind's introduction (the vault gauntlet teaches the vault by
    // making it the prize), and its board is hand-placed, not rolled — the
    // roll-pool gate this test guards is untouched.
    const early: string[] = [];
    for (let L = 1; L <= 80; L++) {
      if (authoredBoardFor(L)) continue;
      const allowed = new Set<NodeKind>(kindsUnlockedAt(L));
      allowed.add(KIND_STANDARD);
      for (const n of createLevel(L).nodes) {
        if (!allowed.has(n.kind)) early.push(`L${L} node ${n.id} kind ${n.kind}`);
      }
    }
    expect(early).toEqual([]);
  });

  it("the unlock pool reaches the full set by L29 (kind compression) and then stops", () => {
    // The pool used to grow one kind per boss level and completed at L56 —
    // which hid a third of the game's content behind a depth most players
    // never reach. The compression pass hands SIPHON/VAULT/NURSERY/CORRUPTER/
    // RIFT non-boss debuts (KIND_DEBUTS), so the pool completes at L29 and
    // the L32+ bosses FEATURE an already-met kind instead of debuting one.
    expect(kindsUnlockedAt(FIRST_BOSS_LEVEL - 1).length).toBe(3);
    expect(kindsUnlockedAt(14).length).toBe(4); // relay only — L14-17 boards untouched
    expect(kindsUnlockedAt(17).length).toBe(4);
    expect(kindsUnlockedAt(18).length).toBe(5); // nursery, the first insert
    expect(kindsUnlockedAt(28).length).toBe(10);
    expect(kindsUnlockedAt(29).length).toBe(11); // rift completes the set
    expect(kindsUnlockedAt(56).length).toBe(11);
    expect(kindsUnlockedAt(200).length).toBe(11);
  });
});

describe("difficulty comes from kinds, not counts", () => {
  /** Share of neutral nodes carrying a non-standard kind over [lo, hi]. */
  const specialShare = (lo: number, hi: number, skipBoss: boolean): number => {
    let spec = 0;
    let total = 0;
    for (let L = lo; L <= hi; L++) {
      if (skipBoss && isBossLevel(L)) continue;
      for (const n of createLevel(L).nodes) {
        if (n.owner !== NEUTRAL) continue;
        total++;
        if (n.kind !== KIND_STANDARD) spec++;
      }
    }
    return spec / total;
  };

  it("late boards carry far more special kinds than early ones", () => {
    // Boss levels excluded so this measures the ROLL rate, not the scripted
    // debuts — otherwise the six hand-placed boards would carry the assertion.
    // Measured: 14.0% (L9-20) -> 34.5% (L45-60). Before this phase the rate was
    // a flat 0.18 at every level, so the ratio was ~1.0 and this failed.
    const early = specialShare(9, 20, true);
    const late = specialShare(45, 60, true);
    expect(late).toBeGreaterThan(early * 1.8);
  });

  it("node count is still capped — depth did not come from more dots", () => {
    // The cap is per board-size band now (it mirrors levelParams' nodeCount
    // table): bigger counts exist, but only on proportionally bigger boards
    // (worldScaleForLevel), so DENSITY never rises. The guard keeps its
    // meaning — counts follow the band table instead of creeping arbitrarily,
    // and depth still comes from kinds, not from more dots per screen.
    for (let L = 1; L <= 80; L++) {
      const st = createLevel(L);
      const scale = worldScaleForLevel(L);
      const cap =
        st.cfg.factionCount === 3
          ? scale >= 1.8 ? 13 : scale >= 1.4 ? 10 : 7
          : st.cfg.factionCount === 4
            ? scale >= 1.8 ? 26 : scale >= 1.4 ? 20 : 13
            : scale >= 1.8 ? 18 : scale >= 1.4 ? 14 : 9;
      expect(st.nodes.length, `L${L} (band ${scale})`).toBeLessThanOrEqual(cap);
    }
  });
});

describe("corrupter: takes passing units instead of destroying them", () => {
  /**
   * A corrupter sitting on the lane between two rival nodes. The turret's
   * mirror, and asserted against the turret so the difference is the subject:
   * a zapped packet leaves the board, a stolen one keeps flying and lands on
   * the other side.
   */
  const laneState = (kind: NodeKind) =>
    makeState([
      { x: 20, y: 45, owner: 2 as Faction, units: 40 }, // sender
      { x: 140, y: 45, owner: 3 as Faction, units: 40 }, // target
      { x: 80, y: 45, owner: 1, units: 10, kind }, // player-owned interceptor
    ]);

  it("a stolen packet survives, and it belongs to the corrupter's owner", () => {
    const s = laneState(KIND_CORRUPTER);
    startFlow(s, 0, 1, 1);
    // Long enough for packets to reach the midpoint, short of any arrival.
    for (let i = 0; i < 80; i++) tick(s, []);
    const stolen = s.packets.filter((p) => p.owner === 1);
    expect(stolen.length, "corrupter must have taken at least one").toBeGreaterThan(0);
    // Stolen packets keep their route — only the side changes.
    for (const p of stolen) {
      expect(p.from).toBe(0);
      expect(p.to).toBe(1);
    }
  });

  it("keeps more units on the board than a turret does", () => {
    const alive = (kind: NodeKind): number => {
      const s = laneState(kind);
      startFlow(s, 0, 1, 1);
      for (let i = 0; i < 80; i++) tick(s, []);
      return s.packets.length;
    };
    expect(alive(KIND_CORRUPTER)).toBeGreaterThan(alive(KIND_TURRET));
  });

  it("is dormant while neutral, like a turret", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 2 as Faction, units: 40 },
      { x: 140, y: 45, owner: 3 as Faction, units: 40 },
      { x: 80, y: 45, owner: NEUTRAL, units: 10, kind: KIND_CORRUPTER },
    ]);
    startFlow(s, 0, 1, 1);
    for (let i = 0; i < 80; i++) tick(s, []);
    expect(s.packets.every((p) => p.owner === 2)).toBe(true);
  });

  it("only reaches CORRUPT_RANGE, and only on its cadence", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 2 as Faction, units: 40 },
      { x: 140, y: 45, owner: 3 as Faction, units: 40 },
      // Parked well outside the lane: nothing ever comes within reach.
      { x: 80, y: 45 + CORRUPT_RANGE + 5, owner: 1, units: 10, kind: KIND_CORRUPTER },
    ]);
    startFlow(s, 0, 1, 1);
    for (let i = 0; i < 80; i++) tick(s, []);
    expect(s.packets.some((p) => p.owner === 1)).toBe(false);
    expect(CORRUPT_EVERY).toBeGreaterThan(0);
  });
});

describe("rift: a pair collapses the distance between them", () => {
  const pair = (kindA: NodeKind, kindB: NodeKind, ownerB: Faction) =>
    makeState([
      { x: 20, y: 45, owner: 2 as Faction, units: 40, kind: kindA },
      { x: 140, y: 45, owner: ownerB, units: 5, kind: kindB },
    ]);

  const firstArrival = (kindA: NodeKind, kindB: NodeKind, ownerB: Faction): number => {
    const s = pair(kindA, kindB, ownerB);
    startFlow(s, 0, 1, 1);
    for (let i = 0; i < 4; i++) tick(s, []);
    const p = s.packets[0];
    return p ? p.arriveTick - p.departTick : -1;
  };

  it("rift to friendly rift arrives in RIFT_TRAVEL_TICKS", () => {
    expect(firstArrival(KIND_RIFT, KIND_RIFT, 2 as Faction)).toBe(RIFT_TRAVEL_TICKS);
  });

  it("does not link to a rift someone else owns — it is a pair, not a portal", () => {
    const linked = firstArrival(KIND_RIFT, KIND_RIFT, 3 as Faction);
    const plain = firstArrival(KIND_STANDARD, KIND_STANDARD, 3 as Faction);
    expect(linked).toBe(plain);
    expect(linked).toBeGreaterThan(RIFT_TRAVEL_TICKS);
  });

  it("needs a rift at BOTH ends", () => {
    expect(firstArrival(KIND_RIFT, KIND_STANDARD, 2 as Faction)).toBeGreaterThan(RIFT_TRAVEL_TICKS);
    expect(firstArrival(KIND_STANDARD, KIND_RIFT, 2 as Faction)).toBeGreaterThan(RIFT_TRAVEL_TICKS);
  });

  it("is a floor, never a penalty — a short hop keeps its own shorter time", () => {
    const s = makeState([
      { x: 60, y: 45, owner: 2 as Faction, units: 40, kind: KIND_RIFT },
      { x: 64, y: 45, owner: 2 as Faction, units: 5, kind: KIND_RIFT },
    ]);
    startFlow(s, 0, 1, 1);
    for (let i = 0; i < 4; i++) tick(s, []);
    const p = s.packets[0]!;
    expect(p.arriveTick - p.departTick).toBeLessThan(RIFT_TRAVEL_TICKS);
  });
});
