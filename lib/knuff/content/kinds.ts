/**
 * The kinds of thing a night can bring: the spec's kind table (§5.1) as
 * data.
 *
 * Kind is told by outline; these are the numbers behind the outlines. A
 * kind is in this table from the day the timetable names it, and it is
 * BUILT from the step that gives it rules. Until then the night leaves it
 * out of its rows (sim/night.ts), whatever a caller asks for.
 *
 * Masses and speeds are knobs (content/tune.ts), not rows of this table.
 * What the end panel calls a kind is in content/copy.ts.
 */

/**
 * Every kind the timetable names, and the offer's pickup tile. The
 * polisher is the boss; it is here so 06:00's lines can name it.
 */
export type Kind = "bunny" | "token" | "gum" | "battery" | "envelope" | "bag" | "heart" | "pickup" | "polisher";

export type KindRow = {
  /** It collides as a circle of this radius, u. 0 for a box. */
  radius: number;
  /** It collides as a box this wide and this tall, u. 0 for a circle. */
  boxW: number;
  boxH: number;
  /** Hits it takes. 0: it never pops (a battery bursts; the heart is taken). */
  hits: number;
  /** Points: for the pop, or for each hit point taken off a thing that takes several. */
  points: number;
  /** It costs a heart if it touches him while he is landed. */
  hurts: boolean;
  /** While one is alive or announced the hour is not clear, and it counts when a row is called early. */
  clear: boolean;
  /** It counts toward the room's cap. The heart is not an intruder. */
  intruder: boolean;
};

export const KINDS: Record<Exclude<Kind, "polisher">, KindRow> = {
  bunny: { radius: 8, boxW: 0, boxH: 0, hits: 1, points: 10, hurts: true, clear: true, intruder: true },
  token: { radius: 7, boxW: 0, boxH: 0, hits: 1, points: 25, hurts: true, clear: true, intruder: true },
  gum: { radius: 0, boxW: 28, boxH: 12, hits: 2, points: 15, hurts: false, clear: false, intruder: true },
  battery: { radius: 10, boxW: 0, boxH: 0, hits: 0, points: 40, hurts: true, clear: true, intruder: true },
  envelope: { radius: 9, boxW: 0, boxH: 0, hits: 1, points: 15, hurts: true, clear: true, intruder: true },
  bag: { radius: 34, boxW: 0, boxH: 0, hits: 8, points: 40, hurts: true, clear: true, intruder: true },
  heart: { radius: 0, boxW: 28, boxH: 28, hits: 0, points: 0, hurts: false, clear: false, intruder: false },
  // A charm on a square tile (§6.3). Nothing hits it: it is taken. Its one
  // "hit" keeps it alive in the room until its offer is settled or closed.
  pickup: { radius: 0, boxW: 36, boxH: 36, hits: 1, points: 0, hurts: false, clear: false, intruder: false },
};

/** A kind of thing in the room that has rules so far: a thing in the room is one of these. */
export type BuiltKind = "bunny" | "token" | "gum" | "battery" | "envelope" | "bag" | "heart";

/**
 * The kinds that have rules so far, in the order they were built: what a
 * night can bring (State.night.kinds). The polisher is one of them: a
 * night whose kinds leave it out has no 06:00, and ends when 05:00 ends.
 * Gum and the battery came in step 4; the envelope (the newsletter's V),
 * the money bag (venture capital) and the love heart in step 5. (The heart
 * is not an intruder; its line of the timetable is dealt by its own rule.)
 */
export const BUILT: readonly (BuiltKind | "polisher")[] = ["bunny", "token", "polisher", "gum", "battery", "envelope", "bag", "heart"];

export function isBuilt(kind: string): kind is BuiltKind | "polisher" {
  return (BUILT as readonly string[]).includes(kind);
}

/**
 * The polisher's row of the kind table (§5.1, §8): a box, 120 u long in its
 * direction of travel and 60 u across; its plug pays this much for each
 * hit point it takes off. Its hits are the knob `bossHits`.
 */
export const POLISHER = { boxL: 120, boxW: 60, points: 200 } as const;
