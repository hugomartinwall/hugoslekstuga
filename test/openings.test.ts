import { describe, expect, it } from "vitest";
import type { GameState, Node, ScriptedOpening } from "../lib/overrun/sim/state";
import { NEUTRAL, PLAYER } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { BALANCED } from "../lib/overrun/sim/ai";
import { createLevel, OPENINGS } from "../lib/overrun/sim/level";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";

/**
 * Scripted openings: authored first moves ahead of the AI's normal wake.
 * The mechanism is tested on hand-built boards; the L1/L2 schedule entries
 * are tested against the real generated boards, because their whole purpose
 * is what a first-time player sees in the opening minute.
 */

function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units">>,
  openings: ScriptedOpening[],
  aiFirstMoveTick = 1_000_000,
): GameState {
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 1,
      seed: 0, // hand-built board
      aiFirstMoveTick,
      aiIntervalTicks: 60,
      aiMinUnits: 5,
      aiOverkillMargin: 2,
      aiTier: 1,
      aiKillCertainty: 99,
      aiSendFraction: 0.65,
      aiNeutralBonus: 25,
      aiKillPlayerBias: 1,
      factionCount: 2,
      ais: [{ faction: 2, persona: BALANCED, firstMoveTick: aiFirstMoveTick }],
      openings,
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
    nextAiTick: [0, 0, aiFirstMoveTick, 0, 0],
    firstSendDone: false,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
  };
}

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks && state.status === "playing"; i++) tick(state, []);
}

describe("scripted opening mechanism", () => {
  it("fires exactly at its tick, from the richest node, at the nearest neutral", () => {
    const s = makeState(
      [
        { x: 20, y: 45, owner: 1, units: 10 },
        { x: 100, y: 45, owner: 2, units: 8 }, // poorer
        { x: 130, y: 45, owner: 2, units: 20 }, // the richest — the source
        { x: 110, y: 60, owner: 0, units: 3 }, // nearest neutral to the source
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      [{ faction: 2, tick: 10, to: "nearNeutral", fraction: 0.5 }],
    );
    run(s, 10);
    expect(s.flows.length).toBe(0); // not yet — fires AT tick 10, not before
    run(s, 1);
    // Half of the source's ~21 units (20 + the tick-0 production), minus the
    // packet the flow already emitted in the same tick.
    expect(s.flows.length).toBe(1);
    expect(s.flows[0]).toMatchObject({ from: 2, to: 3 });
    expect(s.flows[0]!.remaining).toBeGreaterThanOrEqual(9);
    // Fires once: the flow drains and is not re-issued.
    run(s, 200);
    expect(s.flows.length).toBe(0);
    expect(s.nodes[3]!.owner).toBe(2);
  });

  it("farNeutral and playerNearest resolve their roles", () => {
    const far = makeState(
      [
        { x: 20, y: 45, owner: 1, units: 10 },
        { x: 130, y: 45, owner: 2, units: 20 },
        { x: 110, y: 45, owner: 0, units: 3 },
        { x: 40, y: 45, owner: 0, units: 3 }, // farthest neutral from the source
      ],
      [{ faction: 2, tick: 5, to: "farNeutral" }],
    );
    run(far, 6);
    expect(far.flows.some((f) => f.from === 1 && f.to === 3)).toBe(true);

    const hunt = makeState(
      [
        { x: 20, y: 45, owner: 1, units: 10 },
        { x: 60, y: 60, owner: 1, units: 2 }, // nearest player node to the source
        { x: 130, y: 45, owner: 2, units: 20 },
        { x: 100, y: 45, owner: 0, units: 3 },
      ],
      [{ faction: 2, tick: 5, to: "playerNearest" }],
    );
    run(hunt, 6);
    expect(hunt.flows.some((f) => f.from === 2 && f.to === 1)).toBe(true);
  });

  it("a faction with no nodes skips its opening without crashing", () => {
    const s = makeState(
      [
        { x: 20, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
        { x: 140, y: 80, owner: 3 as const, units: 5 },
      ],
      [{ faction: 2, tick: 5, to: "nearNeutral" }],
    );
    s.cfg.ais = [
      { faction: 2, persona: BALANCED, firstMoveTick: 1e6 },
      { faction: 3, persona: BALANCED, firstMoveTick: 1e6 },
    ];
    s.cfg.factionCount = 3;
    run(s, 20);
    expect(s.status).toBe("playing");
    expect(s.flows.length).toBe(0);
  });
});

describe("the opening minute on real boards (the reviewer window)", () => {
  it("L1: the bot visibly moves by 8s, and at a neutral — zero threat", () => {
    const s = createLevel(1);
    const openTick = OPENINGS[1]![0]!.tick;
    run(s, openTick + 1);
    const botFlows = s.flows.filter((f) => s.nodes[f.from]!.owner === 2);
    expect(botFlows.length).toBeGreaterThan(0);
    for (const f of botFlows) expect(s.nodes[f.to]!.owner).toBe(NEUTRAL);
  });

  it("L1-L3: first bot activity lands inside 12 seconds on every board", () => {
    // The pre-submission gate (bot first hostile flow ≤12s on L1-L3) asserted
    // at its source: a passive player must SEE the game is alive well inside
    // the conversion window.
    for (const level of [1, 2, 3]) {
      const s = createLevel(level);
      let firstMove = Infinity;
      for (let t = 0; t < 12 * 30 && s.status === "playing"; t++) {
        tick(s, []);
        if (s.flows.some((f) => s.nodes[f.from]!.owner !== PLAYER) || s.packets.some((p) => p.owner !== PLAYER)) {
          firstMove = t;
          break;
        }
      }
      expect(firstMove, `L${level} first bot move`).toBeLessThanOrEqual(12 * 30);
    }
  });

  it("L1-L3: total passivity survives the 60s cushion but ALWAYS ends by 5 minutes", () => {
    // Two contracts in tension, both load-bearing. The cushion: a confused
    // first-timer must still be alive at 60 s (the conversion funnel). The
    // valve: an all-capped standoff must be impossible — the capped bot
    // attacks with the brake off (allOwnCapped in ai.ts), so a passive game
    // ENDS in a postmortem and a fresh board instead of freezing forever.
    // Measured across 10 attempt-seeds per level: deaths span 63-98 s.
    for (const level of [1, 2, 3]) {
      const s = createLevel(level);
      run(s, 60 * 30);
      expect(s.nodes.some((n) => n.owner === PLAYER), `L${level} alive at 60s`).toBe(true);
      run(s, 240 * 30);
      expect(s.status, `L${level} ends by 5min`).toBe("lost");
    }
  });
});
