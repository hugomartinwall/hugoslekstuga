import { describe, expect, it } from "vitest";
import { createTickEvents, diffTick } from "../lib/overrun/audio/events";
import type { GameState, Node } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";

/** Same helper shape as combat.test.ts — AI asleep, optional enemy sentinel. */
function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units">>,
  sentinel = true,
): GameState {
  if (sentinel) nodes = [...nodes, { x: 146, y: 76, owner: 2, units: 1 }];
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 1,
      aiFirstMoveTick: 1e6,
      aiIntervalTicks: 60,
      aiMinUnits: 5,
      aiOverkillMargin: 2,
      aiTier: 1,
      aiKillCertainty: 99,
      aiSendFraction: 0.65,
      aiNeutralBonus: 25,
      aiKillPlayerBias: 1,
      factionCount: 2,
      ais: [{ faction: 2, persona: BALANCED, firstMoveTick: 1e6 }],
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
    nextAiTick: [0, 0, 1e6, 0, 0],
    firstSendDone: false,
  };
}

/** Run one tick with a prev snapshot and return the diffed events. */
function step(state: GameState, commands: Parameters<typeof tick>[1] = []) {
  const prev = structuredClone(state);
  tick(state, commands);
  const out = createTickEvents();
  diffTick(prev, state, out);
  return out;
}

describe("tick event diff", () => {
  it("detects a player send once, not on subsequent drain ticks", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 10 },
      { x: 60, y: 45, owner: 0, units: 5 },
    ]);
    const first = step(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    expect(first.playerSends).toBe(1);
    const second = step(s);
    expect(second.playerSends).toBe(0);
  });

  it("detects a redirect as a new send", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 20 },
      { x: 60, y: 45, owner: 0, units: 5 },
      { x: 40, y: 70, owner: 0, units: 5 },
    ]);
    step(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    step(s);
    const redirect = step(s, [{ type: "sendUnits", from: 0, to: 2 }]);
    expect(redirect.playerSends).toBe(1);
  });

  it("classifies arrivals and the eventual capture", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 10 },
      { x: 60, y: 45, owner: 0, units: 3 },
    ]);
    step(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    let hostile = 0;
    let friendly = 0;
    let captures = 0;
    for (let i = 0; i < 200; i++) {
      const e = step(s);
      hostile += e.arrivalsHostile;
      friendly += e.arrivalsFriendly;
      captures += e.playerCaptures;
    }
    expect(captures).toBe(1);
    expect(hostile).toBeGreaterThanOrEqual(3); // defenders shaved before flip
    expect(friendly).toBeGreaterThanOrEqual(4); // remainder deposited after flip
  });

  it("detects losing a node to the enemy", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 0 },
        { x: 60, y: 45, owner: 2, units: 10 },
      ],
      false,
    );
    s.flows.push({ from: 1, to: 0, remaining: 10 });
    let losses = 0;
    for (let i = 0; i < 200; i++) losses += step(s).playerLosses;
    expect(losses).toBe(1);
  });

  it("counts enemy neutral-grabs separately", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 50 },
        { x: 60, y: 45, owner: 0, units: 1 },
        { x: 80, y: 45, owner: 2, units: 10 },
      ],
      false,
    );
    s.flows.push({ from: 2, to: 1, remaining: 8 });
    let enemyCaptures = 0;
    let playerLosses = 0;
    for (let i = 0; i < 200; i++) {
      const e = step(s);
      enemyCaptures += e.aiCaptures;
      playerLosses += e.playerLosses;
    }
    expect(enemyCaptures).toBe(1);
    expect(playerLosses).toBe(0);
  });

  it("reports nothing on a quiet tick", () => {
    const s = makeState([{ x: 40, y: 45, owner: 1, units: 10 }]);
    const e = step(s);
    expect(Object.values(e).every((v) => v === 0)).toBe(true);
  });
});
