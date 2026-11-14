import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pathFor } from "../../lib/clusters";
import { OG_SIZE, renderToolOG } from "../../lib/og";
import { SITE_NAME } from "../../lib/site";
import { tools } from "../../lib/tools";
import { fingerprint, recorded } from "./drawn";

/**
 * The address of a share image is `…/opengraph-image?<hash>`, and the
 * hash is of the route file's bytes and nothing else. The fourteen cards
 * are drawn in lib/og.tsx from the registry, so a new design, tagline,
 * colour or icon changes a picture and leaves its address where it was,
 * and whatever keeps pictures by their address (link previews do) goes
 * on showing the old one. The cards kept their old addresses through
 * the 2026-11 redesign that way.
 *
 * So an image route's file says the fingerprint of its picture in its
 * first line, `// Picture 1a2b3c4d: …`. This suite draws each picture
 * and holds its file to it: a picture that changes fails here until its
 * file says the new fingerprint, and saying it changes the file, and
 * with it the address.
 */

vi.mock("next/og", async () => ({
  ImageResponse: (await import("./drawn")).RecordedImage,
}));

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SITE_IMAGE = "app/opengraph-image.tsx";
const cardFile = (slug: string) => `app${pathFor(slug)}/opengraph-image.tsx`;

/**
 * The site image has no such line yet: its address had to stay when the
 * cards got new ones. Until its picture next changes, this is the
 * picture its address stands for. Then the line goes into its file and
 * the file comes off this list.
 */
const NO_LINE_YET: Record<string, string> = {
  [SITE_IMAGE]: "d823da1d",
};

type ImageRoute = {
  default: () => unknown;
  alt: string;
  size: unknown;
  contentType: string;
};
const load = (file: string): Promise<ImageRoute> => import(file);

const HOW_TO_MEND = `
A picture and its file's first line have parted ways. If the picture was meant to change, its
address has to change with it: make the first line of each file below start with the
fingerprint shown as expected, "// Picture 1a2b3c4d: " (a neighbour has the rest of the line).
For ${SITE_IMAGE}, add the line and take the file off NO_LINE_YET in this suite.
`;

describe("a share image's address follows its picture", () => {
  it("each card's route draws its own card, at the cards' size, under its own title", async () => {
    for (const tool of tools) {
      const file = cardFile(tool.slug);
      const route = await load(`../../${file}`);
      expect(
        { alt: route.alt, size: route.size, contentType: route.contentType },
        file,
      ).toEqual({
        alt: `${tool.title} — ${SITE_NAME}`,
        size: OG_SIZE,
        contentType: "image/png",
      });
      expect(fingerprint(recorded(route.default())), file).toBe(
        fingerprint(recorded(renderToolOG(tool.slug))),
      );
    }
  });

  it("the site image is the cards' size", async () => {
    const route = await load(`../../${SITE_IMAGE}`);
    expect({ size: route.size, contentType: route.contentType }).toEqual({
      size: OG_SIZE,
      contentType: "image/png",
    });
    expect(recorded(await route.default()).options).toEqual(OG_SIZE);
  });

  it("every image route's file says the fingerprint of the picture it draws", async () => {
    const says: Record<string, string | undefined> = {};
    const draws: Record<string, string> = {};
    for (const file of [SITE_IMAGE, ...tools.map((tool) => cardFile(tool.slug))]) {
      const line = read(file).match(/^\/\/ Picture ([0-9a-f]{8}): /)?.[1];
      expect(
        line !== undefined && file in NO_LINE_YET,
        `${file} has its line now: take it off NO_LINE_YET`,
      ).toBe(false);
      says[file] = line ?? NO_LINE_YET[file];
      draws[file] = fingerprint(recorded(await (await load(`../../${file}`)).default()));
    }
    expect(says, HOW_TO_MEND).toEqual(draws);
  });
});
