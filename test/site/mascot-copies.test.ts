import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import AppleIcon, { contentType, size } from "../../app/apple-icon";
import { COLOR_HEX, CREAM_HEX } from "../../lib/colors";
import {
  DEFAULT_EYE_STATE,
  drawHugoSprite,
  spriteColors,
} from "../../lib/hugo/sprite";
import { Hugo } from "../../lib/og";
import { type Box, cells, drawn, hex, recorded } from "./drawn";
import { parseSvg, rectCells } from "./svg";

/**
 * The mascot is drawn by one module, lib/hugo/sprite.ts. Two files cannot
 * import it and carry a copy instead: app/apple-icon.tsx (kept import-free
 * after a build failure) and app/icon.svg (a static file). The share
 * images (lib/og.tsx) import his rows and palette but place the boxes
 * themselves. Nothing else stops these drifting from the original, so
 * this does.
 *
 * The original is not restated here. `atRest` has the real painter,
 * drawHugoSprite, draw him the way the live site does with his eyes at
 * rest, and writes down the colour of each of the 16×16 cells. Each copy
 * is then read the way it is drawn (the apple icon's boxes, the SVG's
 * rects, the share images' boxes) and must come out as the same cells.
 * So a change to the rows, the palette, the mix ratios or the pupils in
 * sprite.ts fails here until the copies follow, and so does a change to
 * a copy: a moved cell, another colour, a shape that is not a cell.
 */

vi.mock("next/og", async () => ({
  ImageResponse: (await import("./drawn")).RecordedImage,
}));

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The colour of each cell, null where nothing is drawn. */
type Grid = (string | null)[][];

/** Coral, his default: the one colour the icons can show. */
const CORAL = COLOR_HEX.tomato;

function empty(size: number): Grid {
  return Array.from({ length: size }, () => Array<string | null>(size).fill(null));
}

/** The original: drawHugoSprite with his eyes at rest, one unit per cell. */
function atRest(accent: string): Grid {
  const grid = empty(16);
  // As much of a 2D context as the painter uses.
  let [tx, ty, sx, sy] = [0, 0, 1, 1];
  const saved: number[][] = [];
  const ctx = {
    fillStyle: "",
    save() {
      saved.push([tx, ty, sx, sy]);
    },
    restore() {
      [tx, ty, sx, sy] = saved.pop()!;
    },
    translate(x: number, y: number) {
      tx += sx * x;
      ty += sy * y;
    },
    scale(x: number, y: number) {
      sx *= x;
      sy *= y;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      for (let yy = ty + sy * y; yy < ty + sy * (y + h); yy++) {
        for (let xx = tx + sx * x; xx < tx + sx * (x + w); xx++) {
          if (grid[yy]?.[xx] === undefined) {
            throw new Error(`drawHugoSprite painted cell ${xx},${yy}, outside its grid`);
          }
          grid[yy][xx] = hex(this.fillStyle);
        }
      }
    },
  };
  drawHugoSprite(ctx as unknown as CanvasRenderingContext2D, {
    x: 8,
    y: 8,
    px: 1,
    accent,
    eye: DEFAULT_EYE_STATE,
  });
  return grid;
}

