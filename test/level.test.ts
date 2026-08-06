import { describe, expect, it } from "vitest";
import { createLevel, DEFAULT_BOOSTS, levelParams } from "../lib/overrun/sim/level";
import FROZEN from "./fixtures/levels-v1.json";
import { hashState, WORLD_H, WORLD_W } from "../lib/overrun/sim/state";
import { MAP_MARGIN } from "../lib/overrun/sim/constants";

describe("procedural levels", () => {
  it("is deterministic: same level twice ⇒ identical state", () => {
    for (const lvl of [1, 2, 3, 7, 13, 25]) {
      expect(hashState(createLevel(lvl))).toBe(hashState(createLevel(lvl)));
    }
  });

  it("node counts follow the difficulty table", () => {
    expect(createLevel(1).nodes).toHaveLength(5);
    expect(createLevel(2).nodes).toHaveLength(7);
    expect(createLevel(3).nodes).toHaveLength(9);
    expect(createLevel(5).nodes).toHaveLength(11);
    expect(createLevel(10).nodes).toHaveLength(12); // 3-way disc board
    expect(createLevel(20).nodes).toHaveLength(21); // 4-way Klein board
    expect(createLevel(40).nodes).toHaveLength(21); // clamped 4-way
  });

  it("faction counts follow the curve", () => {
    const count = (lvl: number) => createLevel(lvl).cfg.factionCount;
    expect(count(5)).toBe(2);
    expect(count(6)).toBe(3);
    expect(count(8)).toBe(2); // breather duel
    expect(count(12)).toBe(4);
    expect(count(15)).toBe(2);
  });

  it("exactly one player and one enemy start, mirrored, equal size", () => {
    for (const lvl of [1, 4, 8, 15]) {
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

  it("respects the map margin and keeps nodes apart", () => {
    for (const lvl of [1, 5, 10, 20, 25]) {
      const s = createLevel(lvl);
      for (const n of s.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(MAP_MARGIN - 0.001);
        expect(n.x).toBeLessThanOrEqual(WORLD_W - MAP_MARGIN + 0.001);
        expect(n.y).toBeGreaterThanOrEqual(MAP_MARGIN - 0.001);
        expect(n.y).toBeLessThanOrEqual(WORLD_H - MAP_MARGIN + 0.001);
      }
      // Spacing may relax under crowding but must never allow overlap (2×max radius).
      for (const a of s.nodes)
        for (const b of s.nodes)
          if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(15 - 6);
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

  it("L1–3 maps are byte-stable against the frozen pre-refactor snapshots", () => {
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

  it("difficulty knobs are monotonically hostile", () => {
    const a = levelParams(4);
    const b = levelParams(12);
    expect(b.aiIntervalTicks).toBeLessThanOrEqual(a.aiIntervalTicks);
    expect(b.aiFirstMoveTick).toBeLessThanOrEqual(a.aiFirstMoveTick);
    expect(b.aiMinUnits).toBeLessThanOrEqual(a.aiMinUnits);
    expect(b.enemyStart).toBeGreaterThanOrEqual(a.enemyStart);
  });
});
