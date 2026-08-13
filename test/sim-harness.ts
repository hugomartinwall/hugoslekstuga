/**
 * Shared hand-built-state harness for sim tests.
 *
 * Deliberately NOT a `.test.ts` — importing a spec from another spec makes
 * vitest register and run its `describe`s twice, which is the trap
 * `test/viewports.ts` exists to avoid. Same reasoning, same shape.
 *
 * Lifted verbatim from factions.test.ts, which had the richest of the four
 * near-identical copies in the suite. The other three (combat, aggression,
 * events) keep their own smaller versions for now; migrating them is tidying,
 * not correctness, and a half-migration would just add a fifth variant.
 */

import type { Faction, GameState, Node, NodeKind } from "../lib/overrun/sim/state";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";
import { tick } from "../lib/overrun/sim/tick";
import type { Command } from "../lib/overrun/sim/commands";

/** Hand-built state with explicit factions/kinds; AI asleep unless configured. */
export function makeState(
  nodes: Array<Partial<Node> & Pick<Node, "x" | "y" | "owner" | "units">>,
  opts: {
    ais?: GameState["cfg"]["ais"];
    tier?: number;
    interval?: number;
    certainty?: number;
    minUnits?: number;
    sendFraction?: number;
  } = {},
): GameState {
  const ais = opts.ais ?? [{ faction: 2 as Faction, persona: BALANCED, firstMoveTick: 1e6 }];
  const nextAiTick = [0, 0, 0, 0, 0];
  for (const fc of ais) nextAiTick[fc.faction] = fc.firstMoveTick;
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 1,
      seed: 0, // hand-built board — nothing here came out of the generator
      aiFirstMoveTick: 0,
      aiIntervalTicks: opts.interval ?? 60,
      aiMinUnits: opts.minUnits ?? 8,
      aiOverkillMargin: 4,
      aiTier: opts.tier ?? 2,
      aiKillCertainty: opts.certainty ?? 99,
      aiSendFraction: opts.sendFraction ?? 0.65,
      aiNeutralBonus: 25,
      aiKillPlayerBias: 1,
      factionCount: 1 + ais.length,
      ais,
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: UPGRADE_COST,
      playerUpgradeTicks: UPGRADE_TICKS,
    },
    nodes: nodes.map((n, id) => ({
      id,
      size: 1 as const,
      kind: 0 as NodeKind,
      guard: 0,
      upgrading: 0,
      selected: false,
      ...n,
    })),
    flows: [],
    packets: [],
    nextAiTick,
    firstSendDone: true,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
  };
}

export function run(s: GameState, ticks: number, cmds: (i: number) => Command[] = () => []): void {
  for (let i = 0; i < ticks && s.status === "playing"; i++) tick(s, cmds(i));
}

/**
 * How many times a per-tick cadence fires over `run(s, T)`.
 *
 * `run` executes ticks 0…T−1, and production, turret fire and siphon drain all
 * test `state.tick % interval === 0` — so tick 0 counts and the answer is ceil,
 * not floor. Getting this wrong produces an off-by-one that reads like a
 * mechanic bug.
 */
export const fires = (ticks: number, interval: number): number => Math.ceil(ticks / interval);
