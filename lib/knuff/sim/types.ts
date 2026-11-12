/**
 * Knuff — the simulation's types.
 *
 * The State is plain data: numbers, booleans, strings, and lists and
 * objects of them. No class, no function, no Map, no undefined, no
 * Infinity (-1 means "never"). So one generic walk can copy it, fingerprint
 * it and store it as JSON (see state.ts).
 *
 * Step 1 holds the first two minutes: him, dust bunnies and tokens, hearts,
 * pips, the slow-motion meter, the hour clock and the score. Plates,
 * charms, the offer, the boss and the later kinds join in the steps that
 * build them, under the names the spec gives them.
 */
import type { BuiltKind } from "../content/kinds";

/** Every number a hand might want to change. One flat table; content/tune.ts fills it. */
export type Tune = {
  // ── Copied from the feel toy: how he moves ──────────────────────────
  /** Launch speed at full power, u/s. */
  maxSpeed: number;
  /** Exponential drag on him, 1/s. */
  dragK: number;
  /** Constant deceleration on him, u/s². */
  friction: number;
  /** Share of launch speed at or above which he is the weapon ("hot"). */
  hotFrac: number;
  /** Below this speed the toy's slowing stops him, u/s. In the game that is a landing. */
  restSpeed: number;
  wallRestitution: number;
  bodyRestitution: number;
  /** Share of the collision impulse he feels when the thing he hit pops. */
  popImpulseScale: number;
  /** His radius, u. */
  himRadius: number;
  /** A substep never moves a body further than this, u, so nothing tunnels. */
  maxSubstepTravel: number;
  maxSubsteps: number;
  /** Mass of a dust bunny and of a token. His mass is 1. */
  lightMass: number;
  /** How a shoved light thing slows: drag, friction and its rest speed. */
  lightDragK: number;
  lightFriction: number;
  lightRestSpeed: number;
  lightWallRestitution: number;

  // ── Copied from the feel toy: the pull ──────────────────────────────
  /** Pull length for full power, CSS px. */
  pullFullPx: number;
  /** Room speed while a pull is held, as a share of normal speed. */
  slowShare: number;
  /** Pull back to launch away from the pull, or push to launch along it. */
  pullDir: "back" | "push";

  // ── The game's own: launch and pips ─────────────────────────────────
  /** A touch becomes a pull when it has moved this far, CSS px. The band and the aim line start then. */
  lineShowsPx: number;
  /** A pull released shorter than this is no shot, CSS px. */
  noShotPx: number;
  /** Power at `noShotPx`, as a share of launch speed. No launch is softer. */
  minPower: number;
  /** Cushions the aim line runs through. It stops at the next one. Drawing only. */
  aimCushions: number;
  /** Launches in hand. */
  pipMax: number;
  /** One pip comes back this often while he is below the maximum, ticks. Given by `pace`. */
  pipRefillTicks: number;
  /** The body pop of a launch that gives one pip back, once. 0 means never. */
  pipRefundPop: number;

  // ── Hot and landing ─────────────────────────────────────────────────
  /** After a pop he stays hot this many ticks whatever his speed. 0: only speed counts. */
  popHotTicks: number;
  /** A landing dazes dust bunnies whose centre is this close to his, u. */
  thumpRadius: number;
  /** How long a thump or a close arrival dazes, ticks. */
  dazeTicks: number;
  /** An arrival that lands this close to him lands dazed, u. */
  arriveDazedWithin: number;
  /** The thump also turns tokens inside its ring to roll straight away. */
  thumpTurnsTokens: boolean;

  // ── Hearts ──────────────────────────────────────────────────────────
  hearts: number;
  /** Nothing can cost a heart for this long after one is lost, ticks. */
  invulnTicks: number;
  /** Reach of the wave a lost heart sends out, u. */
  hitWaveRadius: number;
  /** Speed the wave gives a dust bunny, u/s. */
  hitWaveSpeed: number;

  // ── Slow motion ─────────────────────────────────────────────────────
  /** Size of the slow-motion meter, in slowed ticks. */
  slowMeterMax: number;
  /** One slowed tick comes back per this many ticks while no pull is held. */
  slowRefillTicks: number;
  /** A landing tops the meter up to at least this. */
  slowLandingFloor: number;

  // ── The night ───────────────────────────────────────────────────────
  /** An hour never lasts longer, ticks. */
  hourMaxTicks: number;
  /** An hour not clear by this tick gets its offer then. */
  offerLatestTick: number;
  /** Gap between an hour being clear and settled, and the next hour, ticks. */
  hourPauseTicks: number;
  /** Every arrival is announced this long before it lands, ticks. */
  telegraphTicks: number;
  /** An arrival's spot is at least this far from him when it is announced, u. */
  arriveMinDist: number;
  /** Never more than this many intruders alive or announced. */
  roomCap: number;
  /** How the timetable is dealt: 1 as written, 2 the full room, 3 the full room with more tokens. */
  pace: number;
  /** A row is called early when no more than this many intruders that count for clear are left. Given by `pace`. */
  paceRoom: number;
  /** No row waits longer than this after the row before it was announced, ticks. Given by `pace`. */
  paceEvery: number;
  /** Extra bunches are dealt until this tick of the hour, and no hour is clear before it. Given by `pace`. */
  paceLastCall: number;
  /** The same for 19:00 alone. Given by `pace`. */
  paceLastCallFirst: number;
  /** Loose tokens on an extra bunch from 20:00 to 23:00; two fewer from 00:00 on. Given by `pace`. */
  paceTokens: number;

  // ── Intruders ───────────────────────────────────────────────────────
  /** A dust bunny's walk toward him, u/s. */
  bunnySpeed: number;
  /** How far its heading swings each way, rad. */
  bunnyWobble: number;
  /** How fast the swing runs, rad per tick. */
  bunnyWobbleRate: number;
  /** A token's roll, u/s. */
  tokenSpeed: number;

  // ── Score ───────────────────────────────────────────────────────────
  /** Largest chain multiplier. */
  chainCap: number;
  /** Most steps a chain can be carried into the next launch. */
  carryMax: number;
  /** Largest cushion multiplier. */
  cushionCap: number;
  /** A cushion touched within this long of the last one does not count again, ticks. */
  cushionMergeTicks: number;
};

