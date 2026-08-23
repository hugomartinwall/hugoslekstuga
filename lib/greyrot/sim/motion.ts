/**
 * Shared body motion — the movement rules every unit in the world obeys.
 *
 * Extracted verbatim from `step.ts`, unchanged, because a second simulation
 * (`sim/rt/`) now needs the same physics and "nothing in the world moves by
 * different physics" is a rule this codebase already keeps. Two copies of a
 * grade cap that disagree by a rounding error is a desync waiting to happen.
 *
 * Deterministic by construction: fixed per-tick constants, no wall clock, no
 * `Math.random`, and no trig — facing is a unit vector turned by lerp and
 * normalise, because `sin`/`cos`/`atan2` are not IEEE-exact across platforms
 * and would eventually diverge a replay.
 */

import {
  DEEP_STEP_TOLERANCE,
  FRICTION,
  MAX_GRADE,
  PIVOT_BRAKE,
  STOP_EPSILON,
  TURN_RATE,
  WADE_DEPTH,
} from "./constants";
import type { SimWorld } from "./world";

/**
 * Anything the movement rules can move.
 *
 * Lived in `sim/state.ts` when there were two simulations; that file is gone
 * and this is the module that defines what a body IS, so it lives here. `RtBody`
 * is structurally compatible and nothing needs to say so.
 *
 * Facing is a unit vector rather than an angle on purpose: `atan2`, `sin` and
 * `cos` are not IEEE-exact across platforms, and a replay that drifts by one
 * ulp per tick is not a replay (`CLAUDE.md` §4).
 */
export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  fx: number;
  fz: number;
}

/**
 * Integrate one body one tick under the world's movement rules.
 *
 * @param ix/iz    steering intent, clamped to unit length
 * @param maxSpeed metres per tick
 * @param accel    metres per tick per tick
 * @param slip     friction multiplier — 1 is normal ground, higher slides.
 *                 Ice patches raise it, which is how a frozen floor reads as
 *                 dangerous rather than as a texture swap.
 */
export function integrate(
  world: SimWorld,
  b: Body,
  ix: number,
  iz: number,
  maxSpeed: number,
  accel: number,
  slip = 1,
): void {
  const il = Math.hypot(ix, iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
  }

  if (il > 1e-6) {
    // Pivot brake: damp the velocity component that OPPOSES the input, so a
    // reversal pivots instead of drifting through its own momentum. Unit input
    // axis, opposed component only — perpendicular velocity (arcs) untouched.
    const ul = Math.hypot(ix, iz);
    const ux = ix / ul;
    const uz = iz / ul;
    const along = b.vx * ux + b.vz * uz;
    if (along < 0) {
      b.vx -= ux * along * (1 - PIVOT_BRAKE);
      b.vz -= uz * along * (1 - PIVOT_BRAKE);
    }
    b.vx += ix * accel;
    b.vz += iz * accel;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > maxSpeed) {
      b.vx = (b.vx / sp) * maxSpeed;
      b.vz = (b.vz / sp) * maxSpeed;
    }
  } else {
    // Slip pulls friction toward 1 (no damping at all), so ice coasts.
    const f = FRICTION + (1 - FRICTION) * Math.max(0, Math.min(1, (slip - 1) / 3));
    b.vx *= f;
    b.vz *= f;
    if (Math.hypot(b.vx, b.vz) < STOP_EPSILON) {
      b.vx = 0;
      b.vz = 0;
    }
  }

  if (b.vx === 0 && b.vz === 0) return;

  let nx = b.x + b.vx;
  let nz = b.z + b.vz;

  const curH = world.field.heightAt(b.x, b.z);
  const nextH = world.field.heightAt(nx, nz);
  const moveDist = Math.hypot(b.vx, b.vz);
  // Grade cap: cannot gain more height than the distance moved allows.
  const blockedBySlope = nextH - curH > moveDist * MAX_GRADE;
  // Water: wadeable to WADE_DEPTH; deeper blocks, with a ripple-tolerant
  // escape rule for anything already over-deep. See constants.ts history.
  const wadeFloor = world.waterLevel - WADE_DEPTH;
  const overDeep = curH < wadeFloor;
  const blockedByWater =
    nextH < wadeFloor && (overDeep ? nextH < curH - DEEP_STEP_TOLERANCE : true);

  if (blockedBySlope || blockedByWater) {
    // Slide along the contour (perpendicular to the terrain gradient).
    const e = 0.5;
    const gx = world.field.heightAt(b.x + e, b.z) - world.field.heightAt(b.x - e, b.z);
    const gz = world.field.heightAt(b.x, b.z + e) - world.field.heightAt(b.x, b.z - e);
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-9) {
      const cx = -gz / gl;
      const cz = gx / gl;
      const along = b.vx * cx + b.vz * cz;
      b.vx = cx * along;
      b.vz = cz * along;
    } else {
      b.vx = 0;
      b.vz = 0;
    }
    nx = b.x + b.vx;
    nz = b.z + b.vz;
    const slideH = world.field.heightAt(nx, nz);
    const slideDist = Math.hypot(b.vx, b.vz);
    const stillSlope = slideH - curH > slideDist * MAX_GRADE;
    const stillWater =
      slideH < wadeFloor && (overDeep ? slideH < curH - DEEP_STEP_TOLERANCE : true);
    if (stillSlope || stillWater) {
      b.vx = 0;
      b.vz = 0;
      nx = b.x;
      nz = b.z;
    }
  }

  b.x = nx;
  b.z = nz;
}

