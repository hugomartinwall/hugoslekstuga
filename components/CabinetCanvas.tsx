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
 *
 * A cabinet only plays while it is on screen or about to be. The list
 * these stand in is in the page in both layouts (it is the server-
 * rendered HTML), and while the room showed, its four cabinets were
 * repainted every frame under display:none. One that is not rendered,
 * or has been scrolled well out of view, now leaves the ticker; it keeps
 * its last picture and picks up again when it comes near (an
 * intersection observer says which).
 *
 * The first picture is painted at mount, whether or not the cabinet is
 * rendered: a canvas can be drawn on without a box, and it keeps what
 * was drawn. So no cabinet is ever blank, wherever it is on the page and
 * whichever layout is showing. That matters for a print made from a
 * room-size window: paper is narrower than the room, so the print shows
 * the list, and cabinets that had waited for a box to be painted in
 * came out as four empty frames.
 */

/** How far outside the window a cabinet starts playing: far enough that
 *  one scrolled into view is already moving when it arrives. */
const NEAR = "200px 0px";

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
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = () => subscribe((now) => paint(now / 1000));

    // The first picture, now, rendered or not (see above). Under reduced
    // motion it is also the only one.
    paint(still ? STILL_T : performance.now() / 1000);
    if (still) return;
    // No way to tell where the cabinet is: play wherever it is, as before.
    if (typeof IntersectionObserver === "undefined") return play();

    // Playing. Not intersecting covers both cases: scrolled away, and
    // not rendered at all.
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        const near = entries[entries.length - 1].isIntersecting;
        if (near && !stop) {
          stop = play();
        } else if (!near && stop) {
          stop();
          stop = null;
        }
      },
      { rootMargin: NEAR },
    );
    io.observe(canvas);
    return () => {
      io.disconnect();
      stop?.();
    };
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
