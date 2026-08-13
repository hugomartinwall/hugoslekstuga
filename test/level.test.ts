import { describe, expect, it } from "vitest";
import {
  createLevel,
  introNoteForLevel,
  DEFAULT_BOOSTS,
  levelParams,
  worldScaleForLevel,
} from "../lib/overrun/sim/level";
/**
 * v3. These snapshots exist to catch *accidental* drift, so they are only ever
 * regenerated alongside a stated reason. Two so far:
 *  - v2: the duel "contested centre" node moved to the true fixed point
 *    (80, 45). It used to sample a y, so it sat closer to one start than the
 *    other and the boards were not actually mirror-symmetric.
 *  - v3: L1–L5 retuned for onboarding — denser boards, and the AI's opening
 *    attack no longer accelerates from 8 s to 2 s across the teaching levels.
 *  - v4: Phase 3A. Node radii grew ~49% and MIN_SPACING 16 → 20, because node
 *    diameter on a phone was 27.5 CSS px against a 44 px tap target and no
 *    amount of camera work fixes that — the scale is set by the board's world
 *    extent, so diameter depends on NODE_R, not on how many nodes there are.
 *    Bigger nodes need more spacing, and more spacing is what caps the count:
 *    L1–5 go 7/9/11/11/13 → 5/7/7/9/9, and every board is regenerated. This is
 *    the one thing that invalidates a frozen fixture legitimately — the maps
 *    genuinely changed shape, so re-freezing is recording the new design, not
 *    papering over a diff.
 * Earlier versions are in git history.
 */
import FROZEN from "./fixtures/levels-v4.json";
import { authoredBoardFor } from "../lib/overrun/sim/authored";
import { hashState, NEUTRAL, WORLD_H, WORLD_W } from "../lib/overrun/sim/state";
import {
  MAP_MARGIN,
  MAP_MARGIN_3WAY,
  MIN_SPACING,
  MIN_SPACING_3WAY,
  NODE_R,
} from "../lib/overrun/sim/constants";

/**
 * Geometry keeps changing well past the point the difficulty knobs saturate
 * (~L29), so the geometric sweeps run far beyond the tuned range. Costs ~20 ms.
 */
const SWEEP = 200;

