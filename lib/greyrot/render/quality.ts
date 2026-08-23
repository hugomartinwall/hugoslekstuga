/**
 * Quality tiers (CLAUDE.md §5).
 *
 * The hardware floor is a 4 GB Chromebook, and CrazyGames *disables* games on
 * Chromium OS that don't run smoothly — so this is a gate, not a preference
 * panel. Every renderer subsystem reads its budget from here rather than
 * hard-coding a number.
 *
 * Selection is a timing probe during load, then one-way adaptive degradation.
 * It never steps back up on its own: oscillating between tiers looks far worse
 * than sitting on a low one.
 */

export type Tier = "low" | "medium" | "high";

export interface QualitySettings {
  tier: Tier;
  /** Multiplier on devicePixelRatio. The single biggest fill-rate lever. */
  renderScale: number;
  /** 0 = blob shadows only. */
  shadowMapSize: number;
  shadowCascades: number;
  bloom: boolean;
  bloomMips: number;
  /** Instanced scatter budget (grass, rocks, trees). */
  foliage: number;
  particles: number;
  /** Far plane for traversal. Low tier hides the short draw with heavy fog. */
  viewDistance: number;
  fogNear: number;
  water: "flat" | "animated";
  /** Surface-detail noise octaves (terrain/scatter/water). 1 on Low. */
  detailOctaves: 1 | 2;
  /** Grass vertex sway. Off on Low — vertex ALU is the floor's budget. */
  grassWind: boolean;
}

export const TIERS: Record<Tier, QualitySettings> = {
  high: {
    tier: "high",
    renderScale: 1,
    shadowMapSize: 2048,
    shadowCascades: 2,
    bloom: true,
    bloomMips: 3,
    foliage: 4000,
    particles: 8000,
    viewDistance: 140,
    fogNear: 55,
    water: "animated",
    detailOctaves: 2,
    grassWind: true,
  },
  medium: {
    tier: "medium",
    renderScale: 0.75,
    shadowMapSize: 1024,
    shadowCascades: 1,
    bloom: true,
    bloomMips: 2,
    foliage: 1500,
    particles: 3000,
    viewDistance: 95,
    fogNear: 32,
    water: "animated",
    detailOctaves: 2,
    grassWind: true,
  },
  low: {
    tier: "low",
    renderScale: 0.5,
    shadowMapSize: 0,
    shadowCascades: 0,
    bloom: false,
    bloomMips: 0,
    foliage: 400,
    particles: 1000,
    viewDistance: 60,
    fogNear: 16,
    water: "flat",
    detailOctaves: 1,
    grassWind: false,
  },
};

/** 60 fps leaves no headroom on a Chromebook; 50 is the bar we hold. */
const FRAME_BUDGET_MS = 20;
const DEGRADE_AFTER_BAD_FRAMES = 60;

export class Quality {
  private current: QualitySettings;
  private badFrames = 0;
  private locked = false;
  private listeners: Array<(q: QualitySettings) => void> = [];

  constructor(initial: Tier = "medium") {
    this.current = TIERS[initial];
  }

  get settings(): QualitySettings {
    return this.current;
  }

  /** Effective pixel ratio, combining the tier scale with a dpr cap. */
  pixelRatio(): number {
    return Math.min(devicePixelRatio, 2) * this.current.renderScale;
  }

  onChange(fn: (q: QualitySettings) => void): void {
    this.listeners.push(fn);
  }

  /** Manual override from the settings menu. Stops adaptive degradation. */
  set(tier: Tier, lock = true): void {
    this.locked = lock;
    if (this.current.tier === tier) return;
    this.current = TIERS[tier];
    this.badFrames = 0;
    for (const fn of this.listeners) fn(this.current);
  }

  /**
   * Feed every frame. Steps down one tier after a sustained run of slow
   * frames. Deliberately one-way — see the note at the top of the file.
   */
  sample(frameMs: number): void {
    if (this.locked) return;
    if (frameMs > FRAME_BUDGET_MS) {
      this.badFrames++;
      if (this.badFrames >= DEGRADE_AFTER_BAD_FRAMES) {
        this.badFrames = 0;
        const next: Record<Tier, Tier> = { high: "medium", medium: "low", low: "low" };
        const target = next[this.current.tier];
        if (target !== this.current.tier) {
          console.info(`[quality] degrading ${this.current.tier} → ${target}`);
          this.current = TIERS[target];
          for (const fn of this.listeners) fn(this.current);
        }
      }
    } else {
      // Require a *sustained* run of bad frames; one hitch is not a verdict.
      this.badFrames = Math.max(0, this.badFrames - 2);
    }
  }
}

/**
 * Hard ceiling on how long the probe may take, in milliseconds.
 *
 * The probe drives itself with `requestAnimationFrame`, which browsers do not
 * fire at all while a document is hidden — and a CrazyGames game loads inside
 * an iframe that can perfectly well be scrolled out of view or in a background
 * tab while it boots. Without a deadline the probe never resolves, `boot()`
 * never finishes, and the game hangs forever on its loading ring having
 * rendered exactly one frame. Found by loading the sandbox in a hidden tab,
 * where it reproduced every time.
 */
const PROBE_DEADLINE_MS = 2500;

/**
 * Pick a starting tier by timing the real shader stack during load.
 *
 * `drawProbeFrame` must render something representative — a device that copes
 * with an empty scene tells us nothing. Returns as soon as it has a stable
 * median, so it costs a fraction of a second.
 *
 * **Never blocks boot.** If the frame callbacks dry up — a hidden document, a
 * throttled background tab — the probe gives up at `PROBE_DEADLINE_MS` and
 * returns whatever it learned, or `medium` if it learned nothing. Medium is
 * the right default to fall back to rather than `low`: the runtime degrades
 * downward on sustained bad frames (§5) but deliberately never steps back up,
 * so guessing low would strand a capable machine on the worst tier for the
 * whole session, while guessing medium self-corrects within seconds of the
 * game actually becoming visible.
 */
export async function probeTier(drawProbeFrame: () => void): Promise<Tier> {
  const WARMUP = 5; // first frames include shader compilation
  const SAMPLES = 20;
  const times: number[] = [];
  let timedOut = false;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      finish();
    }, PROBE_DEADLINE_MS);

    let n = 0;
    let last = performance.now();
    const step = (): void => {
      if (done) return;
      drawProbeFrame();
      const now = performance.now();
      if (n >= WARMUP) times.push(now - last);
      last = now;
      n++;
      if (n < WARMUP + SAMPLES) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  });

  if (times.length === 0) {
    console.info(`[quality] probe got no frames (hidden document?) → medium`);
    return "medium";
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;

  // The probe runs at the medium preset. Thresholds are generous because a
  // loading screen competes with asset decoding for the main thread.
  const tier: Tier = median < 11 ? "high" : median < 24 ? "medium" : "low";
  console.info(
    `[quality] probe median ${median.toFixed(1)} ms over ${times.length} frames` +
      `${timedOut ? " (deadline hit)" : ""} → ${tier}`,
  );
  return tier;
}
