import { describe, expect, it } from "vitest";
import type { Faction, GameState, Node, NodeKind } from "../lib/overrun/sim/state";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS, unitCap } from "../lib/overrun/sim/constants";
import { allPlayerNodesCapped, isNudgeCandidate, pickUpgradeNudgeNode } from "../lib/overrun/app/nudge";

/** Minimal hand-built state; AI asleep, no flows unless a test adds them. */
function makeState(
  nodes: Array<Partial<Node> & Pick<Node, "x" | "y" | "owner" | "units">>,
  cost: readonly [number, number] = UPGRADE_COST,
): GameState {
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 5,
      seed: 0, // hand-built board
      aiFirstMoveTick: 1e6,
      aiIntervalTicks: 60,
      aiMinUnits: 8,
      aiOverkillMargin: 4,
      aiTier: 2,
      aiKillCertainty: 99,
      aiSendFraction: 0.65,
      aiNeutralBonus: 25,
      aiKillPlayerBias: 1,
      factionCount: 2,
      ais: [
        {
          faction: 2 as Faction,
          persona: { aggression: 0.5, expansion: 0.5, opportunism: 0.5, turtle: 1 },
          firstMoveTick: 1e6,
        },
      ],
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: cost as [number, number],
      playerUpgradeTicks: UPGRADE_TICKS,
    },
    nodes: nodes.map((n, id) => ({
      id,
      size: 0 as const,
      kind: 0 as NodeKind,
      guard: 0,
      upgrading: 0,
      selected: false,
      ...n,
    })),
    flows: [],
    packets: [],
    nextAiTick: [0, 0, 1e6, 0, 0],
    firstSendDone: true,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
  };
}

describe("upgrade nudge candidacy", () => {
  it("rejects unaffordable, non-player, max-size, and in-progress nodes", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: UPGRADE_COST[0] - 1 }, // too poor
      { x: 40, y: 45, owner: 2, units: 50 }, // not the player's
      { x: 60, y: 45, owner: 1, units: 50, size: 2 }, // already max
      { x: 80, y: 45, owner: 1, units: 50, upgrading: 30 }, // building
      { x: 100, y: 45, owner: 0, units: 50 }, // neutral
    ]);
    for (let id = 0; id < 5; id++) expect(isNudgeCandidate(s, id), `node ${id}`).toBe(false);
    expect(pickUpgradeNudgeNode(s)).toBeNull();
  });

  it("accepts an affordable quiet player node, regardless of selection", () => {
    const s = makeState([{ x: 20, y: 45, owner: 1, units: UPGRADE_COST[0] }]);
    expect(isNudgeCandidate(s, 0)).toBe(true);
    s.nodes[0]!.selected = true;
    expect(isNudgeCandidate(s, 0)).toBe(true);
    expect(pickUpgradeNudgeNode(s)).toBe(0);
  });

  it("a hostile inbound flow makes a node unsafe; a friendly one doesn't", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 50 },
      { x: 60, y: 45, owner: 2, units: 30 },
      { x: 100, y: 45, owner: 1, units: 5 },
    ]);
    s.flows.push({ from: 1, to: 0, remaining: 10 });
    expect(isNudgeCandidate(s, 0)).toBe(false);
    s.flows.length = 0;
    s.flows.push({ from: 2, to: 0, remaining: 3 });
    expect(isNudgeCandidate(s, 0)).toBe(true);
  });

  it("an outbound flow disqualifies (upgrading a draining node teaches badly)", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 50 },
      { x: 100, y: 45, owner: 0, units: 5 },
    ]);
    s.flows.push({ from: 0, to: 1, remaining: 10 });
    expect(isNudgeCandidate(s, 0)).toBe(false);
  });

  it("picks the richest candidate, sticks to a still-valid sticky id", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 20 },
      { x: 60, y: 45, owner: 1, units: 40 },
    ]);
    expect(pickUpgradeNudgeNode(s)).toBe(1);
    expect(pickUpgradeNudgeNode(s, 0)).toBe(0); // sticky wins while valid
    s.nodes[0]!.owner = 2; // sticky lost to the enemy
    expect(pickUpgradeNudgeNode(s, 0)).toBe(1); // re-picks
  });

  it("respects the per-level discounted cost from cfg", () => {
    const s = makeState([{ x: 20, y: 45, owner: 1, units: 10 }], [9, 19]);
    expect(isNudgeCandidate(s, 0)).toBe(true);
  });
});

describe("cap-stall predicate", () => {
  const cap0 = unitCap(0, 0);

  it("true only when every player node sits at its cap with nothing moving", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: cap0 },
      { x: 60, y: 45, owner: 1, units: cap0 },
      { x: 100, y: 45, owner: 2, units: 5 },
      { x: 140, y: 45, owner: 0, units: 5 },
    ]);
    expect(allPlayerNodesCapped(s)).toBe(true);
  });

  it("one node below cap breaks the stall", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: cap0 },
      { x: 60, y: 45, owner: 1, units: cap0 - 1 },
      { x: 100, y: 45, owner: 2, units: 5 },
    ]);
    expect(allPlayerNodesCapped(s)).toBe(false);
  });

  it("an outbound flow, an in-flight packet, or a build counts as acting", () => {
    const flow = makeState([
      { x: 20, y: 45, owner: 1, units: cap0 },
      { x: 100, y: 45, owner: 2, units: 5 },
    ]);
    flow.flows.push({ from: 0, to: 1, remaining: 3 });
    expect(allPlayerNodesCapped(flow)).toBe(false);

    const packet = makeState([
      { x: 20, y: 45, owner: 1, units: cap0 },
      { x: 100, y: 45, owner: 2, units: 5 },
    ]);
    packet.packets.push({ owner: 1, from: 0, to: 1, departTick: 0, arriveTick: 30 });
    expect(allPlayerNodesCapped(packet)).toBe(false);

    const building = makeState([
      { x: 20, y: 45, owner: 1, units: cap0, upgrading: 50 },
      { x: 100, y: 45, owner: 2, units: 5 },
    ]);
    expect(allPlayerNodesCapped(building)).toBe(false);
  });

  it("no player nodes at all is a loss in progress, not a stall", () => {
    const s = makeState([{ x: 100, y: 45, owner: 2, units: 5 }]);
    expect(allPlayerNodesCapped(s)).toBe(false);
  });

  it("deposits past the cap still count as capped", () => {
    // Deposits may exceed the cap (the cap only limits growth) — a node
    // sitting ABOVE it is exactly as stalled as one sitting at it.
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: cap0 + 12 },
      { x: 100, y: 45, owner: 2, units: 5 },
    ]);
    expect(allPlayerNodesCapped(s)).toBe(true);
  });
});
