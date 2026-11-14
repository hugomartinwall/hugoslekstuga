/**
 * The knobs: one plain table of named numbers.
 *
 * Two halves. TOY is copied from the feel toy, whose motion the owner set
 * by hand; do not retype those numbers from memory, and do not round them.
 * test/knuff/feel-lock.test.ts runs the toy's own simulation beside the
 * game's and fails if they part. GAME is what the game adds (the spec's
 * table, §2.2), and grows a row at a time as the steps are built.
 *
 * One knob, `pace`, gives six others their values (PACE below). A caller
 * may override any knob when a game starts: `createKnuff` takes a partial
 * table and lays it over DEFAULT_TUNE with `mergeTune`.
 */
import type { Tune } from "../sim/types";

/**
 * The toy's tuning sheet as the owner left it after he played: every
 * slider at its default. (Its sixth slider, the cushions the aim line runs
 * through, is not copied: that is the game's own knob now, `aimCushions`.)
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
} as const satisfies Partial<Tune>;

/** The knobs that take their values from `pace`. */
export type PaceGiven = Pick<Tune, "pipRefillTicks" | "paceRoom" | "paceEvery" | "paceLastCall" | "paceLastCallFirst" | "paceTokens">;

/**
 * What each pace gives (§3.4). 1: the timetable as written; the five pace
 * numbers are not used there. 2: the full room. 3: the full room with one
 * more loose token on every extra bunch. A `pace` that is none of the
 * three is read as 1. Last call is tick 1,020 of the hour (decision 23; the
 * spec started it at 840): inside both its floors of §3.4, it keeps the
 * Ordinary and the Expert who take a charm off the edges of their rows.
 * An extra bunch carries four loose tokens at pace 2 and five at pace 3 (the
 * spec started them at two and three): with the thump turning tokens away
 * (decision 22, "only together with more tokens", §2.2) the Ordinary lived
 * to the end of 05:00 in 42% of its nights, and `paceTokens`, the first lever
 * of §3.4's dial, brought every row but the two the lead accepted back in.
 */
export const PACE: Readonly<Record<1 | 2 | 3, PaceGiven>> = {
  1: { pipRefillTicks: 120, paceRoom: 6, paceEvery: 228, paceLastCall: 1020, paceLastCallFirst: 456, paceTokens: 4 },
  2: { pipRefillTicks: 96, paceRoom: 6, paceEvery: 228, paceLastCall: 1020, paceLastCallFirst: 456, paceTokens: 4 },
  3: { pipRefillTicks: 96, paceRoom: 6, paceEvery: 228, paceLastCall: 1020, paceLastCallFirst: 456, paceTokens: 5 },
};

/** The values `pace` gives. */
export function paceGives(pace: number): PaceGiven {
  return pace === 2 || pace === 3 ? PACE[pace] : PACE[1];
}

/** The pace the night starts at. */
const START_PACE = 2;