export type Room = { left: number; top: number; right: number; bottom: number };

export type Him = {
  /** Centre. */
  x: number;
  y: number;
  /** Where he was one tick ago: the renderer draws between the two. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** He is flying: a weapon. When this is false he is landed: at rest, and a target. */
  hot: boolean;
  /** The tick of his last pop, for `popHotTicks`; -1 = never. */
  lastContactTick: number;
  /** Nothing can cost a heart while `tick` is under this. 0 = not invulnerable. */
  invulnUntil: number;
};

/**
 * A thing in the room: a dust bunny or a token. Everything in `things` is
 * alive (a popped thing is gone by the end of its tick); it is announced
 * until `landTick` and landed from then on.
 */
export type Thing = {
  id: number;
  kind: BuiltKind;
  x: number;
  y: number;
  px: number;
  py: number;
  /** A token: its roll. A dust bunny: a shove on top of its walk, which dies away. */
  vx: number;
  vy: number;
  /** A dust bunny's walk this tick. Zero for a token, and while dazed or announced. */
  wx: number;
  wy: number;
  /** Hits left. */
  hp: number;
  /** The tick it lands; it is announced until then. -1: it was in the room before the night began (the rack). */
  landTick: number;
  /** It is dazed while `tick` is under this: it stands still and cannot cost a heart. 0 = never dazed. */
  dazedUntil: number;
  /** A dust bunny's wobble phase, rad. 0 for a token. */
  phase: number;
};

/** The launch in progress, or the last one. */
export type LaunchState = {
  /** Counts launches from 1. 0: there has been none. */
  id: number;
  startTick: number;
  /** In flight. A landing, the next release and the end of the night close it. */
  active: boolean;
  /** Steps the chain was carried in from the launch before (§7). */
  carry: number;
  /** Pops so far, and those made by his body (in step 1 every pop is one). */
  pops: number;
  bodyPops: number;
  /** It has given its pip back. */
  refunded: boolean;
  /** Cushions that count for the score: one touched within `cushionMergeTicks` of the last is not counted again. */
  cushions: number;
  /** The last cushion touched in this launch, counted or not; -1 = none yet. */
  lastCushionTick: number;
  /** This launch's total. */
  points: number;
  /** Things he overlapped at the release: this launch cannot pop one until he has left it. */
  blocked: number[];
  /** Did it pop anything (for the next launch's carry). */
  popped: boolean;
};

export type NightState = {
  /** 0 is 19:00, 10 is 05:00; 11 once 05:00 has ended. */
  hour: number;
  /** The tick the hour began. */
  hourStart: number;
  /** The kinds this night's rows may bring. A kind not listed is left out of the rows. */
  kinds: string[];
  /** The next of the hour's rows to announce, counted among the rows that are dealt. */
  nextRow: number;
  /** The pace: the tick the hour's last row or extra bunch was announced; -1 = none yet this hour. */
  rowTick: number;
  /** The tick that row lands; -1 = none yet this hour. */
  rowLandTick: number;
  /** Ids [holdFrom, holdTo) of what a "first" row announced, while it is the row before; -1 and -1 = no hold. */
  holdFrom: number;
  holdTo: number;
  /** -1 until the hour is clear. */
  clearTick: number;
  /** -1 until the offer opened, or would have. */
  offerTick: number;
  /** -1 until the offer is settled. Until there are charms, that is the tick it would have opened. */
  settledTick: number;
};

