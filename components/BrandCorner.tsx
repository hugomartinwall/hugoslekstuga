"use client";

import BrandDot from "@/components/BrandDot";

/**
 * Hugo's home — a free-floating brand mark in the top-left corner of
 * every page. Replaces the old wordmark + top nav. Bigger than the
 * inline dot was (0.7em of the 52px wrapper below = a ~36px sprite) so
 * Hugo reads as the brand identity without any text alongside him.
 *
 * Fixed-position so the TravelingDot animations still target a stable
 * screen anchor — the canvas resolves `[data-brand-dot]` exactly the
 * same way it did when Hugo lived in the wordmark.
 *
 * All BrandDot behaviours apply: proximity eyes, color cycle on tap,
 * shift+click opens his room, drag-and-spring for joy, spam-click for
 * the play-dead tantrum, the Konami-code somersault, and a long-press
 * that — on the homepage, with a mouse — starts Hugo's Parkour. (The
 * long-press used to start a cursor leash; the leash was deleted when
 * the game took its place.) The on-`/about` voice still grounds the
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
        // (it's authored as 0.7em). 52px gives a ~36px sprite — the
        // 16×16 pixel body needs a little more room than the old disc
        // did to keep its face legible.
        fontSize: "52px",
        lineHeight: 1,
        // BrandDot still carries the 0.16em left margin that once
        // spaced it from the wordmark, and nothing here takes it back:
        // he sits about 26px from the edge, not 18.
      }}
    >
      <BrandDot interactive />
    </div>
  );
}
