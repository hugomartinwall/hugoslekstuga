"use client";

import { useEffect, useRef } from "react";
import { drawArcadeCabinet, ARCADE_CABINET_GLASS } from "@/lib/hugo/sprite";
import { screenFor, STILL_T } from "@/lib/hugo/cabinet-screens";

/**
 * One arcade cabinet with its screen playing — the same machine the
 * homepage room draws in its row, as a small standalone canvas for the
 * phone homepage's game cards.
 *
 * Every instance on the page shares one animation frame (a module-level
 * ticker), the loop stops while the tab is hidden, and reduced motion
 * draws a single still frame instead.
 */

type Draw = (now: number) => void;
const draws = new Set<Draw>();
let raf = 0;

function tick(now: number) {
  for (const d of draws) d(now);
  raf = draws.size > 0 && !document.hidden ? requestAnimationFrame(tick) : 0;
}

function subscribe(d: Draw): () => void {
  draws.add(d);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => {
    draws.delete(d);
    if (draws.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && draws.size > 0 && !raf) {
      raf = requestAnimationFrame(tick);
    }
  });
}

export default function CabinetCanvas({
  slug,
  accent,
  unit = 2,
  className,
}: {
  slug: string;
  /** The marquee colour (the game family's accent). */
  accent: string;
  /** CSS px per cabinet grid unit: 2 → 76×84. */
  unit?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = ARCADE_CABINET_GLASS.gridW * unit;
  const h = ARCADE_CABINET_GLASS.gridH * unit;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const painter = screenFor(slug);
    const paint = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawArcadeCabinet(
        ctx,
        canvas.width / 2,
        canvas.height / 2,
        unit * dpr,
        accent,
        (put) => painter(put, t),
      );
    };
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      paint(STILL_T);
      return;
    }
    return subscribe((now) => paint(now / 1000));
  }, [slug, accent, unit, w, h]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className}
      style={{ width: w, height: h, imageRendering: "pixelated" }}
    />
  );
}
