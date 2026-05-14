"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Tool } from "@/lib/tools";
import { bgClass, bgSoftClass } from "@/lib/colors";

/**
 * Tool page chrome. Wraps every tool with the back link, header
 * card, and brand corner dot.
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
  children,
}: {
  tool: Tool;
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
      className={`mx-auto w-full max-w-3xl px-5 pt-16 pb-10 sm:px-8 sm:pt-20 sm:pb-14 ${
        ready ? "card-arrive" : "opacity-0"
      }`}
    >
      <Link
        href="/"
        className="group mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        <span
          aria-hidden
          className="inline-block transition-transform duration-200 group-hover:-translate-x-1"
        >
          ←
        </span>
        Back to playhouse
      </Link>

      <header
        className={`card-chunk relative mb-10 flex flex-col gap-4 rounded-[var(--radius-card)] ${bgSoftClass(tool.color)} p-6 sm:p-8`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink ${bgClass(tool.color)} text-2xl`}
            aria-hidden
          >
            {tool.emoji}
          </div>
          <div className="flex flex-col">
            <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">
              {tool.title}
            </h1>
            <p className="text-base font-medium text-ink-soft">
              {tool.tagline}
            </p>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
