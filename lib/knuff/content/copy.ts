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

/**
 * The second hint, two lines: from his first landing until his sixth
 * launch it takes the place of the first. The first seconds must teach it.
 */
export const HINT_AGAIN = ["FLING AGAIN", "BEFORE THE RING CLOSES"] as const;

/** The one line a page too small to play shows. */
export const TOO_SMALL = {
  phone: "turn the phone upright",
  laptop: "make the window taller",
} as const;

/** The keys of the panels. */
export const KEYS = {
  resume: "RESUME",
  again: "AGAIN",
  back: "BACK TO PLAYHOUSE",
} as const;

/** What a screen reader calls each panel. */
export const PANEL_LABEL = {
  pause: "Paused",
  end: "Night over",
} as const;

/** The end panel's labels. */
export const END = {
  best: "BEST",
  newBest: "NEW BEST",
  night: "NIGHT",
  bestShot: "BEST SHOT",
  /** What the panel calls a night that reached morning; any other night is called by the hour he fell in. */
  morning: "MORNING",
  /** The start of the line that says what took the last heart: "lost to a runaway token". */
  lostTo: "lost to",
} as const;

/** What the end panel's line calls the kind that took the last heart. */
export const KIND_NAME: Readonly<Record<string, string>> = {
  bunny: "a dust bunny",
  token: "a runaway token",
};
