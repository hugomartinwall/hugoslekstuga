/**
 * Puppet: a Rig assembled as jointed Object3Ds with a procedural walk cycle.
 *
 * This is the runtime form the rig was designed for — rigid parts on a joint
 * hierarchy, no skinning (see humanoid.ts). `flattenRig` remains for the
 * preview harness and the regression screenshot only.
 *
 * Animation is presentation: it reads the interpolated sim pose (position,
 * facing, speed) and invents everything else. The walk phase accumulates with
 * DISTANCE TRAVELLED, not time — so the feet always match the ground speed
 * and the hero cannot moonwalk, whatever the sim's speed happens to be.
 */

import { Group, Mesh, Object3D, type BufferGeometry, type Material } from "three";
import type { Rig } from "./humanoid";
import type { Mesh as DslMesh } from "../mesh/dsl";

/**
 * DSL→BufferGeometry conversion cache, keyed by the DSL mesh OBJECT.
 *
 * Round 7's perf-gate finding: every spawned foe regenerated and reconverted
 * its whole rig, and the FIRST fight's spawn was the worst frame in the game
 * (~46 ms real, ~180 ms at the gate's 4× throttle — over the 100 ms bar).
 * Rigs are cached per foe kind (rt-view) precisely so spawning N rotlings
 * converts the rotling's parts once — at boot, behind the loading ring — and
 * every later spawn just assembles Object3Ds around shared geometry.
 *
 * Cache-owned geometries are NEVER disposed: they are shared by every live
 * puppet of the kind and outlive any one of them. The memory is a handful of
 * small parametric meshes per kind — the whole point of the pipeline.
 */
const GEO_CACHE = new WeakMap<DslMesh, BufferGeometry>();

/** Convert a rig part's mesh through the shared cache. */
export function partGeometry(mesh: DslMesh): BufferGeometry {
  let geo = GEO_CACHE.get(mesh);
  if (!geo) {
    geo = mesh.toGeometry({ flat: true });
    GEO_CACHE.set(mesh, geo);
  }
  return geo;
}

/** Stride length in metres per full walk cycle (two steps). */
const STRIDE = 1.7;

/** Hero attack swing duration, seconds: wind-up → slash → follow-through. */
const ATTACK_DURATION = 0.42;

/** Cast release thrust duration, seconds: whip forward, then ease home. */
const RELEASE_DURATION = 0.3;

/**
 * Above this speed (m/s) the gait reads as a run: longer stride, more lean.
 * Below the hero's 4.4 m/s top speed on purpose — at 2.6 the run blend never
 * saturated and the full run pose was unreachable in the shipped game.
 */
const RUN_SPEED = 2.2;

/** Hit recoil duration, seconds. */
const HIT_DURATION = 0.32;

/** Secondary-motion spring constants. Stiff enough to settle, loose enough to see. */
const SEC_STIFFNESS = 110;
const SEC_DAMPING = 13;

/** One trailing joint's 2-DOF spring state (pitch about x, roll about z). */
interface Spring {
  x: number;
  vx: number;
  z: number;
  vz: number;
}

