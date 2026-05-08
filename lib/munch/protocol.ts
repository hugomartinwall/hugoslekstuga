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
export const MAX_PLAYERS = 50;

// Speed falls off with mass: at START_MASS you go BASE_SPEED, at 4×
// you're half as fast, etc.
export const BASE_SPEED = 360;

// To eat another blob you must be at least EAT_RATIO × their mass.
export const EAT_RATIO = 1.25;

// Split mechanic — halves your mass and ejects a projectile.
export const SPLIT_MIN_MASS = 40;
export const SPLIT_PROJECTILE_SPEED = 900;
export const SPLIT_PROJECTILE_DECEL = 1.4; // multiplicative per second
export const SPLIT_PROJECTILE_LIFETIME_MS = 6000;

// Server tick rate; client interpolates between snapshots.
export const TICK_HZ = 30;
export const SNAPSHOT_HZ = 20;

// AFK kick: no input received for this long → drop the player.
export const AFK_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Shared entity shapes                                                */
/* ------------------------------------------------------------------ */

export type PlayerView = {
  id: string;
  name: string;
  x: number;
  y: number;
  mass: number;
  color: string;
};

export type FoodView = {
  id: number;
  x: number;
  y: number;
  color: string;
};

export type ProjectileView = {
  id: number;
  ownerId: string; // not eaten by your own player
  x: number;
  y: number;
  mass: number;
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
  | { type: "join"; name: string }
  | { type: "input"; dir: { x: number; y: number }; split: boolean }
  | { type: "pong" };

/* ------------------------------------------------------------------ */
/* Server → client                                                     */
/* ------------------------------------------------------------------ */

export type ServerMsg =
  | { type: "welcome"; playerId: string; worldSize: number; color: string; name: string }
  | {
      type: "state";
      tick: number;
      you: { x: number; y: number; mass: number; alive: boolean };
      players: PlayerView[];
      food: FoodView[];
      projectiles: ProjectileView[];
      leaderboard: LeaderboardEntry[];
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

/** Movement speed for a given mass. Bigger = slower. */
export function speedForMass(mass: number): number {
  return BASE_SPEED / Math.sqrt(Math.max(1, mass / START_MASS));
}

/** Viewport half-extents for a given mass — bigger = see further. */
export function viewportHalfFor(mass: number): { hx: number; hy: number } {
  // Base view 800x600, scales with sqrt(mass).
  const scale = Math.sqrt(mass / START_MASS);
  return { hx: 700 * scale, hy: 500 * scale };
}
