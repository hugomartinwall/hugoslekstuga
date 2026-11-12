import { describe, expect, it } from "vitest";
import { ICON_SIZE, PIXEL_ICONS } from "../../lib/pixel-icons";

/**
 * The parkour's controls hint sets three arrow icons in one line of
 * text: left, right, up (components/HomeShell.tsx). Each is a 12-row
 * bitmap in a 12px box, so where the ink sits in the rows is where the
 * arrow sits on the line. The up arrow was first drawn as the back
 * arrow turned upright, shaft and all: its ink reached row 11 where the
 * other two stop at row 9, and it hung 2px below them.
 */

/** The first and the last row of an icon that has a lit cell. */
function inkRows(name: keyof typeof PIXEL_ICONS): [number, number] {
  const rows = PIXEL_ICONS[name]
    .map((row, y) => (row.includes("#") ? y : -1))
    .filter((y) => y >= 0);
  return [rows[0], rows[rows.length - 1]];
}

describe("the arrows of the controls hint", () => {
  it("are whole bitmaps", () => {
    for (const name of ["back", "forward", "up"] as const) {
      expect(PIXEL_ICONS[name], name).toHaveLength(ICON_SIZE);
      for (const row of PIXEL_ICONS[name]) {
        expect(row, name).toMatch(new RegExp(`^[.#]{${ICON_SIZE}}$`));
      }
    }
  });

  it("stand on one line: their ink starts and ends in the same rows", () => {
    expect(inkRows("forward")).toEqual(inkRows("back"));
    expect(inkRows("up")).toEqual(inkRows("back"));
  });
});
