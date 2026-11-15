/**
 * Every bitmap the room is drawn from: the charms' icons, and the things
 * in the room. They live here and nowhere else, as the site's pixel icons
 * live in lib/pixel-icons.ts. He is not here: he is the site's sprite.
 *
 * The charms' icons (§6.4) are 12 × 12, one empty cell all round, no two
 * alike as blobs. Drawn at 3 u a cell on an offered plate's insert and on
 * a pickup's 36 × 36 u tile, whose frame is drawn over the empty ring, and
 * at 2 u a cell on a lit plate's 28 × 28 u insert.
 */
import type { Bitmap } from "./bake";


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

// ── The things in the room ────────────────────────────────────────────
//
// Pixel art on a 1 u grid, one character a cell: `-` is empty, any other
// character names a colour in the palette the bitmap is baked with
// (render/bake.ts). Each is drawn centred on the thing's centre. Kind is
// told by outline first, colour only confirms it (§5.1): a fuzzy ball
// with eyes, a ring with a hole, a flat bar with a bitten edge, a tall
// cell with a terminal and a bolt, a wide rectangle with a flap, a big
// sack with a knot. Nothing in the room but him wears a white ring, and
// nothing but a tile is square.

/**
 * The dust bunny: a fuzzy ball, 16 u across (it collides as a circle of
 * 8), with two eyes on its middle row. Two frames: its tufts stir as it
 * walks. `a` ash, `l` light, `d` shade, `e` eye. The dazed frame has no
 * eyes: the daze marks take their place (§9.5).
 */
export const BUNNY: readonly Bitmap[] = [
  [
    "-----a--a-------",
    "---a-aaaaaa-a---",
    "--aaaaaaaaaaaa--",
    "--allaaaaaaaaa--",
    "-allaaaaaaaaaaa-",
    "-alaaaaaaaaaaaad",
    "aaaaaaaaaaaaaaad",
    "aaaaeeaaaaeeaaad",
    "-aaaeeaaaaeeaaad",
    "aaaaaaaaaaaaaadd",
    "-aaaaaaaaaaaaad-",
    "-aaaaaaaaaaaaddd",
    "--aaaaaaaaaaadd-",
    "--daaaaaaaaddd--",
    "---dddaaaddd----",
    "----d--dd--d----",
  ],
  [
    "------a--a------",
    "--a-aaaaaaa-a---",
    "--aaaaaaaaaaaa--",
    "-aallaaaaaaaaa--",
    "-allaaaaaaaaaaa-",
    "-alaaaaaaaaaaaa-",
    "aaaaaaaaaaaaaaad",
    "-aaaeeaaaaeeaaad",
    "aaaaeeaaaaeeaaad",
    "aaaaaaaaaaaaaadd",
    "-aaaaaaaaaaaaad-",
    "daaaaaaaaaaaaad-",
    "--aaaaaaaaaaadd-",
    "--daaaaaaaaddd--",
    "----ddaaaddd----",
    "---d--dd--d-----",
  ],
];
/** The dust bunny dazed: still, and no eyes (the marks are drawn in their place). */
export const BUNNY_DAZED: Bitmap = BUNNY[0].map((row) => row.replace(/e/g, "a"));

/**
 * The runaway token: a ring with a hole, 14 u across (radius 7), its hole
 * about 3 u across the middle. Two frames: the notches on its rim turn as
 * it rolls. `k` acid, `l` light, `d` shade, `n` a notch.
 */
export const TOKEN: readonly Bitmap[] = [
  [
    "----kknnkk----",
    "---lkkkkkkkk--",
    "--llkkkkkkkkk-",
    "-llkkkkkkkkkkd",
    "lkkkk----kkkkd",
    "lkkk------kkkd",
    "nkkk------kkkn",
    "nkkk------kkkn",
    "kkkk------kkkd",
    "kkkkd----kkkkd",
    "-kkkkkkkkkkkdd",
    "--kkkkkkkkkdd-",
    "---kkkkkkddd--",
    "----ddnndd----",
  ],
  [
    "----kkkkkk----",
    "---lkkkkkknk--",
    "--lnkkkkkkkkk-",
    "-llkkkkkkkkkkd",
    "lkkkk----kkkkd",
    "lkkk------kkkd",
    "kkkk------kkkd",
    "kkkk------kkkd",
    "kkkk------kkkd",
    "kkkkd----kkkkd",
    "-kkkkkkkkkknd-",
    "--knkkkkkkkdd-",
    "---kkkkkkddd--",
    "----dddddd----",
  ],
];

