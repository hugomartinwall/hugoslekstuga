import type { Metadata, Viewport } from "next";
import { findTool } from "@/lib/tools";
import Client from "./Client";

const tool = findTool("adventure")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
};

/**
 * Page-scoped: only the game goes edge-to-edge. viewport-fit=cover is what
 * makes env(safe-area-inset-*) non-zero on notched iPhones — the renderer
 * reads those via the --sat/--sar/--sab/--sal custom properties in
 * globals.css and keeps its HUD and touch controls out of the notch.
 * userScalable off because a double-tap mid-fight must not zoom the page;
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
