/**
 * Hugo's parkour — the simulation.
 *
 * Pure step functions over plain objects, no canvas and no DOM: the
 * component (components/hugo/HugoParkour.tsx) reads the live swarm and
 * wordmark into `Surface`s each step and calls `stepPlayer`. Every
 * per-step constant here is tuned at 60 steps/sec — the component's
 * fixed-timestep loop owns keeping that clock honest.
 */

export const GRAVITY = 0.55;
/** Ground acceleration — top speed in ~10 steps (~0.17s). Tuned down
 *  from 0.5: reaching MAX_RUN in 7 steps read as binary on/off. */
export const RUN_ACCEL = 0.34;
/** Turnaround acceleration when input opposes travel — stronger than
 *  RUN_ACCEL so direction changes stay crisp despite the softer ramp. */
export const SKID_ACCEL = 0.6;
export const AIR_ACCEL = 0.3;
/** Gentle horizontal decay while airborne with no input, so flying
 *  off a fast-drifting orb doesn't feel launched on rails. */
export const AIR_DRAG = 0.985;
export const MAX_RUN = 3.4;
export const FRICTION = 0.82;
export const JUMP_V = -12;
/** The second (air) jump is a touch softer than the first. */
export const AIR_JUMP_SCALE = 0.92;
export const COYOTE_STEPS = 7;
export const JUMP_BUFFER_STEPS = 7;
/** Simulation cadence. Every per-step constant in this file was tuned
 *  at 60 steps/sec back when the loop ran once per rAF — on a 120Hz
 *  panel that meant the whole game played at double speed. The loop
 *  simulates on this fixed clock and only *draws* at rAF rate. */
export const STEP_MS = 1000 / 60;
/** Cap on catch-up steps after a stall (tab switch, long frame) so
 *  Hugo resumes where he paused instead of teleporting. */
export const MAX_SIM_STEPS = 3;
export const PLAYER_HALF = 14; // half-width of the ~28px sprite body

/* ── the moped (level 2) ────────────────────────────────────────────
 * Momentum is the whole game: throttle builds speed slowly, braking
 * is deliberate, airborne speed is committed. One fixed-height jump,
 * no air jump — ramps are the only speed→height converter, so speed
 * management stays the single legible skill. */

/** Throttle: 0→top in ~94 steps (~1.6s, ~350px of runway). */
export const MOPED_ACCEL = 0.08;
/** Top speed — more than double on-foot MAX_RUN; reads as a vehicle. */
export const MOPED_MAX = 7.5;
/** Brake: full speed→0 in ~34 steps (~128px). Plan early. */
export const MOPED_BRAKE = 0.22;
/** Coasting decay per step (throttle released, grounded)... */
export const MOPED_COAST = 0.995;
/** ...plus a linear bleed so he actually comes to a stop. */
export const MOPED_ROLL = 0.006;
/** Riding left is allowed but reads as a heavy U-turn. */
export const MOPED_REVERSE_MAX = 2.0;
/** Faint airborne trim — can only oppose current speed, never add. */
export const MOPED_AIR_ACCEL = 0.05;
/** One jump, fixed height (~100px apex) — speed changes distance,
 *  never height. jumpCut still applies. */
export const MOPED_JUMP_V = -10.5;
/** Short coyote: at 7.5px/step a lip passes in <2 steps; 5 steps of
 *  grace keeps max-distance jumps fair without cheesing gaps. */
export const MOPED_COYOTE = 5;
/** Below this speed a ramp lip is just a ledge — no launch. */
export const RAMP_MIN_LAUNCH = 2.5;
/** Clamp on ramp launch velocity. */
export const RAMP_MAX_VY = 13;
/** Camera anchor while riding — further left than on foot so full
 *  throttle keeps a forward view. */
export const MOPED_CAM_ANCHOR = 0.3;

/** Anything Hugo can stand on. Orbs are the live swarm (curved tops,
 *  they drift and carry him); rects are flat static tops (wordmark
 *  letters, authored level solids); ramps are sloped tops ascending
 *  rightward that throw a rider crossing the high lip at speed. `y`
 *  is the centre for orbs, the top edge for rects, and the LOW-end
 *  top for ramps (the lip sits at `y - rise`). */
export type Surface =
  | { kind: "orb"; id: string; x: number; y: number; r: number }
  | { kind: "rect"; id: string; x: number; y: number; w: number }
  | {
      kind: "ramp";
      id: string;
      x: number;
      y: number;
      w: number;
      rise: number;
      /** Launch factor at the lip: vy = -k * vx (clamped). */
      k: number;
    };

export type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  airJump: boolean;
  squash: number;
  stand: { id: string; lastX: number; lastY: number } | null;
};

export type InputState = {
  left: boolean;
  right: boolean;
  upHeld: boolean;
  jumpCut: boolean;
};

export type WorldBounds = {
  floorY: number;
  minX: number;
  maxX: number;
};

/** Where Hugo sits on screen while the camera follows — left of
 *  centre, so a right-scroller gets forward view for free. */