/**
 * Chewing gum: flat and wide, 28 × 12 u, its long edges bitten into
 * stripes, stepped ends, no eyes. `m` magenta, `l` light, `d` shade. With
 * one hit left it is split across the middle (`GUM_SPLIT`).
 */
export const GUM: Bitmap = [
  "--mmm--mm--mm--mm--mm--mmm--",
  "--mmm--mm--mm--mm--mm--mmm--",
  "mmllllllllllmmmmmmmmmmmmmmmm",
  "mlllllllmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmd",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmdd",
  "mmddddddddddddddddddddddddmm",
  "--mmm--mm--mm--mm--mm--mmm--",
  "--ddd--dd--dd--dd--dd--ddd--",
];
export const GUM_SPLIT: Bitmap = GUM.map((row) => `${row.slice(0, 13)}--${row.slice(15)}`);

/**
 * The battery: a tall cell, 14 × 22 u, with a 6 × 3 u terminal on top, a
 * dark band across its top third and a bolt down its body. Drawn 25 u
 * tall, centred on its centre. `b` amber, `l` light, `d` shade, `k` dark.
 */
export const BATTERY: Bitmap = [
  "----bbbbbb----",
  "----blbbbb----",
  "----bbbbbd----",
  "-bbbbbbbbbbbb-",
  "bllbbbbbbbbbbd",
  "blbbbbbbbbbbbd",
  "bbbbbbbbbbbbbd",
  "kkkkkkkkkkkkkk",
  "kkkkkkkkkkkkkk",
  "blbbbbbbbbbbbd",
  "blbbbbbbkkbbbd",
  "blbbbbbkkbbbbd",
  "bbbbbbkkbbbbbd",
  "bbbbbkkbbbbbbd",
  "bbbbkkkkkkbbbd",
  "bbbbbbbbkkbbbd",
  "bbbbbbbkkbbbbd",
  "bbbbbbkkbbbbbd",
  "bbbbbkkbbbbbbd",
  "bbbbbbbbbbbbbd",
  "bbbbbbbbbbbbbd",
  "bbbbbbbbbbbbbd",
  "bbbbbbbbbbbbdd",
  "bddddddddddddd",
  "-dddddddddddd-",
];

/**
 * The envelope: a wide rectangle, 20 × 14 u, with its flap drawn as a V
 * from the top corners to the middle. It does not turn: a rectangle that
 * turned would read as another shape. `p` paper, `f` the flap's line, `s`
 * shade.
 */
export const ENVELOPE: Bitmap = [
  "-pppppppppppppppppp-",
  "pffppppppppppppppffs",
  "ppffppppppppppppffps",
  "pppffppppppppppffpps",
  "ppppffppppppppffppps",
  "pppppffppppppffpppps",
  "ppppppffppppffppppps",
  "pppppppffffffpppppps",
  "ppppppppppppppppppps",
  "ppppppppppppppppppps",
  "ppppppppppppppppppps",
  "ppppppppppppppppppps",
  "pssssssssssssssssss-",
  "-ssssssssssssssssss-",
];

/** A dazed thing's mark: a 3 u phosphor square in a room-dark frame, so it reads on every body (acid and paper white too). */
export const DAZE_MARK: Bitmap = ["ddddd", "dpppd", "dpppd", "dpppd", "ddddd"];

/** The love heart, 7 × 6 cells drawn 2 u a cell on its tile. */
export const HEART_ICON: readonly string[] = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];

/**
 * A square tile `size` u across: a frame `frame` u thick (`f`), room dark
 * inside (`i`), and an icon of rows of `X` at `cell` u a cell (`x`),
 * centred. Every tile is square, never round, so it is never taken for an
 * intruder (§5.1).
 */
