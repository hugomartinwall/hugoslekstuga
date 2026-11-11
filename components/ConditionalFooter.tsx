"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { tools } from "@/lib/tools";

/**
 * Where the footer shows.
 *
 * Never on a full-screen route: the sjökort chart and every game fill the
 * viewport and do not scroll. The game routes come from the registry, so
 * a new game needs no edit here.
 *
 * The homepage is the one in-between. From `md` up the room is exactly one
 * screen with no scrolling, so the footer is hidden; below `md` the page
 * scrolls like any other and the footer shows. That is decided in CSS
 * (`md:hidden` on the <footer>), not by measuring the viewport in script,
 * so the server and the first paint already agree. And because that phone
 * page is itself the list of every game and tool, its footer is the small
 * print only.
 */
const FULL_SCREEN_ROUTES = new Set([
  pathFor("sjokort"),
  ...tools.filter((t) => isGameSlug(t.slug)).map((t) => pathFor(t.slug)),
]);

export default function ConditionalFooter() {
  const pathname = usePathname();
  if (FULL_SCREEN_ROUTES.has(pathname)) return null;
  const home = pathname === "/";
  return (
    <Footer
      pathname={pathname}
      className={home ? "md:hidden" : undefined}
      index={!home}
    />
  );
}
