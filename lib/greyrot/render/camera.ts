/**
 * The camera rig (CLAUDE.md §5).
 *
 * **A fixed 3/4 diorama.** The original contract specified over-the-shoulder
 * traversal pulling back to a combat arena, and explicitly rejected a fixed
 * camera because it forfeited the traversal horizons that make a world feel
 * like a place. That trade-off flipped when the game became a turn-based
 * creature RPG: there are no traversal horizons any more, there are *stages*,
 * so a view-distance-heavy camera would be paying the renderer's most
 * expensive bill for something the game no longer uses.
 *
 *   stage     — the exploration framing. Fixed 3/4 angle, gentle follow, lit
 *               like a toy theatre. View-bounded by construction.
 *   encounter — settles onto a fight. Particle-heavy, but the frame was
 *               already small, so the budgets never stack. The BOSS FIGHT
 *               runs on this framing too: it is the one whose telegraph
 *               readability every fight in the game has already proven.
 *   lean      — the conversation lean-in (Sella's intro): tight and low on a
 *               1.15 m speaker. Was named "boss" until R4 gave the boss a
 *               real framing and the name had to tell the truth.
 *   boss      — the R4 cinematic push-in on the Thornback at the arena
 *               trigger: a 2.15 m body framed with air above it, ~2 s,
 *               nothing frozen. Single purpose, and where the cover art
 *               comes from (§13).
 *
 * The yaw is AUTHORED-AT-REST, movement-following on the walk (round 7). At
 * rest and in every fight the frame sits at DIORAMA_YAW — the angle placement
 * pre-clears sightlines for — and while walking, `FollowYaw` eases the frame
 * behind the commanded direction so where you are going is up-screen, even
 * running back down the road. There is still no player-driven orbit: taps stay
 * world-anchored, and the input latch (`rt-commands.ts` rule 4) keeps held
 * movement world-stable while the frame turns.
 *
 * Framings are tuned for a ~1.15 m sporeling, not a 1.8 m human.
 *
 * Presentation only. The simulation never learns a camera exists.
 */

import { PerspectiveCamera, Vector3 } from "three";
import {
  ENCOUNTER_FOV_DEG,
  ENCOUNTER_VIEW_HEIGHT,
  ENCOUNTER_VIEW_LOOK_HEIGHT,
  STAGE_VIEW_DISTANCE,
  STAGE_VIEW_HEIGHT,
  STAGE_VIEW_LOOK_HEIGHT,
  VIEW_DISTANCE,
  VIEW_LEAD,
  VIEW_LEAD_TOWARD,
  VIEW_YAW,
} from "../sim/staging";
import { MAX_SPEED } from "../sim/constants";
import { reducedMotion } from "./motion";

export type CameraMode = "stage" | "encounter" | "lean" | "boss";

export interface FrameLead {
  x: number;
  z: number;
}

/**
 * Ease a persistent lead vector toward "VIEW_LEAD metres along the current
 * velocity" while `active`, and back toward zero otherwise. Exponential form:
 * frame-rate independent, and a no-op at dt 0 so paused captures hold still.
 * Shared by both entries — the one implementation rule from round 4.
 *
 * ANISOTROPIC (round 6): the frame shows ~23 m up-screen and ~3-4 m
 * down-screen at hero depth, so the lead grows by VIEW_LEAD_TOWARD when the
 * walk points toward the camera — "I can't see where I'm going" was said
 * about exactly the down-screen run. With the follow-yaw (round 7) the boost
 * earns its keep during the TURN TRANSIENT — the ~2 s where the walk points
 * down-screen before the camera catches up — so it measures against the live
 * `yaw`, not the authored constant.
 */
