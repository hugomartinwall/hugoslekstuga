import { describe, expect, it } from "vitest";
import type { GameState, Node } from "../lib/overrun/sim/state";
import { tick, TICK_HZ } from "../lib/overrun/sim/tick";
import { levelParams } from "../lib/overrun/sim/level";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";

/**
 * The "go for the kill" contract from playtest feedback: an obviously beaten
 * player must actually be beaten — while low-tier AI stays conservative
 * enough to never look reckless during onboarding.
 */

/** Hand-built state with real per-level AI knobs (AI awake from tick 0). */
function makeState(
  level: number,
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units">>,
): GameState {
  const p = levelParams(level);
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level,
      seed: 0, // hand-built board
      aiFirstMoveTick: 0, // awake immediately — these tests are about reactions
      aiIntervalTicks: p.aiIntervalTicks,
      aiMinUnits: p.aiMinUnits,
      aiOverkillMargin: p.aiOverkillMargin,
      aiTier: p.aiTier,
      aiKillCertainty: p.aiKillCertainty,
      aiSendFraction: p.aiSendFraction,
      aiNeutralBonus: p.aiNeutralBonus,
      aiKillPlayerBias: 1,
      factionCount: 2,
      ais: [{ faction: 2, persona: BALANCED, firstMoveTick: 0 }],
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: UPGRADE_COST,
      playerUpgradeTicks: UPGRADE_TICKS,
    },
    nodes: nodes.map((n, id) => ({
      id,
      size: 1 as const,
      kind: 0 as const,
      guard: 0,
      upgrading: 0,
      selected: false,
      ...n,
    })),
    flows: [],
    packets: [],
    nextAiTick: [0, 0, 0, 0, 0],
    firstSendDone: true,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
  };
}

function run(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks && s.status === "playing"; i++) tick(s, []);
}

describe("kill instinct", () => {
  it("punishes the blunder: emptied home gets taken within ~20s (L5, tier 2)", () => {
    const s = makeState(5, [
      { x: 30, y: 45, owner: 1, units: 25 }, // home
      { x: 140, y: 45, owner: 0, units: 20 }, // distant prize
      { x: 70, y: 45, owner: 2, units: 45 }, // watching, 40 wu away
    ]);
    // The blunder: player empties the home into the far neutral.
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 600); // 20 s
    expect(s.nodes[0]!.owner).toBe(2);
  });

  it("finisher: a 1-unit last node against 30 units nearby ends the game fast — even at tier 1", () => {
    for (const level of [1, 5]) {
      const s = makeState(level, [
        { x: 60, y: 45, owner: 1, units: 1 },
        { x: 90, y: 45, owner: 2, units: 30 },
      ]);
      run(s, 15 * TICK_HZ);
      expect(s.status, `level ${level}`).toBe("lost");
    }
  });

  it("tier 1 is not reckless: an emptied NON-last node is left alone", () => {
    const s = makeState(1, [
      { x: 30, y: 45, owner: 1, units: 0 }, // open, but not the last node
      { x: 40, y: 70, owner: 1, units: 30 },
      { x: 90, y: 45, owner: 2, units: 25 },
      { x: 140, y: 45, owner: 0, units: 3 },
    ]);
    run(s, 300); // 10 s — long enough for a snipe to land from 30 wu if fired
    // Tier 1 snipes only last-node states; the open node may fall to NORMAL
    // attacks eventually, but not to the instant kill layer this quickly.
    expect(s.nodes[0]!.owner).toBe(1);
  });

  it("higher tiers DO punish the same open node quickly", () => {
    const s = makeState(10, [
      { x: 30, y: 45, owner: 1, units: 0 },
      { x: 40, y: 70, owner: 1, units: 30 },
      { x: 90, y: 45, owner: 2, units: 25 },
      { x: 140, y: 45, owner: 0, units: 3 },
    ]);
    run(s, 300);
    expect(s.nodes[0]!.owner).toBe(2);
  });
});

describe("knob monotonicity", () => {
  /**
   * The knob-monotonicity sweep that used to live here is gone, not weakened.
   *
   * It was a strict subset of `tiers.test.ts` > "the aggression knobs never
   * regress, within a topology, swept to L60": same four knobs plus enemyStart,
   * over L2-60 instead of L2-25. Two copies of one invariant have to be edited
   * in lockstep, and when the invariant changed — triads now freeze their
   * difficulty vector inside a window, so the curve is per-topology rather than
   * global — this copy came second and failed on its own terms.
   *
   * Deleted deliberately rather than reformulated twice. If you remove the
   * tiers.test.ts sweep, bring one back here.
   */
  it("still owns the knob RANGES, which the monotonicity sweep does not check", () => {
    // A curve can be monotone and still leave the game — these are the absolute
    // bounds every knob has to respect at any level or topology.
    for (let L = 1; L <= 200; L++) {
      const p = levelParams(L);
      expect(p.aiKillCertainty, `L${L}`).toBeGreaterThanOrEqual(1.25);
      expect(p.aiSendFraction, `L${L}`).toBeLessThanOrEqual(0.85);
      expect(p.aiSendFraction, `L${L}`).toBeGreaterThan(0);
      expect(p.aiNeutralBonus, `L${L}`).toBeGreaterThanOrEqual(6);
      expect(p.aiFirstMoveTick, `L${L}`).toBeGreaterThanOrEqual(45);
      expect(p.aiIntervalTicks, `L${L}`).toBeGreaterThanOrEqual(45);
      expect(p.aiMinUnits, `L${L}`).toBeGreaterThanOrEqual(6);
      expect(p.aiOverkillMargin, `L${L}`).toBeGreaterThanOrEqual(2);
    }
  });
});
