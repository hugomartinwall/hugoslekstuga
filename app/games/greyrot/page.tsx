import type { Viewport } from "next";
import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("greyrot");

/**
 * Page-scoped: only the game goes edge-to-edge. viewport-fit=cover is what
 * makes env(safe-area-inset-*) non-zero on notched iPhones — Greyrot's HUD
 * root consumes them directly as padding, so the element arc and the health
 * bar stay clear of the notch and the home indicator.
 *
 * userScalable off because a pinch during a fight is never a zoom request;
 * touch-action:none on the canvas is the real guard.
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
