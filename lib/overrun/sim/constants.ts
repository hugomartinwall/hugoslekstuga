/**
 * Every balance-relevant number in one place. Tests import from here, so a
 * tuning change that breaks the difficulty curve fails balance.test.ts loudly.
 * Indexed arrays are by NodeSize (0 small, 1 medium, 2 large).
 */

export const PACKET_SPEED = 0.8; // world units per tick (24 wu/s at 30 Hz)
export const EMIT_EVERY = 2; // ticks between packet emissions per flow (15/s)

// Size-tier spread deliberately flattened (~1.9× small→large total advantage)
// so a lucky large node doesn't decide games.
export const PROD_INTERVAL = [45, 30, 24] as const; // ticks per +1 unit
export const UNIT_CAP = [35, 50, 65] as const; // production stops here (deposits may exceed)
export const NODE_R = [4.5, 6, 7.5] as const; // world-unit radius

/** Factory production intervals (≈ ×1.6 rate), pre-rounded integers. */
export const FACTORY_PROD_INTERVAL = [28, 19, 15] as const;
/** Hard floor for any production interval after meta boosts. */
export const PROD_INTERVAL_FLOOR = 12;

export const TURRET_EVERY = 20; // ticks between turret shots (0.67 s)
export const TURRET_RANGE = 22; // world units

/** In-run node size upgrades: cost by current size, build time in ticks. */
export const UPGRADE_COST = [15, 25] as const;
export const UPGRADE_TICKS = 90; // 3 s at 30 Hz

/** Chance per neutral orbit of rolling a special kind (from L9 mapgen). */
export const SPECIAL_NEUTRAL_CHANCE = 0.18;

export const MIN_SPACING = 16; // mapgen: min distance between node centers
export const MIN_SPACING_3WAY = 14; // tighter disc boards
export const MAP_MARGIN = 14; // mapgen: node-free border

/** Emission pauses above this — keeps worst-case brawls bounded on weak hardware. */
export const MAX_PACKETS = 4000;
