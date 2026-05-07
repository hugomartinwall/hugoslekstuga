"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";

/**
 * The homepage is now the map — full viewport, no scroll. The Footer
 * doesn't fit there. It still renders on every other route.
 */
export default function ConditionalFooter() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <Footer />;
}
