/**
 * Where the camera stands — as simulation-side data.
 *
 * This lives in `sim/` rather than `render/` for one reason: **encounter
 * placement has to know it.** The diorama angle is AUTHORED (`CLAUDE.md` §5):
 * every fight is framed from exactly this yaw, so the patch of ground the
 * camera will occupy during an encounter is knowable at the moment the fight
 * is placed, and the scenario can refuse to put one where a tree would stand
 * between the camera and the arena.
 *
 * Round 7 split the walking camera off this constant: on the open road the
 * yaw FOLLOWS the commanded walk (`render/camera.ts` `FollowYaw`), and the
 * blocker material fades anything that drifts between the rotated lens and
 * the hero — the reactive half of a hybrid. The placement dividend holds
 * where it pays: `FollowYaw` drives back to THIS yaw the moment a fight takes
 * the lens, so the pre-cleared sightlines below are the sightlines fights are
 * actually seen through.
 *
 * The renderer imports these too (render→sim is the allowed direction, §4), so
 * there is exactly one copy and the two can never drift apart.
 */

/**
 * Viewing yaw, radians. Slightly off-axis so the stage reads with depth —
 * dead-on is a side-scroller, 45° is an isometric puzzle game, and this sits
 * deliberately between them.
 */
export const VIEW_YAW = 0.42;

/** Metres the encounter camera sits back from its look point. */
export const VIEW_DISTANCE = 9.2;

/**
 * Metres the STAGE camera sits back from its look point — the walking frame.
 * Sim-side for the same reason as VIEW_YAW: with a fixed yaw the walking
 * camera's standing spot for a hero anywhere on the road is knowable at
 * placement time, and the road builder clears the band it stands in
 * (`scenario.ts`) — the ambient forest scatter knows nothing about roads and
 * put a full-grown tree exactly in the lens at the s3 gate.
 */
export const STAGE_VIEW_DISTANCE = 5.6;

/**
 * Metres the STAGE camera's lens sits above its look point, and metres that
 * look point sits above the ground — the walking frame's vertical half.
 *
 * Sim-side for the SAME reason as `STAGE_VIEW_DISTANCE`, one axis along: the
 * camera-sleeve rule for declared props is a 3D clearance test (a lens 0.81 m
 * outside a hut's collision cylinder and 0.26 m under its apex is *under the
 * eaves*, which a 2D perpendicular distance cannot see), and a rule that
 * cannot read the lens height cannot do it at all.
 *
 * ⚠️ AND IT MAY NOT BE COPIED. R4.5 moved `height` 3.3 → 2.6 and that single
 * dial turn is what put the lens inside two village hut roofs. A sleeve
 * derived from a hard-coded 3.3 would have gone on passing — **the identical
 * defect shape as the near-lens fade radius being 1.6, one level up.**
 *
 * ── CURRENT STATE ── STRUCTURAL. `render/camera.ts`'s `FRAMINGS.stage`
 * IMPORTS both of these (gfx, R6), so there is one copy and drift is not
 * expressible. `architecture.test.ts` still reads `camera.ts` and asserts the
 * import form, which is now a regression guard against someone re-inlining a
 * literal rather than the checked copy it was while the import was pending.
 */
export const STAGE_VIEW_HEIGHT = 2.6;
export const STAGE_VIEW_LOOK_HEIGHT = 0.62;

/**
 * Metres the stage frame leads the hero along their velocity (round 5: the
 * hairpin legs run near pure screen-right, where an unled frame showed
 * ~0.78 s ahead). Applied render-side in `render/camera.ts`; defined HERE for
 * the same reason as VIEW_YAW — the camera-sleeve carve in `scenario.ts` has
 * to clear the sight line for a camera that now drifts up to this far from
 * its resting offset. The first led drive proved the need: the sleeve was
 * carved for an unled camera and the gate rise put a boulder in the frame.
 */
export const VIEW_LEAD = 2.6;

/**
 * Extra lead, as a multiple of VIEW_LEAD, when the walk points TOWARD the
 * camera (round 6: "I can't see where I'm going" running down-screen). The
 * frame is not symmetric: at hero depth the stage framing shows ~23 m
 * up-screen and only ~3-4 m down-screen, so a symmetric lead leaves the
 * down-screen walk nearly blind. At 1.0 the lead doubles to 5.2 m walking
 * due south and the hero rides the upper third of the frame. Placement is
 * unaffected: a toward-camera lead shifts the frame ALONG the view axis, so
 * the sight sleeve does not widen and the stand-band discs (one per ~1 m
 * road sample) already cover any slide along the road.
 */
