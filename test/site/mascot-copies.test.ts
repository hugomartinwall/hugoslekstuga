import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_HEX, CREAM_HEX, INK_HEX } from "../../lib/colors";

/**
 * The mascot is drawn by one module, lib/hugo/sprite.ts. Two files cannot
 * import it and carry a copy instead: app/apple-icon.tsx (kept import-free
 * after a build failure) and app/icon.svg (a static file). Nothing else
 * stops the copies drifting from the original, so this does.
 *
 * The sources are read as text on purpose: sprite.ts reaches the rest of
 * the app through the "@/" alias, which this runner does not resolve.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function rowsFrom(src: string, name: string): string[] {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`no ${name} array found`);
  return [...m[1].matchAll(/"([.a-z]{16})"/g)].map((r) => r[1]);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The same mix lib/hugo/sprite.ts uses for the shade and the highlight. */
function mix(hex: string, to: string, t: number): string {
  const a = hexRgb(hex);
  const b = hexRgb(to);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const CORAL = COLOR_HEX.tomato;
const EXPECTED = {
  b: CORAL,
  s: mix(CORAL, CREAM_HEX, 0.52),
  h: mix(CORAL, INK_HEX, 0.55),
  w: INK_HEX,
} as const;
/** At rest the pupils are the left column of each eye, two cells tall. */
const PUPILS = [
  { x: 5, y: 6 },
  { x: 9, y: 6 },
];

const SPRITE_ROWS = rowsFrom(read("lib/hugo/sprite.ts"), "SPRITE_ROWS");

/** The original as a 16x16 grid of colours, null where nothing is drawn. */
function canonical(): (string | null)[][] {
  const grid = SPRITE_ROWS.map((row) =>
    [...row].map((ch) => (ch === "." ? null : EXPECTED[ch as keyof typeof EXPECTED])),
  );
  for (const p of PUPILS) {
    grid[p.y][p.x] = CREAM_HEX;
    grid[p.y + 1][p.x] = CREAM_HEX;
  }
  return grid;
}

describe("the copies of the mascot", () => {
  it("the original is the 16x16 drawing this test expects", () => {
    expect(SPRITE_ROWS).toHaveLength(16);
    for (const row of SPRITE_ROWS) expect(row).toMatch(/^[.bshw]{16}$/);
  });

  it("app/apple-icon.tsx carries the same rows, colours and pupils", () => {
    const src = read("app/apple-icon.tsx");
    expect(rowsFrom(src, "ROWS")).toEqual(SPRITE_ROWS);
    for (const [key, hex] of Object.entries(EXPECTED)) {
      const m = src.match(new RegExp(`\\b${key}:\\s*"(#[0-9a-fA-F]{6})"`));
      expect(m, `colour "${key}" in app/apple-icon.tsx`).not.toBeNull();
      expect(m![1].toLowerCase()).toBe(hex.toLowerCase());
    }
    const pupils = [...src.matchAll(/\{\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(pupils).toEqual(PUPILS);
  });

  it("app/icon.svg draws the same cells, one row higher", () => {
    const svg = read("app/icon.svg");
    const grid: (string | null)[][] = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
    // Paint every <rect> in document order, in the fill of its <g>.
    for (const g of svg.matchAll(/<g fill="(#[0-9a-fA-F]{6})">([\s\S]*?)<\/g>/g)) {
      const fill = g[1].toLowerCase();
      for (const r of g[2].matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\s*\/>/g)) {
        const [x, y, w, h] = [Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])];
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy][xx] = fill;
      }
    }
    const want = canonical();
    // In the favicon he stands one cell higher, so he is centred on the tile.
    for (let y = 1; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const expected = want[y][x];
        expect(grid[y - 1][x], `cell ${x},${y - 1} of app/icon.svg`).toBe(expected === null ? null : expected.toLowerCase());
      }
    }
  });
});
