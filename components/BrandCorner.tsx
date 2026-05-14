"use client";

import BrandDot from "@/components/BrandDot";

/**
 * Hugo's home — a free-floating brand mark in the top-left corner of
 * every page. Replaces the old wordmark + top nav. Bigger than the
 * inline dot was (0.7em of a 44px wrapper = ~31px) so Hugo reads as
 * the brand identity without any text alongside him.
 *
 * Fixed-position so the TravelingDot animations still target a stable
 * screen anchor — the canvas resolves `[data-brand-dot]` exactly the
 * same way it did when Hugo lived in the wordmark.
 *
 * All BrandDot behaviours apply: proximity eyes, color cycle on tap,
 * shift+click opens his room, long-press starts the leash, drag-and-
 * spring for joy, spam-click for the play-dead tantrum, and the
 * Konami-code somersault. The on-`/about` voice still grounds the
 * brand name in copy; the tab title, URL bar, and footer carry it
 * everywhere else.
 */
export default function BrandCorner() {
  return (
    <div
      aria-hidden={false}
      style={{
        position: "fixed",
        top: 16,
        left: 18,
        zIndex: 40,
        // The wrapper's font-size controls BrandDot's rendered size
        // (it's authored as 0.7em). 44px gives a ~31px dot — big
        // enough to read as a brand mark, small enough to stay quiet.
        fontSize: "44px",
        lineHeight: 1,
        // The dot uses inline-block + a left margin to space itself
        // from the wordmark. We don't want that margin in the corner.
        // Negative margin pulls it tight to the edge.
      }}
    >
      <BrandDot interactive />
    </div>
  );
}
