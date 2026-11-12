/**
 * Every word the player reads. Drafts in the site's voice: the owner has
 * the last say on each of them.
 *
 * None of them names the mascot. The architecture suite reads this file
 * for his internal name.
 */

/** The root's label for a screen reader: how to play, in a sentence. */
export const ROOT_LABEL =
  "Knuff, an arcade game. Pull back anywhere on the screen and let go to launch him across the room; with a mouse, drag back and let go. He bounces off the cushions and pops what he hits while he is fast.";

/** The start hint, by pull direction. Shown until the third launch. */
export const HINT = {
  /** Under a thumb. */
  touch: { back: "PULL BACK. LET GO.", push: "PUSH. LET GO." },
  /**
   * Under a mouse. The spec's hint has a first line about the keys
   * (ARROWS AIM, SPACE LAUNCHES); it joins when the keyboard is built.
   */
  mouse: { back: "DRAG BACK AND LET GO", push: "PUSH AND LET GO" },
} as const;

/** The one line a page too small to play shows. */
export const TOO_SMALL = {
  phone: "turn the phone upright",
  laptop: "make the window taller",
} as const;