export const CAM_ANCHOR = 0.42;
/** Exponential follow factor per step. */
export const CAM_LERP = 0.1;

/** Per-step camera follow. `snap` (reduced motion / teleports) jumps
 *  straight to the target instead of easing. Clamped to the world, so
 *  while worldW === viewW the camera provably never moves. */
export function updateCamera(
  camera: { x: number },
  playerX: number,
  viewW: number,
  worldW: number,
  snap: boolean,
): void {
  const target = Math.max(
    0,
    Math.min(worldW - viewW, playerX - viewW * CAM_ANCHOR),
  );
  if (snap) camera.x = target;
  else camera.x += (target - camera.x) * CAM_LERP;
}

export function createPlayer(x: number, y: number): PlayerState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    coyote: 0,
    jumpBuffer: 0,
    airJump: true,
    squash: 0,
    stand: null,
  };
}

/** The player-centre y when standing on `s` at player-x `px`, or null
 *  if `px` is off the surface. Orbs expose their top arc and drop you
 *  past 95% of the radius; rects are flat with a 4px lip. The -16 is
 *  the sprite's half-height. */
export function standY(s: Surface, px: number): number | null {
  if (s.kind === "orb") {
    const dx = px - s.x;
    if (Math.abs(dx) > s.r * 0.95) return null;
    return s.y - Math.sqrt(Math.max(0, s.r * s.r - dx * dx)) - 16;
  }
  if (s.kind === "ramp") {
    // Sloped top ascending left→right. No lip grace on the right —
    // crossing it is the launch condition, not a stand.
    if (px < s.x - 4 || px > s.x + s.w) return null;
    const t = Math.max(0, (px - s.x) / s.w);
    return s.y - t * s.rise - 16;
  }
  if (px < s.x - 4 || px > s.x + s.w + 4) return null;
  return s.y - 16;
}

/** One 60Hz moped step: ride, throttle/brake, jump, launch, land.
 *  Same PlayerState and surfaces as on foot (airJump simply never
 *  granted). Deliberately a sibling of stepPlayer, not a
 *  parameterization — the input semantics genuinely differ, and
 *  stepPlayer must stay byte-identical for level 1. */
export function stepMoped(
  player: PlayerState,
  input: InputState,
  surfaces: Surface[],
  world: WorldBounds,
): void {
  if (input.jumpCut) {
    input.jumpCut = false;
    if (player.vy < -3) player.vy *= 0.5;
  }

  // Ride the current stand (movers carry; ramps re-pin the sloped
  // top so riding up needs no new machinery). Crossing a ramp's high
  // lip at speed throws the rider: vy = -k·vx.
  if (player.stand) {
    const s = surfaces.find((q) => q.id === player.stand!.id);
    if (s) {
      player.x += s.x - player.stand.lastX;
      player.y += s.y - player.stand.lastY;
      player.stand.lastX = s.x;
      player.stand.lastY = s.y;
      const top = standY(s, player.x);
      if (top === null) {
        if (
          s.kind === "ramp" &&
          player.x > s.x + s.w &&
          Math.abs(player.vx) >= RAMP_MIN_LAUNCH
        ) {
          player.vy = Math.max(-RAMP_MAX_VY, -s.k * Math.abs(player.vx));
        }
        player.stand = null;
        player.grounded = false;
      } else {
        player.y = top;
      }
    } else {
      player.stand = null;
      player.grounded = false;
    }
  }

  // Throttle / brake / coast. Airborne momentum is committed — input
  // can only trim speed off, never add.
  if (input.right) {
    if (player.grounded) {
      player.vx = Math.min(MOPED_MAX, player.vx + MOPED_ACCEL);
    } else if (player.vx < 0) {
      player.vx = Math.min(0, player.vx + MOPED_AIR_ACCEL);
    }
    if (player.vx >= 0) player.facing = 1;
  } else if (input.left) {
    if (player.grounded) {
      if (player.vx > 0.3) {
        player.vx = Math.max(0, player.vx - MOPED_BRAKE); // the brake
      } else {
        // Heavy U-turn: slow reverse build-up.
        player.vx = Math.max(
          -MOPED_REVERSE_MAX,
          player.vx - MOPED_ACCEL * 0.6,
        );
        if (player.vx < 0) player.facing = -1;
      }
    } else if (player.vx > 0) {
      player.vx = Math.max(0, player.vx - MOPED_AIR_ACCEL);
    }
  } else if (player.grounded) {
    player.vx *= MOPED_COAST;
    if (player.vx > 0) player.vx = Math.max(0, player.vx - MOPED_ROLL);
    else if (player.vx < 0) player.vx = Math.min(0, player.vx + MOPED_ROLL);
  }

  // Jump — buffered, short coyote, NO air jump. A jump buffered on a
  // ramp's lip step overwrites the launch (the rider's bail-out).
  if (player.grounded) player.coyote = MOPED_COYOTE;
  else if (player.coyote > 0) player.coyote -= 1;
  if (player.jumpBuffer > 0) {
    player.jumpBuffer -= 1;
    if (player.coyote > 0) {
      player.vy = MOPED_JUMP_V;
      player.grounded = false;
      player.stand = null;
      player.coyote = 0;
      player.jumpBuffer = 0;
      player.squash = -6;
    }
  }

  // Gravity + integrate + one-way landings (landing keeps vx — the
  // momentum IS the difficulty).
  if (!player.stand) {
    player.vy = Math.min(14, player.vy + GRAVITY);
    const prevY = player.y;
    player.x += player.vx;
    player.y += player.vy;

    if (player.vy > 0) {
      for (const s of surfaces) {
        const top = standY(s, player.x);
        if (top === null) continue;
        if (prevY <= top && player.y >= top) {
          player.y = top;
          player.vy = 0;
          player.grounded = true;
          player.squash = 6;
          player.stand = { id: s.id, lastX: s.x, lastY: s.y };
          break;
        }
      }
    }

    if (player.y >= world.floorY - 16) {
      player.y = world.floorY - 16;
      if (player.vy > 2) player.squash = 6;
      player.vy = 0;
      player.grounded = true;
    } else if (!player.stand) {
      player.grounded = false;
    }
    player.x = Math.max(world.minX, Math.min(world.maxX, player.x));
  } else {
    player.x += player.vx;
    player.x = Math.max(world.minX, Math.min(world.maxX, player.x));
  }
}

