/**
 * Key bindings as data — the single source of truth. Layout rule (house
 * convention): `e.code` for positional keys (the WASD cluster, arrows,
 * Space, Shift — physical position is what matters, so AZERTY works),
 * `e.key` for mnemonic letters (p for pause, m for mute). Escape is never
 * the only path to an action.
 */

export type MoveDir = "up" | "down" | "left" | "right";

export const MOVE_CODES: Record<string, MoveDir> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Verb actions by physical code (positional cluster around WASD). */
export const ACTION_CODES: Record<string, string> = {
  Space: "attack",
  KeyJ: "attack",
  ShiftLeft: "dodge",
  ShiftRight: "dodge",
  KeyK: "dodge",
  KeyQ: "dagger",
  KeyE: "parry",
  KeyR: "dash",
  KeyF: "whirl",
  KeyG: "bomb",
  KeyV: "flash",
  KeyX: "overclock",
  KeyC: "flask",
  Enter: "confirm",
  Escape: "pause",
};

/** Mnemonic keys by `e.key` (layout-independent meaning). */
export const ACTION_KEYS: Record<string, string> = {
  p: "pause",
  m: "mute",
};
