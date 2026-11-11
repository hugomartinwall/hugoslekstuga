"use client";

import { useEffect, useRef } from "react";
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
  const holder = useRef<HTMLDivElement>(null);

  // The footer lives in the root layout, so it outlives the page above
  // it. After a trip through one of its links the focus was still on that
  // link: on the new page, scrolled to the top, no focus showed anywhere,
  // and the next Tab went on through the footer instead of into the page.
  // When the page changes while the focus is in here, it moves to the new
  // page's heading (which also tells a screen reader where it has
  // landed), so the next Tab is the page's first control. Without
  // scrolling: the new page is already at its top. Dropping the focus is
  // not enough, the browser keeps tabbing on from where it was.
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!holder.current?.contains(active)) return;
    const heading = document.querySelector<HTMLElement>("h1");
    if (!heading) {
      active.blur();
      return;
    }
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pathname]);

  if (FULL_SCREEN_ROUTES.has(pathname)) return null;
  const home = pathname === "/";
  return (
    // `contents`: the holder is only there to know what is inside the
    // footer; it has no box of its own.
    <div ref={holder} className="contents">
      <Footer
        pathname={pathname}
        className={home ? "md:hidden" : undefined}
        index={!home}
        column={home ? "list" : "page"}
      />
    </div>
  );
}
