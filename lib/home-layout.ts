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
 * The homepage is a room where this matches and a scrolling list where
 * it does not. It is the media query behind Tailwind's `md:`, in rem and
 * not in pixels, so the script's choice and the `md:` classes cannot
 * disagree: 48rem is 768px at the usual text size, and 960px for a
 * visitor whose browser is set to 20px text. Written as 768px it used to
 * mount the room in a window the stylesheet was laying out as the list.
 */
export const ROOM_MEDIA = "(min-width: 48rem)";

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
