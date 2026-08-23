/**
 * Aiming. There is almost nothing here, and that is the design.
 *
 * > **A cast fires along the hero's facing.** No reticle, no lock, no
 * > targeting assist, and nothing reads the cursor to decide where a spell
 * > goes. Identical on desktop and touch.
 *
 * Aim is **footwork**: you face something by moving toward it, and you hit it
 * by being pointed the right way at the right moment.
 *
 * ## Why this file is a stub instead of a system
 *
 * It used to hold a soft-lock, a cursor ground-pick, a ray-versus-body picker
 * and a policy resolver, built over three rounds of playtest feedback that all
 * said the same thing: *stop aiming for the player*. Each round I removed one
 * kind of assistance and added a better one. The verdict on the last of them
 * was that it still never felt like it locked and the on-screen reticle was
 * noise — so the whole apparatus went, and what remains is one line of maths.
 *
 * A system that needs a ring drawn on the ground to explain where your shot
 * will go is a system the player cannot feel. The character is the indicator.
 *
 * No trig, no `Math.random`, no wall clock. Facing is a unit vector, the same
 * convention `sim/state.ts` uses and for the same reason: `atan2`/`sin`/`cos`
 * are not IEEE-exact across platforms and a replay leaning on them diverges.
 */

export interface AimFacing {
  x: number;
  z: number;
  /** Facing as a unit vector. */
  fx: number;
  fz: number;
}

/**
 * Where a cast lands: straight ahead, at `range`.
 *
 * The only aim rule in the game. It does not take the foe list, the cursor, or
 * the device, because none of them are allowed to influence it — that is the
 * point, and the signature is the enforcement.
 */
export function forwardAimPoint(from: AimFacing, range: number): { x: number; z: number } {
  return { x: from.x + from.fx * range, z: from.z + from.fz * range };
}

/**
 * Where a target travelling at `(vx, vz)` per tick will be when a shot
 * launched now arrives.
 *
 * **Never called by the game.** It exists so tests can assert that a correct
 * lead lands a hit — which is what makes "a moving target can be missed" a
 * measured claim rather than a hopeful one — and so balance bots can shoot
 * competently without an aimbot existing anywhere in the live path.
 */
export function leadPoint(
  from: { x: number; z: number },
  target: { x: number; z: number; vx: number; vz: number },
  projectileSpeedPerTick: number,
  extraTicks = 0,
): { x: number; z: number } {
  const speed = Math.max(1e-6, projectileSpeedPerTick);
  let x = target.x;
  let z = target.z;
  // Fixed-point iteration. One pass solves the flight time to where the target
  // is NOW, which under-leads badly at range — the interception point is
  // further away than the target, so the shot takes longer to get there than
  // the first estimate says, and the estimate has to chase itself outward.
  //
  // Six passes, not three: at 12 m against a target crossing at 0.28 m/tick
  // three passes reached 12.2 m of lead against a true answer of 12.7, which
  // missed by 1.1 m against a 0.9 m blast.
  for (let i = 0; i < 6; i++) {
    const ticks = Math.hypot(x - from.x, z - from.z) / speed + extraTicks;
    x = target.x + target.vx * ticks;
    z = target.z + target.vz * ticks;
  }
  return { x, z };
}
