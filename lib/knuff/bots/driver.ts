/**
 * The driver: runs one player through one night on the real `step`, with
 * the real slow-motion rule (§13.1).
 *
 * It gives the player a real clock. A normal tick adds one sixtieth of a
 * second and a slowed tick five, so a reaction time in milliseconds passes
 * through slow motion as a person's does:
 *
 *     real seconds = normal ticks / 60 + slowed ticks / 12
 *
 * It keeps each player's own random stream (§12.3): mulberry32, seeded
 * from the night's seed and the player's name. Never the State's three
 * streams: a draw taken there would change the night being measured.
 *
 * And it keeps the night's books, from the State and the events and from
 * nothing else: what the balance table prints and what its bounds ask.
 */
import { DARK_PLATES } from "../content/charms";
import { HOURS } from "../content/night";
import { overlapDepth } from "../sim/boss";
import { intruders } from "../sim/night";
import { createState, type StartOptions } from "../sim/state";
import { step } from "../sim/step";
import type { SimEvent, State, Tune } from "../sim/types";
import { KITER, KITER_RANDOM, flickerBot, kiterBot, onceBot, rhythmBot, spamBot } from "./aimless";
import { CAUTIOUS, EXPERT, ORDINARY, STRAIGHT, cornerHands, handBot, type Bot, type Now, type Rand } from "./probe";

// ── The cast ──────────────────────────────────────────────────────────

export type Player = {
  key: string;
  label: string;
  /** Looks ahead with the probe: slow to run. */
  looksAhead: boolean;
  make: (r: Rand) => Bot;
};

export const CAST: readonly Player[] = [
  { key: "once", label: "Once", looksAhead: false, make: (r) => onceBot(r) },
  { key: "spam", label: "Spam", looksAhead: false, make: (r) => spamBot(r) },
  { key: "flicker", label: "Flicker", looksAhead: false, make: (r) => flickerBot(r) },
  { key: "rhythm", label: "Rhythm", looksAhead: false, make: (r) => rhythmBot(r) },
  { key: "kiter", label: "Kiter", looksAhead: false, make: (r) => kiterBot(r, KITER) },
  { key: "kiter-random", label: "Kiter, random (the studies')", looksAhead: false, make: (r) => kiterBot(r, KITER_RANDOM) },
  { key: "corner", label: "Corner", looksAhead: true, make: (r) => handBot(r, cornerHands()) },
  { key: "straight", label: "Straight", looksAhead: false, make: (r) => handBot(r, STRAIGHT) },
  { key: "cautious", label: "Cautious", looksAhead: true, make: (r) => handBot(r, CAUTIOUS) },
  { key: "ordinary", label: "Ordinary, no charms", looksAhead: true, make: (r) => handBot(r, ORDINARY) },
  { key: "expert", label: "Expert, no charms", looksAhead: true, make: (r) => handBot(r, EXPERT) },
];

/**
 * The players who take what is offered ("takes one", §13.1): the Ordinary's
 * and the Expert's hands, going after one offered thing picked at random
 * once an offer is armed. They are not rows of the step-1 table, which is
 * played with nothing offered; the offer checks of step 2 and the
 * full-night table use them.
 */
export const TAKERS: readonly Player[] = [
  { key: "ordinary-takes", label: "Ordinary, takes one", looksAhead: true, make: (r) => handBot(r, { ...ORDINARY, takes: true }) },
  { key: "expert-takes", label: "Expert, takes one", looksAhead: true, make: (r) => handBot(r, { ...EXPERT, takes: true }) },
];

export function player(key: string): Player {
  const p = CAST.find((c) => c.key === key) ?? TAKERS.find((c) => c.key === key);
  if (!p) throw new Error(`no player "${key}"`);
  return p;
}

/**
 * The step-1 night (§13.2), which the step-1 table keeps until step 5:
 * dust bunnies and tokens only (so no 06:00: the polisher is left out and
 * the night ends when 05:00 ends), all ten plates dark, nothing offered.
 * Later steps add what they build to this list of leavings-out.
 */
