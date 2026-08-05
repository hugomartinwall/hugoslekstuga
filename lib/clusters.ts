// Routing helpers for tool slugs.
//
// The site used to have visible cluster categories (Files / Writing / …)
// driving the homepage map's edges and legend. That model was retired
// when the map became a free-floating swarm with always-visible names —
// no more category groupings, no more inter-tool edges.
//
// What survives: the path resolver. Most tools live at /tools/<slug>;
// games (currently just Munch) live at /games/<slug>. This file is
// where that one-line decision is encoded.

const GAME_SLUGS = new Set<string>(["munch", "noodle", "overrun"]);

/**
 * The route a tool lives at. Most tools are under /tools/<slug>; games
 * get their own /games/<slug> prefix so the URL reads honestly as a
 * game and not yet-another-utility.
 */
export function pathFor(slug: string): string {
  return GAME_SLUGS.has(slug) ? `/games/${slug}` : `/tools/${slug}`;
}

/** Games render as arcade cabinets on the homepage swarm; ToolMap asks here. */
export function isGameSlug(slug: string): boolean {
  return GAME_SLUGS.has(slug);
}
