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

/** Length lost per second of boost. Gentle — 1/sec means a snake at
 *  length 100 can sustain a minute-and-a-half of sprint before
 *  bottoming out. Each drained segment drops as a food pellet at
 *  the tail, leaving a visible trail other snakes can pick up. */
export const BOOST_LENGTH_DRAIN_PER_SEC = 1;

/** Base head turn rate at INITIAL_LENGTH, radians per second. The
 *  actual per-snake turn rate is read through turnRateFor(length),
 *  which slows turning down as snakes grow — small noodles are
 *  agile (their USP), big noodles are committed. */
export const TURN_RATE = 5;

/** Per-snake turn-rate envelope. At INITIAL_LENGTH this is exactly
 *  TURN_RATE. As length grows the rate drops on a gentle curve and
 *  floors at MIN to keep giants steerable. Used by both server
 *  motion integration and client-side prediction so the snake feels
 *  the same in both. */
export const TURN_RATE_EXPONENT = 0.12;
export const MIN_TURN_RATE = 1.5;
export function turnRateFor(length: number): number {
  const l = Math.max(INITIAL_LENGTH, length);
  const factor = Math.pow(INITIAL_LENGTH / l, TURN_RATE_EXPONENT);
  return Math.max(MIN_TURN_RATE, TURN_RATE * factor);
}

/** Distance between consecutive body segments along the head's path. */
export const SEGMENT_GAP = 12;

/** Base visual radii at INITIAL_LENGTH. Head a touch bigger than
 *  segments so the snake reads as having a head, not just being a
 *  uniform tube. Per-snake radii are read through radiusMultiplierFor
 *  so they scale up with length — a long snake is also a thick one. */
export const HEAD_RADIUS = 14;
export const SEGMENT_RADIUS = 12;

/** Body width grows with length on a gentle curve. Exponent set so
 *  the snake gets visibly chunkier at 1k+ length without becoming
 *  unrecognisable at 10k+. At length 8 this is 1.0; at 1000 ≈ 2.89;
 *  at 5000 ≈ 4.12; at 10000 ≈ 4.80. Combined with the slower
 *  viewport-zoom exponent below, on-screen thickness grows ~15-35%
 *  from initial to giant snakes. */
export const RADIUS_LENGTH_EXPONENT = 0.22;
export function radiusMultiplierFor(length: number): number {
  return Math.pow(Math.max(1, length / INITIAL_LENGTH), RADIUS_LENGTH_EXPONENT);
}

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

/** Bigger snakes see further. Dialled back from 0.25 so the camera
 *  doesn't outpace the body's actual growth — combined with the
 *  RADIUS_LENGTH_EXPONENT above, a length-5000 snake now looks chunky
 *  on screen instead of "long thin worm in a vast empty room". */
export const VIEW_LENGTH_EXPONENT = 0.18;

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
  /** Head position in world coords. Drives the minimap so players can
   *  see roughly where each top-10 snake is even when they're outside
   *  the viewport. */
  x: number;
  y: number;
  /** Snake colour, so minimap dots can be coloured per snake. */
  color: string;
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
      /** Optional client timestamp (Date.now()) for RTT measurement.
       *  Server echoes the latest seen value back in the state's `tEcho`
       *  so the client can compute round-trip time. Never persisted,
       *  never affects gameplay — pure telemetry. */
      t?: number;
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
      /** Echo of the latest `t` field the server received on this
       *  player's input messages. Lets the client compute RTT without
       *  separate ping-pongs. Absent if the client hasn't sent any
       *  timestamps yet (older client builds). */
      tEcho?: number;
    }
  | {
      type: "dead";
      finalLength: number;
      killer: string | null;
    }
  | {
      /** Sent when a join request hits the player cap. Client should
       *  show a waiting state with the position; the server promotes
       *  the front of the queue as slots open and eventually sends a
       *  normal welcome. `position` is 1-indexed (1 = next in line). */
      type: "queued";
      position: number;
      total: number;
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
