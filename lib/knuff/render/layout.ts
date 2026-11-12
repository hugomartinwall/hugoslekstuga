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

/** The top bar's height, px. */
export const BAR_H = 48;
/** The thumb deck a phone is sure of where the room is drawn at 1 px a unit or more, px. */
export const DECK_MIN = 130;
/** The margin under the room on a laptop, px. There is no deck there. */
export const LAPTOP_MARGIN = 28;
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
  return {
    s,
    dpr,
    coarse,
    tooSmall: !playable && s < MIN_SCALE,
    page: { w: pageW, h: pageH },
    bar: { x: roomX, y: top, w: roomW, h: BAR_H },
    room: { x: roomX, y: roomY, w: roomW, h: roomH },
    deck: { x: roomX, y: roomY + roomH, w: roomW, h: 0 },
  };
}
