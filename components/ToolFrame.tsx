"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Tool } from "@/lib/tools";
import { accentVars } from "@/lib/colors";
import { isGameSlug } from "@/lib/clusters";
import { iconForSlug } from "@/lib/pixel-icons";
import PixelIcon from "@/components/PixelIcon";
import IconTile from "@/components/ui/IconTile";
import { keycapClass } from "@/components/ui/Keycap";

/**
 * Tool page chrome: one slim title row (back key, the tool's icon tile,
 * its name, its tagline) and then the tool. The row sits on Hugo's own
 * line in the corner, so the tool starts near the top of the screen
 * instead of under a header card.
 *
 * It also sets the page's accent (--accent / --accent-soft) from the
 * tool's registry colour, so every kit control inside wears it without
 * being told.
 *
 * The entrance animation is **origin-pinned**: when Hugo (the
 * traveling dot in the root layout) lands at the nav after fetching
 * the tool, he dispatches `hugoslekstuga:dot-arrived` with his
 * landing screen position. We pin the `card-arrive` keyframe's
 * transform-origin to that point so the page visually *expands from
 * Hugo*, reinforcing that the tool opened because he opened it.
 *
 * For direct visits (no Hugo flight — URL pasted, deep link, etc.)
 * the origin falls back to the nav-dot's expected screen position
 * after a 50ms wait, so every tool entry uses the same motion
 * vocabulary regardless of how the user got there.
 */
export default function ToolFrame({
  tool,
  hugoOnStage = false,
  children,
}: {
  tool: Tool;
  /** The page puts its own Hugo on the stage (Advice), so the corner one
   *  yields and the row has no slot to keep for him. */
  hugoOnStage?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let resolved = false;

    const setOrigin = (x: number, y: number) => {
      if (resolved) return;
      resolved = true;
      const root = rootRef.current;
      if (root) {
        // Convert viewport coords to coords relative to the entering
        // element so transform-origin pins correctly.
        const r = root.getBoundingClientRect();
        const localX = x - r.left;
        const localY = y - r.top;
        root.style.setProperty("--enter-origin-x", `${localX}px`);
        root.style.setProperty("--enter-origin-y", `${localY}px`);
      }
      setReady(true);
    };

    const onArrived = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      setOrigin(detail.x, detail.y);
    };
    window.addEventListener("hugoslekstuga:dot-arrived", onArrived);

    // Fallback for direct visits — if no event arrives in 50ms, pin
    // origin to where the nav dot lives now (read its position) so
    // the expansion still feels intentional.
    const fallback = window.setTimeout(() => {
      if (resolved) return;
      const navDot = document.querySelector<HTMLElement>("[data-brand-dot]");
      if (navDot) {
        const r = navDot.getBoundingClientRect();
        setOrigin(r.left + r.width / 2, r.top + r.height / 2);
      } else {
        // No nav dot in DOM somehow — fall further back to top-right
        // of viewport (where the nav dot lives in practice).
        setOrigin(window.innerWidth - 32, 32);
      }
    }, 50);

    return () => {
      window.removeEventListener("hugoslekstuga:dot-arrived", onArrived);
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      style={accentVars(tool.color)}
      className={`page-col px-5 pt-4 pb-10 sm:px-8 sm:pb-14 ${
        ready ? "card-arrive" : "opacity-0"
      }`}
    >
      {/* Below `lg` the column reaches the corner where Hugo lives, so the
          row starts to his right. Where the page has its own Hugo the
          corner is empty and the row starts at the margin, over the
          tagline, as the column does from `lg` up. */}
      <header className="mb-7 sm:mb-9">
        <div
          className={`flex min-h-11 items-center gap-3 ${
            hugoOnStage ? "" : "pl-14 lg:pl-0"
          }`}
        >
          <Link
            href="/"
            aria-label="Back to playhouse"
            className={keycapClass({
              tone: "quiet",
              size: "icon",
              className: "shrink-0 sm:w-auto sm:px-3",
            })}
          >
            <PixelIcon name="back" size={12} />
            <span className="label-pixel hidden text-ink-soft sm:inline">
              playhouse
            </span>
          </Link>
          <IconTile name={iconForSlug(tool.slug, isGameSlug(tool.slug))} />
          <h1 className="font-display text-3xl leading-none text-ink sm:text-4xl">
            {tool.title}
          </h1>
          <p className="ml-1 hidden min-w-0 truncate text-sm text-ink-muted md:block">
            {tool.tagline}
          </p>
        </div>
        <p className="mt-2 text-sm text-ink-muted md:hidden">{tool.tagline}</p>
      </header>

      <main>{children}</main>
    </div>
  );
}
