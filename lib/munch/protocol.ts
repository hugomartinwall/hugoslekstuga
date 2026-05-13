// Wire protocol between the munch client and the munch server. The
// same types are imported by both — keep this file pure types + tuning
// constants only. No browser or Node-specific imports.

/* ------------------------------------------------------------------ */
/* Tuning constants (referenced by both client and server)             */
/* ------------------------------------------------------------------ */

export const WORLD_SIZE = 6000; // square map, units = pixels
export const FOOD_TARGET = 1400; // server keeps this many food pellets alive
export const FOOD_MASS = 1;
export const START_MASS = 20;
export const MIN_MASS = 20;
/** Hard cap on total population (humans + bots). Guardrail, not a target —
 *  in practice population settles at max(BOT_FLOOR, humanCount). */
export const MAX_PLAYERS = 100;
/** Minimum population the room maintains. When humans < BOT_FLOOR, bots
 *  fill the gap; when humans >= BOT_FLOOR, bots are absent. */
export const BOT_FLOOR = 10;

// Speed falls off with mass: at START_MASS you go BASE_SPEED, then a
// gentle power curve (see speedForMass). The exponent tunes how punishing
// growth is — sqrt (0.5) felt like wading through molasses past mass
// 200, so we use a softer 0.3.
export const BASE_SPEED = 360;
export const SPEED_FALLOFF = 0.3;

// To eat another cell you must be at least EAT_RATIO × their mass.
export const EAT_RATIO = 1.25;

/* ----- Split mechanic (multi-cell with gravity rejoin) -----
 *
 * Pressing space halves your largest cell and ejects the new half forward
 * at SPLIT_EJECT_SPEED. For SPLIT_PULL_DELAY_MS after the split, the
 * centroid pull is OFF so the new cell actually travels — then it ramps
 * back in over SPLIT_PULL_RAMP_MS, gravity catches the cell, and it
 * drifts back home. After SPLIT_REJOIN_MS the two cells are allowed to
 * merge again on contact.
 */
export const SPLIT_MIN_MASS = 40;
export const SPLIT_EJECT_SPEED = 1400; // initial forward velocity (px/s)
// Per-tick momentum decay. Tuned so 1-second decay matches the previous
// 30 Hz value (0.95^30 ≈ 0.21 → 0.975^60 ≈ 0.22). If you change TICK_HZ,
// recompute this so the eject feel stays consistent.
export const SPLIT_VELOCITY_DAMP = 0.975;
export const SPLIT_PULL_DELAY_MS = 500; // free flight before gravity engages
export const SPLIT_PULL_RAMP_MS = 500; // ramp pull from 0 to 1 over this window
export const SPLIT_REJOIN_MS = 30_000; // 30s before two own cells may merge
export const CELL_PULL = 4.5; // gravity toward centroid (px/s per px of gap)
export const MAX_CELLS_PER_PLAYER = 8; // hard cap so people don't spam space

/* ----- Multi-cell trailing physics -----
 *
 * In a cluster, all cells move at the largest cell's reference speed
 * scaled by (cell.mass / maxMass)^TRAIL_EXPONENT. With TRAIL_EXPONENT in
 * (0, 1) the smaller cells genuinely lag behind the primary in the
 * input direction — that's the "moving through water" feel. The single-
 * cell case is unaffected (mass/max = 1, exponent doesn't matter).
 */
export const TRAIL_EXPONENT = 0.55;

// Server tick rate; client interpolates between snapshots. 60 Hz makes
// physics integration smoother (smaller dt = less compounding error) and
// makes the world feel less stale. Snapshot rate stays at 20 Hz — bumping
// it would double network traffic for marginal gain since the client
// already lerps between snapshots.
export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 20;

// AFK kick: no input received for this long → drop the player.
export const AFK_TIMEOUT_MS = 60_000;

// Spawn protection: just-spawned (or just-respawned) players can't be
// eaten and can't eat for this long. Lifts immediately if they split,
// so it can't be exploited offensively. The client renders a pulsing
// halo around protected cells.
export const SPAWN_PROTECT_MS = 1500;

/* ------------------------------------------------------------------ */
/* Shared entity shapes                                                */
/* ------------------------------------------------------------------ */

/** A single body on the map. A player can have 1..N cells while split. */
export type CellView = {
  id: number;
  x: number;
  y: number;
  mass: number;
  /** 0..1 fraction of merge cooldown remaining. 0 means this cell is
   * ready to re-merge with its siblings on contact; >0 means it's
   * still in the post-split window. Clients render this as an arc so
   * the player can see when they'll be whole again. */
  cd: number;
  /** True while this cell's player is in spawn protection — clients
   * render a pulsing halo and the server skips eat resolution either
   * direction. Lifts on first split. */
  prot: boolean;
};

export type PlayerView = {
  id: string;
  name: string;
  color: string;
  cells: CellView[];
};

