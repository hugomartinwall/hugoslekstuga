/**
 * Knuff — the simulation's types.
 *
 * The State is plain data: numbers, booleans, strings, and lists and
 * objects of them. No class, no function, no Map, no undefined, no
 * Infinity (-1 means "never"). So one generic walk can copy it, fingerprint
 * it and store it as JSON (see state.ts).
 *
 * Step 1 held the first two minutes: him, dust bunnies and tokens, hearts,
 * pips, the slow-motion meter, the hour clock and the score. Step 2 adds
 * the ten plates, the charms and the offer. Step 3 adds the boss, the floor
 * polisher of 06:00. The later kinds join in the steps that build them,
 * under the names the spec gives them.
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

  // ── Charms and offers ───────────────────────────────────────────────
  /** The offer arms this long after it opens, or sooner if he lands, ticks. */
  offerArmTicks: number;
  /** A floor pickup never appears closer to him than this, u. */
  pickupMinDist: number;
  /** Bumper: the speed he leaves the plate with, as a share of launch speed. */
  bumperSpeed: number;
  /** Pip: a Pip plate gives one pip at most this often, ticks. */
  pipPlateCooldown: number;
  /** Spark: how long its ring lasts after the bounce, ticks. */
  sparkTicks: number;
  /** Spark: how far past his edge the ring reaches, u. */
  sparkReach: number;
  /** Bell: how long it dazes, ticks. */
  bellDazeTicks: number;
  /** Bell: a Bell plate rings at most this often, ticks. */
  bellCooldown: number;
  /** Coin slot: its multiplier on pops for the rest of the launch. */
  coinFactor: number;
  /** At most this many plates carry each wall charm. */
  capBumper: number;
  capPip: number;
  capSpark: number;
  capBell: number;
  capCoin: number;
  /** Heavy: the share of a pop's impulse he still feels. */
  heavyFactor: number;
  /** Long burn: the hot line moves down to this share of launch speed. */
  longBurnHotFrac: number;
  /** Wide: added to his radius, u. */
  wideRadius: number;
  /** Wide: the share of a pop's impulse he still feels. */
  wideFactor: number;

  // ── The boss: the floor polisher (06:00) ────────────────────────────
  /** Its speed when it lands, u/s. */
  bossSpeed: number;
  /** Hits the plug takes. */
  bossHits: number;
  /** It stalls this long after a plug hit, ticks. */
  bossStallTicks: number;
  /** Its speed is multiplied by this after each hit, and after each long gap without one. */
  bossSpeedUp: number;
  /** It stalls this long at a wall before it changes lane, ticks. */
  bossLaneStallTicks: number;
  /** Without a hit for this long it speeds up as if hit, ticks. */
  bossNoHitTicks: number;
  /** One dust bunny arrives this often while it is in the room, ticks. */
  bossTrickleTicks: number;
  /** Dust bunnies it coughs out on each hit. */
  bossCough: number;
  /** Width of the plug in the middle of its trailing end, u. */
  plugWidth: number;
  /** The speed the pad throws him at, u/s. */
  padThrowSpeed: number;
  /** The night ends this long after 06:00 begins, beaten or not, ticks. */
  bossMaxTicks: number;
  /** For beating the polisher, points. */
  nightBonus: number;
  /** Per heart left when the polisher is beaten, points. */
  heartBonus: number;
};

/**
 * His numbers after charms: what `statsFor(charms, tune)` makes (sim/charms.ts).
 * `step`, the aim line and the bots read these and never a charm.
 */
export type Stats = {
  /** His radius, u: 13, or 15 with Wide. */
  radius: number;
  /** The speed at or above which he is hot, u/s: lower with Long burn. */
  hotSpeed: number;
  /** The share of a collision's impulse he feels when the thing he hit pops: less with Heavy and with Wide. */
  popImpulse: number;
  /** Pips in hand at most: 4 with Fourth pip. */
  pipMax: number;
  /** Hearts at most: 4 with Thick skin. */
  maxHearts: number;
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
  /** The tick of his last contact (a pop, by his body or by Spark's ring), for `popHotTicks`; -1 = never. */
  lastContactTick: number;
  /** Nothing can cost a heart while `tick` is under this. 0 = not invulnerable. */
  invulnUntil: number;
};

/** What can be in the room: the intruders built so far, and an offer's pickups. */
export type ThingKind = BuiltKind | "pickup";

/**
 * A thing in the room: a dust bunny, a token, or a charm's pickup tile.
 * Everything in `things` is alive (a popped thing, and a pickup whose
 * offer is over, is gone by the end of its tick); it is announced until
 * `landTick` and landed from then on. A pickup is never announced: it
 * lies there from the tick its offer opens.
 */