/** Push a body out of the static blockers around it. */
export function pushOutOfBlockers(world: SimWorld, b: Body, radius: number): void {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const o of world.obstacles.near(b.x, b.z)) {
      const dx = b.x - o.x;
      const dz = b.z - o.z;
      const minDist = o.radius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-9) {
        const push = minDist - d;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      } else {
        b.x += b.fx * minDist;
        b.z += b.fz * minDist;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Turn facing toward the velocity, capped, trig-free. */
export function faceVelocity(b: Body, rate = TURN_RATE): void {
  const sp = Math.hypot(b.vx, b.vz);
  if (sp <= STOP_EPSILON) return;
  turnToward(b, b.vx / sp, b.vz / sp, rate);
}

export function turnToward(b: Body, tx: number, tz: number, rate = TURN_RATE): void {
  // Near-exact opposition deadlocks lerp+normalise: the lerp shrinks the
  // vector along the same line and normalising restores it unchanged, so the
  // turn never starts. (Walking due south from the default north facing hit
  // this — collinear cases are common, not exotic.) Bias the target toward
  // the facing's left perpendicular so the turn always picks the same side.
  let ax = tx;
  let az = tz;
  if (b.fx * tx + b.fz * tz < -0.999) {
    ax = tx - b.fz * 0.05;
    az = tz + b.fx * 0.05;
  }
  const nx = b.fx + (ax - b.fx) * rate;
  const nz = b.fz + (az - b.fz) * rate;
  const l = Math.hypot(nx, nz);
  if (l > 1e-9) {
    b.fx = nx / l;
    b.fz = nz / l;
  }
}

/**
 * Push two bodies apart to `minDist`, split by weights (wa + wb should be 1;
 * weight 0 makes that body immovable). Position-based like `pushOutOfBlockers`
 * — velocity untouched, nothing new to hash. `relax` < 1 resolves a fraction
 * per tick so spawn overlaps ease apart over a few ticks instead of popping.
 *
 * On exact co-location the push axis falls back to `a`'s facing, which is
 * state and therefore deterministic.
 */
export function pushApart(
  a: Body,
  b: Body,
  minDist: number,
  wa: number,
  wb: number,
  relax = 0.5,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return false;
  const d = Math.sqrt(d2);
  let ux: number;
  let uz: number;
  if (d > 1e-9) {
    ux = dx / d;
    uz = dz / d;
  } else {
    ux = a.fx;
    uz = a.fz;
  }
  const push = (minDist - d) * relax;
  a.x -= ux * push * wa;
  a.z -= uz * push * wa;
  b.x += ux * push * wb;
  b.z += uz * push * wb;
  return true;
}

export function dist2(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
