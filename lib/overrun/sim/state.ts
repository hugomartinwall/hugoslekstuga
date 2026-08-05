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

export type Owner = "player" | "enemy" | "neutral";

export type NodeSize = 0 | 1 | 2; // small | medium | large

/**
 * A node on the map. Positions are static in world units on a fixed 160×90
 * board (packet positions are derived from them); the renderer scales.
 */
export interface Node {
  id: number;
  x: number;
  y: number;
  owner: Owner;
  units: number; // integer, always >= 0
  size: NodeSize;
  selected: boolean;
}

/**
 * A unit in transit. IMMUTABLE after spawn — position is derived at render
 * time from the endpoint nodes and (tick + alpha), so the sim never iterates
 * packets for movement, only for arrival.
 */
export interface Packet {
  owner: Owner; // stamped at spawn; compared against target owner AT ARRIVAL
  from: number; // node id
  to: number; // node id
  departTick: number;
  arriveTick: number;
}

/** An active drain from a node. At most one per source node. */
export interface Flow {
  from: number;
  to: number;
  remaining: number; // integer units still to emit
}

export type GameStatus = "playing" | "won" | "lost";

/** Per-level difficulty knobs, derived from the level number by level.ts. */
export interface LevelCfg {
  level: number;
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
  /** Target-scoring bonus for neutrals; shrinks with level so the AI hunts the player. */
  aiNeutralBonus: number;
}

export interface GameState {
  tick: number;
  rng: Rng;
  status: GameStatus;
  cfg: LevelCfg;
  nodes: Node[];
  flows: Flow[];
  packets: Packet[];
  nextAiTick: number;
  /** Set on the player's first send; the onboarding hint renders until then. */
  firstSendDone: boolean;
}

export const WORLD_W = 160;
export const WORLD_H = 90;

const OWNER_ID: Record<Owner, number> = { player: 1, enemy: 2, neutral: 3 };
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
  mix(state.nextAiTick);
  mix(state.firstSendDone ? 1 : 0);
  for (const n of state.nodes) {
    mix(n.id);
    mix(Math.round(n.x * 1000));
    mix(Math.round(n.y * 1000));
    mix(n.units);
    mix(n.size);
    mix(OWNER_ID[n.owner]);
    mix(n.selected ? 1 : 0);
  }
  for (const f of state.flows) {
    mix(f.from);
    mix(f.to);
    mix(f.remaining);
  }
  for (const p of state.packets) {
    mix(OWNER_ID[p.owner]);
    mix(p.from);
    mix(p.to);
    mix(p.departTick);
    mix(p.arriveTick);
  }
  return h >>> 0;
}
