import type { Faction, GameState, NodeKind, NodeSize } from "./state";
import {
  KIND_FORTRESS,
  KIND_STANDARD,
  KIND_VAULT,
  KIND_VOLATILE,
  NEUTRAL,
  PLAYER,
} from "./state";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "./constants";
import { BALANCED } from "./ai";

/**
 * Hand-authored boards: the GAUNTLET puzzles.
 *
 * Everything procedural in this game is screened for winnability; these are
 * the opposite discipline — data-only layouts with an INTENDED solution,
 * verified by replaying that solution in a unit test (deterministic sim makes
 * the replay exact). No RNG is consumed building one, no screening runs, and
 * the send budget is the puzzle: the board is arranged so the obvious line
 * spends the budget and fails, and the trick line — soften with the volatile
 * chain, feed production before the gate — wins inside it.
 *
 * The app layer treats a gauntlet loss as a free instant retry (no life).
 */

export interface AuthoredNode {
  x: number;
  y: number;
  owner: Faction;
  units: number;
  size: NodeSize;
  kind: NodeKind;
}

export interface SolutionStep {
  /** Sim tick to issue the command at. */
  atTick: number;
  from: number;
  to: number;
  fraction?: number;
}

export interface AuthoredBoard {
  level: number;
  /** Intro-card line. */
  intro: string;
  sendBudget: number;
  /** Gauntlet target node index; absent = own every node. */
  targetIndex?: number;
  nodes: AuthoredNode[];
  /**
   * The recorded intended solution — proof the budget is sufficient, pinned
   * by test/authored.test.ts. Not shown to the player (attempt hints reuse
   * the coach arrow with solution[0]).
   */
  solution: SolutionStep[];
}

/**
 * L10 — CRACK THE VAULT.
 *
 * A fortress gate (every second hit absorbed) stands between the player and
 * a fat vault. Charging the gate with the starting garrison spends the whole
 * budget breaking armour and arrives at the vault broke. The line: take the
 * two cheap side balls FIRST (three producers instead of one), let the
 * economy run, then converge everything through the gate and spend the last
 * send on the vault.
 */
const VAULT_CRACK: AuthoredBoard = {
  level: 10,
  intro: "GAUNTLET · CRACK THE VAULT",
  sendBudget: 6,
  targetIndex: 4,
  nodes: [
    { x: 25, y: 45, owner: PLAYER, units: 26, size: 1, kind: KIND_STANDARD },
    { x: 52, y: 20, owner: NEUTRAL, units: 4, size: 0, kind: KIND_STANDARD },
    { x: 52, y: 70, owner: NEUTRAL, units: 4, size: 0, kind: KIND_STANDARD },
    { x: 88, y: 45, owner: NEUTRAL, units: 11, size: 1, kind: KIND_FORTRESS },
    { x: 132, y: 45, owner: NEUTRAL, units: 26, size: 1, kind: KIND_VAULT },
  ],
  solution: [
    { atTick: 5, from: 0, to: 1, fraction: 0.3 },
    { atTick: 10, from: 0, to: 2, fraction: 0.45 },
    { atTick: 900, from: 1, to: 3 },
    { atTick: 905, from: 2, to: 3 },
    { atTick: 910, from: 0, to: 3 },
    { atTick: 1500, from: 3, to: 4 },
  ],
};

/**
 * L21 — THE DOMINO RUN.
 *
 * Volatiles detonate on every capture, damaging everything in radius —
 * including their neighbours' garrisons. Attacking the fat middle balls
 * head-on is unaffordable inside the budget; capturing the cheap volatile
 * FIRST softens the whole cluster, and the second volatile finishes the
 * job. Order is the entire puzzle.
 */
// L15, not L21: the vault KIND debut owns L21's board dressing, and an
// authored board would erase the debut orbit. The volatile chain reading as
// "early" against the L20 boss is the point — the puzzle IS the introduction.
const DOMINO_RUN: AuthoredBoard = {
  level: 15,
  intro: "GAUNTLET · THE DOMINO RUN",
  sendBudget: 5,
  nodes: [
    { x: 22, y: 45, owner: PLAYER, units: 24, size: 1, kind: KIND_STANDARD },
    { x: 62, y: 45, owner: NEUTRAL, units: 6, size: 0, kind: KIND_VOLATILE },
    { x: 82, y: 28, owner: NEUTRAL, units: 12, size: 1, kind: KIND_STANDARD },
    { x: 82, y: 62, owner: NEUTRAL, units: 12, size: 1, kind: KIND_STANDARD },
    { x: 86, y: 45, owner: NEUTRAL, units: 9, size: 0, kind: KIND_VOLATILE },
    { x: 128, y: 45, owner: NEUTRAL, units: 8, size: 0, kind: KIND_STANDARD },
  ],
  solution: [
    { atTick: 5, from: 0, to: 1, fraction: 0.4 },
    { atTick: 300, from: 1, to: 4 },
    { atTick: 700, from: 0, to: 2, fraction: 0.5 },
    { atTick: 1000, from: 2, to: 3 },
    { atTick: 1400, from: 4, to: 5 },
  ],
};

export const AUTHORED_BOARDS: readonly AuthoredBoard[] = [VAULT_CRACK, DOMINO_RUN];

export function authoredBoardFor(level: number): AuthoredBoard | undefined {
  return AUTHORED_BOARDS.find((b) => b.level === level);
}

/**
 * Build the GameState for an authored gauntlet. Deterministic by construction
 * (the rng seed is fixed and nothing draws from it), AI absent (no rival
 * faction on these boards — the gauntlet objective replaces the annihilation
 * rules, so an empty cast is NOT an instant win).
 */
export function createAuthoredLevel(board: AuthoredBoard): GameState {
  return {
    tick: 0,
    rng: { s: 0x5eed },
    status: "playing",
    cfg: {
      level: board.level,
      seed: 0,
      aiFirstMoveTick: 1_000_000_000,
      aiIntervalTicks: 1_000_000,
      aiMinUnits: 999,
      aiOverkillMargin: 99,
      aiTier: 1,
      aiKillCertainty: 99,
      aiSendFraction: 0.65,
      aiNeutralBonus: 0,
      aiKillPlayerBias: 1,
      factionCount: 2, // the sim's floor; no faction-2 node exists
      ais: [{ faction: 2, persona: BALANCED, firstMoveTick: 1_000_000_000 }],
      objective: {
        type: "gauntlet",
        sendBudget: board.sendBudget,
        targetNodeId: board.targetIndex,
      },
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: UPGRADE_COST,
      playerUpgradeTicks: UPGRADE_TICKS,
    },
    nodes: board.nodes.map((n, id) => ({
      id,
      x: n.x,
      y: n.y,
      owner: n.owner,
      units: n.units,
      size: n.size,
      kind: n.kind,
      guard: 0,
      upgrading: 0,
      selected: false,
    })),
    flows: [],
    packets: [],
    nextAiTick: [0, 0, 1_000_000_000, 0, 0],
    firstSendDone: true, // no hint arrow — the puzzle IS the level
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
    // Deliberately zero, like every other boost on authored boards: a puzzle
    // whose recorded solution depends on the buyer's abilities is a puzzle
    // with two answers. cfg.abilities stays absent, so the shipped solution
    // hashes hold.
    abilityCharges: { overcharge: 0, stasis: 0, recall: 0 },
    effects: { overcharge: [], stasis: [] },
  };
}