export const STEP1_NIGHT: StartOptions = { kinds: ["bunny", "token"], plates: DARK_PLATES, offers: false };

/** The seed of night number `i`. */
export function nightSeed(i: number): number {
  return (1000 + i * 7919) >>> 0;
}

/** A player's own stream for one night: mulberry32, seeded from the night's seed and the player's name. */
export function playerStream(seed: number, name: string): Rand {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < name.length; k++) {
    h ^= name.charCodeAt(k);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = (h ^ Math.imul(seed >>> 0, 0x9e3779b9)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── One night's books ─────────────────────────────────────────────────

/** One offer of the night, and what became of it. */
export type OfferSeen = {
  hour: number;
  /** The tick of its hour it opened at. */
  into: number;
  /** It opened because the hour was clear; false: at `offerLatestTick`, with the hour not clear. */
  clear: boolean;
  /** Intruders alive or announced when it opened. */
  crowd: number;
  /** Things offered: plates, and pickups. */
  plates: number;
  pickups: number;
  /** Ticks from opening to arming; -1 if it never armed. */
  armedAfter: number;
  /** What was taken: its place in the offer, its kind and charm, the tick of the hour; -1, "", "" and -1 if nothing. */
  taken: number;
  takenKind: string;
  takenCharm: string;
  takenInto: number;
  /** The launch that took it: aimed at it, aimed at another offered thing, or aimed at the room (an accident). */
  takenBy: "" | "aimed" | "wrong" | "accident";
  /** The offered thing the player went after (-1 if none), and its launches aimed at it, and those that took it. */
  wanted: number;
  wantedKind: string;
  tries: number;
  hits: number;
  /** Launches released while it was armed: those that could take something, aimed at it or not. */
  armedLaunches: number;
};

/** One lost heart. */
export type Loss = {
  tick: number;
  hour: number;
  by: string;
  /** Ticks since the thing was announced; -1 if it stood in the room before the night (the rack). */
  sinceAnnounce: number;
  /** Ticks since it landed, and how far from him it landed; -1 and -1 for the rack. */
  sinceLand: number;
  landDist: number;
};

/** The boss's part of a night: from the tick 06:00 began. */
export type Fight = {
  /** The tick 06:00 began; -1 if the night never reached it. */
  began: number;
  /** How the night ended once it had: the polisher beaten, the lights came on, or the last heart. "" before 06:00. */
  ended: "" | "morning" | "dawn" | "hearts";
  /** Ticks from 06:00's first to the night's end (its last tick counted). */
  ticks: number;
  /** Counted plug hits, and those of them that counted as two. */
  hits: number;
  twos: number;
  /** The pad's throws, and those that cost a heart. */
  throws: number;
  throwsHurt: number;
  /** Hearts lost to the pad while he was landed, and while he was hot. */
  padLanded: number;
  padHot: number;
  /**
   * Hearts lost to the pad on an end that had been drawn as the pad for
   * less than a telegraph: the end that leads is shown from the polisher's
   * announcement (its arrow), and from the start of every stall (the pad to
   * come), so this counts what nobody could have read.
   */
  padUnread: number;
  /** Hearts lost from 06:00 on, to anything. */
  hearts: number;
  /** Ticks at whose end his circle overlapped the machine's box, and the deepest overlap at the end of a tick, u. */
  insideTicks: number;
  deepest: number;
  /** What beating the polisher added to the score. */
  bonus: number;
  /** Launches from 06:00 on (the pad's throws not counted). */
  launches: number;
};

export type Night = {
  seed: number;
  ended: "hearts" | "morning" | "dawn" | "";
  /** The hour the night ended in, 0 = 19:00; 11 if he was alive when 05:00 ended (and in the boss's hour, 06:00). */
  hour: number;
  ticks: number;
  normalTicks: number;
  slowedTicks: number;
  score: number;
  bestShot: number;
  heartsLost: number;
  launches: number;
  pops: number;
  /** Length of each hour that ended, ticks. */
  hourLen: number[];
  losses: Loss[];
  /**
   * Hearts lost against a fairness rule: to a thing announced for less than
   * the telegraph, to a close arrival that was not dazed, or to the
   * polisher's pad on an end shown as the pad for less than the telegraph.
   */
  unfair: number;
  /** Ticks with nothing alive and nothing announced; those of them in the pause between hours; the longest run. */
  ticksEmpty: number;
  ticksEmptyPause: number;
  longestEmpty: number;
  /** Intruders alive or announced: summed over ticks, and the most at once. */
  roomSum: number;
  maxRoom: number;
  /** Intruders announced (the opening rack, which stood there before the night, is not counted). */
  announced: number;
  /** Extra bunches dealt. */
  extras: number;
  /** Tabled rows announced before their tick: called early or brought by the clock, together. */
  early: number;
  /** Intruders the cap refused. */
  capRefused: number;
  /** A landed intruder that was not dazed stood within 120 u of him in the first 600 ticks: at any moment / while he was landed and could be hurt. */
  near: boolean;
  nearLanded: boolean;
  /** The hour the first token came in (-1 = none came), whether it came alone at tick 0 as the first thing that hour sent, and how long it stood alone (-1 = to the end). */
  tokenHour: number;
  tokenAlone: boolean;
  tokenAloneTicks: number;
  /** Ticks he was landed, and landed with no pip. */
  ticksLanded: number;
  ticksLandedNoPip: number;
  /** Every offer the night made (none when offers are off). */
  offers: OfferSeen[];
  /** What he had at the end: body charms taken, and the plates (one charm name or "" each). */
  charms: string[];
  plates: string[];
  /** The boss's books: `began` is -1 on a night that never reached 06:00. */
  fight: Fight;
};

/** Called after every tick that was taken, with what it did: for a trace, or a test. */
export type Watch = (events: readonly SimEvent[], s: State) => void;

/** Run one player through one night. */
export function runNight(seed: number, who: Player, tune: Tune, start: StartOptions = STEP1_NIGHT, watch?: Watch): Night {
  const s: State = createState(seed, tune, start);
  const bot = who.make(playerStream(seed, who.key));
  const events: SimEvent[] = [];
  const now: Now = { clock: 0, landedTick: -1 };
  const slowedUnits = 1 / tune.slowShare;
  const n: Night = {
    seed,
    ended: "",
    hour: 0,
    ticks: 0,
    normalTicks: 0,
    slowedTicks: 0,
    score: 0,
    bestShot: 0,
    heartsLost: 0,
    launches: 0,
    pops: 0,
    hourLen: [],
    losses: [],
    unfair: 0,
    ticksEmpty: 0,
    ticksEmptyPause: 0,
    longestEmpty: 0,
    roomSum: 0,
    maxRoom: 0,
    announced: 0,
    extras: 0,
    early: 0,
    capRefused: 0,
    near: false,
    nearLanded: false,
    tokenHour: -1,
    tokenAlone: false,
    tokenAloneTicks: -1,
    ticksLanded: 0,
    ticksLandedNoPip: 0,
    offers: [],
    charms: [],
    plates: [],
    fight: { began: -1, ended: "", ticks: 0, hits: 0, twos: 0, throws: 0, throwsHurt: 0, padLanded: 0, padHot: 0, padUnread: 0, hearts: 0, insideTicks: 0, deepest: 0, bonus: 0, launches: 0 },
  };
  const fight = n.fight;
  const announcedAt = new Map<number, number>();
  const arrivedAt = new Map<number, { tick: number; dist: number }>();
  let hourStart = -1;
  let rowsThisHour = 0;
  let tokenTick = -1;
  let rowHasToken = false;
  let emptyRun = 0;
  let idle = 0;
  const most = HOURS * tune.hourMaxTicks + tune.bossMaxTicks + 400;

  /** The offer out now, and what the launch in flight was aimed at. */
  let offer: OfferSeen | null = null;
  let launchAim = -1;
  /** The tick from which the polisher's leading end has been shown as the pad (its telegraph's arrow, or a stall's pad to come). */
  let padShownFrom = -1;
  for (let guard = 0; s.phase !== "over" && guard < most; guard++) {
    now.clock = s.normalTicks + slowedUnits * s.slowedTicks;
    const input = bot.act(s, tune, now);
    const aim = input.launch !== null && bot.aimingAt ? bot.aimingAt() : -1;
    // The room as the tick finds it: intruders only (an offer's tiles are not).
    const roomBefore = intruders(s);
    const inPause = s.night.clearTick >= 0;
    /** Is he hot at this point of the tick's events? */
    let hot = s.him.hot;
    events.length = 0;
    step(s, input, tune, events);
    if (s.phase === "waiting") {
      // A player who never launches cannot lose: nothing moves until the first launch.
      if (++idle > 3) break;
      continue;
    }
    // The room as the tick found it: empty is nothing alive and nothing announced.
    if (roomBefore === 0) {
      n.ticksEmpty++;
      if (inPause) n.ticksEmptyPause++;
      if (++emptyRun > n.longestEmpty) n.longestEmpty = emptyRun;
    } else emptyRun = 0;

    let came = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case "launch":
          n.launches++;
          hot = true;
          if (fight.began >= 0) fight.launches++;
          if (offer && s.launch.armed) offer.armedLaunches++;
          launchAim = aim;
          if (offer && aim >= 0) {
            if (offer.wanted < 0) {
              offer.wanted = aim;
              offer.wantedKind = s.offer.items[aim]?.kind ?? "";
            }
            if (aim === offer.wanted) offer.tries++;
          }
          break;
        case "offerOpen": {
          const into = e.tick - s.night.hourStart;
          offer = {
            hour: s.night.hour,
            into,
            clear: s.night.clearTick >= 0,
            crowd: intruders(s),
            plates: e.items.filter((i) => i.kind === "plate").length,
            pickups: e.items.filter((i) => i.kind === "pickup").length,
            armedAfter: -1,
            taken: -1,
            takenKind: "",
            takenCharm: "",
            takenInto: -1,
            takenBy: "",
            wanted: -1,
            wantedKind: "",
            tries: 0,
            hits: 0,
            armedLaunches: 0,
          };
          n.offers.push(offer);
          break;
        }
        case "offerArmed":
          if (offer) offer.armedAfter = e.tick - s.night.hourStart - offer.into;
          break;
        case "offerTaken":
          if (offer) {
            offer.taken = e.item;
            offer.takenKind = e.kind;
            offer.takenCharm = e.charm;
            offer.takenInto = e.tick - s.night.hourStart;
            offer.takenBy = launchAim === e.item ? "aimed" : launchAim >= 0 ? "wrong" : "accident";
            if (launchAim === e.item && e.item === offer.wanted) offer.hits++;
            offer = null;
          }
          break;
        case "offerClosed":
          offer = null;
          break;
        case "pop":
          n.pops++;
          break;
        case "land":
          now.landedTick = e.tick;
          hot = false;
          break;
        case "hour":
          if (hourStart >= 0) n.hourLen.push(e.tick - hourStart);
          hourStart = e.tick;
          rowsThisHour = 0;
          if (e.hour >= HOURS) {
            fight.began = e.tick;
            padShownFrom = e.tick;
          }
          break;
        case "bossStall":
          padShownFrom = e.tick;
          break;
        case "hit":
          if (e.kind === "polisher") {
            fight.hits++;
            if (e.two) fight.twos++;
          }
          break;
        case "bossThrow":
          fight.throws++;
          if (e.hurt) fight.throwsHurt++;
          hot = true;
          break;
        case "announce":
          came++;
          announcedAt.set(e.id, e.tick);
          if (e.kind === "token") rowHasToken = true;
          break;
        case "arrive":
          arrivedAt.set(e.id, { tick: e.tick, dist: e.dist });
          break;
        case "row":
          n.capRefused += e.cut;
          if (e.row === -1) n.extras++;
          else if (e.how !== "tick") n.early++;
          if (rowHasToken && n.tokenHour < 0) {
            n.tokenHour = e.hour;
            n.tokenAlone = e.hour === 1 && e.tick === hourStart && rowsThisHour === 0 && e.n === 1 && e.how === "tick";
            tokenTick = e.tick;
          } else if (n.tokenHour === e.hour && n.tokenAloneTicks < 0) {
            n.tokenAloneTicks = e.tick - tokenTick;
          }
          rowHasToken = false;
          rowsThisHour++;
          break;
        case "hurt": {
          const ann = announcedAt.get(e.id);
          const arr = arrivedAt.get(e.id);
          const loss: Loss = {
            tick: e.tick,
            hour: s.night.hour,
            by: e.by,
            sinceAnnounce: ann === undefined ? -1 : e.tick - ann,
            sinceLand: arr === undefined ? -1 : e.tick - arr.tick,
            landDist: arr === undefined ? -1 : arr.dist,
          };
          n.losses.push(loss);
          n.heartsLost++;
          if (fight.began >= 0) fight.hearts++;
          if (e.by === "polisher") {
            if (hot) fight.padHot++;
            else fight.padLanded++;
            if (e.tick - padShownFrom < tune.telegraphTicks) {
              fight.padUnread++;
              n.unfair++;
            }
          } else if (ann !== undefined && loss.sinceAnnounce < tune.telegraphTicks) n.unfair++;
          else if (arr !== undefined && arr.dist <= tune.arriveDazedWithin && loss.sinceLand < tune.dazeTicks) n.unfair++;
          break;
        }
        case "over":
          if (e.how === "morning" && hourStart >= 0) n.hourLen.push(e.tick - hourStart);
          if (fight.began >= 0) {
            fight.ended = e.how;
            fight.ticks = e.tick + 1 - fight.began;
            fight.bonus = e.bonus;
          }
          break;
        default:
          break;
      }
    }
    n.announced += came;
    const room = roomBefore + came;
    n.roomSum += room;
    if (room > n.maxRoom) n.maxRoom = room;

    // The tick just taken is s.tick - 1. Is something that could cost a heart within 120 u of him?
    const taken = s.tick - 1;
    if (taken <= 600 && !n.nearLanded) {
      let best = 1e18;
      for (const d of s.things) {
        if (d.landTick > taken || taken < d.dazedUntil || d.kind === "pickup") continue;
        const dd = (d.x - s.him.x) * (d.x - s.him.x) + (d.y - s.him.y) * (d.y - s.him.y);
        if (dd < best) best = dd;
      }
      if (best <= 120 * 120) {
        n.near = true;
        if (!s.him.hot && taken >= s.him.invulnUntil) n.nearLanded = true;
      }
    }
    if (!s.him.hot) {
      n.ticksLanded++;
      if (s.pips === 0) n.ticksLandedNoPip++;
    }
    // At the end of no tick is he inside the machine's box.
    if (s.boss.present) {
      const deep = overlapDepth(s.boss, s.him.x, s.him.y, s.stats.radius);
      if (deep > 1e-6) fight.insideTicks++;
      if (deep > fight.deepest) fight.deepest = deep;
    }
    if (watch) watch(events, s);
  }

  n.ended = s.ended;
  n.hour = s.night.hour;
  n.ticks = s.tick;
  n.normalTicks = s.normalTicks;
  n.slowedTicks = s.slowedTicks;
  n.score = s.score;
  n.bestShot = s.bestShot;
  n.charms = s.charms.slice();
  n.plates = s.plates.map((p) => p.charm);
  return n;
}

/** Real seconds of a night: a slowed tick lasts 1 / slowShare normal ones. */
export function realSeconds(n: Night, tune: Tune): number {
  return n.normalTicks / 60 + n.slowedTicks / (60 * tune.slowShare);
}