export function updateFrameLead(
  lead: FrameLead,
  vxPerTick: number,
  vzPerTick: number,
  active: boolean,
  dt: number,
  yaw: number = VIEW_YAW,
): void {
  let tx = 0;
  let tz = 0;
  if (active) {
    const v = Math.hypot(vxPerTick, vzPerTick);
    if (v > 1e-6) {
      // How much of the walk points AT the camera (view forward is the
      // direction the camera looks: +yaw in the XZ plane).
      const toward = Math.max(
        0,
        -((vxPerTick / v) * Math.sin(yaw) + (vzPerTick / v) * Math.cos(yaw)),
      );
      // Scale with speed so a drifting stop doesn't hold the frame ahead of
      // a hero who is no longer going anywhere.
      const reach = VIEW_LEAD * (1 + VIEW_LEAD_TOWARD * toward) * Math.min(1, v / MAX_SPEED);
      tx = (vxPerTick / v) * reach;
      tz = (vzPerTick / v) * reach;
    }
  }
  // ASYMMETRIC ease (R1's frame-edge finding, measured at real rAF): growth
  // keeps the proven gentle 2.5 so a walk-start never snaps — but a SHRINKING
  // lead drains at 12, because the two worst hero-off-frame transients were
  // both a full lead outliving its cause: the stop (release a held walk and
  // the frame keeps showing road ahead of a hero going nowhere — feet at NDC
  // -0.77 for ~half a second) and the fight trigger (`active` flips false but
  // the old λ left the lead alive through the encounter pull-in). One rate
  // change fixes both without touching the authored walking frame. The rate
  // is safe for feel because the VISIBLE glide is governed by the rig's own
  // stiffness damping, not by this target's ease — and a pure mid-walk turn
  // never takes this branch (a rotated target is not a smaller one). 12, not
  // the first cut's 7: at 7 the framing gate's M2 settle measured 0.685-0.693
  // against its 0.700 bar — a gate one jitter from a false red owns nobody.
  const shrinking = tx * tx + tz * tz < lead.x * lead.x + lead.z * lead.z;
  const a = 1 - Math.exp((shrinking ? -12 : -2.5) * dt);
  lead.x += (tx - lead.x) * a;
  lead.z += (tz - lead.z) * a;
}

/**
 * The diorama angle, radians — now the AUTHORED yaw: where the frame rests,
 * and where every fight is framed from.
 *
 * Defined in `sim/staging.ts`, not here, because encounter PLACEMENT
 * needs it: the scenario computes where the camera will stand *during fights*
 * and refuses to put one behind a tree. Render may import sim, so there is
 * one copy and no drift.
 */
export const DIORAMA_YAW = VIEW_YAW;

/**
 * VERTICAL field of view of the WALKING frame, degrees. Horizontal coverage is
 * `tan(fov/2) × aspect` — the fov is vertical, so there is no single "walking
 * frame" and the audited aspects (`FRAME_AUDIT_ASPECTS`) are the policy.
 *
 * Exported because the frame is now a SUBJECT of measurement, not only a
 * setting: `scripts/frame-wedge.mjs` derives the in-frame wedge from it, and a
 * rig carrying its own 48 would answer for a camera we no longer ship — the
 * defect shape the near-lens fade radius and the 3.3 sleeve both had.
 *
 * Render-side, unlike `ENCOUNTER_FOV_DEG`: nothing under `sim/` reads the
 * walking fov today. **If a validator rule ever needs it (the west-side rule
 * would), it moves to `sim/staging.ts` and this imports it** — the precedent is
 * one framing down and the reason is identical.
 */
export const STAGE_FOV_DEG = 48;

/** Radians of the ¾ offset kept between the walk direction and the frame. */
const FOLLOW_OFFSET = VIEW_YAW;
/** Seconds of sustained off-frame walking before the follow engages. */
const ENGAGE_SECONDS = 0.3;
/** Radians of heading error below which a hold never swings the frame. */
const DEADBAND_ENGAGE = 0.35;
/** Radians of heading error at which an engaged follow stops tracking. */
const DEADBAND_RELEASE = 0.05;
/** Max radians/second the follow target slews. The rig's ease smooths on top. */
const SLEW = 1.7;