/** The part of a grid that is drawn on. */
function bounds(grid: Grid): { x: number; y: number; w: number; h: number } {
  const ys = grid.flatMap((row, y) => (row.some((c) => c !== null) ? [y] : []));
  const xs = grid.flatMap((row) => row.flatMap((c, x) => (c !== null ? [x] : [])));
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/**
 * One letter per cell, so that a failure prints as a picture: b body,
 * s shade, h highlight, w eye white, # room dark (his pupils, and the
 * tile behind him), p a pupil of any other colour, . nothing, ? a colour
 * he does not have.
 */
function picture(grid: Grid, accent: string): string[] {
  const c = spriteColors(accent);
  const letter = new Map([
    [hex(c.pupil), "p"],
    [hex(c.body), "b"],
    [hex(c.shade), "s"],
    [hex(c.highlight), "h"],
    [hex(c.white), "w"],
    [CREAM_HEX, "#"],
  ]);
  return grid.map((row) =>
    row.map((cell) => (cell === null ? "." : (letter.get(cell) ?? "?"))).join(""),
  );
}

function expectSame(got: Grid, want: Grid, accent = CORAL) {
  expect(picture(got, accent)).toEqual(picture(want, accent));
  expect(got).toEqual(want);
}

/**
 * A cell is a flat box and nothing more: placed by its corner and its
 * size, in one colour. No radius, no opacity, no border, no transform.
 */
function expectFlat(boxes: readonly Box[], colour: "background" | "backgroundColor") {
  for (const box of boxes) {
    expect(Object.keys(box.style).sort()).toEqual(
      [colour, "height", "left", "position", "top", "width"].sort(),
    );
    expect(box.style.position).toBe("absolute");
  }
}

/** The favicon's tile: 16×16, two one-unit steps cut from each corner. */
const TILE = "M2 0h12v1h1v1h1v12h-1v1h-1v1H2v-1H1v-1H0V2h1V1h1z";

describe("the copies of the mascot", () => {
  it("the painter draws him in all his colours, and leaves the top row empty", () => {
    const original = atRest(CORAL);
    const letters = new Set(picture(original, CORAL).join(""));
    expect([...letters].sort()).toEqual(["#", ".", "b", "h", "s", "w"]);
    // The favicon lifts him one row, so the top row has to be free.
    expect(original[0].every((cell) => cell === null)).toBe(true);
  });

  it("app/apple-icon.tsx draws the same cells, ten px each, in the middle of a room-dark tile", () => {
    // It stays self-contained (its comment says why): one import, next/og.
    const src = read("app/apple-icon.tsx");
    expect(src.match(/^import\b.*$/gm)).toEqual([
      'import { ImageResponse } from "next/og";',
    ]);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);

    // What the page's <link> says of it, and what it is drawn at.
    expect({ size, contentType }).toEqual({
      size: { width: 180, height: 180 },
      contentType: "image/png",
    });
    const image = recorded(AppleIcon());
    expect(image.options).toEqual(size);
    const [tile, ...boxes] = drawn(image.element).boxes;
    // The tile: the room dark from edge to edge (iOS cuts its own corners).
    expect(tile.style).toEqual({
      width: "100%",
      height: "100%",
      background: CREAM_HEX,
      display: "flex",
      position: "relative",
    });
    expectFlat(boxes, "background");

    // Ten px per cell, so the 180 px tile is 18 cells each way, and his
    // body in the middle of it.
    const original = atRest(CORAL);
    const body = bounds(original);
    const left = (18 - body.w) / 2 - body.x;
    const top = (18 - body.h) / 2 - body.y;
    const want = empty(18).map((row, y) =>
      row.map((_, x) => original[y - top]?.[x - left] ?? CREAM_HEX),
    );
    expectSame(cells([tile, ...boxes], 10, 18), want);
  });

  it("app/icon.svg draws the same cells, one row higher, on its stepped tile", () => {
    // parseSvg takes only what an XML parser takes: a file a browser
    // refuses is no icon at all.
    const [svg, ...others] = parseSvg(read("app/icon.svg"));
    expect(others).toEqual([]);
    // One unit per cell and hard edges: nothing scales or softens him.
    expect({ name: svg.name, attrs: svg.attrs }).toEqual({
      name: "svg",
      attrs: {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 16 16",
        "shape-rendering": "crispEdges",
      },
    });
    const [tile, ...groups] = svg.children;
    expect(tile).toEqual({
      name: "path",
      attrs: { fill: CREAM_HEX, d: TILE },
      children: [],
    });
    // After the tile, only groups of plain rects (rectCells throws on
    // anything else). All 16 rows: the sprite's empty top row is the one
    // that goes, and nothing takes its place at the bottom.
    const original = atRest(CORAL);
    expectSame(rectCells(groups, 16), [...original.slice(1), original[0]]);
  });

  it("lib/og.tsx draws the same cells on the share images", () => {
    // In coral and in another colour, one px per cell and at a size the
    // images use.
    for (const accent of [undefined, COLOR_HEX.teal]) {
      for (const cell of [1, 4]) {
        const original = atRest(accent ?? CORAL);
        const body = bounds(original);
        // `x` and `y` are the corner of his body, not of the grid's.
        const corner = { x: -body.x * cell, y: -body.y * cell };
        const [sheet, ...boxes] = drawn(Hugo({ x: 0, y: 0, cell, accent })).boxes;
        // What holds the cells: the 16×16 grid, with nothing done to it.
        expect(sheet.style).toEqual({
          position: "absolute",
          left: corner.x,
          top: corner.y,
          width: 16 * cell,
          height: 16 * cell,
          display: "flex",
        });
        expectFlat(boxes, "backgroundColor");
        expectSame(cells(boxes, cell, 16, corner), original, accent ?? CORAL);
      }
    }
  });
});
