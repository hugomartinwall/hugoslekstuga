/**
 * Every balance-relevant number in one place. Tests import from here, so a
 * tuning change that breaks the difficulty curve fails balance.test.ts loudly.
 * Indexed arrays are by NodeSize (0 small, 1 medium, 2 large).
 *
 * Imports types + kind tags from state.ts, which imports nothing — so this
 * stays the leaf of the sim's dependency graph.
 */

import type { NodeKind, NodeSize } from "./state";
import { KIND_VAULT } from "./state";

/**
 * World units per tick. Scaled with MIN_SPACING (see below) so that growing the
 * board's nodes does not silently make every send 44% longer — the geometry
 * changed, the *feel* of a send should not.
 */
export const PACKET_SPEED = 1.0; // 30 wu/s at 30 Hz
export const EMIT_EVERY = 2; // ticks between packet emissions per flow (15/s)

// Size-tier spread deliberately flattened (~1.9× small→large total advantage)
// so a lucky large node doesn't decide games.
export const PROD_INTERVAL = [45, 30, 24] as const; // ticks per +1 unit
export const UNIT_CAP = [35, 50, 65] as const; // production stops here (deposits may exceed)
/**
 * World-unit radius per size tier.
 *
 * Grown ~1.44x from [4.5, 6, 7.5], keeping the tier ratios, because the old
 * radii could not clear the 44 CSS px tap target on a phone. That is not a
 * framing problem the camera can solve: its scale is set by the board's world
 * extent, so node diameter in CSS px is a function of NODE_R relative to
 * WORLD_W and is very nearly independent of how many nodes are on the board.
 * Measured worst case over L1-25, an iPhone X in landscape needed NODE_R[0]
 * around 6.5 to reach 44 px. Fewer, bigger nodes is the trade, and it is the
 * intended one: difficulty now comes from node kinds and AI capability rather
 * than from crowding more dots onto a phone screen.
 *
 * The flatter spread is what buys the node budget back: two large nodes are
 * 19 wu of diameter, so MIN_SPACING can sit at 20 rather than the 23 the
 * original 1.67x spread would have forced, and 20 wu is already ~68 CSS px of
 * separation on the tightest supported phone. Overshooting spacing costs nodes
 * quadratically for legibility nobody can see.
 */
export const NODE_R = [6.7, 8.0, 9.0] as const;

/** Factory production intervals (≈ ×1.6 rate), pre-rounded integers. */
export const FACTORY_PROD_INTERVAL = [28, 19, 15] as const;
/** Hard floor for any production interval after meta boosts. */
export const PROD_INTERVAL_FLOOR = 12;

export const TURRET_EVERY = 20; // ticks between turret shots (0.67 s)
export const TURRET_RANGE = 28; // world units — scaled with MIN_SPACING

/* ------------------------------------------------- boss kinds (L14 onward) */

/**
 * The ranges below are written as literals, like TURRET_RANGE, but they mean
 * multiples of MIN_SPACING (= 20): 26 is "a bit more than one hop", 24 is
 * "about one hop". If MIN_SPACING moves again, these move with it — that is
 * the same trap the NODE_R note above describes, one level down.
 */

/** Relay: packets launched from it travel this much faster than PACKET_SPEED. */
export const RELAY_PACKET_SPEED = 1.8;

/**
 * Volatile: detonates on EVERY capture (kinds survive capture), damaging every
 * other node in radius regardless of owner. Re-arming is the point — a
 * contested volatile centre punishes whoever keeps trading it.
 */
export const VOLATILE_RADIUS = 26; // 1.3 × MIN_SPACING
export const VOLATILE_DAMAGE = 5;

/** Beacon: friendly nodes in range (itself included) produce this much faster. */
export const BEACON_RANGE = 26; // 1.3 × MIN_SPACING
export const BEACON_FACTOR = 0.75;

/** Siphon: while owned, steals one unit from the nearest hostile node in range. */
export const SIPHON_EVERY = 45; // ticks (1.5 s)
export const SIPHON_RANGE = 24; // 1.2 × MIN_SPACING

/** Vault: roughly double the cap, ~1.5× slower to fill it. */
export const VAULT_CAP = [70, 100, 130] as const;
export const VAULT_PROD_INTERVAL = [68, 45, 36] as const;

/** Nursery: grows while still NEUTRAL, so ignoring it is punished. */
export const NURSERY_NEUTRAL_INTERVAL = 90; // ticks per +1 unit (3 s)

/**
 * Corrupter: while owned, takes the nearest passing hostile unit rather than
 * shooting it down. Deliberately the Turret's mirror, and deliberately slower
 * than it (30 ticks against 20) — a turret removes one unit from the board, a
 * corrupter moves one from their column to yours, which is twice the swing.
 */
