/**
 * Devices in, one tick's `RtCommand[]` out.
 *
 * Extracted from the sandbox so the campaign and the balance harness share one
 * implementation. This function is small and looks copyable, and copying it is
 * exactly the mistake: three of the rules encoded here were each paid for once
 * already, and a second copy would drift off them silently.
 *
 * 1. **Input is DRAINED, never sampled.** At 30 Hz a key pressed and released
 *    between two ticks is invisible to a sampler. For movement that is a shrug;
 *    for an element press in a game whose whole skill is fast composition it is
 *    the common case, not an edge case.
 * 2. **The command queue is cleared at the top of every tick**, so anything
 *    pushed into it between ticks is silently wiped. Injections — the debug
 *    handle, scripted spawns — go through a separate `external` list that is
 *    spliced in at the end. Both entries rediscovered this independently, and
 *    in the sandbox it presented as "the opening wave never spawned".
 * 3. **The aim is quantised before it becomes a command.** It originates in
 *    floating-point screen space from a camera-dependent unprojection, which is
 *    presentation, and which a replay does not reproduce. Snapping to the same
 *    1/4096 m grid the hashes use makes the command exactly reproducible, and
 *    0.25 mm is far below anything that could change a decision.
 * 4. **Held movement is LATCHED in world space.** The camera yaw follows the
 *    walk now, and yaw-rotated intent feeding a yaw that follows the intent is
 *    a closed loop: the pre-pivot orbit camera (86c90a9) measured 1.5
 *    uncommanded rotations in 3 s from a held pointer re-picked through the
 *    live camera every tick. The loop is cut here, at the rotation step — a
 *    held input's world direction is frozen the moment it starts (or is
 *    actively re-steered past `RELATCH_*`), and only FRESH input passes
 *    through the live yaw. Hold "down" and the camera swings behind you while
 *    you keep running the same world way; release and press again, and the
 *    press means the new frame.
 *
 * **Nothing here reads the cursor to decide where a spell goes.** The cursor
 * steers movement and nothing else; a cast fires along the hero's facing, on
 * both devices, and `forwardAimPoint`'s signature is what enforces it.
 */

import { forwardAimPoint } from "../sim/rt/aim";
import { BASE_CAST_RANGE } from "../sim/rt/spell";
import type { RtBody } from "../sim/rt/state";
import type { RtCommand } from "../sim/rt/step";
import type { SpellInput } from "./spell-input";

/**
 * Metres ahead of the hero a cast is aimed. Re-exported from the sim, where
 * per-element range identities resolve against the same number.
 */
export const CAST_RANGE = BASE_CAST_RANGE;

/** The sim's positional grid — the same quantum the state hashes use. */
const AIM_Q = 4096;

/**
 * Radians of SCREEN-direction change at which a held key/stick hold is
 * re-derived through the live yaw. Big enough that a settling camera never
 * re-steers a steady hold; far smaller than the 45° between key combos, so a
 * genuine new steer always re-latches.
 */
const RELATCH_SCREEN = 0.2;
/** CSS pixels of pointer travel at which a held pointer re-picks the ground. */
const RELATCH_PX = 2;

/**
 * The world-space latch for held movement — rule 4 in the header.
 *
 * Owned by the caller (like `out`/`external`) so both entries and every
 * scripted drive share the one instance the camera also reads.
 */
export interface MoveLatch {
  /** Unit screen direction the current key/stick hold was derived from. */
  screenDx: number;
  screenDy: number;
  /** The frozen world direction of the current hold (unit). */
  worldDx: number;
  worldDz: number;
  /** True while a key/stick hold is latched. */
  active: boolean;
  /** Pointer position (CSS px) of the last ground re-pick. */
  aimPx: number;
  aimPy: number;
  /** True while a pointer hold is latched. */
  pointerActive: boolean;
  /**
   * The world move direction COMMANDED this tick (zero when none). The camera's
   * follow-yaw reads this, never raw velocity — a knockback is velocity the
   * player never asked for, and it must not spin the frame (the same rule the
   * facing regression pinned for the body).
   */
  movedDx: number;
  movedDz: number;
}

export function newMoveLatch(): MoveLatch {
  return {
    screenDx: 0,
    screenDy: 0,
    worldDx: 0,
    worldDz: 0,
    active: false,
    aimPx: 0,
    aimPy: 0,
    pointerActive: false,
    movedDx: 0,
    movedDz: 0,
  };
}

export interface GatherOptions {
  input: SpellInput;
  hero: RtBody;
  /** The camera yaw AS OF THIS TICK, for rotating fresh screen intent into world space. */
  yaw: number;
  /** Where the cursor meets the ground, for hold-to-walk. Null when unknown. */
  cursorGround: () => { x: number; z: number } | null;
  /** The held-movement latch. Caller-owned; the camera's follow-yaw reads it. */
  latch: MoveLatch;
  /** Scratch list, cleared and returned. Owned by the caller so it is not reallocated. */
  out: RtCommand[];
  /** Injections since the last tick. Drained into `out` and emptied. */
  external: RtCommand[];
}

