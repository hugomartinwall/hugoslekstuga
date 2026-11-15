/**
 * Geometry of the homepage room — where the arcade row stands and how
 * much of the room it takes. Pure numbers, shared by everything that
 * has to agree on them: ToolMap (draws the cabinets and keeps the swarm
 * above them), PixelWordmark (centres the title in what is left) and
 * HomeShell (parks the hints).
 *
 * Coordinates are the room's own (the homepage room is one viewport at
 * the page origin, so they are viewport coordinates too).
 */

/** The big cabinet is drawn on a 38×42 grid of `unit` pixels. */
export const CABINET_GRID_W = 38;
export const CABINET_GRID_H = 42;

/** Space under the cabinets for their name labels. */
const ROW_BASE = 40;
/** Breathing room between the swarm and the top of the row. */
const ROW_HEADROOM = 30;

/**
 * The smallest window that gets the room, in rem. Anything narrower or
 * shorter gets the list. These two numbers are the one place the size is
 * decided: ROOM_MEDIA below is built from them, and the stylesheet's
 * `room:` / `list:` variants (app/globals.css, which cannot import a
 * constant) carry a copy that test/home/room-media.test.ts holds to them.
 *
 * In rem, like every other breakpoint in the stylesheet: 48rem by 35rem
 * is 768 by 560px at the usual text size, and 960 by 700px for a visitor
 * whose browser is set to 20px text. (And in px too, as a floor: see
 * PX_PER_REM below.)
 */
export const ROOM_MIN_WIDTH_REM = 48;
/**
 * Why 35: the room is one screen and its parts do not shrink below a
 * floor. The arcade row takes 154px at its smallest (84px cabinets, 40px
 * for their names, 30px of headroom: see cabinetRow), and the title
 * never starts above 132px (ROOM_TOP_CLAMP in PixelWordmark keeps it out
 * of the corner mascot and the keys). The nine orbs need a row above the
 * title and a row below it, and under about 540px there is no such band:
 * the cabinets' names fall off the bottom edge (a large phone held
 * sideways is 844 to 932px wide and 390 to 430px tall, so it used to get
 * this room) and the orbs come to rest on the title. Measured before the
 * rule existed: an orb sat on the title in most samples at 800x480,
 * 1280x480 and 1024x520, and in none at 1366x540 or 1024x600. 35rem is
 * 560px, a step above the 540px that measured clean. If the swarm turns
 * out to need more height in the narrowest room (768 by 560), raise this
 * one number, and the stylesheet's copy with it.
 */
export const ROOM_MIN_HEIGHT_REM = 35;

/**
 * The same size in px, at the usual 16px a rem: the floor under the rem
 * condition. Everything in the room is laid out in px (the cabinets, the
 * keys, the orbs and their names), so a browser set to SMALLER text must
 * not get the room in a smaller window: at 12px text, 48rem by 35rem is
 * 576 by 420px, and there the cabinets' names ended 41px under the
 * bottom edge. A browser set to larger text is the rem condition's
 * business: it gets the list in a bigger window.
 */
const PX_PER_REM = 16;

/**
 * The homepage is a room where this matches and a scrolling list where
 * it does not. Read with matchMedia (HomeShell); the stylesheet asks the
 * same question with the same words. Written in px alone it once mounted
 * the room in a window the stylesheet was laying out as the list, and
 * written for the width alone it gave the room to windows too short to
 * hold it.
 *
 * One template literal, not two joined with `+`: the production
 * minifier folded the pair into "(min-height: 35 and (min-width: ...",
 * which never matches, so the built site showed an empty room. The dev
 * server does not minify and never showed it. test/home/room-media
 * runs the minifier over this file.
 */
export const ROOM_MEDIA = `(min-width: ${ROOM_MIN_WIDTH_REM}rem) and (min-height: ${ROOM_MIN_HEIGHT_REM}rem) and (min-width: ${ROOM_MIN_WIDTH_REM * PX_PER_REM}px) and (min-height: ${ROOM_MIN_HEIGHT_REM * PX_PER_REM}px)`;

export type CabinetRow = {
  /** Canvas px per cabinet grid unit (3 = 114×126). */
  unit: number;
  w: number;
  h: number;
  /** Centre of each cabinet, left to right. */
  centers: { x: number; y: number }[];
  /** y of the cabinets' top edge. */
  top: number;
  /** Height the row takes at the bottom of the room: the swarm, the
   *  title and the hints all stay above `roomHeight - reserve`. */
  reserve: number;
};

export function cabinetRow(
  width: number,
  height: number,
  count: number,
): CabinetRow {
  // Tall rooms get the full-size cabinet; short ones step it down so
  // the swarm keeps a usable band above the row.
  let unit = height >= 840 ? 3 : height >= 700 ? 2.5 : 2;
  // And never wider than the room can seat side by side.
  while (unit > 1.5 && count * CABINET_GRID_W * unit + (count + 1) * 20 > width) {
    unit -= 0.5;
  }
  const w = CABINET_GRID_W * unit;
  const h = CABINET_GRID_H * unit;
  const gap =
    count > 1
      ? Math.max(20, Math.min(96, (width - count * w) / (count + 1)))
      : 0;
  const total = count * w + Math.max(0, count - 1) * gap;
  const startX = Math.round((width - total) / 2 + w / 2);
  const bottom = height - ROW_BASE;
  const cy = Math.round(bottom - h / 2);
  const centers = Array.from({ length: count }, (_, i) => ({
    x: startX + Math.round(i * (w + gap)),
    y: cy,
  }));
  return {
    unit,
    w,
    h,
    centers,
    top: cy - h / 2,
    reserve: count > 0 ? h + ROW_BASE + ROW_HEADROOM : 0,
  };
}

/** Vertical centre of the band the swarm and the title share. */
export function swarmCenterY(height: number, reserve: number): number {
  return (height - reserve) / 2;
}
