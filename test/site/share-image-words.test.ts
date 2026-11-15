import { describe, expect, it, vi } from "vitest";
import SiteImage, { alt as siteImageAlt } from "../../app/opengraph-image";
import {
  GLYPH_RISE,
  GLYPHS,
  missingGlyphs,
  PixelText,
  renderToolOG,
} from "../../lib/og";
import { tools } from "../../lib/tools";
import { drawn, recorded } from "./drawn";

/**
 * The share images set their words in a hand-drawn face of capitals,
 * figures and a few marks (GLYPHS in lib/og.tsx). A character the face
 * does not have is drawn as a block, and the only other sign is a line
 * in the server log; a letter it has only without its accent is set
 * without it, and nothing says so. So every word an image sets is
 * checked here: a title or tagline with a new character fails this
 * suite, and the fix is to draw the glyph. The glyphs themselves are
 * checked too, because a slip in one (a short row, a stray character)
 * draws the wrong thing just as quietly.
 */

vi.mock("next/og", async () => ({
  ImageResponse: (await import("./drawn")).RecordedImage,
}));

describe("the words on the share images", () => {
  it("every title and tagline in the registry has all its glyphs", () => {
    for (const tool of tools) {
      for (const field of ["title", "tagline"] as const) {
        expect(
          missingGlyphs(tool[field]),
          `no glyph for these in the ${field} of "${tool.slug}" (${tool[field]})`,
        ).toEqual([]);
      }
    }
  });

  it("so has every word the fourteen images and the name card set", async () => {
    // What each image actually sets, read from the tree it draws: the
    // site image's own words and the site's name on every card are not
    // in the registry.
    const words = new Map<string, string[]>();
    words.set("site", drawn(recorded(await SiteImage()).element).texts);
    for (const slug of [...tools.map((tool) => tool.slug), "no-such-slug"]) {
      words.set(slug, drawn(recorded(renderToolOG(slug)).element).texts);
    }
    for (const [image, texts] of words) {
      for (const text of texts) {
        expect(missingGlyphs(text), `"${text}" on the ${image} image`).toEqual([]);
      }
    }
    // And the walk does see the words: the marquee and the line under it
    // on the site image (its alt text says the same two), the name on the
    // name card, and on a card its title and its tagline (whole, or as
    // the lines it was broken into).
    const [marquee, line, ...more] = words.get("site")!;
    expect(more).toEqual([]);
    expect(siteImageAlt).toBe(`${marquee} — ${line.toLowerCase()}`);
    expect(words.get("no-such-slug")!.length).toBeGreaterThanOrEqual(1);
    for (const tool of tools) {
      expect(words.get(tool.slug)).toContain(tool.title);
      expect(words.get(tool.slug)!.join(" ")).toContain(tool.tagline);
    }
  });

  it("the face has the marks a title is likely to want next", () => {
    expect(missingGlyphs("Rock & Roll: 50/50 (really) + more")).toEqual([]);
  });

  it("every glyph is a whole drawing: rows of X and dot, all as wide, down to the baseline", () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      // One character, as a word hands it over: in capitals.
      expect([...ch], ch).toHaveLength(1);
      expect(ch.toUpperCase(), ch).toBe(ch);
      // Seven rows from the cap line to the baseline, after the rows
      // that stand above it (the dots on an Ö).
      expect(rows.length - (GLYPH_RISE[ch] ?? 0), ch).toBeGreaterThanOrEqual(7);
      for (const row of rows) {
        // Any other character is a cell that is silently not drawn.
        expect(row, `a row of ${ch}`).toMatch(/^[X.]+$/);
        expect(row.length, `a row of ${ch}`).toBe(rows[0].length);
      }
      expect(rows.join(""), ch).toContain("X");
    }
    for (const ch of Object.keys(GLYPH_RISE)) expect(GLYPHS, ch).toHaveProperty(ch);
    // And no two characters are drawn alike (rows pasted from a neighbour).
    const drawings = Object.values(GLYPHS).map((rows) => rows.join("/"));
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it("a character without a glyph is reported, and drawn as a solid block", () => {
    // The marks it has not drawn, and a letter it could only set
    // without its accent.
    expect(missingGlyphs("100% café @ home")).toEqual(["%", "É", "@"]);

    // A snowman: no title will have warned about this one already (the
    // face says each missing character once).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { boxes } = drawn(PixelText({ text: "☃", x: 0, y: 0, cell: 1, color: "#ffffff" }));
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('"☃"');
    warn.mockRestore();
    // One box, the whole 5×7 cell: not an outline, which read as an O.
    expect(
      boxes.filter((box) => box.color !== undefined).map(({ x, y, w, h }) => ({ x, y, w, h })),
    ).toEqual([{ x: 0, y: 0, w: 5, h: 7 }]);
  });
});
