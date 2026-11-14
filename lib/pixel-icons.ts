/**
 * The site's pixel icons — 12×12 bitmaps, one per tool plus a few for
 * the chrome. `#` is a lit cell, `.` is empty.
 *
 * They replace the Unicode symbols (◴ ⊚ ▦ …) the tools used to wear:
 * those are drawn by whatever font the visitor's OS falls back to, so
 * every platform showed a slightly different mark. A bitmap is the same
 * everywhere, and it is drawn the way Hugo is drawn — out of cells.
 *
 * Keyed by slug. On the homepage a game is a cabinet (drawn by
 * lib/hugo/sprite.ts), so a game's icon here is only for lists; one
 * without its own falls back to the shared `game` cabinet.
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
  // The games. On the homepage a game is a cabinet with its screen
  // playing; in a list (the search palette) each wears its own mark, so
  // five games are not five identical tiles.
  // A banner on its pole: take the node, plant the flag.
  overrun: [
    "..#.........",
    "..########..",
    "..#########.",
    "..########..",
    "..#########.",
    "..########..",
    "..#.........",
    "..#.........",
    "..#.........",
    "..#.........",
    ".###........",
    "#####.......",
  ],
  // One sword.
  adventure: [
    "..........##",
    ".........###",
    "........###.",
    ".......###..",
    "......###...",
    "..#..###....",
    "...####.....",
    "...###......",
    "..##.#......",
    ".##...#.....",
    "##..........",
    "#...........",
  ],
  // A sporeling's cap.
  greyrot: [
    "....####....",
    "..########..",
    ".##########.",
    "###.####.###",
    "###.####.###",
    "############",
    "############",
    "....####....",
    "....####....",
    "....####....",
    "...######...",
    "...######...",
  ],
  // What is left of whoever did not survive.
  "survival-maxx": [
    "..########..",
    ".##########.",
    "############",
    "############",
    "##..####..##",
    "##..####..##",
    "#####..#####",
    "############",
    ".##########.",
    "..##.##.##..",
    "..##.##.##..",
    "............",
  ],
  // Him, pulled back on a band. A simplified drawing of him, the one
  // icon that shows him: his 14×12 body does not fit in 12×12.
  knuff: [
    "......####..",
    ".....######.",
    "....########",
    "....#.##.###",
    "....#.##.###",
    "....########",
    ".....######.",
    "...#..####..",
    "..#.........",
    ".#..........",
    "##..........",
    "##..........",
  ],
  // An arcade cabinet: a game that has no mark of its own yet.
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
  // The back arrow, pointing the other way: "go on".
  forward: [
    "............",
    ".....##.....",
    "......##....",
    ".......##...",
    "##########..",
    "###########.",
    "##########..",
    ".......##...",
    "......##....",
    ".....##.....",
    "............",
    "............",
  ],
  // The same arrow, pointing up: with back and forward, the legend for
  // the arrow keys (the parkour's controls hint). Its shaft is two cells
  // shorter than theirs, so that all three stand on the same line: the
  // sideways arrows fill rows 1 to 9, and turned upright with its full
  // shaft this one reached row 11 and hung below them in the hint.
  up: [
    "............",
    ".....#......",
    "....###.....",
    "...#####....",
    "..#######...",
    ".##.###.##..",
    ".#..###..#..",
    "....###.....",
    "....###.....",
    "....###.....",
    "............",
    "............",
  ],
  // An eight-pointed burst: what the one forbidden key wears.
  burst: [
    ".....##.....",
    "#....##....#",
    ".##.####.##.",
    "..########..",
    "..########..",
    "############",
    "############",
    "..########..",
    "..########..",
    ".##.####.##.",
    "#....##....#",
    ".....##.....",
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
  // Add one.
  plus: [
    "............",
    ".....##.....",
    ".....##.....",
    ".....##.....",
    ".....##.....",
    ".##########.",
    ".##########.",
    ".....##.....",
    ".....##.....",
    ".....##.....",
    ".....##.....",
    "............",
  ],
  // Play: hear it, start it.
  play: [
    "............",
    "..##........",
    "..####......",
    "..######....",
    "..########..",
    "..##########",
    "..##########",
    "..########..",
    "..######....",
    "..####......",
    "..##........",
    "............",
  ],
  // A cog: settings.
  settings: [
    ".....##.....",
    ".##..##..##.",
    ".##########.",
    "..########..",
    "..###..###..",
    "####....####",
    "####....####",
    "..###..###..",
    "..########..",
    ".##########.",
    ".##..##..##.",
    ".....##.....",
  ],
  // A crosshair: find me, centre on me.
  locate: [
    ".....##.....",
    ".....##.....",
    "...######...",
    "..##....##..",
    "..#......#..",
    "###..##..###",
    "###..##..###",
    "..#......#..",
    "..##....##..",
    "...######...",
    ".....##.....",
    ".....##.....",
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
