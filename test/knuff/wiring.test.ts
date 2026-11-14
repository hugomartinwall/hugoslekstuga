import { describe, expect, it } from "vitest";
import { isGameSlug, pathFor } from "../../lib/clusters";
import { COLOR_HEX, INK_HEX } from "../../lib/colors";
import { SCREEN_H, SCREEN_W, STILL_T, screenFor } from "../../lib/hugo/cabinet-screens";
import { ICON_SIZE, PIXEL_ICONS, iconForSlug } from "../../lib/pixel-icons";
import { findTool, tools } from "../../lib/tools";

/**
 * Knuff's place on the site (spec 17): its registry entry, the slug that
 * makes it a game, its icon and its cabinet's screen. Everything else the
 * site shows of it (the homepage's arcade row and list, the footer index,
 * the search palette, the sitemap, the full-screen routes) reads the
 * registry and needs no line of its own. The share card is held by
 * test/site with every other card.
 *
 * The slug set and the idle painter are private to their modules, so
 * they are asked through what those modules export.
 */

/** His internal name, as a whole word in any case: never in anything a visitor reads. */
const NAME = /\bhugo\b/i;

describe("the registry entry", () => {
  it("is spec 17.1's, with the description the lead decided", () => {
    expect(findTool("knuff")).toEqual({
      slug: "knuff",
      title: "Knuff",
      tagline: "Pull back. Let go.",
      description:
        "A one-thumb arcade game. Pull him back, let go, and he flies across the arcade floor after closing: while he is fast he pops whatever he touches, and the moment he slows he is the one in trouble. Bank off the cushions, pick a charm on the hour, and keep the floor clear until morning — most nights end well before it. One score. Runs entirely in your tab.",
      color: "pink",
      emoji: "➶",
      isNew: true,
    });
  });

  it("promises no length a night does not keep, and names nobody", () => {
    const knuff = findTool("knuff")!;
    // A night that reaches morning takes 3.5 to 7 minutes, and most end
    // much sooner (pillar 4): "about five minutes" was true of neither.
    expect(knuff.description).not.toMatch(/minute/i);
    for (const field of ["title", "tagline", "description"] as const) {
      expect(NAME.test(knuff[field]), field).toBe(false);
    }
  });

  it("stands with the games, and is the one new thing on the site", () => {
    const first = tools.findIndex((tool) => isGameSlug(tool.slug));
    expect(tools.slice(first).every((tool) => isGameSlug(tool.slug))).toBe(true);
    expect(tools.slice(first).map((tool) => tool.slug)).toContain("knuff");
    // One NEW tag at a time: it moved here from Survival Maxx.
    expect(tools.filter((tool) => tool.isNew).map((tool) => tool.slug)).toEqual(["knuff"]);
  });

  it("is a game, so it lives at /games/knuff", () => {
    expect(isGameSlug("knuff")).toBe(true);
    expect(pathFor("knuff")).toBe("/games/knuff");
    expect(isGameSlug("no-such-game")).toBe(false);
  });
});

