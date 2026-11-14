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
import type { State, Thing, Tune } from "../sim/types";

/** The top bar's height, px. */
export const BAR_H = 48;
/** The thumb deck a phone is sure of where the room is drawn at 1 px a unit or more, px. */
export const DECK_MIN = 130;
/** The margin under the room on a laptop, px. There is no deck there. */
export const LAPTOP_MARGIN = 28;
/**
 * The bar on a laptop is never narrower than this, px (the room at 1 px a
 * unit), where the room has shrunk under it. At 300 a six-digit score
 * stood a few pixels from the clock in a 768 × 479 window and read as one
 * string with it.
 */
export const BAR_MIN_W = 360;
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
 * Under a scale of 0.75 the game does not run, on a phone and on a laptop
 * alike: a panel says why (turn the phone upright; make the window
 * taller). So a laptop is too small only when its page is under 436 px
 * tall.
 */
export function layoutFor(pageW: number, pageH: number, dpr: number, coarse: boolean, safe: Insets): Layout {
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
  }
  // A page with no height at all still gets a room, not one turned inside
  // out (it is too small to play, and nothing is drawn in it).
  s = Math.max(s, 0.05);

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
  // The bar sits on the room and is as wide as it, but never narrower
  // than the room at 1 px a unit: under that a six-digit score runs into
  // the clock, which the bar must hold clear of each other (§9.2).
  const barW = Math.max(roomW, Math.min(W, BAR_MIN_W));
  const barX = whole(roomX - (barW - roomW) / 2);
  return {
    s,
    dpr,
    coarse,
    tooSmall: s < MIN_SCALE,
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

/**
 * The `i`th of the night's twelve steps in the top bar (§9.2): an hour
 * done, the hour now (lit magenta), or an hour to come. The twelfth is the
 * boss's. No hour is in progress before the first launch, or once morning
 * has come. On a night without the polisher morning comes when 05:00 ends:
 * the State's hour is then one past the last, the twelfth step, and that
 * hour never began. When the polisher is beaten, its step is done.
 */
export function hourStep(s: State, i: number): "done" | "now" | "to come" {
  if (i < s.night.hour) return "done";
  if (i === s.night.hour && s.ended === "morning" && s.boss.present) return "done";
  if (i === s.night.hour && s.phase !== "waiting" && s.ended !== "morning") return "now";
  return "to come";
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
  // His radius after charms (Wide): the distances are from his circle.
  const r = s.stats.radius;
  if (y - s.room.top <= r + 15) return { pips: r + 10, meter: r + 20 };
  if (s.room.bottom - y <= r + 15) return { pips: -(r + 10), meter: -(r + 20) };
  return { pips: r + 10, meter: -(r + 11) };
}

// ── A dazed thing ─────────────────────────────────────────────────────

/** A dust bunny's eyes are squares this many units across, their outer edges half its radius from its centre, on its middle row. */
export const EYE_U = 2.4;

/**
 * The two squares a dazed thing wears in place of its eyes (§9.5), in
 * units from its centre: 3 × 3 u, 3 u apart, on its middle row. They reach
 * 4.8 u from its centre, well inside a dust bunny (8 u) and a token (7 u),
 * and a dust bunny's eyes lie inside them. They are drawn in a pass after
 * every body, so nothing in the room covers them.
 */
export const DAZE_MARKS: readonly Rect[] = [
  { x: -4.5, y: -1.5, w: 3, h: 3 },
  { x: 1.5, y: -1.5, w: 3, h: 3 },
];

/**
 * The order the bodies in the room are drawn in, into `out`: the live
 * ones, then the dazed ones. Announced things are left out, and so are an
 * offer's tiles, which lie on the floor under everything that moves. Dust bunnies
 * are kept apart, but a token rolls through anything and a dust bunny
 * walks through a dazed token: drawn over the live thing it overlaps, a
 * dazed thing's marks lie on its own body, never on one that can cost a
 * heart.
 */
export function bodyOrder(s: State, out: Thing[]): Thing[] {
  out.length = 0;
  // Gum lies flat on the floor and is drawn with it; a pickup and the love heart are tiles on the floor.
  for (const d of s.things) if (d.kind !== "pickup" && d.kind !== "gum" && d.kind !== "heart" && s.tick >= d.landTick && s.tick >= d.dazedUntil) out.push(d);
  for (const d of s.things) if (d.kind !== "pickup" && d.kind !== "gum" && d.kind !== "heart" && s.tick >= d.landTick && s.tick < d.dazedUntil) out.push(d);
  return out;
}