describe("procedural levels", () => {
  it("is deterministic: same level twice ⇒ identical state", () => {
    for (const lvl of [1, 2, 3, 7, 13, 25]) {
      expect(hashState(createLevel(lvl))).toBe(hashState(createLevel(lvl)));
    }
  });

  it("node counts follow the difficulty table", () => {
    // Phase 3A cut these hard. They used to climb to 21, which put node
    // diameter at 27.5 CSS px on a phone against a 44 px tap target — and node
    // count was never the lever that fixes that, node *radius* is. Bigger radii
    // force bigger spacing, and bigger spacing is what caps the count. These
    // numbers are the sampler's measured capacity, not a difficulty choice;
    // difficulty now comes from node kinds and AI capability.
    //
    // v2 depth overhaul: counts now scale with the board-size BAND
    // (worldScaleForLevel), not with the level. The one-screen teaching band
    // keeps the counts above verbatim; the scrolling bands ask for more nodes
    // only because they bring proportionally more board (duels 14/18, quads
    // 20/26, triads 10/13 at bands 1.4/1.8+) — density never rises. What lands
    // on the board is the generator's orbit arithmetic over that ask: a 26-node
    // quad ask floors to 4 starts + 5 four-node orbits + a contested centre
    // = 25 placed, while 20 divides evenly (4 + 4·4, no centre).
    expect(createLevel(1).nodes).toHaveLength(5);
    expect(createLevel(2).nodes).toHaveLength(7);
    expect(createLevel(3).nodes).toHaveLength(7);
    expect(createLevel(5).nodes).toHaveLength(9);
    expect(worldScaleForLevel(7)).toBe(1.4); // the first scrolling board
    expect(createLevel(7).nodes).toHaveLength(14); // duel, band 1.4
    expect(worldScaleForLevel(12)).toBe(1.4);
    expect(createLevel(12).nodes).toHaveLength(10); // 3-way disc board, band 1.4
    expect(worldScaleForLevel(9)).toBe(1.4);
    expect(createLevel(9).nodes).toHaveLength(20); // 4-way Klein board, from its debut
    expect(worldScaleForLevel(19)).toBe(1.8);
    expect(createLevel(19).nodes).toHaveLength(25); // 4-way, band 1.8: 26 asked → 25 placed
    expect(worldScaleForLevel(40)).toBe(1.8); // deep 4-way, but not a boss level
    expect(createLevel(40).nodes).toHaveLength(25); // clamped at the band's ask
    expect(worldScaleForLevel(14)).toBe(2); // bosses are the set-piece 2× board...
    expect(createLevel(14).nodes).toHaveLength(25); // ...with the same 26-node ask
  });

  it("never asks the sampler for more nodes than it can place", () => {
    // Over-asking does not fail loudly: place() returns its best effort and the
    // crowding pass demotes whatever ended up too close. The symptom is a board
    // of uniformly small nodes, which is the exact regression this phase fixed,
    // so the cap is asserted rather than left to the formula.
    //
    // The cap is per BAND: it mirrors levelParams' nodeCount table, which
    // scales the ask with the band's area headroom (capacity grows ~1.96× at
    // 1.4, ~3.24× at 1.8, measured at MIN_SPACING). The generator's orbit
    // flooring means a board only ever comes in at or under its band's ask.
    for (let level = 1; level <= SWEEP; level++) {
      const { nodes, cfg } = createLevel(level);
      const scale = worldScaleForLevel(level);
      const cap =
        cfg.factionCount === 3
          ? scale >= 1.8 ? 13 : scale >= 1.4 ? 10 : 7
          : cfg.factionCount === 4
            ? scale >= 1.8 ? 26 : scale >= 1.4 ? 20 : 13
            : scale >= 1.8 ? 18 : scale >= 1.4 ? 14 : 9;
      expect(
        nodes.length,
        `L${level} (${cfg.factionCount}-faction, band ${scale})`,
      ).toBeLessThanOrEqual(cap);
    }
  });

  it("faction counts follow the curve", () => {
    const count = (lvl: number) => createLevel(lvl).cfg.factionCount;
    // Onboarding is duels all the way to L8. The 3-way board is the hardest
    // topology in the game by geometry (27% of the world, 1.33 neutrals per
    // faction, median 0% win rate at saturated difficulty) and it used to debut
    // at L6 — which is exactly where players reported sticking.
    expect(count(5)).toBe(2);
    expect(count(6)).toBe(2);
    expect(count(8)).toBe(2);
    expect(count(9)).toBe(4); // 4-way debuts alone
    expect(count(10)).toBe(2); // ...with duels either side
    expect(count(12)).toBe(3); // 3-way debuts alone, and late
    expect(count(13)).toBe(2);
    expect(count(17)).toBe(3);
  });

  it("boss levels are always the full-cast 4-way set piece", () => {
    /**
     * Deliberate reversal of the previous assertion, which wanted bosses to
     * "walk" through topologies. Measured, the walk delivered VOLATILE, SIPHON
     * and CORRUPTER debuting as 1v1s, and the L38 VAULT boss on a frozen-
     * difficulty 4-neutral triad. A boss level exists to be the spectacle —
     * the biggest board, every faction on it — and BOSS_KINDS' design note
     * promised exactly that. Variety between bosses still comes from the
     * 7-long rotation, which the second loop pins.
     */
    const bosses = [14, 20, 26, 32, 38, 44, 50, 56];
    for (const L of bosses) {
      expect(createLevel(L).cfg.factionCount, `boss L${L}`).toBe(4);
    }
    // Non-boss levels still vary — the walk survives where it belongs.
    const nonBoss = new Set<number>();
    for (let L = 14; L <= 56; L++) {
      if (!bosses.includes(L)) nonBoss.add(createLevel(L).cfg.factionCount);
    }
    expect(nonBoss).toEqual(new Set([2, 3, 4]));
  });

  it("twist levels ship the mutated board, not the plain one", () => {
    // The trap this guards: a mutator applied OUTSIDE createLevel would mean
    // the screening probes verified a board the player never plays. Because
    // the twist runs inside createLevel, this asserts the mutation is present
    // in exactly what screenLevel and the game both build.
    const swarm = createLevel(17);
    const swarmNeutrals = swarm.nodes.filter((n) => n.owner === 0).map((n) => n.units);
    // SWARM halves every neutral. The generator samples neutrals in
    // [neutralLo, neutralHi], so a halved board must (a) fit under the halved
    // ceiling and (b) have its cheapest neutral BELOW the generator's own
    // floor — a price no unmutated board can contain. (An earlier version
    // compared L17's max against L16's, but L16 is a 4-way: triad neutrals
    // are structurally smaller, so that assertion stayed green with the
    // mutator deleted.)
    const p17 = levelParams(17);
    for (const u of swarmNeutrals) expect(u).toBeLessThanOrEqual(p17.neutralHi >> 1);
    expect(Math.min(...swarmNeutrals)).toBeLessThan(p17.neutralLo);

    const factories = createLevel(23);
    for (const n of factories.nodes.filter((x) => x.owner === 0)) {
      expect(n.kind, `L23 node ${n.id}`).toBe(1); // KIND_FACTORY
    }
    // And both announce themselves on the intro card. (L18 carries the
    // NURSERY debut line and L15 the DOMINO gauntlet card, so the quiet-level
    // sample is L13 — an opening fires there, but openings are silent.)
    expect(introNoteForLevel(17)).toBe("TWIST · SWARM");
    expect(introNoteForLevel(23)).toBe("TWIST · ALL FACTORIES");
    expect(introNoteForLevel(13)).toBeNull();
  });

  it("keeps the 3-way board rare, because it is the one that cannot be widened", () => {
    // Triads are capped at 7 nodes by geometry and nothing in this file can lift
    // that. Serving them one level in four is what made a third of the game the
    // worst-measuring third; occasional is the remedy available.
    let triads = 0;
    for (let L = 1; L <= 60; L++) if (createLevel(L).cfg.factionCount === 3) triads++;
    expect(triads / 60, `${triads}/60 levels are 3-way`).toBeLessThan(0.2);
    expect(triads, "but they must not vanish — variety is the point").toBeGreaterThan(4);
  });

  it("exactly one player and one enemy start, mirrored, equal size", () => {
    // L15 left the sample when it became an authored gauntlet (no rival).
    for (const lvl of [1, 4, 8, 13]) {
      const s = createLevel(lvl);
      const players = s.nodes.filter((n) => n.owner === 1);
      const enemies = s.nodes.filter((n) => n.owner === 2);
      expect(players).toHaveLength(1);
      expect(enemies).toHaveLength(1);
      expect(enemies[0]!.x).toBeCloseTo(WORLD_W - players[0]!.x);
      expect(enemies[0]!.y).toBeCloseTo(WORLD_H - players[0]!.y);
      expect(enemies[0]!.size).toBe(players[0]!.size);
    }
  });

  it("neutral mirror-pairs share size and defender count", () => {
    const s = createLevel(8);
    const neutrals = s.nodes.filter((n) => n.owner === 0);
    for (const n of neutrals) {
      const twin = neutrals.find(
        (m) =>
          m.id !== n.id &&
          Math.abs(m.x - (WORLD_W - n.x)) < 0.001 &&
          Math.abs(m.y - (WORLD_H - n.y)) < 0.001,
      );
      const onCenter = Math.abs(n.x - WORLD_W / 2) < 0.001; // self-mirrored column
      if (!onCenter) {
        expect(twin, `neutral ${n.id} has a mirror twin`).toBeDefined();
        expect(twin!.units).toBe(n.units);
        expect(twin!.size).toBe(n.size);
      }
    }
  });

  it("respects the map margin for its own board topology", () => {
    // 3-way boards pack into a centred disc and use a narrower border, so a
    // single global margin does not describe them. Sweeping the full range
    // rather than a handful of levels — the old five-level sample happened to
    // contain no triad that reached the disc rim.
    //
    // The board is the LEVEL's half-extents about the fixed centre (80, 45):
    // bigger bands extend the rect symmetrically, and the margin holds at the
    // extended rim, not the classic one. The ?? defaults are the classic rect.
    for (let lvl = 1; lvl <= SWEEP; lvl++) {
      const s = createLevel(lvl);
      const margin = s.cfg.factionCount === 3 ? MAP_MARGIN_3WAY : MAP_MARGIN;
      const hx = s.cfg.worldHx ?? WORLD_W / 2;
      const hy = s.cfg.worldHy ?? WORLD_H / 2;
      for (const n of s.nodes) {
        const where = `L${lvl} f${s.cfg.factionCount} node ${n.id}`;
        expect(n.x, where).toBeGreaterThanOrEqual(WORLD_W / 2 - hx + margin - 0.001);
        expect(n.x, where).toBeLessThanOrEqual(WORLD_W / 2 + hx - margin + 0.001);
        expect(n.y, where).toBeGreaterThanOrEqual(WORLD_H / 2 - hy + margin - 0.001);
        expect(n.y, where).toBeLessThanOrEqual(WORLD_H / 2 + hy - margin + 0.001);
      }
    }
  });

  it("node ids equal array indices (flows/packets rely on it)", () => {
    const s = createLevel(12);
    s.nodes.forEach((n, i) => expect(n.id).toBe(i));
  });

  it("startUnits boost adds player starting units without changing the map", () => {
    const base = createLevel(4);
    const boosted = createLevel(4, { ...DEFAULT_BOOSTS, startUnits: 10 });
    const bp = boosted.nodes.find((n) => n.owner === 1)!;
    const pp = base.nodes.find((n) => n.owner === 1)!;
    expect(bp.units).toBe(pp.units + 10);
    expect(bp.x).toBe(pp.x);
  });

  it("L1–3 maps are byte-stable against the frozen snapshots", () => {
    for (const L of [1, 2, 3] as const) {
      const s = createLevel(L);
      const got = s.nodes.map((n) => ({
        x: Math.round(n.x * 1000) / 1000,
        y: Math.round(n.y * 1000) / 1000,
        units: n.units,
        size: n.size,
        o: n.owner === 1 ? "P" : n.owner === 2 ? "E" : "N",
      }));
      expect(got).toEqual(FROZEN[`L${L}`]);
    }
  });

  it("L4–5 keep frozen positions (kinds/units may differ by design)", () => {
    for (const L of [4, 5] as const) {
      const got = createLevel(L).nodes.map((n) => [
        Math.round(n.x * 1000) / 1000,
        Math.round(n.y * 1000) / 1000,
      ]);
      const want = (FROZEN[`L${L}`] as Array<{ x: number; y: number }>).map((n) => [n.x, n.y]);
      expect(got).toEqual(want);
    }
  });

  it("never draws two nodes overlapping", () => {
    // place() only checks a seed against already-placed nodes, so it cannot see
    // a seed's own rotational images. Triads used to relax their way into
    // literally overlapping large nodes (L11/17/25 were the worst), which made
    // the unit counts unreadable — the single most visible rendering artifact
    // on dense boards.
    const overlaps: string[] = [];
    for (let level = 1; level <= SWEEP; level++) {
      const { nodes } = createLevel(level);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - NODE_R[a.size]! - NODE_R[b.size]!;
          if (gap < 0) overlaps.push(`L${level} ${a.id}/${b.id} by ${(-gap).toFixed(1)}wu`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("places node CENTRES far enough apart, before any size shrinking", () => {
    // The overlap test above is nearly a tautology: shrinkCrowdedNodes makes
    // non-overlap a theorem, so it would pass even with the old buggy place().
    // This is the assertion that actually guards *placement*.
    //
    // Two separate claims, because the spacing target is not always reachable:
    //  - HARD: no two centres closer than two small-node diameters. Below this
    //    the shrink can no longer prevent an overlap, so it is the real floor.
    //  - SOFT: the sampler hits its target for the overwhelming majority of
    //    pairs. Rotational packing on a 15-node triad is genuinely tight (five
    //    free seeds, every image must clear every other), so a few percent fall
    //    back. Duels and quads should be at zero.
    const HARD_FLOOR = 2 * NODE_R[0];
    const worst = new Map<number, number>();
    const shortShare = new Map<number, { short: number; pairs: number }>();

    for (let level = 1; level <= SWEEP; level++) {
      const { nodes, cfg } = createLevel(level);
      const want = cfg.factionCount === 3 ? MIN_SPACING_3WAY : MIN_SPACING;
      const acc = shortShare.get(cfg.factionCount) ?? { short: 0, pairs: 0 };
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
          expect(d, `L${level} ${i}/${j}`).toBeGreaterThanOrEqual(HARD_FLOOR);
          acc.pairs++;
          if (d < want - 1e-9) acc.short++;
        }
      }
      shortShare.set(cfg.factionCount, acc);
      const w = worst.get(cfg.factionCount) ?? Infinity;
      worst.set(cfg.factionCount, Math.min(w, ...nodes.flatMap((a, i) =>
        nodes.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)))));
    }

    // Re-measured after Phase 3A raised MIN_SPACING 16 → 20: duels 0.216%,
    // quads 0.000%, triads 0.000%. Duels moved off zero, and the cap moves with
    // them — but only after establishing what the number actually is, because
    // "0.216% is close to 0.2%" is exactly how a threshold gets quietly bent
    // around a bug.
    //
    // It is not a bug. The 0.216% is **four pairs, on two levels** (L131 and
    // L135), each about 2 wu short of a 20 wu target, and both are mirror pairs
    // of the same two placements. Those two seeds are genuinely hard: nine
    // nodes in a mirror-symmetric rect at 20 wu is near the packing limit, and
    // raising PLACE_ATTEMPTS to 30000 did not find room. The HARD_FLOOR above
    // still holds and the crowding pass still guarantees no overlap, so the
    // visible consequence is two slightly smaller nodes on two levels in 200.
    //
    // The better fix is to drop an orbit the sampler cannot place rather than
    // cram it — a board of seven well-spaced nodes beats nine with two crammed,
    // and it would make the budget self-limiting instead of hand-capped per
    // topology. Tracked separately; it is a mapgen change and this is not the
    // moment to make one.
    //
    // Triads get the loosest cap and always have: a 7-node triad is 15 short
    // pairs out of 1092, worst gap 19.3 against a 20 wu target — three-fold
    // rotational packing inside a disc bounded by the world's short axis is the
    // tightest arrangement in the game. Quads are the roomiest and sit at a
    // clean zero over 7,326 pairs, so they get no allowance at all.
    const CAPS: Record<number, number> = { 2: 0.003, 3: 0.02, 4: 0.0 };
    for (const [factions, acc] of shortShare) {
      const share = acc.short / acc.pairs;
      expect(share, `${factions}-faction: ${(share * 100).toFixed(3)}% of pairs below target`)
        .toBeLessThanOrEqual(CAPS[factions]!);
    }
  });

  it("keeps large nodes available on every board topology", () => {
    // Regression for a spacing/shrink mismatch that quietly demoted almost
    // every large node on 3-way boards (1.1% large, against 15% on duels) —
    // a difficulty discontinuity across a third of all levels, invisible to
    // an aggregate size-mix check.
    const counts = new Map<number, { large: number; total: number }>();
    for (let level = 1; level <= SWEEP; level++) {
      const { nodes, cfg } = createLevel(level);
      const c = counts.get(cfg.factionCount) ?? { large: 0, total: 0 };
      for (const n of nodes) {
        c.total++;
        if (n.size === 2) c.large++;
      }
      counts.set(cfg.factionCount, c);
    }
    for (const [factions, c] of counts) {
      const share = c.large / c.total;
      // Each topology gets its own bar, for a structural reason rather than to
      // make a red test green. Starts and the contested centre are forced to
      // size 1, so only the orbits are ever rolled, and rollSize gives large 15%
      // of the time:
      //
      //   topology  nodes  rollable  ceiling  measured  survival
      //   2-way         9       5.9     9.9%     12.5%      126%
      //   3-way         7       3.0     6.4%      4.6%       71%
      //   4-way        13       8.0     9.2%      7.6%       82%
      //
      // The 4-way bar came down from 8%, and the reason matters: quads are 13
      // nodes now rather than 9, so a quad board carries ~1.0 large nodes where
      // it used to carry ~0.5. The SHARE fell only because the denominator grew.
      // 8% also sat 1.2pp under the arithmetic ceiling, which made it a pin on
      // one particular set of levels rather than a quality bar — and this test
      // exists to catch the 1.1%-large crowding regression, which is an order of
      // magnitude below any of these.
      const floor = factions === 3 ? 0.025 : factions === 4 ? 0.05 : 0.08;
      expect(
        share,
        `${factions}-faction boards: ${(share * 100).toFixed(1)}% large (floor ${floor})`,
      ).toBeGreaterThan(floor);
    }
  });

  it("keeps symmetric twins identical in size", () => {
    // shrinkCrowdedNodes must not be able to demote one faction's node and
    // leave its mirror/rotational twin at full size — that hands one player
    // more production on a board that is congruent by construction.
    //
    // Twins are identified positionally: every non-centre node has an image
    // under the board's symmetry group, and that image must match it exactly.
    const mismatches: string[] = [];
    const at = (nodes: ReturnType<typeof createLevel>["nodes"], x: number, y: number) =>
      nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 1e-6);

    for (let level = 1; level <= SWEEP; level++) {
      if (authoredBoardFor(level)) continue; // gauntlets are asymmetric on purpose
      const { nodes, cfg } = createLevel(level);
      const images = (n: { x: number; y: number }): Array<{ x: number; y: number }> => {
        if (cfg.factionCount === 2) return [{ x: WORLD_W - n.x, y: WORLD_H - n.y }];
        if (cfg.factionCount === 4) {
          return [
            { x: WORLD_W - n.x, y: n.y },
            { x: n.x, y: WORLD_H - n.y },
            { x: WORLD_W - n.x, y: WORLD_H - n.y },
          ];
        }
        const rot = (k: number) => {
          const a = (2 * Math.PI * k) / 3;
          const dx = n.x - WORLD_W / 2;
          const dy = n.y - WORLD_H / 2;
          return {
            x: WORLD_W / 2 + dx * Math.cos(a) - dy * Math.sin(a),
            y: WORLD_H / 2 + dx * Math.sin(a) + dy * Math.cos(a),
          };
        };
        return [rot(1), rot(2)];
      };

      for (const n of nodes) {
        for (const img of images(n)) {
          const twin = at(nodes, img.x, img.y);
          // A missing image means the node is not part of a full orbit; the
          // only legitimate case is a node fixed by the whole group (the board
          // centre), which maps to itself and is found above.
          if (!twin) {
            mismatches.push(`L${level} f${cfg.factionCount} n${n.id} has no image at (${img.x.toFixed(1)}, ${img.y.toFixed(1)})`);
            continue;
          }
          if (twin.size !== n.size) {
            mismatches.push(`L${level} n${n.id}(s${n.size}) vs twin n${twin.id}(s${twin.size})`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("never shrinks a faction's starting node below medium", () => {
    // Starts are seeded at size 1. Letting the crowding pass demote them drops
    // the whole board a production tier (L33 used to put every start at size 0).
    for (let level = 1; level <= SWEEP; level++) {
      for (const n of createLevel(level).nodes) {
        if (n.owner === NEUTRAL) continue;
        expect(n.size, `L${level} start n${n.id} (owner ${n.owner})`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("keeps every node inside the board", () => {
    // "The board" is the level's half-extents about the fixed centre — the
    // drawn circle must fit inside [80 ± worldHx] × [45 ± worldHy], whatever
    // the band. On the classic bands this is the original [0, 160] × [0, 90].
    for (let level = 1; level <= SWEEP; level++) {
      const s = createLevel(level);
      const hx = s.cfg.worldHx ?? WORLD_W / 2;
      const hy = s.cfg.worldHy ?? WORLD_H / 2;
      for (const n of s.nodes) {
        const r = NODE_R[n.size]!;
        expect(n.x - r, `L${level} node ${n.id}`).toBeGreaterThanOrEqual(WORLD_W / 2 - hx);
        expect(n.x + r, `L${level} node ${n.id}`).toBeLessThanOrEqual(WORLD_W / 2 + hx);
        expect(n.y - r, `L${level} node ${n.id}`).toBeGreaterThanOrEqual(WORLD_H / 2 - hy);
        expect(n.y + r, `L${level} node ${n.id}`).toBeLessThanOrEqual(WORLD_H / 2 + hy);
      }
    }
  });

  it("difficulty knobs are monotonically hostile", () => {
    const a = levelParams(4);
    const b = levelParams(12);
    expect(b.aiIntervalTicks).toBeLessThanOrEqual(a.aiIntervalTicks);
    expect(b.aiFirstMoveTick).toBeLessThanOrEqual(a.aiFirstMoveTick);
    expect(b.aiMinUnits).toBeLessThanOrEqual(a.aiMinUnits);
    expect(b.enemyStart).toBeGreaterThanOrEqual(a.enemyStart);
  });
});
