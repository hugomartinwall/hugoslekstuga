import type { Viewport } from "next";
import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("knuff");

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