export type Thing = {
  id: number;
  kind: ThingKind;
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
  /** A dust bunny of the boss's hour (trickled in, or coughed out): it pops for no points. */
  worth0: boolean;
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
  /** Pops so far, and those made by his body (a pop by Spark's ring is not one). */
  pops: number;
  bodyPops: number;
  /** It has given its pip back. */
  refunded: boolean;
  /** Cushions that count for the score: one touched within `cushionMergeTicks` of the last is not counted again. */
  cushions: number;
  /** The last cushion touched in this launch, counted or not; -1 = none yet. */
  lastCushionTick: number;
  /** A Coin slot plate fired in this launch: its pops score `coinFactor` times. */
  coin: boolean;
  /** Spark's ring reaches past his edge while `tick` is under this and he is hot; -1 = never. */
  sparkUntil: number;
  /** Bumper plates this launch has already been kicked by: each kicks once a launch. */
  bumped: number[];
  /** Things that take several hits that this launch has already hit; the polisher's plug is id 0. */
  hit: number[];
  /** The polisher's pad threw him: this launch is the throw. It cannot be thrown again by the pad while it lasts. */
  thrown: boolean;
  /** This launch's total. */
  points: number;
  /** Things and tiles he overlapped at the release: this launch cannot pop or take one until he has left it. */
  blocked: number[];
  /** Released on a tick after the offer armed: this launch can take what is offered (§6.3). */
  armed: boolean;
  /** It took something. A launch takes one thing at most. */
  took: boolean;
  /** Did it pop anything (for the next launch's carry). */
  popped: boolean;
};

/** One plate of the ten. */
export type Plate = {
  /** The wall charm it carries; "" = dark. */
  charm: string;
  /** Its charm cannot fire again before this tick (Pip, Bell); 0 = ready. */
  readyTick: number;
};

/** One thing an offer holds: a plate to light, or a body charm lying on the floor as a tile. */
export type OfferItem = {
  kind: "plate" | "pickup";
  charm: string;
  /** The plate it would light; -1 for a pickup. */
  plate: number;
  /** The pickup's tile in `things`; -1 for a plate. */
  thingId: number;
};

/** The offer of the hour (§6.3). There is never more than one. */
export type Offer = {
  /** It is out: made, not yet taken, not yet closed. */
  open: boolean;
  /** The tick it opened; -1 = none this hour. */
  openTick: number;
  /** The tick it armed; -1 = not yet. A launch released on a later tick can take. */
  armedTick: number;
  items: OfferItem[];
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
  /** -1 until the offer is settled: a charm was taken, or nothing could be offered (then it is the tick the offer would have opened). */
  settledTick: number;
  /** Offers are made this night. Off (`start.offers` false), each hour is settled the moment its offer would have opened. */
  offers: boolean;
};

/** The lanes the polisher walks, 0 (top) to 7. */
export type BossMode = "arriving" | "lane" | "wallStall" | "laneMove" | "hitStall" | "down";

/**
 * The floor polisher (§8): a box 120 u long in its direction of travel and
 * 60 u across, that walks the lanes from side to side. Its leading end is
 * the pad, the middle of its trailing end the plug, the rest the casing.
 */
export type Boss = {
  /** It has been announced: 06:00 has begun. False all night before that. */
  present: boolean;
  /** The centre of its box, and where it was one tick ago. */
  x: number;
  y: number;
  px: number;
  py: number;
  /** 1: heading right, the pad on its right end. -1: heading left. */
  dir: 1 | -1;
  /** The lane it is in, or is leaving while it changes lane. */
  lane: number;
  /** The way it walks the lanes: 1 down the room, -1 up. An end lane is not repeated. */
  laneStep: 1 | -1;
  /** u/s. */
  speed: number;
  /** Hits the plug has left. */
  hp: number;
  /**
   * "arriving": announced, not landed. "lane": moving along a lane, the pad
   * on. "wallStall": its leading end at the wall, the pad off. "laneMove":
   * changing lane. "hitStall": stalled after a plug hit. "down": beaten.
   */
  mode: BossMode;
  /** The tick the mode's time runs out (arriving, wallStall, hitStall); -1 for none. */
  modeUntil: number;
  /** The tick 06:00 began: `bossMaxTicks` counts from here. -1 before. */
  beganTick: number;
  /** For `bossNoHitTicks`: the tick it landed, was last hit, or last sped up without a hit. -1 before it lands. */
  lastHitTick: number;
  /** The tick the next dust bunny is announced. */
  nextTrickleTick: number;
};

