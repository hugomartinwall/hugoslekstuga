/**
 * Making, copying and fingerprinting a State.
 *
 * `cloneState` and `hashState` walk the State generically: every number,
 * boolean and string, through every nested object and list. There is no
 * list of fields written by hand, so a field added to the State in a later
 * step is copied and fingerprinted without anyone remembering to.
 */
import { BODY_CHARMS, DARK, PLATES, START_PLATES, isWallCharm } from "../content/charms";
import { BUILT, isBuilt } from "../content/kinds";
import { BOSS_HOUR } from "../content/night";
import { noBoss } from "./boss";
import { statsFor } from "./charms";
import { placeRack } from "./night";
import { seedStreams } from "./rng";
import type { Plate, Room, State, Tune } from "./types";

/** The room is 360 × 480 u on every device. It is never stretched. */
export const ROOM_W = 360;
export const ROOM_H = 480;
/** The four cushions are this thick and lie inside the room. */
export const CUSHION = 8;
/** Where he starts: 78% of the way down the room, straight above the thumb deck. */
export const START_X = 180;
export const START_Y = 374;

/** The floor he moves on when nothing says otherwise: the room less its cushions. */
export function defaultRoom(): Room {
  return { left: CUSHION, top: CUSHION, right: ROOM_W - CUSHION, bottom: ROOM_H - CUSHION };
}

/**
 * How a State may begin other than the default: a night at a given hour
 * with a given build. The owner's checks, the charm test, the feel lock,
 * the players without charms, the bot table's step-1 night and the dev
 * handle all use it (§12.2).
 */
export type StartOptions = {
  /**
   * The hour the night begins in: 0 is 19:00, 10 is 05:00, 11 is 06:00 (the
   * polisher's, on a night whose kinds bring it). The first launch starts it
   * at its tick 0.
   */
  hour?: number;
  /**
   * Hearts at the start: brought inside 1 and the most he can have.
   * Default: `tune.hearts`, and one more with Thick skin.
   */
  hearts?: number;
  /**
   * Body charms already taken, in order. A name that is not a body charm,
   * and a second copy of one, are left out. Fourth pip starts him with its
   * pip filled, Thick skin with its heart.
   */
  charms?: readonly string[];
  /**
   * The charm on each plate, by number: a wall charm's name, or "" for a
   * dark plate. A missing entry, and a name that is not a wall charm, is
   * dark. Default: the two starting plates, Bumper on 0 and Pip on 4. No
   * cap is held here: a case may light what an offer never would.
   */
  plates?: readonly string[];
  /** Offers are made. Off, each hour is settled the moment its offer would have opened (the players without charms). Default: on. */
  offers?: boolean;
  /**
   * The kinds the night's rows may bring. By default, every kind built so
   * far. A kind not listed is left out of the rows; a kind not built yet
   * cannot be asked for. The polisher counts as a kind: a night without it
   * has no 06:00 and ends when 05:00 ends.
   */
  kinds?: readonly string[];
  /**
   * Nothing in the room but him: no opening rack. Unless `kinds` says
   * otherwise nothing arrives either, all night.
   */
  empty?: boolean;
  /** The floor's edges. The feel lock sets them to the toy's: 0, 0, 360, 480. */
  room?: Room;
};

export function createState(seed: number, tune: Tune, start: StartOptions = {}): State {
  const asked = start.kinds ?? (start.empty ? [] : BUILT);
  // In the order the kinds were built, each once, so two ways of asking for the same night make the same State.
  const kinds: string[] = BUILT.filter((kind) => asked.includes(kind) && isBuilt(kind));
  // 06:00 is an hour to begin in only on a night that has it.
  const lastHour = kinds.includes("polisher") ? BOSS_HOUR : BOSS_HOUR - 1;
  const hour = Math.min(lastHour, Math.max(0, Math.floor(start.hour ?? 0)));
  // In the order of the asking, each once.
  const charms: string[] = [];
  for (const c of start.charms ?? []) if ((BODY_CHARMS as readonly string[]).includes(c) && !charms.includes(c)) charms.push(c);
  const stats = statsFor(charms, tune);
  const platesAsked = start.plates ?? START_PLATES;
  const plates: Plate[] = [];
  for (let p = 0; p < PLATES; p++) {
    const c = platesAsked[p] ?? DARK;
    plates.push({ charm: isWallCharm(c) ? c : DARK, readyTick: 0 });
  }
  const hearts = Math.min(stats.maxHearts, Math.max(1, Math.floor(start.hearts ?? stats.maxHearts)));
  const s: State = {
    v: 1,
    seed: seed >>> 0,
    tick: 0,
    normalTicks: 0,
    slowedTicks: 0,
    phase: "waiting",
    ended: "",
    rng: seedStreams(seed >>> 0),
    room: start.room ? { ...start.room } : defaultRoom(),
    him: { x: START_X, y: START_Y, px: START_X, py: START_Y, vx: 0, vy: 0, hot: false, lastContactTick: -1, invulnUntil: 0 },
    hearts,
    pips: stats.pipMax,
    pipTimer: tune.pipRefillTicks,
    // The meter starts the night full.
    slow: { meter: tune.slowMeterMax, refill: 0 },
    launch: {
      id: 0,
      startTick: 0,
      active: false,
      carry: 0,
      pops: 0,
      bodyPops: 0,
      refunded: false,
      cushions: 0,
      lastCushionTick: -1,
      coin: false,
      sparkUntil: -1,
      bumped: [],
      hit: [],
      thrown: false,
      points: 0,
      blocked: [],
      vPops: [],
      armed: false,
      took: false,
      popped: false,
    },
    pastShots: [],
    charms,
    stats,
    plates,
    things: [],
    nextId: 1,
    night: {
      hour,
      hourStart: 0,
      kinds,
      nextRow: 0,
      rowTick: -1,
      rowLandTick: -1,
      holdFrom: -1,
      holdTo: -1,
      clearTick: -1,
      offerTick: -1,
      settledTick: -1,
      offers: start.offers !== false,
      heartSpent: false,
    },
    offer: { open: false, openTick: -1, armedTick: -1, items: [] },
    boss: noBoss(tune),
    score: 0,
    bestShot: 0,
    lastHurtBy: "",
    lastHurtHour: -1,
  };
  // The 19:00 rack is in the room on the start screen, still until the first launch.
  if (!start.empty) placeRack(s);
  return s;
}

