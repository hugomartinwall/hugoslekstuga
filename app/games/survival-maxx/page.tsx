import type { Viewport } from "next";
import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("survival-maxx");

/**
 * Page-scoped: only the game goes edge-to-edge. viewport-fit=cover is what
 * makes env(safe-area-inset-*) non-zero on notched iPhones — the game's UI
 * layer reads those insets so its HUD stays clear of the notch and the home
 * indicator. userScalable off because the arena owns touch: dragging is the
 * virtual joystick, never a zoom.
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
