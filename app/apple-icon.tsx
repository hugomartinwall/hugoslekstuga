import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon. iOS home-screen icon shown when a user adds
 * hugoslekstuga.com to their Home Screen via Safari: Hugo, the
 * canonical 16×16 sprite, on the room dark. Full-bleed and square on
 * purpose — iOS cuts its own corners.
 *
 * Coral is the canonical static colour — the live `BrandDot` cycles
 * through eight accents, but caches (search engines, OS icon caches)
 * need a stable choice.
 *
 * Composition is inlined rather than imported from `lib/` after a
 * Vercel `modifyConfig` build failure that traced to one of the
 * newer metadata-route additions; keeping this file self-contained
 * avoids re-tripping the same edge case. So the rows and colours below
 * are a copy: SPRITE_ROWS and spriteColors("#ff6e5e") in
 * lib/hugo/sprite.ts are the original, and app/icon.svg is the same
 * drawing as a favicon. Change one, change all three.
 */
const ROWS = [
  "................",
  "................",
  "................",
  "......bbbb......",
  "....bhhbbbbb....",
  "...bhbbbbbbbb...",
  "..bhbwwbbwwbbb..",
  ".bbbbwwbbwwbbbb.",
  ".bbbbwwbbwwbbss.",
  ".bbbbbbbbbbbbss.",
  ".bbbbbbssbbbbss.",
  ".bbbbbbbbbbbsss.",
  "..bbbbbbbbbbss..",
  "..sbbbbbbbbbbs..",
  "...ssssssssss...",
  "................",
];

const ROOM = "#0b0c14";
const COLORS: Record<string, string> = {
  b: "#ff6e5e", // body: coral
  s: "#803b38", // shade: coral, 52% of the way to the room dark
  h: "#f2b7aa", // highlight: coral, 55% of the way to phosphor
  w: "#e8f2e9", // eye white: phosphor
};
/** Pupils: the left column of each eye, two cells tall — where
 *  `drawHugoSprite` puts them at rest. */
const PUPILS = [
  { x: 5, y: 6 },
  { x: 9, y: 6 },
];

/** Ten px per cell, so every edge lands on a whole pixel. He fills
 *  columns 1–14 and rows 3–14 of the grid, 140×120 px: LEFT and TOP put
 *  the grid where that is the middle of the 180. */
const CELL = 10;
const LEFT = 10;
const TOP = 0;

export default function AppleIcon() {
  // One box per run of same-coloured cells in a row, not one per cell.
  const boxes: { x: number; y: number; w: number; h: number; color: string }[] = [];
  ROWS.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== ".") boxes.push({ x, y, w, h: 1, color: COLORS[ch] });
      x += w;
    }
  });
  for (const p of PUPILS) boxes.push({ ...p, w: 1, h: 2, color: ROOM });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: ROOM,
          display: "flex",
          position: "relative",
        }}
      >
        {boxes.map((b, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: LEFT + b.x * CELL,
              top: TOP + b.y * CELL,
              width: b.w * CELL,
              height: b.h * CELL,
              background: b.color,
            }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
