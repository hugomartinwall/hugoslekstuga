"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";

/**
 * Full-viewport, no-scroll routes don't have room for the Footer: the
 * homepage swarm map and the sjökort chart both fill the screen. It
 * still renders on every other route.
 */
const FULL_SCREEN_ROUTES = new Set(["/", "/tools/sjokort", "/games/overrun"]);

export default function ConditionalFooter() {
  const pathname = usePathname();
  if (FULL_SCREEN_ROUTES.has(pathname)) return null;
  return <Footer />;
}