export type FoodView = {
  id: number;
  x: number;
  y: number;
  color: string;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  mass: number;
};

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

export type ClientMsg =
  | {
      type: "join";
      name: string;
      /** Solo-testing hint: while at least one connected human has this
       *  flag set, the server pauses the bot floor (existing bots evict,
       *  no new ones spawn). Resumes when that human leaves. Used by the
       *  ?nobots URL flag on the client. */
      nobots?: boolean;
    }
  | {
      type: "input";
      dir: { x: number; y: number };
      split: boolean;
      /** Optional canvas aspect ratio (width/height). When present the
       *  server sizes the viewport so the visible slice matches this
       *  shape, preserving total visible area for fairness. Older
       *  clients that don't send it get the desktop-default 1.4:1. */
      aspect?: number;
      /** Optional client timestamp (Date.now()) for RTT measurement.
       *  Server echoes the latest seen value back in the state's `tEcho`.
       *  Telemetry only. */
      t?: number;
    }
  | { type: "pong" };

/* ------------------------------------------------------------------ */
/* Server → client                                                     */
/* ------------------------------------------------------------------ */

export type ServerMsg =
  | {
      type: "welcome";
      playerId: string;
      worldSize: number;
      color: string;
      name: string;
    }
  | {
      type: "state";
      tick: number;
      you: { cells: CellView[]; alive: boolean };
      players: PlayerView[];
      food: FoodView[];
      leaderboard: LeaderboardEntry[];
      /** Echo of latest `t` field from input messages — see noodle
       *  protocol for the RTT-measurement rationale. */
      tEcho?: number;
    }
  | {
      type: "dead";
      finalScore: number;
      killer: string | null;
    }
  | { type: "error"; reason: string }
  | { type: "ping" };

/* ------------------------------------------------------------------ */
/* Helpers used in both halves                                         */
/* ------------------------------------------------------------------ */

/** Visual radius for a given mass — cells grow with the square root so
 * doubling the mass adds about 1.4× the radius (the agar feel). */
export function radiusForMass(mass: number): number {
  return Math.sqrt(mass) * 4;
}

/** Movement speed for a given mass. Bigger = slower, but on a gentle
 *  curve — at mass 1280 you're still around 100 px/s, not 45. */
export function speedForMass(mass: number): number {
  return BASE_SPEED * Math.pow(Math.max(1, mass / START_MASS), -SPEED_FALLOFF);
}

/** Per-tick smoothing factor for input velocity. 0..1 — the cell's
 *  effective velocity each tick moves this fraction of the way toward
 *  the target velocity. At 60 Hz, 0.15 ≈ 280ms to reach 90% of target —
 *  clear ice-skater glide on direction changes without feeling
 *  unresponsive. Lower = more glide; higher = snappier. */
export const INPUT_SMOOTH = 0.15;

/** Viewport half-extents for a given total-mass — bigger = see further.
 *
 * Important: this scales with mass^0.35, NOT sqrt (mass^0.5). Why: a
 * blob's world radius scales with sqrt(mass), so if the viewport also
 * scaled with sqrt(mass), the blob's *screen* size would be exactly
 * constant — you'd grow numerically without any visual feedback. By
 * scaling the viewport slower than the blob, your cell visibly takes
 * up more of the screen as you grow, while the world also widens.
 *
 * `aspect` is the client's canvas width / height. When provided, the
 * box is reshaped to match (so a portrait phone gets a tall slice
 * instead of empty cream above/below) while keeping the total visible
 * area identical to the desktop default — phone players don't see
 * more or less of the world, just shaped differently. */
const VIEW_BASE_AREA = 1400 * 1000; // 2*hx × 2*hy at scale=1, default aspect
const VIEW_DEFAULT_ASPECT = 1400 / 1000;
export function viewportHalfFor(
  totalMass: number,
  aspect?: number,
): { hx: number; hy: number } {
  const scale = Math.pow(Math.max(1, totalMass / START_MASS), 0.35);
  const a = aspect && aspect > 0 ? aspect : VIEW_DEFAULT_ASPECT;
  // 4·hx·hy = baseArea · scale²,  hx/hy = a → solve.
  const hy = Math.sqrt(VIEW_BASE_AREA / (4 * a)) * scale;
  const hx = a * hy;
  return { hx, hy };
}

/** Sum a player's cells. */
export function totalMassOf(cells: CellView[]): number {
  let sum = 0;
  for (const c of cells) sum += c.mass;
  return sum;
}

/** Mass-weighted centroid of a set of cells. */
export function centroidOf(cells: CellView[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  let sum = 0;
  for (const c of cells) {
    cx += c.x * c.mass;
    cy += c.y * c.mass;
    sum += c.mass;
  }
  if (sum === 0) return { x: 0, y: 0 };
  return { x: cx / sum, y: cy / sum };
}