function shortestAngle(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

/**
 * External pose overlay, added on top of walk/idle. The roster drives bandit
 * wind-up/slam through this; the hero's own attack uses the internal timer.
 * All values are radian offsets from the layered pose.
 */
export interface PoseOverlay {
  armLX: number;
  armRX: number;
  foreLX: number;
  foreRX: number;
  torsoTwist: number;
}

const ZERO_OVERLAY: PoseOverlay = { armLX: 0, armRX: 0, foreLX: 0, foreRX: 0, torsoTwist: 0 };

export class Puppet {
  readonly group = new Group();
  private joints = new Map<string, Object3D>();
  private rest = new Map<string, [number, number, number]>();
  /** Walk phase in radians; advances with distance, not time. */
  private phase = 0;
  /** Smoothed 0..1 walk blend so gait eases in and out. */
  private gait = 0;
  private idleTime = 0;
  /** Fires when a foot plants — main wires dust puffs to this. */
  onFootfall?: (x: number, z: number) => void;
  private lastStepSign = 1;
  /** Attack timer in seconds; NaN = not attacking. */
  private attackTime = Number.NaN;
  /** Hit-recoil timer in seconds; NaN = not recoiling. */
  private hitTime = Number.NaN;
  /** Cast-charge timer in seconds; NaN = not charging. */
  private chargeTime = Number.NaN;
  /** How long the current charge is expected to hold (the root, seconds). */
  private chargeDuration = 0;
  /** 1 for a single, up toward 2 for a pair — scales the gather. */
  private chargeWeight = 1;
  /** Cast-release timer in seconds; NaN = not releasing. */
  private releaseTime = Number.NaN;
  /** Smoothed roll into turns, radians. */
  private bank = 0;
  private overlay: PoseOverlay = { ...ZERO_OVERLAY };
  /** Joints that trail the body under spring-damper secondary motion. */
  private secondaryNames: string[] = [];
  private springs = new Map<string, Spring>();
  private prevSpeed = 0;
  private prevYaw = 0;
  private hasPrevYaw = false;

  constructor(rig: Rig, material: Material) {
    for (const part of rig.parts) {
      const joint = new Object3D();
      joint.name = part.name;
      joint.position.set(part.offset[0], part.offset[1], part.offset[2]);
      const rest: [number, number, number] = part.rest ?? [0, 0, 0];
      joint.rotation.set(rest[0], rest[1], rest[2]);
      this.rest.set(part.name, rest);

      const mesh = new Mesh(partGeometry(part.mesh), material);
      mesh.castShadow = true;
      joint.add(mesh);

      const parent = part.parent ? this.joints.get(part.parent) : undefined;
      (parent ?? this.group).add(joint);
      this.joints.set(part.name, joint);
    }
    this.basePelvisY = this.joints.get("pelvis")?.position.y ?? 0;
  }

  /**
   * Direct joint access for kind-specific presentation state (R4: the
   * thornback's phase-two crest FLARE scales its named "crest" joint). The
   * animator never touches joints it does not know, so a caller-owned scale
   * on an extra part coexists with every pose above.
   */
  joint(name: string): Object3D | undefined {
    return this.joints.get(name);
  }

  /** Trigger the strike swing. Layered over walk/idle, so mid-run reads fine. */
  attack(): void {
    this.attackTime = 0;
  }

  /** Trigger a hit recoil — the body's answer to taking damage. */
  hit(): void {
    this.hitTime = 0;
  }

  /**
   * Begin the cast CHARGE: the anticipation, played during the sim's root.
   * Arms gather in front, hands rise, a slight hunch — eased in fast, then
   * HELD at full pose until `castRelease()`, so it is robust to tick/frame
   * skew (the release arrives on a sim tick, not a render frame). Before this
   * existed the only cast animation was the melee slash fired at LAUNCH,
   * which put the anticipation after the bolt had already left.
   *
   * @param duration expected root length, seconds — used only as a timeout so
   *                 an interrupted cast (revive, stage reset) cannot hold the
   *                 pose forever
   * @param weight   1 for a single, 2 for a pair — a bigger mix gathers wider
   */
  castCharge(duration: number, weight: number): void {
    this.chargeTime = 0;
    this.chargeDuration = duration;
    this.chargeWeight = weight;
    this.releaseTime = Number.NaN;
    this.attackTime = Number.NaN;
  }

  /** The cast RELEASE: a forward thrust whip, then ease home. */
  castRelease(): void {
    this.releaseTime = 0;
    this.chargeTime = Number.NaN;
  }

  /**
   * The two-phase cast curve. Both arms, symmetric — a caster's gather, not
   * the sword swing. Signs per the rig convention (humanoid.ts): NEGATIVE x
   * brings a limb in FRONT; elbows flex negative to raise the hands.
   */
  private castPose(): { armX: number; foreX: number; hunch: number; drop: number } {
    const w = 0.75 + 0.25 * Math.min(2, this.chargeWeight);
    if (!Number.isNaN(this.chargeTime)) {
      // Interrupted mid-root (a revive, a stage reset) with no release ever
      // arriving: ease home rather than holding the gather forever.
      if (this.chargeTime > this.chargeDuration + 0.5) {
        const k = Math.min(1, (this.chargeTime - this.chargeDuration - 0.5) / 0.25);
        const e = (1 - k) * (1 - k);
        return { armX: -0.75 * w * e, foreX: -1.0 * w * e, hunch: 0.14 * e, drop: 0.06 * e };
      }
      // Gather quickly relative to the root, then hold. Amplitudes are sized
      // for the fixed 3/4 camera, which foreshortens a forward raise — at
      // -0.55 the gather barely read from the shipped angle.
      const k = Math.min(1, this.chargeTime / Math.min(0.18, this.chargeDuration * 0.6 || 0.18));
      const e = k * k * (3 - 2 * k);
      return { armX: -0.75 * w * e, foreX: -1.0 * w * e, hunch: 0.14 * e, drop: 0.06 * e };
    }
    if (!Number.isNaN(this.releaseTime)) {
      const t = this.releaseTime / RELEASE_DURATION;
      if (t >= 1) {
        this.releaseTime = Number.NaN;
        return { armX: 0, foreX: 0, hunch: 0, drop: 0 };
      }
      if (t < 0.35) {
        // The whip: arms punch forward and straighten. Near-linear = violent.
        const k = t / 0.35;
        return {
          armX: -0.75 * w - 0.55 * w * k,
          foreX: -1.0 * w + 0.9 * w * k,
          hunch: 0.14 + 0.1 * k,
          drop: 0.06 * (1 - k),
        };
      }
      // Follow-through: ease home.
      const k = (t - 0.35) / 0.65;
      const e = 1 - (1 - k) * (1 - k);
      return {
        armX: -1.3 * w * (1 - e),
        foreX: -0.1 * w * (1 - e),
        hunch: 0.22 * (1 - e),
        drop: 0,
      };
    }
    return { armX: 0, foreX: 0, hunch: 0, drop: 0 };
  }

  /**
   * Name the joints that trail the body with spring-damper secondary motion —
   * for a sporeling, `["cap"]`.
   *
   * `ART_DIRECTION.md` §5 makes this mandatory rather than decorative: a
   * sporeling whose cap does not lag behind its head looks dead. The spring is
   * driven by the body's own acceleration and turn rate, so it costs nothing
   * but a few numbers per frame and needs no physics engine (`CLAUDE.md` §12).
   */
  setSecondary(names: string[]): void {
    this.secondaryNames = names.filter((n) => this.joints.has(n));
    for (const n of this.secondaryNames) {
      if (!this.springs.has(n)) this.springs.set(n, { x: 0, vx: 0, z: 0, vz: 0 });
    }
  }

  /**
   * Advance the trailing joints one frame.
   *
   * ⚠️ Sign note, because it inverts the limb convention and that is confusing:
   * limbs hang DOWN from their joint, so positive x sends them behind. A cap
   * sits UP from its joint, so for it positive x sends the top FORWARD. Hence
   * a forward acceleration (which should make the cap lag *backwards*) drives
   * the spring NEGATIVE.
   */
  private updateSecondary(dt: number, accel: number, yawRate: number, idle: number): void {
    if (this.secondaryNames.length === 0) return;

    const targetX = Math.max(-0.45, Math.min(0.45, -accel * 0.035)) + Math.sin(idle * 1.4) * 0.02;
    const targetZ = Math.max(-0.45, Math.min(0.45, yawRate * 0.09));

    // Fixed substeps keep the spring stable when a frame runs long.
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 60))));
    const h = dt / steps;
    for (const name of this.secondaryNames) {
      const s = this.springs.get(name)!;
      for (let i = 0; i < steps; i++) {
        s.vx += (-(s.x - targetX) * SEC_STIFFNESS - s.vx * SEC_DAMPING) * h;
        s.vz += (-(s.z - targetZ) * SEC_STIFFNESS - s.vz * SEC_DAMPING) * h;
        s.x += s.vx * h;
        s.z += s.vz * h;
      }
      this.set(name, s.x, 0, s.z);
    }
  }

  /** The hit recoil curve: a sharp snap back, then an eased return. */
  private hitPose(): { pitch: number; drop: number } {
    if (Number.isNaN(this.hitTime)) return { pitch: 0, drop: 0 };
    const t = this.hitTime / HIT_DURATION;
    if (t >= 1) {
      this.hitTime = Number.NaN;
      return { pitch: 0, drop: 0 };
    }
    // Fast out (0.18 of the duration), slow home.
    const k = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
    const e = k * k * (3 - 2 * k); // smoothstep
    // Negative pitch on an upright torso tips it BACKWARD — recoiling away.
    return { pitch: -0.34 * e, drop: 0.05 * e };
  }

  /** External per-frame pose overlay (bandit wind-up/slam). Resets each set. */
  setOverlay(o: Partial<PoseOverlay> | null): void {
    this.overlay = { ...ZERO_OVERLAY, ...(o ?? {}) };
  }

  /**
   * Mount a prop on a joint (a weapon in the right fist, later a shield on
   * the left forearm). Replaces any prop already on that joint. The prop
   * inherits the joint's full animation — the attack slash swings it free.
   */
  attachProp(jointName: string, prop: Object3D, offset: [number, number, number]): void {
    const joint = this.joints.get(jointName);
    if (!joint) return;
    this.detachProp(jointName);
    prop.name = `prop:${jointName}`;
    prop.position.set(offset[0], offset[1], offset[2]);
    joint.add(prop);
  }

  detachProp(jointName: string): void {
    const joint = this.joints.get(jointName);
    const old = joint?.children.find((c) => c.name === `prop:${jointName}`);
    if (old) joint!.remove(old);
  }

  /**
   * The attack curve: fast anticipation back, a whip through the slash, and
   * an eased follow-through home. Piecewise on normalised time.
   *
   * Signs follow the rig convention (see RigPart.rest in humanoid.ts):
   * POSITIVE x carries a limb BEHIND the character, negative brings it in
   * front. So the wind-up is +armRX (arm back) and the slash drives it
   * negative (arm sweeps forward). The torso twist is +y on the wind-up,
   * which pulls the right shoulder back with the arm — the two used to
   * disagree, and the swing read as a backhand.
   */
  private attackPose(): PoseOverlay {
    if (Number.isNaN(this.attackTime)) return ZERO_OVERLAY;
    const t = this.attackTime / ATTACK_DURATION;
    if (t >= 1) {
      this.attackTime = Number.NaN;
      return ZERO_OVERLAY;
    }
    let armRX: number;
    let foreRX: number;
    let twist: number;
    if (t < 0.3) {
      // Wind-up: arm draws back and the elbow cocks, torso counter-twists.
      const k = t / 0.3;
      const e = k * k;
      armRX = 1.1 * e;
      foreRX = -1.2 * e;
      twist = 0.35 * e;
    } else if (t < 0.55) {
      // Slash: whip through. Near-linear = fast and violent.
      const k = (t - 0.3) / 0.25;
      armRX = 1.1 - 2.6 * k;
      foreRX = -1.2 + 1.0 * k;
      twist = 0.35 - 0.8 * k;
    } else {
      // Follow-through: ease home.
      const k = (t - 0.55) / 0.45;
      const e = 1 - (1 - k) * (1 - k);
      armRX = -1.5 * (1 - e);
      foreRX = -0.2 * (1 - e);
      twist = -0.45 * (1 - e);
    }
    return { armLX: 0, armRX, foreLX: 0, foreRX, torsoTwist: twist };
  }

  private set(name: string, rx: number, ry: number, rz: number): void {
    const j = this.joints.get(name);
    const r = this.rest.get(name);
    if (!j || !r) return;
    j.rotation.set(r[0] + rx, r[1] + ry, r[2] + rz);
  }

  /**
   * @param dt     render-frame seconds (presentation smoothing only)
   * @param x/z    interpolated sim position
   * @param groundY terrain height under the hero
   * @param fx/fz  interpolated facing (unit vector)
   * @param speed  sim speed in metres/second
   */
  update(
    dt: number,
    x: number,
    z: number,
    groundY: number,
    fx: number,
    fz: number,
    speed: number,
  ): void {
    this.group.position.set(x, groundY, z);
    // The sim keeps facing as a vector (no trig allowed there); converting to
    // an angle is presentation's job.
    const yaw = Math.atan2(fx, fz);
    this.group.rotation.y = yaw;

    // Body derivatives, for secondary motion and lean. Both are presentation
    // only — the sim never sees them.
    const yawRate = this.hasPrevYaw && dt > 0 ? shortestAngle(yaw - this.prevYaw) / dt : 0;
    const accel = dt > 0 ? (speed - this.prevSpeed) / dt : 0;
    this.prevYaw = yaw;
    this.hasPrevYaw = true;
    this.prevSpeed = speed;

    // Gait blend eases the limbs between idle and walk poses.
    const walking = speed > 0.3 ? 1 : 0;
    this.gait += (walking - this.gait) * Math.min(1, dt * 10);
    // Run blend: above RUN_SPEED the stride opens up and the body leans in.
    const run = Math.max(0, Math.min(1, (speed - RUN_SPEED) / RUN_SPEED));

    // Phase advances with distance: speed [m/s] * dt [s] / stride [m] * 2π.
    this.phase += ((speed * dt) / STRIDE) * Math.PI * 2;
    this.idleTime += dt;

    if (!Number.isNaN(this.attackTime)) this.attackTime += dt;
    if (!Number.isNaN(this.hitTime)) this.hitTime += dt;
    if (!Number.isNaN(this.chargeTime)) this.chargeTime += dt;
    if (!Number.isNaN(this.releaseTime)) this.releaseTime += dt;
    const atk = this.attackPose();
    const rec = this.hitPose();
    const cast = this.castPose();
    const ov = this.overlay;
    // While the right arm is mid-attack, mid-cast or overlaid, its walk swing
    // yields. The cast is symmetric, so it silences both arms.
    const armRBusy = atk.armRX !== 0 || ov.armRX !== 0 || cast.armX !== 0 ? 0 : 1;
    const armLBusy = ov.armLX !== 0 || cast.armX !== 0 ? 0 : 1;

    const g = this.gait;
    const swing = Math.sin(this.phase);
    const swingB = Math.sin(this.phase + Math.PI); // counter-phase

    /* ---- legs: thigh swings, shin bends only on the back-swing ---------- */
    const LEG_AMP = 0.62 * (1 + run * 0.35);
    this.set("thighL", swing * LEG_AMP * g, 0, 0);
    this.set("thighR", swingB * LEG_AMP * g, 0, 0);
    // Knee flexes when that leg is swinging forward (positive half-cycle).
    this.set("shinL", Math.max(0, -swing) * 0.9 * g, 0, 0);
    this.set("shinR", Math.max(0, -swingB) * 0.9 * g, 0, 0);

    /* ---- arms: counter-phase to the legs, elbows trail ------------------ */
    const ARM_AMP = 0.45 * (1 + run * 0.4);
    const idleSway = Math.sin(this.idleTime * 1.6) * 0.03;
    this.set(
      "upperArmL",
      (swingB * ARM_AMP * g + idleSway * (1 - g)) * armLBusy + ov.armLX + cast.armX,
      0,
      0,
    );
    this.set(
      "upperArmR",
      (swing * ARM_AMP * g - idleSway * (1 - g)) * armRBusy + ov.armRX + atk.armRX + cast.armX,
      0,
      0,
    );
    // Elbows flex FORWARD, so the term is negative (rig sign convention).
    // The flex peaks on the arm's forward swing — an arm rotation is negative
    // when it is in front, hence max(0, −swing).
    this.set(
      "foreArmL",
      -(Math.max(0, -swingB) * 0.5 * g + 0.06) * armLBusy + ov.foreLX + cast.foreX,
      0,
      0,
    );
    this.set(
      "foreArmR",
      -(Math.max(0, -swing) * 0.5 * g + 0.06) * armRBusy + ov.foreRX + atk.foreRX + cast.foreX,
      0,
      0,
    );

    /* ---- torso and head: bob, counter-rotation, idle breathing ---------- */
    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * g * (1 + run * 0.5);
    const breathe = Math.sin(this.idleTime * 1.9) * 0.008 * (1 - g);
    const pelvis = this.joints.get("pelvis");
    if (pelvis) pelvis.position.y = this.basePelvisY - bob + breathe - rec.drop - cast.drop;
    // Shoulders counter-rotate against the hips — the detail that makes a
    // procedural walk read as a walk instead of a shuffle. The lean opens up
    // with the run blend; positive x on an upright torso pitches it FORWARD.
    const lean = 0.05 * g + run * 0.22;
    // Banking: the torso rolls into a turn, smoothed so a snap pivot reads as
    // a lean rather than a twitch. On the TORSO joint, not the group — the
    // group's z belongs to RtView's down-fall tip.
    const bankTarget = Math.max(-0.22, Math.min(0.22, -yawRate * 0.045)) * Math.min(1, g + run);
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 7);
    this.set(
      "torso",
      lean + rec.pitch + cast.hunch,
      -swing * 0.1 * g + atk.torsoTwist + ov.torsoTwist,
      this.bank,
    );
    // The head counter-leans so the character keeps looking where it is going
    // rather than at its own feet. During a cast the head dips WITH the
    // hunch (positive x pitches forward), which tips the cap — and its
    // facing blaze — down the fire line: the anticipation itself points.
    this.set(
      "head",
      0.03 * g - run * 0.14 - rec.pitch * 0.5 + cast.hunch * 0.9,
      swing * 0.06 * g,
      0,
    );
    this.set("pelvis", 0, swing * 0.08 * g, swing * 0.03 * g);

    /* ---- secondary motion ----------------------------------------------- */
    // Last, so trailing joints are written on top of the layered pose.
    this.updateSecondary(dt, accel, yawRate, this.idleTime);

    /* ---- footfalls ------------------------------------------------------ */
    // A step plants each time sin(phase) crosses zero while walking.
    const sign = swing >= 0 ? 1 : -1;
    if (g > 0.5 && sign !== this.lastStepSign) {
      this.lastStepSign = sign;
      this.onFootfall?.(x, z);
    }
  }

  /** Pelvis rest height, captured at construction — offsets are rig-specific. */
  private basePelvisY = 0;

  dispose(): void {
    // Geometries are cache-owned and SHARED across every puppet built from
    // the same rig (see `partGeometry`); disposing them here would yank the
    // buffers out from under the kind's other live bodies. The material is
    // per-puppet and stays the caller's to dispose.
  }
}
