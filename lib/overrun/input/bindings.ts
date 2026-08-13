/**
 * Key bindings, as data — and the one place the control scheme is written down.
 *
 * The help card renders CONTROL_LINES verbatim (and keyboard.test.ts enforces
 * that every bound mnemonic appears in it). marketing/copy.md describes the
 * same controls in prose and CANNOT read this file — when a binding changes,
 * update its Controls section by hand, or the store listing describes a
 * different game (which is exactly how it once claimed Escape was the pause
 * key months after P and Space became primary).
 *
 * Layout rule, which is the opposite of the usual WASD advice:
 *   - `e.code` for positional keys with no letter on them (arrows, Space,
 *     Enter, Tab). Position is what the player is reaching for.
 *   - `e.key` for mnemonic letters (P for pause, U for upgrade). The printed
 *     letter is what the player is reaching for, and `e.code` would send an
 *     AZERTY player to the wrong physical key.
 *
 * We deliberately bind no WASD cluster, so there is no AZERTY problem to
 * create — that stayed true when the camera arrived: keyboard panning rides
 * the focus keys (selecting or aiming at an off-screen ball eases the camera
 * to it), so only zoom (+/-) and reset (0/Home) needed keys, and none of
 * them is a letter. X and C are chosen over Q/Z/W because they sit
 * identically on both layouts.
 *
 * Escape is never the ONLY path to an action — browsers reserve it (it exits
 * fullscreen at the browser level regardless of preventDefault()). Every
 * binding below that lists Escape lists something else too.
 */

export interface Binding {
  /** Values compared against `e.code`. */
  codes?: readonly string[];
  /** Values compared against `e.key`, case-insensitively. */
  keys?: readonly string[];
}

export const BINDINGS = {
  pause: { keys: ["p"], codes: ["Escape"] },
  mute: { keys: ["m"] },
  confirm: { codes: ["Space", "Enter", "NumpadEnter"] },
  cancel: { keys: ["x"], codes: ["Escape"] },
  upgrade: { keys: ["u"] },
  cancelStream: { keys: ["c"] },
  sendRatio: { keys: ["f"] },
  // Abilities: the printed digit is the mnemonic (`keys`), but the top-row
  // digits are shifted on AZERTY, so the positional codes catch the physical
  // key too. Numpad included for the desktop strategy crowd.
  ability1: { keys: ["1"], codes: ["Digit1", "Numpad1"] },
  ability2: { keys: ["2"], codes: ["Digit2", "Numpad2"] },
  ability3: { keys: ["3"], codes: ["Digit3", "Numpad3"] },
  cycleNext: { codes: ["Tab"] },
  up: { codes: ["ArrowUp"] },
  down: { codes: ["ArrowDown"] },
  left: { codes: ["ArrowLeft"] },
  right: { codes: ["ArrowRight"] },
  // The camera keys. Arrows walk BALL focus (the accessibility path) and the
  // camera follows focus, so zoom and reset are all the keyboard needs.
  // "Equal" is the physical +/= key unshifted — positional, not a letter.
  zoomIn: { keys: ["+"], codes: ["Equal", "NumpadAdd"] },
  zoomOut: { keys: ["-"], codes: ["NumpadSubtract"] },
  resetView: { codes: ["Home", "Digit0", "Numpad0"] },
} as const satisfies Record<string, Binding>;

export function matches(e: KeyboardEvent, b: Binding): boolean {
  if (b.codes?.includes(e.code)) return true;
  const k = e.key.toLowerCase();
  return b.keys?.some((x) => x === k) ?? false;
}

/** Any binding that starts play from the start card — i.e. not pause. */
export function isPauseKey(e: KeyboardEvent): boolean {
  return matches(e, BINDINGS.pause);
}

/**
 * The controls, verbatim, for the help card and the marketing copy.
 *
 * Kept to what is actually bound. If you add a binding, add its line here and
 * the help card picks it up with no further edit.
 */
export const CONTROL_LINES: readonly string[] = [
  "DRAG FROM YOUR BALL TO A TARGET",
  "OR TAP YOUR BALL, THEN THE TARGET",
  "ARROWS AIM · SPACE SENDS",
  "U UPGRADES · X CANCELS · C STOPS A STREAM",
  "F SETS HALF OR FULL SEND",
  "1 2 3 FIRE POWERS · TAP A BALL TO AIM THEM",
  "DRAG EMPTY SPACE TO LOOK · PINCH OR WHEEL ZOOMS",
  "+ - ZOOMS · 0 RESETS THE VIEW",
  "P PAUSES · M MUTES",
];