/** Wrap an angle difference onto (-π, π] — the short way round. */
function wrapAngle(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

/**
 * Movement-following yaw (round 7: "I can not see where I'm going since the
 * camera angle is stale"). The walking camera eases to sit behind the
 * COMMANDED walk — including the full 180° when an explorer doubles back —
 * so where you are going is up-screen.
 *
 * Three rules keep it from misbehaving, each paid for once already:
 *
 * - **It reads the commanded move direction** (`MoveLatch.movedDx/Dz`), never
 *   velocity — a knockback must not spin the frame, the same principle the
 *   facing regression pinned sim-side.
 * - **The input latch cuts the feedback loop** (`rt-commands.ts` rule 4): a
 *   held key keeps its world meaning while this controller turns the camera
 *   under it, so following cannot chase its own tail (the 86c90a9 lesson).
 * - **Fights return to the authored yaw.** Encounter placement pre-clears
 *   sightlines for `DIORAMA_YAW` at setup; the follow yields the lens the
 *   moment a framing that placement vouches for takes over, and resumes when
 *   the fight linger ends.
 *
 * Deadband + engage delay mean road weave never swings the frame — only a
 * sustained turn does. Shared by both entries, like `updateFrameLead`.
 */
export class FollowYaw {
  /** The slewed target handed to the rig (which adds its own λ=8 ease). */
  private heading = DIORAMA_YAW;
  /** Seconds of sustained off-frame walking accumulated toward engagement. */
  private engage = 0;
  private tracking = false;

  /**
   * @param movedDx/Dz  the world move direction commanded this tick (zero when
   *                    the player is not asking to move) — `MoveLatch.movedDx/Dz`
   * @param follow      false during encounter/boss/intro framings: drive back
   *                    to the authored yaw instead
   */
  update(dt: number, movedDx: number, movedDz: number, follow: boolean): number {
    let desired: number | null = null;
    if (!follow) {
      this.tracking = false;
      this.engage = 0;
      desired = DIORAMA_YAW;
    } else if (movedDx !== 0 || movedDz !== 0) {
      desired = Math.atan2(movedDx, movedDz) + FOLLOW_OFFSET;
      const err = Math.abs(wrapAngle(desired - this.heading));
      if (!this.tracking) {
        // Small weave stays framed; a sustained real turn engages.
        if (err > DEADBAND_ENGAGE) {
          this.engage += dt;
          if (this.engage >= ENGAGE_SECONDS) this.tracking = true;
        } else {
          this.engage = 0;
        }
        if (!this.tracking) desired = null;
      } else if (err < DEADBAND_RELEASE) {
        this.tracking = false;
        this.engage = 0;
        desired = null;
      }
    } else {
      // Standing still: hold the frame where it is. Returning to the authored
      // yaw on idle would un-turn a camera the player just earned.
      this.engage = 0;
    }

    if (desired !== null) {
      const delta = wrapAngle(desired - this.heading);
      const step = SLEW * dt;
      this.heading += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
      this.heading = wrapAngle(this.heading);
    }
    return this.heading;
  }

  /** For scripted capture — where the follow target currently points. */
  get current(): number {
    return this.heading;
  }
}

interface Framing {
  /** Metres behind the target, along the diorama yaw. */
  distance: number;
  /** Metres above the target. */
  height: number;
  /** Look-at point offset above the target's feet. */
  lookHeight: number;
  fov: number;
  /** Seconds to converge. Lower is snappier. */
  stiffness: number;
}

/**
 * ~30° elevation, not the 37° the first pass used.
 *
 * A sporeling's face sits UNDER a wide cap, so every extra degree of camera
 * height trades face for hat — at 37° the hero rendered as a mushroom seen
 * from above with no character in it at all. 30° still reads rank positions on
 * the ground, which is what the encounter framing needs, while keeping the
 * eyes visible. Distances are tuned so a 1.15 m sporeling stands ~150 px tall
 * at 1280×800 and stays above the legibility floor at 800×450.
 */
const FRAMINGS: Record<CameraMode, Framing> = {
  // Stage distance is shared with the road builder's stand-band clear — see
  // STAGE_VIEW_DISTANCE in staging.ts for why placement needs it.
  /**
   * R4.5: **fov 38 → 48, height 3.3 → 2.6.** The walking frame was a
   * ground-only wedge — its top edge sat ~6.6° BELOW horizontal, so the
   * horizon was never in shot at any chapter-1 vantage on any tier, six of
   * eight vantages held an identically-sized ~20 m bubble of world, and a
   * distant landmark could not be rescued by height (with the lens pitched
   * down, a taller object at the same distance projects FURTHER off the top).
   * That was the measurable form of the owner's "the map layout is exactly the
   * same".
   *
   * Only the STAGE framing moves. `encounter` and `boss` keep their own fov,
   * so every fight frame, the boss push-in and the cover art are untouched —
   * and `distance` is deliberately NOT touched because `STAGE_VIEW_DISTANCE`
   * is sim-side (`sim/staging.ts` — scenario.ts's camera-sleeve carve and the
   * fence stand-band are computed from it), so changing it would move
   * placement and re-hash chapter 1.
   *
   * Lowering `height` alongside the wider fov is what keeps the hero readable:
   * it partially compensates the shrink, measured at −17% rather than the −21%
   * fov alone would cost (800×450: 127 px → 105 px, still comfortably legible).
   * fun's binding verdict, played same-tick against the shipped setting: the
   * ground field reads identically, and the ash sag and the s2 meadow both
   * recover beats — Wellmead's roofs, the drowned stump on the skyline, the
   * pyre chain — that were already in the geometry and being cropped away.
   */
  //
  // R5: `height` and `lookHeight` now IMPORT their constants rather than
  // repeating them. `sim/staging.ts` owns them because the camera-sleeve rule
  // for declared props is a 3D clearance test and a rule that cannot read the
  // lens height cannot do it at all; `architecture.test.ts` was holding the
  // transcription as a CHECKED COPY until this landed. A checked copy catches
  // drift *after* someone writes it — the import stops it being writable, and
  // leaving two of three terms as literals beside `distance`'s import is
  // exactly the shape that produces an edit to one and not the other.
  //
  // The cost is real and it is the right cost: retuning the walking lens is now
  // an edit in `sim/`, which re-runs the prop validator with it. R4.5's
  // 3.3 → 2.6 is what put the lens inside two hut roofs precisely because
  // nothing downstream was obliged to notice.
  stage: {
    distance: STAGE_VIEW_DISTANCE,
    height: STAGE_VIEW_HEIGHT,
    lookHeight: STAGE_VIEW_LOOK_HEIGHT,
    fov: STAGE_FOV_DEG,
    stiffness: 0.3,
  },
  // Pulled back and up, to hold three ranks per side plus the HUD furniture.
  // The distance is shared with encounter placement — see staging.ts.
  //
  // R6: `height`, `lookHeight` and `fov` now IMPORT their constants, for the
  // reason `stage` does one framing up — V12 judges every reinforcement entry
  // point against THIS frame, so the sim holds these terms, and a checked copy
  // catches drift only after someone writes it. The import stops it being
  // writable. The cost is named and accepted: retuning the fight lens is now an
  // edit whose validator runs with it.
  encounter: {
    distance: VIEW_DISTANCE,
    height: ENCOUNTER_VIEW_HEIGHT,
    lookHeight: ENCOUNTER_VIEW_LOOK_HEIGHT,
    fov: ENCOUNTER_FOV_DEG,
    stiffness: 0.38,
  },
  // The conversation lean-in — tuned for a 1.15 m speaker (Sella's intro).
  lean: { distance: 3.6, height: 1.1, lookHeight: 0.75, fov: 30, stiffness: 0.6 },
  // The Thornback push-in (R4): a 2.15 m body needs air over the crest and
  // enough distance that the crest, the fists and a brazier behind it share
  // the frame. Stiffness matches the lean — the push should feel authored,
  // not snapped. Values capture-tuned against the live arena.
  // Stiffness 0.32, down from a first-pass 0.55: the push-in has a 2 s
  // window and the slower glide spent all of it travelling — the capture
  // caught a half-arrived frame instead of a landed cinematic. fun shipped
  // the framing itself (crest clear, two braziers, water behind).
  boss: { distance: 7.2, height: 2.4, lookHeight: 1.25, fov: 32, stiffness: 0.32 },
};

/** Critically-damped smoothing — no overshoot, frame-rate independent. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private mode: CameraMode = "stage";
  /** 0..1 blend between the previous framing and the current one. */
  private blend = 1;
  private from: Framing = FRAMINGS.stage;
  private pos = new Vector3();
  private look = new Vector3();
  /** Viewing yaw, radians. Fixed at DIORAMA_YAW except for authored moments. */
  private yaw = DIORAMA_YAW;
  /** Where the yaw is heading; `yaw` eases toward it so changes never snap. */
  private targetYaw = DIORAMA_YAW;
  private shake = 0;
  private shakeSeed = 0;
  /** Terrain height under an arbitrary point. Set by the app. */
  private groundSampler: ((x: number, z: number) => number) | null = null;

  /**
   * Give the rig a way to sample terrain under ITSELF.
   *
   * Clamping the camera against the ground under its *target* is not enough:
   * on a slope the camera sits metres away and lands inside the hill behind
   * it, which is how an encounter ended up framed through a wall of dirt and
   * a grass blade the size of the screen.
   */
  setGroundSampler(fn: (x: number, z: number) => number): void {
    this.groundSampler = fn;
  }

  constructor(aspect = 1) {
    this.camera = new PerspectiveCamera(FRAMINGS.stage.fov, aspect, 0.1, 200);
    this.pos.set(0, 3, 6);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.from = this.currentFraming();
    this.mode = mode;
    this.blend = 0;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  setYaw(y: number): void {
    this.targetYaw = y;
  }

  get currentYaw(): number {
    return this.yaw;
  }

  /**
   * Screen shake. Per CLAUDE.md §11 this fires for things that happen TO the
   * player and for their successes — taking a hit, a kill, an ultimate
   * landing, a boss slam — never for routine input. game1 shipped shake on the
   * player's own actions and it rumbled constantly.
   */
  addShake(amount: number): void {
    // Reduced motion drops the shake entirely. It is pure presentation — the
    // hit that caused it already landed in the sim, so nothing about the
    // fight changes.
    if (reducedMotion()) return;
    this.shake = Math.min(1, this.shake + amount);
    this.shakeSeed += 1;
  }

  private currentFraming(): Framing {
    const to = FRAMINGS[this.mode];
    if (this.blend >= 1) return to;
    const t = this.blend * this.blend * (3 - 2 * this.blend); // smoothstep
    const f = this.from;
    return {
      distance: f.distance + (to.distance - f.distance) * t,
      height: f.height + (to.height - f.height) * t,
      lookHeight: f.lookHeight + (to.lookHeight - f.lookHeight) * t,
      fov: f.fov + (to.fov - f.fov) * t,
      stiffness: f.stiffness + (to.stiffness - f.stiffness) * t,
    };
  }

  /**
   * @param dt        seconds since the last frame
   * @param targetX/Y/Z  the point being framed (the party's centroid, usually)
   * @param groundY   terrain height under the camera, so it never clips through
   */
  update(
    dt: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    groundY = -Infinity,
  ): void {
    // Mode transition. This is the frame budget's worst moment — both the
    // long view and the wide scene are briefly on screen — so M0's perf gate
    // measures it explicitly.
    // The traversal↔combat pull-back is the biggest camera move in the game
    // and the most likely to unsettle. Reduced motion cuts to the new framing
    // instead of gliding to it — the framing itself is unchanged, so the fight
    // is composed identically either way.
    if (this.blend < 1) this.blend = reducedMotion() ? 1 : Math.min(1, this.blend + dt / 0.55);
    const f = this.currentFraming();

    // Ease yaw toward its target along the SHORT way round — raw damping of
    // an angle takes the long way across the ±π seam.
    let yawDelta = this.targetYaw - this.yaw;
    yawDelta = ((yawDelta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.yaw += yawDelta - (yawDelta) * Math.exp(-8 * dt);

    const desiredX = targetX - Math.sin(this.yaw) * f.distance;
    const desiredZ = targetZ - Math.cos(this.yaw) * f.distance;
    const desiredY = targetY + f.height;

    const lambda = 1 / Math.max(0.001, f.stiffness);
    this.pos.set(
      damp(this.pos.x, desiredX, lambda, dt),
      damp(this.pos.y, desiredY, lambda, dt),
      damp(this.pos.z, desiredZ, lambda, dt),
    );
    this.look.set(
      damp(this.look.x, targetX, lambda, dt),
      damp(this.look.y, targetY + f.lookHeight, lambda, dt),
      damp(this.look.z, targetZ, lambda, dt),
    );

    // Never let the camera sink into the ground — checked against the terrain
    // under the CAMERA as well as under the target (see setGroundSampler).
    let minY = groundY + 0.6;
    if (this.groundSampler) {
      // 2.2 m, not 1.1: ground clearance has to clear the FOLIAGE, not just
      // the dirt. At 1.1 the camera cleared the hillside and then sat inside a
      // grass tuft, which at this fov filled most of the frame with one blade.
      minY = Math.max(minY, this.groundSampler(this.pos.x, this.pos.z) + 2.2);
    }
    if (this.pos.y < minY) this.pos.y = minY;

    this.camera.position.copy(this.pos);

    if (this.shake > 0.001) {
      // Decaying pseudo-random offset. Deterministic per seed so replay-driven
      // capture stays reproducible.
      const s = this.shake * this.shake * 0.35;
      const t = this.shakeSeed * 12.9898;
      this.camera.position.x += Math.sin(t * 7.1 + performance.now() * 0.05) * s;
      this.camera.position.y += Math.cos(t * 5.3 + performance.now() * 0.043) * s;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }

    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - f.fov) > 0.01) {
      this.camera.fov = f.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setAspect(aspect: number): void {
    if (this.camera.aspect === aspect) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setFar(far: number): void {
    if (this.camera.far === far) return;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  /** Snap instantly — for scene cuts and deterministic capture. */
  snap(targetX: number, targetY: number, targetZ: number): void {
    this.blend = 1;
    this.yaw = this.targetYaw;
    const f = FRAMINGS[this.mode];
    this.pos.set(
      targetX - Math.sin(this.yaw) * f.distance,
      targetY + f.height,
      targetZ - Math.cos(this.yaw) * f.distance,
    );
    this.look.set(targetX, targetY + f.lookHeight, targetZ);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov = f.fov;
    this.camera.updateProjectionMatrix();
  }
}
