/**
 * The knobs: one plain table of named numbers.
 *
 * Two halves. TOY is copied from the feel toy, whose motion the owner set
 * by hand; do not retype those numbers from memory, and do not round them.
 * test/knuff/feel-lock.test.ts runs the toy's own simulation beside the
 * game's and fails if they part. GAME is what the game adds, and grows a
 * row at a time as the steps are built.
 *
 * A caller may override any knob when a game starts: `createKnuff` takes a
 * partial table and lays it over DEFAULT_TUNE with `mergeTune`.
 */
import type { Tune } from "../sim/types";

/**
 * The toy's tuning sheet as the owner left it after he played: every
 * slider at its default. One thing was decided after that: the aim line
 * runs through ONE cushion, not the sheet's two (with two he never missed).
 */
export const TOY_SETTINGS = {
  /** Launch speed at a full pull, u/s. */
  power: 900,
  /** Pull length for full power, CSS px. */
  pull: 100,
  /** Room speed while aiming, percent. */
  slow: 20,
  /** 0 stops quickly, 100 glides far. */
  glide: 50,
  dir: "back",
  bounces: 1,
} as const;

/** The toy's glide slider as drag per second, the way its shell works it out. */
function dragFromGlide(glide: number): number {
  return 2.4 * Math.pow(0.45 / 2.4, glide / 100);
}

/** Copied from the feel toy. */
export const TOY = {
  // What the toy's shell hands its simulation (`tuneFrom(settings)`).
  maxSpeed: TOY_SETTINGS.power,
  dragK: dragFromGlide(TOY_SETTINGS.glide),
  friction: 140,
  hotFrac: 0.33,
  restSpeed: 14,
  wallRestitution: 0.84,
  bodyRestitution: 0.6,
  popImpulseScale: 0.55,

  // Constants of the toy's simulation.
  himRadius: 13,
  maxSubstepTravel: 6,
  maxSubsteps: 10,
  lightMass: 0.35,
  lightDragK: 2.4,
  lightFriction: 50,
  lightRestSpeed: 6,
  lightWallRestitution: 0.55,

  // The pull, from the sheet.
  pullFullPx: TOY_SETTINGS.pull,
  slowShare: TOY_SETTINGS.slow / 100,
  pullDir: TOY_SETTINGS.dir,
  aimCushions: TOY_SETTINGS.bounces,

  // The toy's shortest shot: 35% power from a 12 px pull. The game's is
  // 50% from 24 px; step 1 ("the minimum launch") moves these two to GAME
  // with those values.
  noShotPx: 12,
  minPower: 0.35,

  // Step 0 only: the toy's dummies. They go when the night arrives.
  dummyCount: 6,
  dummyRespawnTicks: 80,
} as const satisfies Partial<Tune>;

/** What the game adds. */
export const GAME = {
  lineShowsPx: 12,
} as const satisfies Partial<Tune>;

export const DEFAULT_TUNE: Tune = { ...TOY, ...GAME };

/**
 * Lay a partial table over a whole one. A knob the table does not have,
 * or one of the wrong kind (a word where a number belongs), is left out:
 * the override may have been typed by hand into a link.
 */
export function mergeTune(base: Tune, over: Partial<Tune> | null | undefined): Tune {
  const out: Tune = { ...base };
  if (!over) return out;
  const target = out as Record<string, unknown>;
  const known = base as Record<string, unknown>;
  for (const [key, value] of Object.entries(over)) {
    if (!(key in known)) continue;
    if (typeof value !== typeof known[key]) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (key === "pullDir" && value !== "back" && value !== "push") continue;
    target[key] = value;
  }
  return out;
}
