// Wire protocol between the noodle client and the noodle server.
// Same convention as lib/munch/protocol.ts — pure types + tuning
// constants, no browser or Node-specific imports.

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

export const WORLD_SIZE = 5000; // square map, units = pixels.
                                // started at 4000 (vs munch's 6000) but
                                // tight once snakes grew — 5000 gives
                                // long snakes somewhere to go without
                                // making the map feel deserted.

/** Population caps. Same shape as munch. */
export const MAX_PLAYERS = 80;
export const BOT_FLOOR = 8;

/** Server tick + snapshot rates. Snapshot rate matches the tick rate
 *  so each tick emits a state — minimises perceived lag for snake
 *  motion (compared to munch's 20Hz, which felt fine for blobs but
 *  stuttery for fluid worm bodies). */
export const TICK_HZ = 30;
export const SNAPSHOT_HZ = 30;

/** AFK kick: no input received for this long → drop the player. */
export const AFK_TIMEOUT_MS = 60_000;

/* ----- Snake physics ----- */

/** Forward speed of a non-boosting head, in world units per second.
 *  Slower than it sounds — the closer camera (post phase 7) means
 *  these world-units cover more screen-space per second. 170 reads
 *  as "drifting with intent," which is the right baseline for
 *  reading the room and the snakes in it. */
export const HEAD_SPEED = 170;

/** Forward speed when boosting. ~1.65× the cruise — wide enough
 *  differential that boost actually catches prey, narrow enough
 *  that the base game doesn't feel sluggish next to it. */
export const BOOST_SPEED = 280;

/** Length lost per second of boost. Costs ~16 segments over a 16-second
 *  sprint at 1/sec drain. Strategic: catch slower prey, escape danger,
 *  but pay in size. */
export const BOOST_LENGTH_DRAIN_PER_SEC = 1;

/** Maximum head turn rate, radians per second. Slower = more committed
 *  turns, harder to dodge. */
export const TURN_RATE = 5;

/** Distance between consecutive body segments along the head's path. */
export const SEGMENT_GAP = 12;

/** Visual radii. Head a touch bigger than segments so the snake reads
 *  as having a head, not just being a uniform tube. */
export const HEAD_RADIUS = 14;
export const SEGMENT_RADIUS = 12;

/** Length on spawn. Long enough to read as a snake, short enough to
 *  feel humble. */
export const INITIAL_LENGTH = 8;

/** When you eat a food pellet you grow by this many segments. Bigger
 *  food (dropped from a death) gives more. */
export const GROW_PER_FOOD = 1;
export const GROW_PER_DEATH_FOOD = 3;

/* ----- World contents ----- */

/** Server keeps roughly this many food pellets alive. Spawned across
 *  the map at random; eaten ones get respawned. Scales with world area
 *  — 600 was tuned for 4000² (≈ 37.5 per Mu²); 940 keeps the density
 *  the same at 5000². */
export const FOOD_TARGET = 940;

/** Pellet visual radius. */
export const FOOD_RADIUS = 6;
/** Bigger pellet — dropped from a snake's death. */
export const DEATH_FOOD_RADIUS = 10;

/* ----- Spawn protection ----- */

/** Just-spawned snakes can't be killed for this long. Lifts on first
 *  boost. Same idea as munch's spawn protection. */
export const SPAWN_PROTECT_MS = 2200;

/* ----- Camera / viewport ----- */

/** Default desktop viewport half-extents at base length. The server
 *  sizes per-player snapshots so each client gets roughly this much
 *  of the world; reshaped by aspect ratio for portrait phones.
 *  Pulled in (was 1200×800) so the camera sits closer to the snake
 *  — closer to slither's default zoom, makes the world feel
 *  inhabited rather than surveyed. */
const VIEW_BASE_AREA = 800 * 540;
const VIEW_DEFAULT_ASPECT = 800 / 540;

/** Bigger snakes see further. Same exponent as munch's viewport. */
export const VIEW_LENGTH_EXPONENT = 0.25;

/**
 * Visible half-extents for a given length. Bigger snakes see further
 * (mass^0.25 in this game's case — gentler curve than munch's 0.35
 * since length scales linearly while mass scaled as a cell volume).
 *
 * `aspect` is the client's canvas width / height, sanity-clamped on
 * the server to [0.2, 5].
 */
export function viewportHalfFor(
  length: number,
  aspect?: number,
): { hx: number; hy: number } {
  const scale = Math.pow(Math.max(1, length / INITIAL_LENGTH), VIEW_LENGTH_EXPONENT);
  const a = aspect && aspect > 0 ? aspect : VIEW_DEFAULT_ASPECT;
  const hy = Math.sqrt(VIEW_BASE_AREA / (4 * a)) * scale;
  const hx = a * hy;
  return { hx, hy };
}

/* ------------------------------------------------------------------ */
/* Wire shapes                                                         */
/* ------------------------------------------------------------------ */

/** A snake on the wire — head first, tail last. The server only sends
 *  segments visible in the player's viewport (plus the head, always)
 *  to keep snapshots small even when the world has many long snakes. */
export type SnakeView = {
  id: string;
  name: string;
  color: string;
  /** Head + visible body segments, head first. Always at least 1. */
  segments: { x: number; y: number }[];
  /** True total length on the server (>= segments.length when culled).
   *  Lets the client draw an approximate continuation when the body
   *  trails out of view. */
  totalLength: number;
  /** Currently boosting? Clients can render a faint trail. */
  boosting: boolean;
  /** Spawn-protected? Clients render a halo. */
  prot: boolean;
};

export type FoodView = {
  id: number;
  x: number;
  y: number;
  color: string;
  /** Visual radius hint — small for normal food, bigger for
   *  death-drop food. */
  r: number;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  length: number;
};

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

export type ClientMsg =
  | {
      type: "join";
      name: string;
      /** Solo-testing flag: pauses the bot floor while connected. */
      nobots?: boolean;
    }
  | {
      type: "input";
      /** Aim direction (unit vector OK, server normalises). The head
       *  steers toward this with TURN_RATE per second. */
      aim: { x: number; y: number };
      /** Boost held this tick. */
      boost: boolean;
      /** Optional canvas aspect ratio (width / height). Same shape as
       *  munch — server reshapes the snapshot viewport to fit. */
      aspect?: number;
    }
  | { type: "respawn" }
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
      you: {
        head: { x: number; y: number } | null;
        /** Full self body (head first). The server doesn't viewport-cull
         *  the player's own body — you always see your whole snake. */
        segments: { x: number; y: number }[];
        length: number;
        alive: boolean;
        boosting: boolean;
        protUntil: number;
      };
      snakes: SnakeView[];
      food: FoodView[];
      leaderboard: LeaderboardEntry[];
    }
  | {
      type: "dead";
      finalLength: number;
      killer: string | null;
    }
  | { type: "error"; reason: string }
  | { type: "ping" };

/* ------------------------------------------------------------------ */
/* Helpers used in both halves                                         */
/* ------------------------------------------------------------------ */

/** Centroid of a snake's visible head + body. Used for camera and
 *  viewport-cull calculations on both sides. The head position is
 *  already a good proxy; centroid is slightly steadier visually
 *  during sharp turns. */
export function centroidOf(
  segments: readonly { x: number; y: number }[],
): { x: number; y: number } {
  if (segments.length === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (const s of segments) {
    cx += s.x;
    cy += s.y;
  }
  return { x: cx / segments.length, y: cy / segments.length };
}
