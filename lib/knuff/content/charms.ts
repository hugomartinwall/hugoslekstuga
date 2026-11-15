/**
 * The charms (spec §6) and the ten plates they are bolted to (§3.1), as
 * data.
 *
 * A wall charm sits on a plate and fires every time he bounces off it. A
 * body charm changes him for the rest of the night. Their numbers are
 * knobs (content/tune.ts); what the player reads about each is in
 * content/copy.ts; their colours and icons are the renderer's.
 */

/** The wall charms, in the order the offer lists them before it shuffles (§6.3). */
export type WallCharm = "bumper" | "pip" | "spark" | "bell" | "coin";
/** The body charms. Each can be taken once. */
export type BodyCharm = "heavy" | "longBurn" | "fourthPip" | "thickSkin" | "wide";
export type Charm = WallCharm | BodyCharm;

export const WALL_CHARMS: readonly WallCharm[] = ["bumper", "pip", "spark", "bell", "coin"];
export const BODY_CHARMS: readonly BodyCharm[] = ["heavy", "longBurn", "fourthPip", "thickSkin", "wide"];
export const CHARMS: readonly Charm[] = [...WALL_CHARMS, ...BODY_CHARMS];

export function isWallCharm(c: string): c is WallCharm {
  return (WALL_CHARMS as readonly string[]).includes(c);
}

export function isBodyCharm(c: string): c is BodyCharm {
  return (BODY_CHARMS as readonly string[]).includes(c);
}

/** The cushions are cut into this many plates, numbered clockwise from the top left. */
export const PLATES = 10;

/** No charm: a dark plate. */
export const DARK = "";

/**
 * The two plates lit from the start: Bumper on plate 0 (top left) and Pip
 * on plate 4 (lower right side), so the player meets the idea in the
 * first ten seconds. A launch straight up from the start bounces off
 * plate 1, which is dark.
 */
export const START_PLATES: readonly string[] = ["bumper", DARK, DARK, DARK, "pip", DARK, DARK, DARK, DARK, DARK];

/** All ten plates dark: the step-1 night, and the feel lock. */
export const DARK_PLATES: readonly string[] = new Array<string>(PLATES).fill(DARK);

/**
 * The plate each plate shares a corner with, or -1. Four pairs: 9 and 0,
 * 1 and 2, 4 and 5, 6 and 7. Pip may not go on a plate that shares a
 * corner with a Bumper plate, nor Bumper beside a Pip plate.
 */
export const CORNER_MATE: readonly number[] = [9, 2, 1, -1, 5, 4, 7, 6, -1, 0];

/** The cushion each plate is part of. */
export const PLATE_SIDE: readonly ("top" | "right" | "bottom" | "left")[] = [
  "top",
  "top",
  "right",
  "right",
  "right",
  "bottom",
  "bottom",
  "left",
  "left",
  "left",
];