export const VIEW_LEAD_TOWARD = 1.0;

/** Unit vector from an encounter's centre toward the camera. */
export function viewDirection(): { dx: number; dz: number } {
  return { dx: -Math.sin(VIEW_YAW), dz: -Math.cos(VIEW_YAW) };
}

/**
 * The ENCOUNTER framing's vertical terms and its field of view.
 *
 * Sim-side for the same reason as everything above it: **placement has to
 * know where the camera stands.** R5 added a reason with teeth — the Dry
 * Gulch's reinforcement arrivals are authored ring points, and half of them
 * shipped OUTSIDE the encounter frame. A body that materialises off-screen
 * reads as *"the game is adding enemies"*, which is the one way that mechanic
 * fails even when its sign is right, so "the entry is in shot" is now a
 * build-time rule (`stage-validator.ts` V12) rather than a hope.
 *
 * ⚠️ NOTHING IN THE TICK MAY READ THESE. They are for build-time placement
 * and for the validator only. `fov` and `height` are RENDER dials — gfx turns
 * them — and a tick that computed anything from them would re-hash chapter 1
 * every time the camera was tuned, which is exactly the property that let the
 * R4.5 camera sweep happen at all. Arrival positions are therefore AUTHORED
 * numbers held against these by a gate, never generated from them.
 *
 * ── CURRENT STATE ── STRUCTURAL. `render/camera.ts`'s `FRAMINGS.encounter`
 * imports all three (gfx, R6); `distance` had imported since R5. The
 * `architecture.test.ts` clause is now a regression guard on the import form.
 */
export const ENCOUNTER_VIEW_HEIGHT = 5.6;
export const ENCOUNTER_VIEW_LOOK_HEIGHT = 0.7;
/** VERTICAL field of view, degrees. Horizontal coverage is this × aspect. */
export const ENCOUNTER_FOV_DEG = 38;

/**
 * How far the fight frame is pulled from the hero toward the pack centroid
 * (`main.ts`) — "biased toward the thick of it, so a fight behind you is
 * still on screen".
 *
 * gfx's finding, and it is a framing term wearing a different coat: an
 * envelope computed about the HERO is wrong by up to ~1.8 m in an 8 m arena
 * because of this one number. It lives here so the rule that consumes it and
 * the frame that applies it cannot drift.
 */
export const ENCOUNTER_FIGHT_BIAS = 0.22;

/**
 * The aspect ratios the frame rules are audited against.
 *
 * **ASPECT IS A POLICY, NOT A CONSTANT** (gfx, R5) — the fov is vertical, so
 * horizontal coverage is `tan(fov/2) × aspect` and there is no single
 * "encounter frame". Naming the audited set is the whole defence, because
 * **this is the axis that hid the bug**: 1280×800 is 16:10, NARROWER than the
 * 800×450 we habitually call the hard case, so anything living at the
 * horizontal edge is hardest on the desktop window nobody was checking.
 *
 * ⚠️ PORTRAIT (390×844, aspect 0.462) IS DELIBERATELY ABSENT AND THE ROW IS ◐
 * THERE. Measured by fun: 8 of 8 arrival points off-frame. It cannot be fixed
 * by moving points and it cannot be fixed by the camera — gfx: holding the
 * 16:9 horizontal half-angle at that aspect needs a vertical fov of 105°, a
 * fisheye. Portrait belongs to R10's mobile pass, and until then the gulch's
 * arrival-readability claim is FALSE on a phone. Saying so out loud beats a
 * rule that quietly excludes the viewport it fails.
 */
export const FRAME_AUDIT_ASPECTS: readonly { readonly w: number; readonly h: number }[] = [
  { w: 1280, h: 800 },
  { w: 800, h: 450 },
];

/**
 * Radius of the converging gather the renderer draws where a reinforcement
 * arrives (`render/fx/rt-event-fx.ts`, `RING`). The CUE, not the body — and
 * the cue is the readable half, so V12 requires the whole ring in frame, not
 * just its centre. fun caught a point whose body landed on screen at 77 px
 * while its gather clipped the edge: *the focal point was in the picture and
 * the thing that draws the eye to it was not.*
 *
 * ── CURRENT STATE ── STRUCTURAL. `rt-event-fx.ts`'s `RING` imports this
 * constant (gfx, R6); the `architecture.test.ts` clause guards the import
 * form against a re-inlined literal.
 */
export const ARRIVAL_CUE_RADIUS = 2.5;