// ── The generic walk ──────────────────────────────────────────────────

function cloneValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v !== null && typeof v === "object") {
    // A spread copies every field in one go and keeps the object's shape,
    // so a copied State steps as fast as the one it was copied from. What
    // it copied by reference (a nested object or list) is then copied in
    // its turn.
    const out: Record<string, unknown> = { ...(v as Record<string, unknown>) };
    for (const key in out) {
      const item = out[key];
      if (item !== null && typeof item === "object") out[key] = cloneValue(item);
    }
    return out;
  }
  return v;
}

/** A deep copy that shares no object with the original. */
export function cloneState(s: State): State {
  return cloneValue(s) as State;
}

/** Two lanes, FNV-1a and a second multiplier with a fold: a 64-bit fingerprint out of 32-bit arithmetic. */
type Hash = { a: number; b: number };

function mixByte(h: Hash, byte: number): void {
  h.a = Math.imul(h.a ^ byte, 16777619) >>> 0;
  h.b = Math.imul(h.b ^ byte, 0x85ebca6b) >>> 0;
  h.b = (h.b ^ (h.b >>> 13)) >>> 0;
}

function mixU32(h: Hash, n: number): void {
  mixByte(h, n & 0xff);
  mixByte(h, (n >>> 8) & 0xff);
  mixByte(h, (n >>> 16) & 0xff);
  mixByte(h, (n >>> 24) & 0xff);
}

function mixString(h: Hash, str: string): void {
  mixU32(h, str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    mixByte(h, c & 0xff);
    mixByte(h, c >>> 8);
  }
}

function mixValue(h: Hash, v: unknown): void {
  if (typeof v === "number") {
    mixByte(h, 1);
    if (!Number.isFinite(v)) {
      // Never legal in a State. Say so in the fingerprint instead of hiding it as a zero.
      mixByte(h, Number.isNaN(v) ? 0xfe : v > 0 ? 0xfd : 0xfc);
      return;
    }
    // Rounded to 1/1024, so the fingerprint is about the simulation and
    // not about the last bits of a float. A seed or a generator state is
    // a whole number up to 2^32, so the rounded value needs two words.
    const q = Math.round(v * 1024);
    const mag = Math.abs(q);
    mixByte(h, q < 0 ? 1 : 0);
    mixU32(h, mag % 4294967296);
    mixU32(h, Math.floor(mag / 4294967296));
  } else if (typeof v === "boolean") {
    mixByte(h, 2);
    mixByte(h, v ? 1 : 0);
  } else if (typeof v === "string") {
    mixByte(h, 3);
    mixString(h, v);
  } else if (Array.isArray(v)) {
    mixByte(h, 4);
    mixU32(h, v.length);
    for (const item of v) mixValue(h, item);
  } else if (v !== null && typeof v === "object") {
    mixByte(h, 5);
    const src = v as Record<string, unknown>;
    // Sorted, so a State revived from JSON, or built in another order,
    // has the fingerprint of the one it was made from.
    for (const key of Object.keys(src).sort()) {
      mixString(h, key);
      mixValue(h, src[key]);
    }
  } else {
    // null, undefined, a function: none of them belongs in a State.
    mixByte(h, 6);
  }
}

/** A short, stable fingerprint of the whole State: for determinism checks and stored runs. */
export function hashState(s: State): string {
  const h: Hash = { a: 2166136261, b: 0x9747b28c };
  mixValue(h, s);
  return h.a.toString(16).padStart(8, "0") + h.b.toString(16).padStart(8, "0");
}
