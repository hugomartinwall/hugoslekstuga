/**
 * Making, copying and fingerprinting a State.
 *
 * `cloneState` and `hashState` walk the State generically: every number,
 * boolean and string, through every nested object and list. There is no
 * list of fields written by hand, so a field added to the State in a later
 * step is copied and fingerprinted without anyone remembering to.
 */
import { rackDummies } from "./dummies";
import { seedStreams } from "./rng";
import type { Room, State, Tune } from "./types";

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
 * How a State may begin other than the default. Step 0 has the two the
 * feel lock needs; the rest of the spec's list (hour, hearts, charms,
 * plates, offers) joins with the things it sets.
 */
export type StartOptions = {
  /** The floor's edges. The feel lock sets them to the toy's: 0, 0, 360, 480. */
  room?: Room;
  /** Nothing in the room but him. */
  empty?: boolean;
};

export function createState(seed: number, tune: Tune, start: StartOptions = {}): State {
  const s: State = {
    v: 1,
    seed: seed >>> 0,
    tick: 0,
    rng: seedStreams(seed >>> 0),
    room: start.room ? { ...start.room } : defaultRoom(),
    him: { x: START_X, y: START_Y, px: START_X, py: START_Y, vx: 0, vy: 0, hot: false },
    launch: { id: 0, startTick: 0, pops: 0, cushions: 0 },
    things: [],
    nextId: 1,
  };
  if (!start.empty) rackDummies(s, tune, ROOM_W, ROOM_H);
  return s;
}

// ── The generic walk ──────────────────────────────────────────────────

function cloneValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v !== null && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) out[key] = cloneValue(src[key]);
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