describe("the icon", () => {
  const rows: readonly string[] = PIXEL_ICONS.knuff;

  it("is twelve rows of twelve cells, lit or empty", () => {
    expect(ICON_SIZE).toBe(12);
    expect(rows).toHaveLength(12);
    for (const row of rows) expect(row).toMatch(/^[#.]{12}$/);
  });

  it("is spec 17.3's drawing: him, flying, speed lines behind him", () => {
    expect(rows).toEqual([
      "............",
      "............",
      ".....######.",
      "....########",
      "##..#.##.###",
      "....#.##.###",
      "###.########",
      "....########",
      "##...######.",
      "............",
      "............",
      "............",
    ]);
  });

  it("is the one the lists use for it, and no other icon's", () => {
    expect(iconForSlug("knuff", true)).toBe("knuff");
    for (const [name, other] of Object.entries(PIXEL_ICONS)) {
      if (name !== "knuff") expect(other.join("/"), name).not.toBe(rows.join("/"));
    }
  });
});

type Rect = { x: number; y: number; w: number; h: number; color: string };

/** What the cabinet's painter draws at time `t`, in the order it draws it. */
function frame(t: number): Rect[] {
  const out: Rect[] = [];
  screenFor("knuff")((x, y, w, h, color) => out.push({ x, y, w, h, color }), t);
  return out;
}

/** The loop is 3.6 s. Two of them at 60 frames a second, as the homepage draws it. */
const LOOP = 3.6;
const TIMES = Array.from({ length: Math.round(2 * LOOP * 60) + 1 }, (_, i) => i / 60);

const CORAL = COLOR_HEX.tomato;
const at = (rects: Rect[], x: number, y: number, w: number, h: number) =>
  rects.filter((r) => r.x === x && r.y === y && r.w === w && r.h === h);
/** The rings in a frame, by the width of their rows: a ring of side n is drawn as a row of n on top and below, and two short sides. */
const ringsOf = (rects: Rect[]) => rects.filter((r) => r.h === 1 && r.w >= 5 && r.color === INK_HEX).map((r) => r.w);

describe("the cabinet's screen", () => {
  it("has a painter of its own, not the idle screen and not another game's", () => {
    const painter = screenFor("knuff");
    expect(painter).not.toBe(screenFor("no-such-game"));
    for (const tool of tools) {
      if (tool.slug !== "knuff" && isGameSlug(tool.slug)) expect(painter, tool.slug).not.toBe(screenFor(tool.slug));
    }
  });

  it("draws the same rectangles for the same time, in any order", () => {
    const forward = TIMES.map(frame);
    const backward = [...TIMES].reverse().map(frame).reverse();
    expect(backward).toEqual(forward);
    // One loop is the next: the second draws what the first drew.
    for (let i = 0; i < 60; i++) {
      const t = i / 7;
      expect(frame(t + LOOP), `t ${t}`).toEqual(frame(t));
    }
  });

  it("puts no cell outside the glass and none over a cushion, over two loops", () => {
    for (const t of TIMES) {
      const rects = frame(t);
      // The two cushions come first, the whole height of each side.
      expect(rects.slice(0, 2), `t ${t}`).toEqual([
        { x: 0, y: 0, w: 1, h: SCREEN_H, color: rects[0].color },
        { x: SCREEN_W - 1, y: 0, w: 1, h: SCREEN_H, color: rects[0].color },
      ]);
      for (const r of rects.slice(2)) {
        const where = `t ${t}: ${JSON.stringify(r)}`;
        for (const n of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(n), where).toBe(true);
        expect(r.w > 0 && r.h > 0, where).toBe(true);
        // Between the cushions, inside the glass.
        expect(r.x >= 1 && r.x + r.w <= SCREEN_W - 1, where).toBe(true);
        expect(r.y >= 0 && r.y + r.h <= SCREEN_H, where).toBe(true);
      }
    }
  });

  it("plays the game: pulled back, flies hot, pops three, lands in a ring that closes", () => {
    const loop = TIMES.filter((t) => t < LOOP).map(frame);
    const bunnies = loop.map((rects) => rects.filter((r) => r.w === 2 && r.h === 2 && r.color !== INK_HEX).length);
    expect(bunnies[0]).toBe(3);
    // Each is gone once he has reached it, and none comes back in the loop.
    for (let i = 1; i < bunnies.length; i++) expect(bunnies[i]).toBeLessThanOrEqual(bunnies[i - 1]);
    expect(bunnies[bunnies.length - 1]).toBe(0);
    // He is in every frame, in coral, three cells square.
    for (const rects of loop) expect(rects.filter((r) => r.color === CORAL && r.w === 3 && r.h === 3)).toHaveLength(1);
    // Flying he wears the 5-cell ring; landed, the thump's 9 and then 7, never the 5.
    const flying = loop.filter((_, i) => {
      const p = (TIMES[i] % LOOP) / LOOP;
      return p >= 0.38 + 1 / 216 && p < 0.68;
    });
    const landed = loop.filter((_, i) => (TIMES[i] % LOOP) / LOOP >= 0.68);
    expect(flying.length).toBeGreaterThan(0);
    for (const rects of flying) expect(ringsOf(rects)).toEqual([5, 5]);
    expect(landed.some((rects) => ringsOf(rects).join() === "9,9")).toBe(true);
    expect(landed.some((rects) => ringsOf(rects).join() === "7,7")).toBe(true);
    expect(landed.some((rects) => ringsOf(rects).length === 0)).toBe(true);
    for (const rects of landed) expect(ringsOf(rects)).not.toContain(5);
  });

  it("under reduced motion holds him drawn back with the band taut and three dust bunnies ahead", () => {
    const still = frame(STILL_T);
    // The pull is held from 0.3 to 0.38 of the loop: the still frame is
    // one of those, so the band is at its longest.
    expect(STILL_T / LOOP).toBeGreaterThanOrEqual(0.3);
    expect(STILL_T / LOOP).toBeLessThan(0.38);
    expect(still).toEqual(frame(0.31 * LOOP));
    expect(still).toEqual(frame(0.379 * LOOP));
    // Him, at rest at the start, no ring of either kind.
    expect(at(still, 8, 7, 3, 3).map((r) => r.color)).toEqual([CORAL]);
    expect(at(still, 10, 8, 1, 1).map((r) => r.color)).toEqual([INK_HEX]);
    expect(ringsOf(still)).toEqual([]);
    // The band behind him: three beads and the thumb at its end, in ink,
    // the thumb clear of the cushion.
    for (const x of [7, 5, 3]) expect(at(still, x, 8, 1, 1).map((r) => r.color), `bead at ${x}`).toEqual([INK_HEX]);
    expect(at(still, 1, 7, 2, 3).map((r) => r.color)).toEqual([INK_HEX]);
    // Three dust bunnies ahead of him, one colour, not his.
    const ahead = [13, 17, 21].map((x) => at(still, x, 8, 2, 2));
    for (const found of ahead) expect(found).toHaveLength(1);
    expect(new Set(ahead.map(([r]) => r.color)).size).toBe(1);
    expect(ahead[0][0].color).not.toBe(CORAL);
    expect(ahead[0][0].color).not.toBe(INK_HEX);
    // And nothing else: two cushions, the band, the bunnies, him and his eye.
    expect(still).toHaveLength(2 + 4 + 3 + 2);
  });
});
