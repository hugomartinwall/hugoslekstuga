/**
 * The charms' icons (§6.4): 12 × 12 bitmaps, one empty cell all round, no
 * two alike as blobs. Drawn at 3 u a cell on an offered plate's insert and
 * on a pickup's 36 × 36 u tile, whose frame is drawn over the empty ring.
 *
 * Plain drafts: the art comes with step 6. They live here and nowhere
 * else, as the site's pixel icons live in lib/pixel-icons.ts.
 */

/** Rows of 12, X for a lit cell. */
export const CHARM_ICON: Readonly<Record<string, readonly string[]>> = {
  // A chevron bouncing off a bar.
  bumper: [
    "............",
    "............",
    ".....XX.....",
    "....XXXX....",
    "...XX..XX...",
    "..XX....XX..",
    ".XX......XX.",
    "............",
    "............",
    ".XXXXXXXXXX.",
    ".XXXXXXXXXX.",
    "............",
  ],
  // A filled square with a plus beside it.
  pip: [
    "............",
    "............",
    "............",
    ".XXXX...X...",
    ".XXXX...X...",
    ".XXXX.XXXXX.",
    ".XXXX...X...",
    ".XXXX...X...",
    "............",
    "............",
    "............",
    "............",
  ],
  // A four-point star.
  spark: [
    "............",
    ".....XX.....",
    ".....XX.....",
    "....XXXX....",
    "....XXXX....",
    ".XXXXXXXXXX.",
    ".XXXXXXXXXX.",
    "....XXXX....",
    "....XXXX....",
    ".....XX.....",
    ".....XX.....",
    "............",
  ],
  // A bell.
  bell: [
    "............",
    ".....XX.....",
    "....XXXX....",
    "...XXXXXX...",
    "...XXXXXX...",
    "...XXXXXX...",
    "..XXXXXXXX..",
    ".XXXXXXXXXX.",
    ".XXXXXXXXXX.",
    "............",
    ".....XX.....",
    "............",
  ],
  // A slot with a coin half in it.
  coin: [
    "............",
    "............",
    "....XXXX....",
    "...XXXXXX...",
    "..XXX..XXX..",
    "..XX....XX..",
    ".XXXXXXXXXX.",
    ".X........X.",
    ".XXXXXXXXXX.",
    "............",
    "............",
    "............",
  ],
  // A weight: a bar with a plate at each end.
  heavy: [
    "............",
    "............",
    ".XX......XX.",
    ".XX......XX.",
    ".XX......XX.",
    ".XXXXXXXXXX.",
    ".XXXXXXXXXX.",
    ".XX......XX.",
    ".XX......XX.",
    ".XX......XX.",
    "............",
    "............",
  ],
  // A flame.
  longBurn: [
    "............",
    "......X.....",
    ".....XX.....",
    ".....XXX....",
    "....XXXX....",
    "...XXXXXX...",
    "...XXX.XXX..",
    "..XXX...XX..",
    "..XXX...XX..",
    "...XXX.XX...",
    "....XXXX....",
    "............",
  ],
  // Four squares (the pips, and one more). Four of two cells and their gaps
  // do not fit in a row of ten, so they stand two by two.
  fourthPip: [
    "............",
    "............",
    "..XXX..XXX..",
    "..XXX..XXX..",
    "..XXX..XXX..",
    "............",
    "............",
    "..XXX..XXX..",
    "..XXX..XXX..",
    "..XXX..XXX..",
    "............",
    "............",
  ],
  // A heart with a frame.
  thickSkin: [
    "............",
    ".XXXXXXXXXX.",
    ".X........X.",
    ".X.XX..XX.X.",
    ".X.XXXXXX.X.",
    ".X.XXXXXX.X.",
    ".X..XXXX..X.",
    ".X...XX...X.",
    ".X........X.",
    ".XXXXXXXXXX.",
    "............",
    "............",
  ],
  // Two arrows pointing apart.
  wide: [
    "............",
    "............",
    "............",
    "...X....X...",
    "..XX....XX..",
    ".XXXX..XXXX.",
    ".XXXX..XXXX.",
    "..XX....XX..",
    "...X....X...",
    "............",
    "............",
    "............",
  ],
};
