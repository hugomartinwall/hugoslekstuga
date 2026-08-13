/**
 * Room geometry. Rooms are single screens: 20×12 tiles of 16 px — a
 * 320×192 logical playfield. Layouts are authored as ASCII string grids
 * in content/layouts.ts and parsed here into flat tile arrays.
 *
 * Legend (shared across worlds; a char only appears where the world's
 * mechanic gives it meaning):
 *   #  wall                 .  floor
 *   E  exit door (east wall; walkable once the room is cleared)
 *   ,  grass (cuttable)     %  thorns (walkable, hurt)
 *   > < ^ v  current lanes  ~  bog
 *   a b c  lava-tide zones (flood thirds, on a timer)
 *   +  brazier (lit safe spot in the dark)
 *   *  pot (breakable, drops a coin)
 *   1-6  enemy spawn markers (become floor; kinds come from the recipe)
 *   @  player entry (becomes floor; defaults to west-centre if absent)
 *   V  the merchant's spot (shop rooms; becomes floor)
 *
 * Pure module — no DOM, tested headless.
 */

export const ROOM_W = 20;
export const ROOM_H = 12;
export const TILE = 16;
export const ROOM_PX_W = ROOM_W * TILE; // 320
export const ROOM_PX_H = ROOM_H * TILE; // 192

/** Tile enum. Values are stable — they end up in Uint8Array + hashState. */
export const T = {
  FLOOR: 0,
  WALL: 1,
  DOOR: 2, // east exit; solid until the room clears
  GRASS: 3,
  THORN: 4,
  CUR_R: 5,
  CUR_L: 6,
  CUR_U: 7,
  CUR_D: 8,
  BOG: 9,
  LAVA_A: 10,
  LAVA_B: 11,
  LAVA_C: 12,
  BRAZIER: 13,
  POT: 14,
} as const;
export type TileId = (typeof T)[keyof typeof T];

const CHAR_TILE: Record<string, TileId> = {
  "#": T.WALL,
  ".": T.FLOOR,
  E: T.DOOR,
  ",": T.GRASS,
  "%": T.THORN,
  ">": T.CUR_R,
  "<": T.CUR_L,
  "^": T.CUR_U,
  v: T.CUR_D,
  "~": T.BOG,
  a: T.LAVA_A,
  b: T.LAVA_B,
  c: T.LAVA_C,
  "+": T.BRAZIER,
  "*": T.POT,
};

export type ParsedRoom = {
  tiles: Uint8Array; // ROOM_W * ROOM_H
  /** Marker digit → tile-centre position. */
  spawns: Map<string, { x: number; y: number }>;
  entry: { x: number; y: number };
  merchant: { x: number; y: number } | null;
  doorTiles: number[]; // indices of DOOR tiles
};

export function tileAt(tiles: Uint8Array, tx: number, ty: number): TileId {
  if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) return T.WALL;
  return tiles[ty * ROOM_W + tx] as TileId;
}

/** Solid for movement. Doors are solid until the room clears. */
export function isSolid(tile: TileId, cleared: boolean): boolean {
  return tile === T.WALL || tile === T.POT || (tile === T.DOOR && !cleared);
}

export function parseRoom(rows: readonly string[]): ParsedRoom {
  if (rows.length !== ROOM_H) {
    throw new Error(`room has ${rows.length} rows, want ${ROOM_H}`);
  }
  const tiles = new Uint8Array(ROOM_W * ROOM_H);
  const spawns = new Map<string, { x: number; y: number }>();
  let entry: { x: number; y: number } | null = null;
  let merchant: { x: number; y: number } | null = null;
  const doorTiles: number[] = [];

  for (let ty = 0; ty < ROOM_H; ty++) {
    const row = rows[ty];
    if (row.length !== ROOM_W) {
      throw new Error(`room row ${ty} has ${row.length} cols, want ${ROOM_W}`);
    }
    for (let tx = 0; tx < ROOM_W; tx++) {
      const ch = row[tx];
      const centre = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
      if (ch >= "1" && ch <= "6") {
        spawns.set(ch, centre);
        tiles[ty * ROOM_W + tx] = T.FLOOR;
        continue;
      }
      if (ch === "@") {
        entry = centre;
        tiles[ty * ROOM_W + tx] = T.FLOOR;
        continue;
      }
      if (ch === "V") {
        merchant = centre;
        tiles[ty * ROOM_W + tx] = T.FLOOR;
        continue;
      }
      const tile = CHAR_TILE[ch];
      if (tile === undefined) throw new Error(`unknown room char "${ch}"`);
      tiles[ty * ROOM_W + tx] = tile;
      if (tile === T.DOOR) doorTiles.push(ty * ROOM_W + tx);
    }
  }

  return {
    tiles,
    spawns,
    entry: entry ?? { x: 1.5 * TILE, y: (ROOM_H / 2) * TILE },
    merchant,
    doorTiles,
  };
}

/**
 * Flood fill from the entry over non-solid tiles (doors count as open —
 * reachability is judged for a cleared room). Used by the geometry tests:
 * every spawn marker and every door must be reachable.
 */
export function floodReachable(parsed: ParsedRoom): Set<number> {
  const seen = new Set<number>();
  const start =
    Math.floor(parsed.entry.y / TILE) * ROOM_W + Math.floor(parsed.entry.x / TILE);
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const idx = queue.pop()!;
    const tx = idx % ROOM_W;
    const ty = Math.floor(idx / ROOM_W);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= ROOM_W || ny >= ROOM_H) continue;
      const nIdx = ny * ROOM_W + nx;
      if (seen.has(nIdx)) continue;
      const tile = tileAt(parsed.tiles, nx, ny);
      if (tile === T.WALL) continue; // pots break, doors open — only walls block forever
      seen.add(nIdx);
      queue.push(nIdx);
    }
  }
  return seen;
}