/** What the game adds: the spec's table of knobs, as far as the build has reached. */
export const GAME = {
  // Launch and pips.
  lineShowsPx: 12,
  noShotPx: 24,
  minPower: 0.5,
  aimCushions: 1,
  pipMax: 3,
  pipRefundPop: 2,
  gumStopMinPips: 1,

  // Hot and landing.
  popHotTicks: 0,
  thumpRadius: 40,
  dazeTicks: 36,
  arriveDazedWithin: 60,
  // On (decision 22, the lever §14 keeps "if tokens feel unfair in the
  // hand"): driven by hand, every token heart came 0 to 11 ticks after a
  // landing, too soon to see. The thump now turns tokens within its reach.
  thumpTurnsTokens: true,

  // Hearts.
  hearts: 3,
  invulnTicks: 72,
  hitWaveRadius: 90,
  hitWaveSpeed: 260,

  // Slow motion.
  slowMeterMax: 16,
  slowRefillTicks: 9,
  slowLandingFloor: 8,

  // The night.
  hourMaxTicks: 1800,
  offerLatestTick: 1320,
  hourPauseTicks: 180,
  telegraphTicks: 36,
  arriveMinDist: 150,
  roomCap: 24,
  pace: START_PACE,
  ...PACE[START_PACE],

  // Intruders.
  bunnySpeed: 22,
  bunnyWobble: 0.6,
  bunnyWobbleRate: 0.07,
  tokenSpeed: 150,
  batterySpeed: 14,
  batteryFuseTicks: 300,
  batteryKnockKeep: 0.9,
  batteryKnockTicks: 48,
  blastRadius: 70,
  blastChainTicks: 12,
  envelopeSpeed: 60,
  envelopeTurnDeg: 0.5,
  envelopeMass: 0.2,
  bagSpeed: 10,
  bagHits: 8,
  bagTokenEvery: 2,
  bagTokenLife: 480,
  heartLife: 480,

  // Score.
  chainCap: 8,
  carryMax: 3,
  cushionCap: 3,
  cushionMergeTicks: 9,
  vBonus: 100,

  // Charms and offers.
  offerArmTicks: 60,
  pickupMinDist: 80,
  bumperSpeed: 0.8,
  pipPlateCooldown: 240,
  sparkTicks: 48,
  sparkReach: 12,
  bellDazeTicks: 36,
  bellCooldown: 240,
  coinFactor: 2,
  capBumper: 2,
  capPip: 2,
  capSpark: 2,
  capBell: 1,
  capCoin: 2,
  heavyFactor: 0.7,
  longBurnHotFrac: 0.27,
  wideRadius: 2,
  wideFactor: 0.85,

  // The boss: the floor polisher. Its speed was 70 in the spec's table (a
  // draft value); at 70 the Expert won its fights in a median of 1,162 and
  // 1,177 ticks on two samples of 200, under the 1,200 the step-3 check
  // asks for, and at 90 in 1,245 and 1,301, winning all of them.
  bossSpeed: 90,
  bossHits: 6,
  bossStallTicks: 60,
  bossSpeedUp: 1.12,
  bossLaneStallTicks: 48,
  bossNoHitTicks: 1500,
  bossTrickleTicks: 240,
  bossCough: 3,
  plugWidth: 24,
  padThrowSpeed: 450,
  // Decision 3 (the pad hurts him hot or landed) as a switch, turned over
  // by decision 21: with real hands the polisher was beaten in 6 of 18
  // fights, the pad taking hearts from launches whose line had looked safe.
  // Off, the pad still throws him hot or landed; hot, it takes no heart.
  padHurtsHot: false,
  bossMaxTicks: 5400,
  nightBonus: 1000,
  heartBonus: 250,
} as const satisfies Partial<Tune>;

export const DEFAULT_TUNE: Tune = { ...TOY, ...GAME };

/**
 * Lay a partial table over a whole one. A knob the table does not have,
 * or one of the wrong kind (a word where a number belongs), is left out:
 * the override may have been typed by hand into a link. A value of the
 * right kind is taken as it is, sensible or not.
 *
 * `pace` is the one knob that sets others. An override that names it deals
 * that pace's six values again; any of the six that the same override
 * names keeps the value it was given there, so each can be turned alone.
 * An override that does not name `pace` leaves the six as they stand. So
 * whoever keeps a table over several changes (a link, then a key on the
 * screen) lays ALL the named knobs over DEFAULT_TUNE each time, not the
 * newest change over the table in use: a pip timer named in the link then
 * outlives a change of pace, as the spec asks.
 */
export function mergeTune(base: Tune, over: Partial<Tune> | null | undefined): Tune {
  const out: Tune = { ...base };
  if (!over) return out;
  const target = out as Record<string, unknown>;
  const known = base as Record<string, unknown>;
  const named = new Set<string>();
  for (const [key, value] of Object.entries(over)) {
    // The table's own knobs only: `in` would also answer yes for what
    // every object inherits, and a table typed by hand could then swap
    // the merged table's prototype for one of its own.
    if (!Object.prototype.hasOwnProperty.call(known, key)) continue;
    if (typeof value !== typeof known[key]) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (key === "pullDir" && value !== "back" && value !== "push") continue;
    target[key] = value;
    named.add(key);
  }
  if (named.has("pace")) {
    for (const [key, value] of Object.entries(paceGives(out.pace))) {
      if (!named.has(key)) target[key] = value;
    }
  }
  return out;
}