export function tileBitmap(size: number, frame: number, icon: readonly string[], cell: number): Bitmap {
  const iconW = Math.max(...icon.map((r) => r.length)) * cell;
  const iconH = icon.length * cell;
  const ox = Math.floor((size - iconW) / 2);
  const oy = Math.floor((size - iconH) / 2);
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) {
      const edge = x < frame || y < frame || x >= size - frame || y >= size - frame;
      if (edge) {
        row += "f";
        continue;
      }
      const ix = Math.floor((x - ox) / cell);
      const iy = Math.floor((y - oy) / cell);
      const on = x >= ox && y >= oy && iy < icon.length && icon[iy][ix] === "X";
      row += on ? "x" : "i";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The money bag: a sack 68 u across (it collides as a circle of 34) with a
 * knot and two ears on top, a dollar sign on its upper half, lit from the
 * top left. 77 rows: the knot's 9 over the sack's 68, so its centre is
 * row 43. Made once, on first use. `g` mint, `l` light, `d` shade, `k`
 * the tie and the sign.
 */
let bagRows: Bitmap | null = null;
export const BAG_TOP = 9;
export function bagBitmap(): Bitmap {
  if (bagRows) return bagRows;
  const R = 34;
  const W = 2 * R;
  const rows: string[][] = [];
  for (let y = 0; y < BAG_TOP + W; y++) rows.push(new Array<string>(W).fill("-"));
  const set = (x: number, y: number, ch: string) => {
    if (y >= 0 && y < rows.length && x >= 0 && x < W) rows[y][x] = ch;
  };
  // The sack.
  for (let y = 0; y < W; y++) {
    const dy = y + 0.5 - R;
    const half = Math.sqrt(Math.max(0, R * R - dy * dy));
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - R;
      if (Math.abs(dx) > half) continue;
      // Light from the top left, shade to the bottom right: by the distance from a point up and left of the middle.
      const lit = Math.hypot(dx + 12, dy + 12);
      const dark = Math.hypot(dx - 10, dy - 10);
      let ch = "g";
      if (lit < 9 && (x + y) % 2 === 0) ch = "l";
      else if (lit < 5) ch = "l";
      if (Math.hypot(dx, dy) > R - 4 && dx + dy > 18) ch = "d";
      if (dark > R + 6) ch = ch === "d" ? "g" : ch;
      set(x, y + BAG_TOP, ch);
    }
  }
  // The neck, the tie across it and the two ears of the knot.
  for (let y = 0; y < BAG_TOP + 3; y++) for (let x = R - 6; x < R + 6; x++) set(x, y + 1, y >= BAG_TOP - 2 && y < BAG_TOP ? "k" : "g");
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 7; x++) {
      if ((y === 0 && (x === 0 || x === 6)) || (y === 4 && (x === 0 || x === 6))) continue;
      set(R - 13 + x, y, "g");
      set(R + 6 + x, y, "g");
    }
  }
  set(R - 12, 1, "l");
  set(R - 11, 1, "l");
  // The dollar sign, 14 × 18, on its upper half (the daze marks take the middle row, its hits the row under it).
  const SIGN = [
    "------kk------",
    "------kk------",
    "---kkkkkkkkk--",
    "--kkkkkkkkkkk-",
    "-kkkk-kk--kkk-",
    "-kkk--kk------",
    "-kkk--kk------",
    "-kkkk-kk------",
    "--kkkkkkkkk---",
    "---kkkkkkkkk--",
    "------kk-kkkk-",
    "------kk--kkk-",
    "------kk--kkk-",
    "-kkk--kk-kkkk-",
    "-kkkkkkkkkkk--",
    "--kkkkkkkkk---",
    "------kk------",
    "------kk------",
  ];
  const sx = R - 7;
  const sy = BAG_TOP + R - 25;
  for (let y = 0; y < SIGN.length; y++) for (let x = 0; x < SIGN[y].length; x++) if (SIGN[y][x] === "k") set(sx + x, sy + y, "k");
  bagRows = rows.map((r) => r.join(""));
  return bagRows;
}
