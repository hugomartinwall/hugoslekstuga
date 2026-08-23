/**
 * The resaturation drive (R1) — the Greyrot's central promise, made a felt
 * thing.
 *
 * `GAME_DESIGN.md` §1 sells the threat as *loss of colour* and the reward as
 * colour coming back, and `post.ts` has carried a saturation uniform for that
 * purpose since M0 — but nothing ever drove it: the uniform sat at the
 * authored 1.15 forever, and fun's baseline verdict ruled the mechanic
 * unshipped ("undetectable across multiple gate crossings; zone palettes
 * swamp it"). This class is the missing driver.
 *
 * Three beats, all read from sim state and events — presentation only, never
 * a wall clock the sim can see, correct on a replay:
 *
 * 1. **The drain.** While a fight lock is up, the world's saturation eases
 *    down to `RESAT.drained` — the rot pressing in around the fight the
 *    player just walked into. Slow on purpose: a press, not a flash. The
 *    floor is far above `ROT_SATURATION`, because the status/FX colour
 *    vocabulary (§6) must stay identifiable mid-fight.
 * 2. **The restoration wave.** The fight is won (`markersCleared`): a round
 *    front sweeps out from the LAST KILL, restoring full saturation inside
 *    and carrying a warm band of `FX.colourRestored` at its edge — colour
 *    visibly arriving from the place the player earned it. The drained base
 *    HOLDS until the front has passed; the wave is the restoration.
 * 3. **The stage-clear pulse.** At the gate (`stageCleared` — the same tick
 *    the toast slides and `happytime` fires, so sound + colour + text land
 *    as one beat): a warm overshoot breath above the resting grade, plus a
 *    bloom lift, plus a warm-band-only wave from the hero — celebration, not
 *    restoration, so the two beats never read alike.
 *
 * Juice law (§11): a stage clear and a fight clear are the player's
 * SUCCESSES — spectacle is legal here. Casting stays untouched.
 */

import { FX, GRADE, RESAT } from "../art";
import { DEFAULT_GRADE, type PostStack } from "./post";
import { srgbToLinear } from "../mesh/dsl";
import type { RtState } from "../../sim/rt/state";
import type { RtEvents } from "../../sim/rt/step";
import { reducedMotion } from "../motion";

/**
 * Wave radius at t=1, aspect-corrected UV units. Sized so the front spends
 * the WHOLE of `waveSeconds` on screen: centre-to-corner is ~1.15 from a
 * mid-frame origin, so 1.35 clears the frame just as the front fades. The
 * first cut used 2.1 "to be safe" and the sweep crossed the visible frame in
 * the first 40% of its life, then travelled invisibly — measured off the
 * capture sequence, not guessed.
 */
const WAVE_MAX_R = 1.35;

/** The warm band's colour, converted once at this boundary like every other. */
const WARM: [number, number, number] = [
  srgbToLinear(FX.colourRestored[0]),
  srgbToLinear(FX.colourRestored[1]),
  srgbToLinear(FX.colourRestored[2]),
];

interface Wave {
  /** Centre in UV (0..1, y up). */
  u: number;
  v: number;
  /** 0..1 progress across `RESAT.waveSeconds`. */
  t: number;
  /** Celebration front: warm band only, no saturation step inside. */
  warmOnly: boolean;
}

export class Resaturation {
  /** The displayed base saturation, eased per frame. */
  private sat = GRADE.saturation;
  private wave: Wave | null = null;
  /** Stage-clear overshoot envelope, 1 → 0. */
  private pulse = 0;
  /** Where the last foe died — the wave's origin. */
  private lastDeath: { x: number; z: number } | null = null;

  /**
   * @param post    the stack whose grade this owns at runtime
   * @param project world point → UV (0..1, y up), or null when off-frame /
   *                before the first camera update. One frame stale at event
   *                time, same as every other event-anchored projection in
   *                main — invisible on a 1.1 s front.
   */
  constructor(
    private post: PostStack,
    private project: (x: number, z: number) => { u: number; v: number } | null,
  ) {}

  /** Ingest one tick's events. Called from the same seam as RtEventFx. */
  onEvents(ev: RtEvents, s: RtState): void {
    if (ev.deaths.length > 0) this.lastDeath = ev.deaths[ev.deaths.length - 1]!;

    // A fight won: the restoration front, from the last kill. If several
    // markers clear on one tick (scripted clears), one wave carries them all.
    if (ev.markersCleared.length > 0) {
      const at = this.lastDeath ?? { x: s.hero.x, z: s.hero.z };
      const uv = this.project(at.x, at.z) ?? { u: 0.5, v: 0.5 };
      // Reduced motion keeps the MEANING and drops the MOVEMENT: colour still
      // comes back — the base saturation eases up on its own below, which is
      // the whole promise — but no front sweeps across the frame to deliver
      // it. Killing the resaturation outright would remove the game's primary
      // feedback, not just an ornament.
      if (!reducedMotion()) this.wave = { u: uv.u, v: uv.v, t: 0, warmOnly: false };
    }

    // The gate: celebration. The hero IS at the gate when this fires, so the
    // hero anchors the front.
    if (ev.stageCleared >= 0) {
      this.pulse = 1;
      // Never displace a live restoration front — the celebration band can
      // ride the pulse alone in that (rare, scripted) overlap.
      if (!this.wave) {
        const uv = this.project(s.hero.x, s.hero.z) ?? { u: 0.5, v: 0.5 };
        if (!reducedMotion()) this.wave = { u: uv.u, v: uv.v, t: 0, warmOnly: true };
      }
    }
  }

  /** Advance and write the grade. Call once per rendered frame. */
  update(dt: number, s: RtState): void {
    const full = GRADE.saturation;
    const drained = s.lock !== null && s.foes.length > 0;

    // While a restoration wave is live the base HOLDS — the front is the
    // restoration, and easing the base underneath it would dissolve the very
    // contrast the wave exists to reveal.
    const holdForWave = this.wave !== null && !this.wave.warmOnly;
    const target = drained ? RESAT.drained : full;
    if (!holdForWave) {
      this.sat += (target - this.sat) * (1 - Math.exp((-3 / RESAT.drainSeconds) * dt));
    }

    // The pulse breathes out with an eased tail.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt / RESAT.pulseSeconds);
    const env = this.pulse * this.pulse;

    const effective = this.sat + (RESAT.overshoot - full) * env;
    this.post.setGrade({
      saturation: effective,
      bloomStrength: DEFAULT_GRADE.bloomStrength + RESAT.pulseBloom * env,
    });

    if (this.wave) {
      this.wave.t += dt / RESAT.waveSeconds;
      if (this.wave.t >= 1) {
        // The front has passed: what it revealed becomes the base.
        if (!this.wave.warmOnly && !drained) this.sat = full;
        this.wave = null;
        this.post.setWave(0.5, 0.5, 0, RESAT.waveWidth, full, 0, WARM);
      } else {
        // A fight starting mid-wave reclaims the frame: drop the front, let
        // the drain ease take over — rot beats ceremony.
        if (drained && !this.wave.warmOnly) {
          this.wave = null;
          this.post.setWave(0.5, 0.5, 0, RESAT.waveWidth, full, 0, WARM);
        } else {
          const t = this.wave.t;
          const r = WAVE_MAX_R * (1 - (1 - t) * (1 - t)); // ease-out front
          const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1; // band bows out
          this.post.setWave(
            this.wave.u,
            this.wave.v,
            r,
            RESAT.waveWidth,
            this.wave.warmOnly ? effective : full,
            RESAT.waveWarm * fade,
            WARM,
          );
        }
      }
    }
  }
}
