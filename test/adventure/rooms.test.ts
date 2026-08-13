import { describe, expect, it } from "vitest";
import { LAYOUTS } from "../../lib/adventure/content/layouts";
import {
  floodReachable,
  parseRoom,
  ROOM_H,
  ROOM_W,
  T,
  TILE,
  tileAt,
} from "../../lib/adventure/sim/rooms";

describe("room layouts", () => {
  for (const [id, rows] of Object.entries(LAYOUTS)) {
    it(`${id} parses and is fully reachable`, () => {
      const parsed = parseRoom(rows);
      expect(parsed.tiles.length).toBe(ROOM_W * ROOM_H);

      // The border must be wall except door tiles.
      for (let tx = 0; tx < ROOM_W; tx++) {
        expect(tileAt(parsed.tiles, tx, 0)).toBe(T.WALL);
        expect(tileAt(parsed.tiles, tx, ROOM_H - 1)).toBe(T.WALL);
      }
      for (let ty = 0; ty < ROOM_H; ty++) {
        expect(tileAt(parsed.tiles, 0, ty)).toBe(T.WALL);
        const east = tileAt(parsed.tiles, ROOM_W - 1, ty);
        expect(east === T.WALL || east === T.DOOR).toBe(true);
      }

      // Every non-shop layout needs an exit door on the east wall.
      if (id !== "arena") {
        expect(parsed.doorTiles.length).toBeGreaterThan(0);
      }

      // Flood fill from the entry: every spawn marker, the merchant spot,
      // and every door must be reachable once the room is cleared.
      const reachable = floodReachable(parsed);
      const idxOf = (p: { x: number; y: number }) =>
        Math.floor(p.y / TILE) * ROOM_W + Math.floor(p.x / TILE);
      for (const [marker, pos] of parsed.spawns) {
        expect(reachable.has(idxOf(pos)), `spawn ${marker} unreachable`).toBe(
          true,
        );
      }
      if (parsed.merchant) {
        expect(reachable.has(idxOf(parsed.merchant))).toBe(true);
      }
      for (const door of parsed.doorTiles) {
        expect(reachable.has(door), `door at ${door} unreachable`).toBe(true);
      }

      // No spawn or entry inside a wall.
      for (const pos of [...parsed.spawns.values(), parsed.entry]) {
        const tile = tileAt(
          parsed.tiles,
          Math.floor(pos.x / TILE),
          Math.floor(pos.y / TILE),
        );
        expect(tile).not.toBe(T.WALL);
      }
    });
  }
});
