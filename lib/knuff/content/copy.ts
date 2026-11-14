/**
 * Every word the player reads. Drafts in the site's voice: the owner has
 * the last say on each of them.
 *
 * None of them names the mascot. The architecture suite reads this file
 * for his internal name.
 */

/** The root's label for a screen reader: how to play, in a sentence. */
export const ROOT_LABEL =
  "Knuff, an arcade game. Pull back anywhere on the screen and let go to launch him across the room; with a mouse, drag back and let go; on the keys, the arrows aim, Up points at the nearest intruder and Space launches. He bounces off the cushions and pops what he hits while he is fast. Escape pauses.";

/** The start hint, by pull direction. Shown until the third launch. */
export const HINT = {
  /** Under a thumb. */
  touch: { back: "PULL BACK. LET GO.", push: "PUSH. LET GO." },
  /** Where there is no touch screen: the keys first, then the mouse. Two lines. */
  mouse: {
    back: ["ARROWS AIM, SPACE LAUNCHES", "OR DRAG BACK AND LET GO"],
    push: ["ARROWS AIM, SPACE LAUNCHES", "OR PUSH AND LET GO"],
  },
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

/** The keys of the panels. RESUME on the Resume panel is followed by the hour the night stopped in: RESUME 23:00. */
export const KEYS = {
  resume: "RESUME",
  again: "AGAIN",
  back: "BACK TO PLAYHOUSE",
  newNight: "NEW NIGHT",
} as const;

/** What a screen reader calls each panel. None names him. */
export const PANEL_LABEL = {
  pause: "Paused",
  waiting: "A night is waiting",
  end: "Night over",
  tooSmall: "Page too small",
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
  /** The line of a night that 06:00 ran out on, with the polisher unbeaten. */
  dawn: "the lights came on",
} as const;

/** What the end panel's line calls the kind that took the last heart. */
export const KIND_NAME: Readonly<Record<string, string>> = {
  bunny: "a dust bunny",
  token: "a runaway token",
  battery: "a battery",
  envelope: "a newsletter",
  bag: "venture capital",
  polisher: "the floor polisher",
};

/**
 * What the charms are called (§6.4), in Silkscreen: on an offered plate's
 * insert, under a pickup's tile, in the top bar while the aim would take
 * one, and in the pause panel.
 */
export const CHARM_NAME: Readonly<Record<string, string>> = {
  bumper: "BUMPER",
  pip: "PIP",
  spark: "SPARK",
  bell: "BELL",
  coin: "COIN SLOT",
  heavy: "HEAVY",
  longBurn: "LONG BURN",
  fourthPip: "FOURTH PIP",
  thickSkin: "THICK SKIN",
  wide: "WIDE",
};

/**
 * Each charm's one line (§6.4), at most 27 characters: the top bar shows it
 * under the name while the aim line would take the charm, or bounce off a
 * plate that carries it. It is the only explanation a charm gets.
 */
export const CHARM_LINE: Readonly<Record<string, string>> = {
  bumper: "bounce off: fast again",
  pip: "bounce off: a pip back",
  spark: "bounce off: pops reach wide",
  bell: "bounce off: stuns the room",
  coin: "bounce off: pops pay double",
  heavy: "pops slow him less",
  longBurn: "stays fast for longer",
  fourthPip: "one more launch in hand",
  thickSkin: "one more heart",
  wide: "bigger, and pops slow less",
};

/** The pause panel's heading over the body charms taken. */
export const CHARMS_TAKEN = "CHARMS";

/**
 * The pause panel's three settings (§9.7) and the choices of the two
 * groups. Motion's three are the stored values "auto", "on" and "off".
 */
export const SETTINGS = {
  sound: "Sound",
  pull: "Pull",
  motion: "Motion",
  pullChoice: { back: "back", push: "push" },
  motionChoice: { auto: "system", on: "reduced", off: "full" },
} as const;