export const CORRUPT_EVERY = 30; // ticks (1 s)
export const CORRUPT_RANGE = 24; // 1.2 × MIN_SPACING, same reach as the siphon

/**
 * Rift: a send from one rift to another rift of the SAME owner arrives in this
 * many ticks regardless of distance. A floor, never a penalty — a short hop
 * between adjacent rifts keeps its own shorter travel time.
 *
 * 9 ticks is 0.3 s, about what a 9 wu hop costs at PACKET_SPEED, so the pair
 * behaves like two nodes standing next to each other however far apart they
 * are. Not instant: an instant send would be untouchable by turrets and
 * corrupters, and a stream you cannot intercept is a stream with no counter.
 */
export const RIFT_TRAVEL_TICKS = 9;

/** In-run node size upgrades: cost by current size, build time in ticks. */
export const UPGRADE_COST = [15, 25] as const;
export const UPGRADE_TICKS = 90; // 3 s at 30 Hz

/* ------------------------------------------------------ player abilities */

/**
 * OVERCHARGE: one own ball's production interval is divided by
 * OVERCHARGE_DIV for OVERCHARGE_TICKS. The division applies AFTER the normal
 * PROD_INTERVAL_FLOOR (its own floor is 1 tick) — quartering into the floor
 * would leave 45→12 for smalls but a no-op 24→12 for larges, and an ability
 * that silently does less on the player's best ball punishes upgrading.
 */
export const OVERCHARGE_TICKS = 300; // 10 s at 30 Hz
export const OVERCHARGE_DIV = 4;

/** STASIS: the target emits nothing and produces nothing for this long. */
export const STASIS_TICKS = 150; // 5 s at 30 Hz

/**
 * Chance per neutral orbit of rolling a special kind, from L9 mapgen.
 *
 * Flat 0.18 through L13 — that band must stay byte-identical, and it is only
 * choosing between the three original kinds. From the first boss level the rate
 * ramps, because that is the whole thesis of Phase 3A: a level 44 board carries
 * more *kinds* where it can no longer carry more *nodes*.
 *
 * The ramp reaches its cap at L56, the last boss level, rather than at L38 —
 * debuts kept arriving after the rate had stopped climbing, so the last three
 * kinds were joining a pool that never grew to hold them. The cap itself stays
 * at 0.30: past roughly a third of neutrals the board reads as noise rather
 * than as a board with features on it.
 */
export const SPECIAL_NEUTRAL_CHANCE = 0.18;
export const SPECIAL_NEUTRAL_CHANCE_MAX = 0.3;
export function specialChance(level: number): number {
  if (level < 14) return SPECIAL_NEUTRAL_CHANCE;
  return Math.min(SPECIAL_NEUTRAL_CHANCE_MAX, SPECIAL_NEUTRAL_CHANCE + 0.00286 * (level - 14));
}

/**
 * Mapgen: minimum distance between node centres. Raised from 16 alongside
 * NODE_R — two large nodes are 21 wu of diameter between them, so anything
 * tighter would just feed the crowding pass and shrink them straight back. The
 * practical node budget falls out of this and the map margin; it is not picked.
 */
export const MIN_SPACING = 20;
/**
 * 3-way disc boards. Must not sit below the radius sum of two large nodes, or
 * every large node on a triad gets demoted by the crowding pass — at 14 that
 * left triads with 1.1% large nodes against 15% on duels, a difficulty
 * discontinuity across a third of all levels.
 */
export const MIN_SPACING_3WAY = 20;
export const MAP_MARGIN = 10; // mapgen: node-free border

/**
 * Narrower border for 3-way boards, which pack their nodes into a centred disc
 * rather than the full rect — so the rect margin would waste most of the space.
 *
 * Sized empirically. Rotational packing is far tighter than free packing: a
 * 15-node triad is only 5 free seeds, and every seed's three images must clear
 * MIN_SPACING_3WAY from each other and from every other orbit. At the old 14
 * (disc radius 31) that was outright infeasible and generation fell back to
 * overlapping nodes. Measured large-node share across L1–200 by radius:
 * r31 → 1.1%, r34 → 4.2%, r36 → 7.9%, **r37 → 10.3%**, r38 → 10.3%.
 * 8 takes the knee. Nodes then reach within ~3 wu of the board edge, which is
 * fine because the camera frames content rather than the rect.
 */
export const MAP_MARGIN_3WAY = 10;

/** Emission pauses above this — keeps worst-case brawls bounded on weak hardware. */
export const MAX_PACKETS = 4000;

/**
 * Production ceiling for a node. Pure — no GameState — because the renderer's
 * fill ring needs it too and has no state to hand it (fx.ts). Deposits may
 * still exceed the cap; it only stops growth.
 */
export function unitCap(size: NodeSize, kind: NodeKind): number {
  return kind === KIND_VAULT ? VAULT_CAP[size] : UNIT_CAP[size];
}