/** One 60Hz simulation step: ride, steer, jump, fall, land. Mutates
 *  `player`. Landing priority is list order — the component puts orbs
 *  before letters before level solids, matching the old loops. */
export function stepPlayer(
  player: PlayerState,
  input: InputState,
  surfaces: Surface[],
  world: WorldBounds,
): void {
  if (input.jumpCut) {
    input.jumpCut = false;
    if (player.vy < -3) player.vy *= 0.5;
  }

  // Ride the surface we're standing on (orbs drift and carry Hugo;
  // static rects just keep him pinned until he walks off the edge).
  if (player.stand) {
    const s = surfaces.find((q) => q.id === player.stand!.id);
    if (s) {
      player.x += s.x - player.stand.lastX;
      player.y += s.y - player.stand.lastY;
      player.stand.lastX = s.x;
      player.stand.lastY = s.y;
      const top = standY(s, player.x);
      if (top === null) {
        player.stand = null;
        player.grounded = false;
      } else {
        player.y = top;
      }
    } else {
      player.stand = null;
      player.grounded = false;
    }
  }

  // Horizontal control.
  const dir = input.left ? -1 : input.right ? 1 : 0;
  if (dir !== 0) {
    const skidding = player.grounded && player.vx * dir < 0;
    const accel = skidding
      ? SKID_ACCEL
      : player.grounded
        ? RUN_ACCEL
        : AIR_ACCEL;
    player.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, player.vx + accel * dir));
    player.facing = dir;
  } else if (player.grounded) {
    player.vx *= FRICTION;
  } else {
    player.vx *= AIR_DRAG;
  }

  // Jumping — buffered, with coyote steps off ledges, plus one air
  // jump (recharged on landing) so a mistimed orb isn't fatal.
  if (player.grounded) {
    player.coyote = COYOTE_STEPS;
    player.airJump = true;
  } else if (player.coyote > 0) player.coyote -= 1;
  if (player.jumpBuffer > 0) {
    player.jumpBuffer -= 1;
    const fromGround = player.coyote > 0;
    if (fromGround || player.airJump) {
      if (!fromGround) player.airJump = false;
      player.vy = fromGround ? JUMP_V : JUMP_V * AIR_JUMP_SCALE;
      player.grounded = false;
      player.stand = null;
      player.coyote = 0;
      player.jumpBuffer = 0;
      player.squash = -6; // stretch up
    }
  }

  // Gravity + integrate.
  if (!player.stand) {
    player.vy = Math.min(14, player.vy + GRAVITY);
    const prevY = player.y;
    player.x += player.vx;
    player.y += player.vy;

    // One-way landings — first surface in list order wins.
    if (player.vy > 0) {
      for (const s of surfaces) {
        const top = standY(s, player.x);
        if (top === null) continue;
        if (prevY <= top && player.y >= top) {
          player.y = top;
          player.vy = 0;
          player.grounded = true;
          player.squash = 6;
          player.stand = { id: s.id, lastX: s.x, lastY: s.y };
          break;
        }
      }
    }

    // Floor + walls.
    if (player.y >= world.floorY - 16) {
      player.y = world.floorY - 16;
      if (player.vy > 2) player.squash = 6;
      player.vy = 0;
      player.grounded = true;
    } else if (!player.stand) {
      player.grounded = false;
    }
    player.x = Math.max(world.minX, Math.min(world.maxX, player.x));
  } else {
    player.x += player.vx;
    player.x = Math.max(world.minX, Math.min(world.maxX, player.x));
  }
}
