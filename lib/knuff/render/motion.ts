/**
 * Reduced motion: the other games' three-state policy, and nothing else.
 *
 * This is not their module as it stands. Theirs reads and writes its own
 * storage key, registers a media-query listener when it is imported, and
 * keeps callbacks nobody can remove. Here the module holds no storage and
 * no listener: game.ts reads the system's setting, registers the listener
 * through its one disposers list, and hands the answer to whoever draws.
 *
 * Reduced motion changes what is drawn (no shake, no trail, no squash,
 * fewer particles). It never changes a rule or a timing.
 */

/** The player's choice: follow the system, always reduced, or always full. */
export type MotionPref = "auto" | "on" | "off";

/** The whole policy in one expression: the player's choice wins over the system's, both ways. */
export function effectiveReduced(pref: MotionPref, os: boolean): boolean {
  return pref === "auto" ? os : pref === "on";
}
