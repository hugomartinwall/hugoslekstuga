/**
 * Simulation state. Pure data — no DOM, no canvas, no platform imports.
 * All randomness flows through the seeded PRNG stored in the state, so the
 * sim is deterministic: same seed + same commands ⇒ same state, forever.
 */

export interface Rng {
  /** mulberry32 state word. */
  s: number;
}

/** Returns a float in [0, 1) and advances the RNG state. */
export function rngNext(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Factions are small integers: 0 = neutral, 1 = the player, 2–4 = AI rivals.
 * Free-for-all: every faction is hostile to every other.
 */
export type Faction = 0 | 1 | 2 | 3 | 4;
export const NEUTRAL: Faction = 0;
export const PLAYER: Faction = 1;
export const MAX_FACTIONS = 4;

/**
 * Node specializations. Fixed at mapgen; survive capture.
 *
 * 0–3 are the originals, taught on L4/L5/L7. 4–11 debut one per boss level from
 * L14 (see BOSS_KINDS in level.ts) and join the random neutral pool from their
 * debut onward.
 *
 * These are where late-game *variety* comes from. Not difficulty — measured,
 * the six kinds added in Phase 3A are worth +4.4pp of win rate TO the player,
 * because a human exploits a new mechanic faster than the AI does. That is the
 * right trade for a boss set piece and the wrong one to mistake for a curve;
 * see the note at the top of TIERS in ai.ts.
 *
 * Adding a kind: widen the union, add the const, give it a KIND_LURE entry in
 * ai.ts and a KIND_NAMES/KIND_VERBS entry in fx.ts (all Records, so tsc catches
 * the omission), and a branch in drawNode.
 */
export type NodeKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const KIND_STANDARD = 0;
export const KIND_FACTORY = 1; // produces ~1.6× faster
export const KIND_FORTRESS = 2; // two hostile packets per defender killed
export const KIND_TURRET = 3; // zaps nearby hostile packets while owned
export const KIND_RELAY = 4; // packets launched FROM it fly much faster
export const KIND_VOLATILE = 5; // detonates on every capture, damaging neighbours
export const KIND_BEACON = 6; // speeds production of friendly nodes in range
export const KIND_SIPHON = 7; // while owned, drains the nearest hostile in range
export const KIND_VAULT = 8; // much higher unit cap, slower production
export const KIND_NURSERY = 9; // keeps growing while still neutral
export const KIND_CORRUPTER = 10; // takes passing hostile units instead of killing them
export const KIND_RIFT = 11; // rift-to-rift sends arrive almost instantly

export type NodeSize = 0 | 1 | 2; // small | medium | large

/**
 * A node on the map. Positions are static in world units on a fixed 160×90
 * board (packet positions are derived from them); the renderer scales.
 */
export interface Node {
  id: number;
  x: number;
  y: number;
  owner: Faction;
  units: number; // integer, always >= 0
  size: NodeSize;
  kind: NodeKind;
  /** Fortress damage alternator (0|1); every second hostile packet is absorbed. */
  guard: number;
  /** 0 = idle, else the tick this node's size upgrade completes. */
  upgrading: number;
  selected: boolean;
}

/**
 * A unit in transit. Position is derived at render time from the endpoint
 * nodes and (tick + alpha), so the sim never iterates packets for movement,
 * only for arrival.
 *
 * `owner` is the one mutable field, and only KIND_CORRUPTER writes it: it takes
 * passing hostile units rather than destroying them the way a turret does. That
 * is safe precisely because nothing about a packet's PATH depends on its owner
 * — from/to/departTick/arriveTick stay fixed, so a converted packet keeps
 * flying the same line and simply changes colour, which is also how a player
 * sees it happen.
 *
 * `fx`/`fy` are a FLOATING ORIGIN, set only by the RECALL ability: a recalled
 * packet keeps flying from wherever it was when the recall fired, which is not
 * a node. Everything that interpolates a packet's position (renderer, turrets,
 * corrupters, a second recall) must read `fx ?? nodes[from].x`. Hashed only
 * when present — the holdTicks conditional-hash trick — so every hash recorded
 * before recall existed stays valid.
 */
export interface Packet {
  owner: Faction; // stamped at spawn; compared against target owner AT ARRIVAL
  from: number; // node id
  to: number; // node id
  departTick: number;
  arriveTick: number;
  /** Floating origin (world units); present only on recalled packets. */
  fx?: number;
  fy?: number;
}

/* ---------------------------------------------------------------- abilities */

/**
 * Player-only actives, bought as permanent unlocks in the meta shop. The tier
 * (1..3) doubles as charges granted per level; 0 = locked. The record shape is
 * shared by the save file, `cfg.abilities` (charges granted this level) and
 * `state.abilityCharges` (live counts).
 */
export type AbilityKind = "overcharge" | "stasis" | "recall";

export interface AbilityCharges {
  overcharge: number;
  stasis: number;
  recall: number;
}

/**
 * Live timed effects on nodes. Plain arrays, NOT Maps — state must survive
 * structuredClone and hash deterministically, and hashState walks these in
 * insertion order. Entries are active while `until > state.tick` and pruned
 * as ticks pass. Hashed ONLY when non-empty (same reasoning as the objective
 * counters above hashState's objective block): an ability-free level keeps
 * every hash it ever had, byte for byte.
 */
export interface ActiveEffects {
  overcharge: { node: number; until: number }[];
  stasis: { node: number; until: number }[];
}

/** An active drain from a node. At most one per source node. */
export interface Flow {
  from: number;
  to: number;
  remaining: number; // integer units still to emit
}

export type GameStatus = "playing" | "won" | "lost";

/**
 * Per-AI behavioral fingerprint: pure multipliers over the base knobs.
 * BALANCED (all 1.0) reproduces the classic 1v1 math exactly.
 */
export interface Persona {
  aggression: number; // scales hostile-target bonus, shrinks overkill margin
  expansion: number; // scales the neutral-capture bonus
  opportunism: number; // scales the anti-snowball/weakness-seeking term
  turtle: number; // divides send fraction (bigger = keeps more garrison)
}

export interface FactionCfg {
  faction: Faction; // 2..4
  persona: Persona;
  firstMoveTick: number; // staggered per faction
  /**
   * Per-faction TIERS override; falls back to cfg.aiTier. Lets one rival be
   * the boss on a board where the others stay ordinary, and lets late levels
   * mix capability as well as personality. Config, not state — not hashed.
   */
  tier?: number;
}

/**
 * Alternate win conditions — the "shape of the fight" axis.
 *
 * Absent objective = annihilation (eliminate every rival), the game's home
 * key. Every objective except `gauntlet` KEEPS annihilation as an alternate
 * win path (wiping the board should never read as a failure); `gauntlet`
 * replaces the rules wholesale because its boards may hold no live rival at
 * all, and the standard check would declare an instant win.
 *
 * Progress state lives on GameState (`holdTicks`, `sendsUsed`), never here:
 * cfg is configuration, not state, and is deliberately not hashed (the same
 * contract as `seed` and `tier` above).
 */
export type ObjectiveType = "crown" | "hold" | "outlast" | "claim" | "gauntlet";

/**
 * A scripted opening move: one authored send, fired once at an exact tick,
 * usually before the faction's normal first wake. This is what gives every
 * level's first fifteen seconds an authored texture — the L1 bot visibly
 * grabbing a neutral at 8 s instead of standing mute — without touching the
 * decision layers. Roles resolve on the live board deterministically
 * (richest source; ties by lowest id), so openings consume no RNG.
 */
export interface ScriptedOpening {
  faction: Faction;
  /** Sim tick to fire at — fires exactly once, exactly then. */
  tick: number;
  /** Target role, resolved against the source when the opening fires. */
  to: "nearNeutral" | "farNeutral" | "playerNearest";
  /** Portion of the source's units to commit; defaults to cfg.aiSendFraction. */
  fraction?: number;
}

/**
 * Star criteria are deliberately NOT part of this type or the sim's win/lose
 * dispatch. Per-archetype star rules ("won a crown level without losing the
 * hill", "finished an outlast with the home intact") are presentation-layer
 * judgements over the final state and belong to the app layer (main.ts),
 * exactly like the existing time/loss star rules. The sim only decides
 * won/lost; keep it that way or every star tweak re-hashes the balance suite.
 */
export interface Objective {
  type: ObjectiveType;
  /** crown/gauntlet: the node whose capture wins; hold: the hill. */
  targetNodeId?: number;
  /** crown: the player's own crowned node — losing it loses the level. */
  playerCrownId?: number;
  /** hold: cumulative held ticks required; outlast: the tick that ends the siege. */
  requiredTicks?: number;
  /** gauntlet: effective sends allowed (cancels are free). */
  sendBudget?: number;
  /** claim: player-owned nodes required simultaneously. */
  quota?: number;
}

/** Per-level difficulty knobs, derived from the level number by level.ts. */
export interface LevelCfg {
  level: number;
  /**
   * The RNG seed this board was generated from.
   *
   * Carried so the board can be rebuilt exactly — for a mid-level reload, for a
   * replay, and so a bug report names a board rather than describing one. Now
   * that the seed is independent of the level number, `level` alone no longer
   * identifies a board and this is the only thing that does.
   *
   * Config, not state: `hashState` does not mix it, for the same reason it does
   * not mix `tier`. Two boards built from different seeds already differ in
   * every node they contain, so hashing the seed would add nothing a
   * determinism test could catch.
   */
  seed: number;
  aiFirstMoveTick: number;
  aiIntervalTicks: number;
  aiMinUnits: number;
  aiOverkillMargin: number;
  /** Structural capability tier (1–4); see TIERS in ai.ts. */
  aiTier: number;
  /** Kill-shot brake: required force multiple over the kill cost. Lower = bolder. */
  aiKillCertainty: number;
  /** Fraction of a node's units sent on normal attacks (garrison keeps the rest). */
  aiSendFraction: number;
  /** Target-scoring bonus for neutrals; shrinks with level so the AI hunts rivals. */
  aiNeutralBonus: number;
  /** Certainty multiplier applied when the kill victim is the player (anti-gank lever). */
  aiKillPlayerBias: number;
  /** Total factions on the board including the player (2–4). */
  factionCount: number;
  /** One entry per AI faction, ascending faction id from 2. */
  ais: FactionCfg[];
  /** Alternate win condition; absent = annihilation. See Objective. */
  objective?: Objective;
  /** Authored first moves, fired ahead of the normal AI wake. See ScriptedOpening. */
  openings?: ScriptedOpening[];
  /**
   * Board half-extents about the FIXED world centre (WORLD_W/2, WORLD_H/2).
   * Absent = the classic 80×45 halves. Bigger late-game boards extend
   * symmetrically around the same centre — WORLD_W/H stay untouched, because
   * everything from the mirror math to the camera's home compose keys off
   * that centre, and per-level data cannot re-roll frozen boards the way
   * changing the constants would.
   */
  worldHx?: number;
  worldHy?: number;
  /**
   * Packet speed multiplier (absent = 1). Bigger boards scale this up so the
   * felt tempo survives the scale — at 1 wu/tick a 1.8× board makes every
   * lane 2-4× the classic cost in growth-during-travel and the game
   * collapses into turtling (measured: 0-2 of 12 competent probes win).
   * Applies to every faction's packets equally; travelTicks owns the math.
   */
  packetSpeedMul?: number;
  /** Player-only production intervals by size (meta-progression boost). */
  playerProdInterval: readonly [number, number, number];
  /** Player-only node-upgrade costs (size 0→1, 1→2). */
  playerUpgradeCost: readonly [number, number];
  /** Player-only upgrade construction ticks. */
  playerUpgradeTicks: number;
  /**
   * Ability charges granted for this level (meta-progression, player-only).
   * Absent = none, and absent means BYTE-IDENTICAL behaviour to before
   * abilities existed: the useAbility command rejects, no effect ever forms,
   * and hashState mixes nothing new. Config, not state — not hashed, same
   * contract as `seed` and `tier`.
   */
  abilities?: AbilityCharges;
}

export interface GameState {
  tick: number;
  rng: Rng;
  status: GameStatus;
  cfg: LevelCfg;
  nodes: Node[];
  flows: Flow[];
  packets: Packet[];
  /** Next normal-layer wake per faction id; indices 0–1 unused. Fixed length 5. */
  nextAiTick: number[];
  /** Set on the player's first send; the onboarding hint renders until then. */
  firstSendDone: boolean;
  /**
   * Set on the player's first PARTIAL send (a real one — fraction < 1 with a
   * target). The coach's ratio step reads this; nothing else does.
   *
   * Deliberately NOT mixed into hashState, unlike firstSendDone: it derives
   * from the command log the same way, but hashing it would churn every
   * recorded determinism hash for a flag whose only consumer is onboarding.
   * If a second consumer ever appears, revisit that trade.
   */
  halfSendDone: boolean;
  /**
   * Objective progress: cumulative ticks the hill has been player-held
   * (`hold` — fills while owned, drains while lost, floors at 0).
   * Advanced by advanceObjective in tick.ts; 0 forever on other objectives.
   */
  holdTicks: number;
  /**
   * Objective progress: effective player sends issued (a send that started or
   * redirected a flow; cancels and dead sends are free). Counted on every
   * level so the counter has no objective-shaped behavior of its own; only
   * `gauntlet` reads it.
   */
  sendsUsed: number;
  /**
   * Live ability charges (counts down from cfg.abilities as commands land).
   * Optional so hand-built test states predating abilities stay valid; every
   * generator-built state carries it. Hashed only when cfg.abilities is
   * present — see the conditional block in hashState.
   */
  abilityCharges?: AbilityCharges;
  /**
   * Active timed effects (see ActiveEffects). Optional for the same reason as
   * abilityCharges; generator-built states always carry an empty one. Hashed
   * only when non-empty.
   */
  effects?: ActiveEffects;
}

export const WORLD_W = 160;
export const WORLD_H = 90;

const STATUS_ID: Record<GameStatus, number> = { playing: 0, won: 1, lost: 2 };

/** Cheap stable hash of the whole state, for determinism tests. */
export function hashState(state: GameState): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 16777619);
  };
  mix(state.tick);
  mix(state.rng.s);
  mix(STATUS_ID[state.status]);
  mix(state.cfg.level);
  mix(state.cfg.factionCount);
  mix(state.cfg.playerProdInterval[0]);
  mix(state.cfg.playerProdInterval[1]);
  mix(state.cfg.playerProdInterval[2]);
  mix(state.cfg.playerUpgradeCost[0]);
  mix(state.cfg.playerUpgradeCost[1]);
  mix(state.cfg.playerUpgradeTicks);
  for (const t of state.nextAiTick) mix(t);
  mix(state.firstSendDone ? 1 : 0);
  // Objective progress is hashed ONLY when an objective is present: the two
  // counters exist on every state, but mixing two extra words unconditionally
  // would churn every hash recorded before objectives existed (the marketing
  // demo's pinned hashAtWindowStart values among them) for levels whose
  // behaviour is byte-identical. Annihilation levels hash exactly as before.
  if (state.cfg.objective) {
    mix(state.holdTicks);
    mix(state.sendsUsed);
  }
  // Ability state follows the same conditional-hash contract as the objective
  // counters: a level with no abilities granted (cfg.abilities absent) and no
  // live effect hashes exactly as it did before abilities existed. Charges are
  // keyed on the CONFIG being present, effects on the arrays being non-empty —
  // so an ability level whose charges sit unspent still discriminates, and an
  // ability-free level never pays for fields it cannot use.
  if (state.cfg.abilities) {
    mix(state.abilityCharges?.overcharge ?? 0);
    mix(state.abilityCharges?.stasis ?? 0);
    mix(state.abilityCharges?.recall ?? 0);
  }
  const effects = state.effects;
  if (effects && (effects.overcharge.length > 0 || effects.stasis.length > 0)) {
    mix(effects.overcharge.length);
    for (const e of effects.overcharge) {
      mix(e.node);
      mix(e.until);
    }
    mix(effects.stasis.length);
    for (const e of effects.stasis) {
      mix(e.node);
      mix(e.until);
    }
  }
  for (const n of state.nodes) {
    mix(n.id);
    mix(Math.round(n.x * 1000));
    mix(Math.round(n.y * 1000));
    mix(n.units);
    mix(n.size);
    mix(n.kind);
    mix(n.guard);
    mix(n.upgrading);
    mix(n.owner);
    mix(n.selected ? 1 : 0);
  }
  for (const f of state.flows) {
    mix(f.from);
    mix(f.to);
    mix(f.remaining);
  }
  for (const p of state.packets) {
    mix(p.owner);
    mix(p.from);
    mix(p.to);
    mix(p.departTick);
    mix(p.arriveTick);
    // Floating origin, hashed only when present (recalled packets) — the
    // conditional-hash trick again, so pre-recall packet hashes are stable.
    if (p.fx !== undefined) {
      mix(Math.round(p.fx * 1000));
      mix(Math.round((p.fy ?? 0) * 1000));
    }
  }
  return h >>> 0;
}
