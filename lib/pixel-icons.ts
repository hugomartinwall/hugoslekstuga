/**
 * The site's pixel icons — 12×12 bitmaps, one per tool plus a few for
 * the chrome. `#` is a lit cell, `.` is empty.
 *
 * They replace the Unicode symbols (◴ ⊚ ▦ …) the tools used to wear:
 * those are drawn by whatever font the visitor's OS falls back to, so
 * every platform showed a slightly different mark. A bitmap is the same
 * everywhere, and it is drawn the way Hugo is drawn — out of cells.
 *
 * Keyed by tool slug for tools; games do not need one here (on the
 * homepage they are cabinets, drawn by lib/hugo/sprite.ts), but they get
 * the shared `game` icon in lists.
 *
 * Plain data, no React — the homepage canvas and the OG image read the
 * same rows that <PixelIcon> renders as SVG.
 */
export const ICON_SIZE = 12;

export const PIXEL_ICONS = {
  // A four-point spark: one small good thing.
  advice: [
    ".....##.....",
    ".....##.....",
    "....####....",
    "....####....",
    "..########..",
    "############",
    "############",
    "..########..",
    "....####....",
    "....####....",
    ".....##.....",
    ".....##.....",
  ],
  // A clock face, hands at twelve and three.
  focus: [
    "...######...",
    "..#......#..",
    ".#...##...#.",
    "#....##....#",
    "#....##....#",
    "#....#####.#",
    "#....#####.#",
    "#..........#",
    "#..........#",
    ".#........#.",
    "..#......#..",
    "...######...",
  ],
  // A wheel, half of it lit.
  roll: [
    "...######...",
    "..####...#..",
    ".#####....#.",
    "######.....#",
    "######.....#",
    "######.....#",
    "######.....#",
    "######.....#",
    "######.....#",
    ".#####....#.",
    "..####...#..",
    "...######...",
  ],
  // A breath: a ring around a full centre.
  breathe: [
    "...######...",
    "..#......#..",
    ".#........#.",
    "#...####...#",
    "#..######..#",
    "#..######..#",
    "#..######..#",
    "#..######..#",
    "#...####...#",
    ".#........#.",
    "..#......#..",
    "...######...",
  ],
  // Struck through: the metadata comes off.
  strip: [
    "...######...",
    "..#......#..",
    ".#......###.",
    "#......###.#",
    "#.....###..#",
    "#....###...#",
    "#...###....#",
    "#..###.....#",
    "#.###......#",
    ".###......#.",
    "..#......#..",
    "...######...",
  ],
  // Big pixels.
  pixla: [
    "####....####",
    "####....####",
    "####....####",
    "####....####",
    "....####....",
    "....####....",
    "....####....",
    "....####....",
    "####....####",
    "####....####",
    "####....####",
    "####....####",
  ],
  // Lines of placeholder text, the last one short.
  lorem: [
    "############",
    "############",
    "............",
    "##########..",
    "##########..",
    "............",
    "############",
    "############",
    "............",
    "#######.....",
    "#######.....",
    "............",
  ],
  // The grid.
  sudoku: [
    "...##..##...",
    "...##..##...",
    "...##..##...",
    "############",
    "############",
    "...##..##...",
    "...##..##...",
    "############",
    "############",
    "...##..##...",
    "...##..##...",
    "...##..##...",
  ],
  // A sail over a hull, on the water.
  sjokort: [
    ".....#......",
    ".....##.....",
    ".....###....",
    ".....####...",
    ".....#####..",
    ".....######.",
    ".....#......",
    "############",
    ".##########.",
    "..########..",
    "............",
    "##..####..##",
  ],
  // An arcade cabinet, for games in lists.
  game: [
    "..########..",
    ".##########.",
    ".##......##.",
    ".##......##.",
    ".##......##.",
    ".##########.",
    ".##########.",
    ".##.####.##.",
    ".##########.",
    ".##########.",
    ".##......##.",
    ".##......##.",
  ],
  search: [
    "..#####.....",
    ".#.....#....",
    "#.......#...",
    "#.......#...",
    "#.......#...",
    "#.......#...",
    ".#.....#....",
    "..######....",
    ".......###..",
    "........###.",
    ".........###",
    "..........##",
  ],
  about: [
    "....####....",
    "....####....",
    "....####....",
    "............",
    "...#####....",
    "....####....",
    "....####....",
    "....####....",
    "....####....",
    "....####....",
    "...######...",
    "...######...",
  ],
  back: [
    "............",
    ".....##.....",
    "....##......",
    "...##.......",
    "..##########",
    ".###########",
    "..##########",
    "...##.......",
    "....##......",
    ".....##.....",
    "............",
    "............",
  ],
  close: [
    "##........##",
    "###......###",
    ".###....###.",
    "..###..###..",
    "...######...",
    "....####....",
    "....####....",
    "...######...",
    "..###..###..",
    ".###....###.",
    "###......###",
    "##........##",
  ],
} as const satisfies Record<string, readonly string[]>;

export type PixelIconName = keyof typeof PIXEL_ICONS;

/** The icon for a registry slug: its own if it has one, the cabinet for games, else the spark. */
export function iconForSlug(slug: string, isGame: boolean): PixelIconName {
  if (slug in PIXEL_ICONS) return slug as PixelIconName;
  return isGame ? "game" : "advice";
}

/** Each row as runs of lit cells: [x, width] pairs — what a renderer needs. */
export function iconRuns(name: PixelIconName): { y: number; x: number; w: number }[] {
  const rows = PIXEL_ICONS[name];
  const out: { y: number; x: number; w: number }[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === "#") w++;
      out.push({ y, x, w });
      x += w;
    }
  }
  return out;
}