export type State = {
  v: 1;
  seed: number;
  /** Ticks since the first launch. */
  tick: number;
  /** For real time: normal / 60 + slowed / (60 × the slow share). */
  normalTicks: number;
  slowedTicks: number;
  /** "boss" is the polisher's hour, 06:00. */
  phase: "waiting" | "night" | "boss" | "over";
  /**
   * How the night ended. "morning": the polisher was beaten, or, on a night
   * that leaves the polisher out, 05:00 ended. "dawn": 06:00 ran out with the
   * polisher unbeaten (the lights came on).
   */
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
  /** Body charms taken, in order. */
  charms: string[];
  /** His numbers after charms: statsFor(charms, tune). */
  stats: Stats;
  /** The ten plates, numbered clockwise from the top left. */
  plates: Plate[];
  things: Thing[];
  nextId: number;
  night: NightState;
  offer: Offer;
  /** The polisher; `present` is false until 06:00. */
  boss: Boss;
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
  /**
   * One per cushion touched; `speed` is his speed going in. `plate` is the
   * plate he bounced off; `charm` the charm that fired there, "" if none
   * did (a dark plate, a Bumper that already kicked this launch, a Pip at
   * the maximum or in its cooldown, a Bell in its cooldown).
   */
  | { type: "cushion"; tick: number; x: number; y: number; side: Side; speed: number; plate: number; charm: string }
  /**
   * `x`, `y` is the thing; `hx`, `hy` is his centre at the contact. `n`
   * counts the pops of this launch from 1; `chain`, `cushions` and `coin`
   * are the three multipliers and `points` what the pop scored. `source`:
   * his body, or Spark's ring. `speed` is his speed going in.
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
      coin: number;
      points: number;
      source: "body" | "spark";
      speed: number;
    }
  /** He landed. `dazed` is how many dust bunnies the thump dazed. */
  | { type: "land"; tick: number; x: number; y: number; dazed: number }
  /** A launch ended: on a landing, at the next release, or with the night. `x`, `y` is where he was. */
  | { type: "launchEnd"; tick: number; x: number; y: number; id: number; pops: number; total: number }
  /** A pip came back. `pips` is the count now. */
  | { type: "pip"; tick: number; pips: number; why: "timer" | "pop" | "heart" | "plate" }
  /** A heart was lost to thing `id` (0 and "polisher": the polisher's pad). `x`, `y` is his centre, where the wave goes out from. */
  | { type: "hurt"; tick: number; x: number; y: number; by: Thing["kind"] | "polisher"; id: number; hearts: number }
  /**
   * A counted hit on a thing that takes several: so far the polisher's plug
   * (id 0). `x`, `y` is his centre as he met it; `left` its hits left; `points` what
   * it paid; `two` whether it counted as two (off a cushion).
   */
  | { type: "hit"; tick: number; x: number; y: number; kind: "polisher"; id: number; left: number; points: number; two: boolean }
  /** The polisher lands, at the end of its telegraph. */
  | { type: "bossArrive"; tick: number; x: number; y: number; lane: number; dir: 1 | -1 }
  /** The plug was hit: `left` hits remain; `coughed` dust bunnies came out of it. */
  | { type: "bossHit"; tick: number; x: number; y: number; left: number; coughed: number }
  /** It stalled: at a wall before a lane change, or after a hit. The pad is off until `until`. */
  | { type: "bossStall"; tick: number; x: number; y: number; why: "wall" | "hit"; until: number }
  /** Pad and plug swapped ends: it sets off heading `dir`. */
  | { type: "bossTurn"; tick: number; x: number; y: number; dir: 1 | -1 }
  /** It starts to change lane, from `from` to `lane`. */
  | { type: "bossLane"; tick: number; x: number; y: number; from: number; lane: number }
  /** It sped up: after a hit, or because `bossNoHitTicks` passed without one. */
  | { type: "bossFaster"; tick: number; x: number; y: number; speed: number; why: "hit" | "time" }
  /** The last hit: it powers down. */
  | { type: "bossDown"; tick: number; x: number; y: number }
  /**
   * He bounced off the polisher without a hit: the casing, or the plug when
   * this launch has hit it already. `x`, `y` is his centre as he met it;
   * `speed` his speed going in, `vx`, `vy` his velocity coming out.
   */
  | { type: "bossBounce"; tick: number; x: number; y: number; part: "casing" | "plug"; speed: number; vx: number; vy: number }
  /**
   * The pad threw him, along `vx`, `vy`. `x`, `y` is his centre where the pad
   * met him; `tx`, `ty` where he was set clear of it and flies from. `hurt`:
   * it cost a heart (it did not while he was invulnerable).
   */
  | { type: "bossThrow"; tick: number; x: number; y: number; tx: number; ty: number; vx: number; vy: number; hurt: boolean }
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
  /** A thing was dazed: by a thump, by landing close, or by a Bell. */
  | { type: "daze"; tick: number; id: number; until: number }
  /** The hour's offer opened with these things. */
  | { type: "offerOpen"; tick: number; items: OfferItem[] }
  /** It armed: a launch released from the next tick on can take. */
  | { type: "offerArmed"; tick: number }
  /** `item` (its place in `items`) was taken; the rest went away. */
  | { type: "offerTaken"; tick: number; item: number; kind: OfferItem["kind"]; charm: string; plate: number; items: OfferItem[] }
  /** The next hour began, or the night ended, with the offer still out: it is lost. */
  | { type: "offerClosed"; tick: number; items: OfferItem[] }
  /** An hour began. */
  | { type: "hour"; tick: number; hour: number }
  /** The hour is clear. */
  | { type: "clear"; tick: number; hour: number }
  /** The night ended. `bonus`: what beating the polisher added to the score (0 for any other end). */
  | { type: "over"; tick: number; how: "hearts" | "morning" | "dawn"; score: number; bonus: number };
