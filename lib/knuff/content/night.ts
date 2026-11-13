/**
 * The timetable: the spec's table (§3.4) as data, one object per row.
 *
 * This file holds the night AS WRITTEN, every kind in it, whether or not
 * the kind has rules yet. What a night leaves out of its rows, the shift
 * of the hours whose opening row is left empty, and the pace at which the
 * rows are dealt all belong to sim/night.ts. Nothing here is computed.
 *
 * A row is what arrives together. `tick` is the tick of the hour at which
 * it is announced at pace 1; at pace 2 and 3 it is the latest tick. It
 * lands one telegraph later: the rack has none (it is in the room on the
 * start screen), the money bag's is twice as long.
 */
import type { Kind } from "./kinds";

/** How a part of a row is placed (§3.3, "Formations"). `tile` is the love heart's square. */
export type Form = "rack" | "blob" | "loose" | "file" | "alone" | "beside" | "under" | "V" | "tile";

export type Part = {
  kind: Kind;
  n: number;
  form: Form;
  /** Dust bunnies whose place in the bunch this part takes: "swapped in". 0 for none. */
  swapped: number;
};

export type Row = {
  /** 0 is 19:00, 10 is 05:00. */
  hour: number;
  tick: number;
  parts: readonly Part[];
  /** The kind this row brings for the first time, alone. "" for every other row. */
  first: Kind | "";
};

/** The eleven hours of the night. The polisher comes at 06:00 and morning is 07:00. */
export const HOURS = 11;

/** The hour index of 06:00, the polisher's: the hour after the last of the eleven. */
export const BOSS_HOUR = HOURS;

/** What the clock shows, by hour index; 11 is the boss and 12 is morning. */
export const CLOCK = ["19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] as const;

/** The table's "Bunch size" column: [dust bunnies, tokens] by hour. */
export const BUNCH: readonly (readonly [number, number])[] = [
  [4, 0],
  [5, 0],
  [5, 1],
  [6, 1],
  [6, 1],
  [6, 2],
  [7, 2],
  [7, 2],
  [8, 2],
  [8, 3],
  [8, 3],
];

/** Where the 19:00 rack's apex stands: 211 u straight ahead of him. */
export const RACK_APEX = { x: 180, y: 163 } as const;

const part = (n: number, kind: Kind, form: Form, swapped = 0): Part => ({ kind, n, form, swapped });
const row = (hour: number, tick: number, parts: Part[], first: Kind | "" = ""): Row => ({ hour, tick, parts, first });

/** A bunch: a blob of dust bunnies with loose tokens. */
const bunch = (bunnies: number, tokens: number): Part[] =>
  tokens > 0 ? [part(bunnies, "bunny", "blob"), part(tokens, "token", "loose")] : [part(bunnies, "bunny", "blob")];
const beside = part(1, "battery", "beside", 1);
const under = part(1, "gum", "under");
const v = part(5, "envelope", "V", 5);

export const ROWS: readonly Row[] = [
  // 19:00, bunches of 4.
  row(0, 0, [part(4, "bunny", "rack")]),
  row(0, 228, bunch(4, 0)),
  row(0, 456, bunch(4, 0)),
  // 20:00, bunches of 5. The first token.
  row(1, 0, [part(1, "token", "alone")], "token"),
  row(1, 228, bunch(5, 0)),
  row(1, 456, bunch(5, 0)),
  // 21:00, bunches of 5 + 1. The first gum.
  row(2, 0, [part(1, "gum", "alone")], "gum"),
  row(2, 342, bunch(5, 1)),
  row(2, 684, bunch(5, 1)),
  // 22:00, bunches of 6 + 1. The first battery.
  row(3, 0, [part(1, "battery", "alone")], "battery"),
  row(3, 342, bunch(6, 1)),
  row(3, 684, bunch(6, 1)),
  // 23:00, bunches of 6 + 1. The first newsletter: a V of five envelopes.
  row(4, 0, [part(5, "envelope", "V")], "envelope"),
  row(4, 342, [part(5, "bunny", "blob"), beside, part(1, "token", "loose")]),
  row(4, 513, [part(3, "token", "file")]),
  row(4, 684, [...bunch(6, 1), under]),
  // 00:00, bunches of 6 + 2. Venture capital: the money bag.
  row(5, 0, [part(1, "bag", "alone")], "bag"),
  row(5, 342, bunch(6, 2)),
  row(5, 513, [part(3, "token", "file")]),
  row(5, 684, bunch(6, 2)),
  // 01:00, bunches of 7 + 2. The love of your life: only if he is missing a heart.
  row(6, 0, bunch(7, 2)),
  row(6, 342, [part(1, "heart", "tile")]),
  row(6, 684, bunch(7, 2)),
  // 02:00, bunches of 7 + 2.
  row(7, 0, [part(6, "bunny", "blob"), beside, part(2, "token", "loose"), under]),
  row(7, 342, [part(2, "bunny", "blob"), v, part(2, "token", "loose")]),
  row(7, 513, [part(3, "token", "file")]),
  // 03:00, bunches of 8 + 2.
  row(8, 0, [part(7, "bunny", "blob"), beside, part(2, "token", "loose"), under]),
  row(8, 342, [part(7, "bunny", "blob"), beside, part(2, "token", "loose")]),
  row(8, 513, [part(3, "token", "file")]),
  // 04:00, bunches of 8 + 3.
  row(9, 0, [part(3, "bunny", "blob"), v, part(3, "token", "loose")]),
  row(9, 342, [part(3, "bunny", "blob"), v, part(3, "token", "loose")]),
  row(9, 513, [part(2, "token", "file")]),
  // 05:00, bunches of 8 + 3. Here the gum too takes a dust bunny's place.
  row(10, 0, [part(6, "bunny", "blob"), beside, part(1, "gum", "under", 1), part(3, "token", "loose")]),
  row(10, 342, [part(3, "bunny", "blob"), v, part(3, "token", "loose")]),
  row(10, 513, [part(2, "token", "file")]),
];

/**
 * 06:00, the boss's hour. Its three lines are not rows of the order above:
 * they are dealt as written at every pace, by the polisher's own rules.
 */
export type BossLine = {
  /** "tick": once, at `tick`. "every": at `tick` and every `tick` after. "plugHit": on each hit on the plug. */
  when: "tick" | "every" | "plugHit";
  tick: number;
  kind: Kind;
  n: number;
  /** A dust bunny of the boss's hour is worth no points. */
  worth0: boolean;
};

export const SIX: readonly BossLine[] = [
  { when: "tick", tick: 0, kind: "polisher", n: 1, worth0: false },
  { when: "every", tick: 240, kind: "bunny", n: 1, worth0: true },
  { when: "plugHit", tick: 0, kind: "bunny", n: 3, worth0: true },
];