/** Snap an aim point onto the sim's grid before it becomes a command. */
function quantise(p: { x: number; z: number }): { x: number; z: number } {
  return { x: Math.round(p.x * AIM_Q) / AIM_Q, z: Math.round(p.z * AIM_Q) / AIM_Q };
}

/**
 * Gather this tick's commands from every source: devices, then injections.
 *
 * Call from the fixed-timestep loop AND from the debug handle's `step`, so a
 * scripted run takes the same path a real tick takes. A debug handle that does
 * not take the game's own path is a debug handle that lies (`CLAUDE.md` §6).
 */
export function gatherRtCommands(o: GatherOptions): RtCommand[] {
  const { input, hero, latch, out, external } = o;
  out.length = 0;

  // Movement, through the world-space latch (rule 4 in the header). Fresh
  // intent is rotated against the yaw of THIS tick; a steady hold replays its
  // frozen world direction while the camera turns underneath it. Trig is fine
  // here — this is app code, not the sim.
  latch.movedDx = 0;
  latch.movedDz = 0;
  const move = input.moveIntent();
  if (move) {
    latch.pointerActive = false;
    const mag = Math.hypot(move.dx, move.dy);
    const sdx = move.dx / mag;
    const sdy = move.dy / mag;
    const steered =
      !latch.active ||
      Math.acos(
        Math.min(1, Math.max(-1, sdx * latch.screenDx + sdy * latch.screenDy)),
      ) > RELATCH_SCREEN;
    if (steered) {
      const cos = Math.cos(o.yaw);
      const sin = Math.sin(o.yaw);
      latch.worldDx = -sdx * cos - sdy * sin;
      latch.worldDz = sdx * sin - sdy * cos;
      latch.screenDx = sdx;
      latch.screenDy = sdy;
      latch.active = true;
    }
    // Direction is latched; DEFLECTION is live — a stick eased toward its rim
    // still speeds up without re-aiming the world.
    latch.movedDx = latch.worldDx;
    latch.movedDz = latch.worldDz;
    out.push({ type: "move", dx: latch.worldDx * mag, dz: latch.worldDz * mag });
  } else if (input.movingToCursor) {
    latch.active = false;
    const aim = input.aim;
    const rePick =
      !latch.pointerActive ||
      (aim !== null &&
        Math.hypot(aim.px - latch.aimPx, aim.py - latch.aimPy) >= RELATCH_PX);
    if (rePick) {
      const g = o.cursorGround();
      if (g) {
        const dx = g.x - hero.x;
        const dz = g.z - hero.z;
        const d = Math.hypot(dx, dz);
        // The stand-still check happens at LATCH time only: a cursor held on
        // the hero means "stay", a cursor held up the road means "keep going"
        // — not "walk there and stop", because re-checking against a point
        // every tick is exactly the per-tick re-pick the latch exists to end.
        if (d > 0.35) {
          latch.worldDx = dx / d;
          latch.worldDz = dz / d;
          latch.pointerActive = true;
          if (aim) {
            latch.aimPx = aim.px;
            latch.aimPy = aim.py;
          }
        } else {
          latch.pointerActive = false;
        }
      }
    }
    if (latch.pointerActive) {
      latch.movedDx = latch.worldDx;
      latch.movedDz = latch.worldDz;
      out.push({ type: "move", dx: latch.worldDx, dz: latch.worldDz });
    }
  } else {
    latch.active = false;
    latch.pointerActive = false;
  }

  // Drained, never sampled: a press between two ticks must not be lost.
  for (const e of input.drain()) {
    if (e.type === "cast") {
      const aim = quantise(forwardAimPoint(hero, CAST_RANGE));
      out.push({ type: "cast", form: e.form, aimX: aim.x, aimZ: aim.z });
    } else {
      out.push(e);
    }
  }

  if (external.length > 0) {
    out.push(...external);
    external.length = 0;
  }
  return out;
}

/**
 * Where the cursor meets the ground — the hold-to-walk target.
 *
 * Marches until the ray dips below the terrain, then BISECTS the crossing
 * interval. The march alone stepped 0.5 m, which put up to half a metre of slop
 * into the walk target.
 *
 * Kept here beside `gatherRtCommands` because it is the *only* thing the cursor
 * is allowed to do. Nothing may use it to place a spell.
 */
export function groundUnderRay(
  ray: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number },
  heightAt: (x: number, z: number) => number,
): { x: number; z: number } | null {
  const at = (t: number): { x: number; y: number; z: number } => ({
    x: ray.ox + ray.dx * t,
    y: ray.oy + ray.dy * t,
    z: ray.oz + ray.dz * t,
  });
  const below = (t: number): boolean => {
    const p = at(t);
    return p.y <= heightAt(p.x, p.z);
  };

  let lo = 0;
  for (let i = 0; i < 140; i++) {
    const hi = lo + 0.5;
    if (below(hi)) {
      // Bracketed: `lo` is above ground, `hi` below. Bisect it.
      let a = lo;
      let b = hi;
      for (let k = 0; k < 12; k++) {
        const mid = (a + b) / 2;
        if (below(mid)) b = mid;
        else a = mid;
      }
      const p = at(b);
      return { x: p.x, z: p.z };
    }
    lo = hi;
  }
  return null;
}
