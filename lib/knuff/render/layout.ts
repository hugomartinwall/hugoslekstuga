/**
 * Where the room is drawn, and how big: the sizing rules of the spec (§9.1).
 *
 * Pure: a page size, the device's pixel ratio, the kind of pointer and
 * the safe-area insets go in, rectangles in CSS px come out. No DOM, so
 * the table of sizes in the spec can be checked under Node
 * (test/knuff/layout.test.ts). renderer.ts measures and calls this.
 *
 * One canvas holds the top bar, the room and, on a phone, the thumb deck
 * under the room. The room is 360 × 480 units on every device; `s` is the
 * scale, in CSS px per unit.
 */
import { ROOM_H, ROOM_W } from "../sim/state";
import type { State, Tune } from "../sim/types";

/** The top bar's height, px. */
export const BAR_H = 48;
/** The thumb deck a phone is sure of where the room is drawn at 1 px a unit or more, px. */
export const DECK_MIN = 130;
/** The margin under the room on a laptop, px. There is no deck there. */
export const LAPTOP_MARGIN = 28;
/** The playable's bar on a laptop is never narrower than this, px (the room at 0.83 px a unit). */
export const BAR_MIN_W = 300;
/** Under this scale the game does not run. */
export const MIN_SCALE = 0.75;

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Layout = {
  /** CSS px per room unit. */
  s: number;
  /** Device pixels per CSS px, as used for the canvas. */
  dpr: number;
  /** A coarse pointer: laid out as a phone, with a deck. */
  coarse: boolean;
  /** `s` came out under 0.75: the game does not run at this size. */
  tooSmall: boolean;
  /** The whole root, CSS px. */
  page: { w: number; h: number };
  /** The top bar: as wide as the page on a phone, as wide as the room on a laptop. */
  bar: Rect;
  /** The room, 360 × 480 units at `s`. */
  room: Rect;
  /** What is left under the room on a phone. Height 0 on a laptop. */
  deck: Rect;
};

/** Floating point leaves 7.999999999999999 where 8 was meant; a snap must not lose a step to it. */
const EPS = 1e-9;

/** The largest scale not above `fit` at which a sprite cell (2 u) is a whole number of device pixels. */
function snapToCells(fit: number, dpr: number): number {
  return Math.floor(fit * 2 * dpr + EPS) / (2 * dpr);
}

/**
 * `playable` is the builds the owner checks before the game ships (the
 * spec's steps 1 to 5): there a laptop page is never too small. Under 0.75
 * the room goes on shrinking to fit, however short the window. A phone
 * keeps its rule either way.
 */
export function layoutFor(
  pageW: number,
  pageH: number,
  dpr: number,
  coarse: boolean,
  safe: Insets,
  playable = false,
): Layout {
  // The page less the safe areas.
  const W = pageW - safe.left - safe.right;
  const H = pageH - safe.top - safe.bottom;
  /** A CSS length moved down onto a whole device pixel. */
  const whole = (v: number) => Math.floor(v * dpr + EPS) / dpr;

  let s: number;
  if (coarse) {
    const fit = Math.min(W / ROOM_W, (H - BAR_H - DECK_MIN) / ROOM_H);
    if (fit >= 1) {
      // 1. Room for the room and a full deck: snap down to a whole sprite cell.
      s = snapToCells(fit, dpr);
      if (s < 1) s = 1;
    } else if (W >= ROOM_W && H >= BAR_H + ROOM_H) {
      // 2. The room fits at 1 px a unit. The deck is what is left, however small.
      s = 1;
    } else {
      // 3. The room shrinks to fit, unsnapped.
      s = Math.min(W / ROOM_W, (H - BAR_H) / ROOM_H);
    }
  } else {
    const fit = Math.min(W / ROOM_W, (H - BAR_H - LAPTOP_MARGIN) / ROOM_H);
    s = snapToCells(fit, dpr);
    // The snap alone can only land on multiples of 1 / (2 × dpr): where it
    // comes out under 1 the room shrinks to fit instead, as on a phone.
    if (s < 1) s = Math.min(1, fit);
    // A window with no height at all still gets a room, not a negative one.
    if (playable) s = Math.max(s, 0.05);
  }

  const roomW = ROOM_W * s;
  const roomH = ROOM_H * s;
  const roomX = whole(safe.left + (W - roomW) / 2);

  if (coarse) {
    const roomY = safe.top + BAR_H;
    const deckY = roomY + roomH;
    return {
      s,
      dpr,
      coarse,
      tooSmall: s < MIN_SCALE,
      page: { w: pageW, h: pageH },
      bar: { x: safe.left, y: safe.top, w: W, h: BAR_H },
      room: { x: roomX, y: roomY, w: roomW, h: roomH },
      deck: { x: safe.left, y: deckY, w: W, h: Math.max(0, safe.top + H - deckY) },
    };
  }

  // A laptop: the block (top bar, room, margin) is centred in the page.
  const blockH = BAR_H + roomH + LAPTOP_MARGIN;
  const top = whole(safe.top + Math.max(0, (H - blockH) / 2));
  const roomY = top + BAR_H;
  // The bar sits on the room and is as wide as it. Where the playable has
  // shrunk the room under what the final route allows, a bar that narrow
  // would run the score into the clock: it keeps a width it can be read at.
  const barW = playable ? Math.max(roomW, Math.min(W, BAR_MIN_W)) : roomW;
  const barX = whole(roomX - (barW - roomW) / 2);
  return {
    s,
    dpr,
    coarse,
    tooSmall: !playable && s < MIN_SCALE,
    page: { w: pageW, h: pageH },
    bar: { x: barX, y: top, w: barW, h: BAR_H },
    room: { x: roomX, y: roomY, w: roomW, h: roomH },
    deck: { x: roomX, y: roomY + roomH, w: roomW, h: 0 },
  };
}

// ── Where the things drawn for reading go ─────────────────────────────

/** The deck must be this tall for the hint to be drawn in it, px. Under that it goes on the floor. */
export const DECK_HINT_MIN = 124;
/** The pad and the hand show until this launch. */
export const HINT_UNTIL_LAUNCH = 3;
/** The second hint shows from his first landing until this launch. */
export const HINT_AGAIN_UNTIL_LAUNCH = 6;

/** The pause key's box in the top bar, CSS px: 44 × 44 in the right corner. */
export function pauseKeyRect(bar: Rect): Rect {
  return { x: bar.x + bar.w - 52, y: bar.y + 2, w: 44, h: 44 };
}

/** Which of the two hints is up, from the State alone. */
export function hintFor(s: State): { hand: boolean; words: "first" | "again" | "" } {
  const launches = s.launch.id;
  const landed = launches >= 2 || (launches === 1 && !s.launch.active);
  return {
    hand: launches < HINT_UNTIL_LAUNCH,
    words: landed && launches < HINT_AGAIN_UNTIL_LAUNCH ? "again" : !landed && launches < HINT_UNTIL_LAUNCH ? "first" : "",
  };
}

/**
 * Where his pips and his meter go, as offsets in units from his centre
 * (negative is up the room). Near the top cushion the meter moves under
 * the pips; near the bottom one the pips move above him and the meter
 * above them. So neither leaves the floor.
 */
export function carriedAt(s: State, tune: Tune, y: number): { pips: number; meter: number } {
  const r = tune.himRadius;
  if (y - s.room.top <= r + 15) return { pips: r + 10, meter: r + 20 };
  if (s.room.bottom - y <= r + 15) return { pips: -(r + 10), meter: -(r + 20) };
  return { pips: r + 10, meter: -(r + 11) };
}