export type State = {
  v: 1;
  seed: number;
  /** Ticks since the first launch. */
  tick: number;
  /** For real time: normal / 60 + slowed / (60 × the slow share). */
  normalTicks: number;
  slowedTicks: number;
  /** "boss" is the polisher's hour; nothing sets it before the boss is built. */
  phase: "waiting" | "night" | "boss" | "over";
  /** How the night ended. "dawn" is the lights coming on at 06:00; nothing sets it before the boss is built. */
  ended: "" | "hearts" | "morning" | "dawn";
  /** mulberry32 states, one per stream (rng.ts). The only source of randomness. */
  rng: { arrivals: number; offers: number; behaviour: number };
  /** The four edges of the floor he moves on. Read from here, never as constants. */
  room: Room;
  him: Him;
  hearts: number;
  pips: number;
  /** Ticks until the next pip. It runs only while he is below the maximum. */
  pipTimer: number;
  /** The slow-motion meter, in slowed ticks, and the count toward its next refill. */
  slow: { meter: number; refill: number };
  launch: LaunchState;
  things: Thing[];
  nextId: number;
  night: NightState;
  score: number;
  /** The largest total one launch has made. */
  bestShot: number;
  /** The kind that took the last heart; "" = none. */
  lastHurtBy: string;
  /** The hour it was taken in; -1 = none. */
  lastHurtHour: number;
};

/** One release: a direction (it need not be unit length) and a power, `minPower` to 1. */
export type Launch = { dx: number; dy: number; power: number };

/** The aim never enters the simulation. Only a release does. */
export type Input = { launch: Launch | null; pullHeld: boolean };

export type Side = "left" | "right" | "top" | "bottom";

/**
 * What a tick did. `step` writes these into the list its caller hands it,
 * in the order they happened; they are not part of the State. Drawing,
 * sound and the bots read the State and these and nothing else.
 *
 * Every event carries the tick it happened in. `x`, `y` is where.
 */
export type SimEvent =
  /** A release that was paid for. `x`, `y` is where he was; `carry` is the chain it starts with. */
  | { type: "launch"; tick: number; x: number; y: number; power: number; carry: number }
  /** A release with no pip in hand. Nothing else happened. */
  | { type: "refused"; tick: number }
  /** One per cushion touched; `speed` is his speed going in. */
  | { type: "cushion"; tick: number; x: number; y: number; side: Side; speed: number }
  /**
   * `x`, `y` is the thing; `hx`, `hy` is his centre at the contact. `n`
   * counts the pops of this launch from 1; `chain` and `cushions` are the
   * two multipliers and `points` what the pop scored. `speed` is his speed
   * going in.
   */
  | {
      type: "pop";
      tick: number;
      x: number;
      y: number;
      hx: number;
      hy: number;
      id: number;
      kind: Thing["kind"];
      n: number;
      chain: number;
      cushions: number;
      points: number;
      source: "body";
      speed: number;
    }
  /** He landed. `dazed` is how many dust bunnies the thump dazed. */
  | { type: "land"; tick: number; x: number; y: number; dazed: number }
  /** A launch ended: on a landing, at the next release, or with the night. `x`, `y` is where he was. */
  | { type: "launchEnd"; tick: number; x: number; y: number; id: number; pops: number; total: number }
  /** A pip came back. `pips` is the count now. */
  | { type: "pip"; tick: number; pips: number; why: "timer" | "pop" | "heart" }
  /** A heart was lost to thing `id`. `x`, `y` is his centre, where the wave goes out from. */
  | { type: "hurt"; tick: number; x: number; y: number; by: Thing["kind"]; id: number; hearts: number }
  /** A thing's telegraph began; it lands at `landTick`. */
  | { type: "announce"; tick: number; x: number; y: number; id: number; kind: Thing["kind"]; landTick: number }
  /** A thing landed, `dist` from his centre; `dazed` if that was close. */
  | { type: "arrive"; tick: number; x: number; y: number; id: number; kind: Thing["kind"]; dist: number; dazed: boolean }
  /**
   * A row of the timetable or an extra bunch was announced. `row` is its
   * place among the hour's rows as written, from 0 (-1 for an extra bunch).
   * `how`: at its tick, called early, or brought by the clock. `n` things
   * were announced and `cut` more were refused by the room's cap.
   */
  | { type: "row"; tick: number; hour: number; row: number; how: "tick" | "early" | "clock"; n: number; cut: number }
  /** A thing was dazed, by a thump or by landing close. */
  | { type: "daze"; tick: number; id: number; until: number }
  /** An hour began. */
  | { type: "hour"; tick: number; hour: number }
  /** The hour is clear. */
  | { type: "clear"; tick: number; hour: number }
  /** The night ended. */
  | { type: "over"; tick: number; how: "hearts" | "morning" | "dawn"; score: number };
