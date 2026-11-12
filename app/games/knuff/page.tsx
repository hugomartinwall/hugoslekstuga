import type { Metadata, Viewport } from "next";
import Client from "./Client";

/**
 * Written out here until the game has its entry in the registry
 * (lib/tools.ts): nothing links to this route yet, and the other game
 * pages read these two lines from their entry. When the entry is added
 * this becomes the same lookup, with the same words.
 */
export const metadata: Metadata = {
  title: "Knuff",
  description:
    "A one-thumb arcade game. Pull him back, let go, and he flies across the arcade floor after closing: while he is fast he pops whatever he touches, and the moment he slows he is the one in trouble. Bank off the cushions, pick a charm on the hour, and keep the floor clear until morning. One score, about five minutes. Runs entirely in your tab.",
};

/**
 * Page-scoped: only the game goes edge-to-edge. viewport-fit=cover is what
 * makes env(safe-area-inset-*) non-zero on notched iPhones; the renderer
 * reads those through the --sat/--sar/--sab/--sal custom properties in
 * globals.css and keeps the room out of the notch. userScalable off
 * because a double tap in the middle of a night must not zoom the page;
 * touch-action: none on the game's root is the real guard.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function Page() {
  return <Client />;
}
