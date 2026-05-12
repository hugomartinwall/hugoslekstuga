"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The signature interaction: when a tool dot on the homepage swarm is
 * clicked, that dot animates up to the nav's brand-dot position as the
 * route changes — making the same dot read as a *resident* that follows
 * you from the playhouse map into a tool's room.
 *
 * Listens for a global `hugoslekstuga:dot-travel` CustomEvent fired by
 * ToolMap with the swarm dot's viewport coords + colour. Finds the nav
 * BrandDot via `[data-brand-dot]`, animates from the swarm position to
 * the nav position, then unmounts — leaving the actual nav dot in place
 * for the user to see as "the dot that just arrived".
 *
 * Lives in the root layout so it persists across the route change. The
 * dot is purely decorative — pointer-events: none, aria-hidden.
 */

type Journey = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
};

const TRAVEL_MS = 480;
const DOT_SIZE = 28;
/** Two ghost dots lag behind the main one so the flight reads as a
 *  trail, not a teleport. Each is smaller, fainter, and starts moving
 *  slightly later — they all arrive at the destination together by
 *  running shorter transitions. */
const TRAIL = [
  { delayMs: 70, sizeRatio: 0.78, opacity: 0.5 },
  { delayMs: 140, sizeRatio: 0.6, opacity: 0.28 },
];

export default function TravelingDot() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [flying, setFlying] = useState(false);
  const reduceMotionRef = useRef(false);
  const rafIdsRef = useRef<{ id1: number; id2: number }>({ id1: 0, id2: 0 });

  // Honour the OS reduced-motion preference. When reduced-motion is on
  // we don't render the traveling dot at all — the page just changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const listener = (e: MediaQueryListEvent) => {
      reduceMotionRef.current = e.matches;
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTravel = (e: Event) => {
      if (reduceMotionRef.current) return;
      const detail = (
        e as CustomEvent<{ fromX: number; fromY: number; color: string }>
      ).detail;
      if (!detail) return;
      const navDot = document.querySelector<HTMLElement>("[data-brand-dot]");
      if (!navDot) return;
      const r = navDot.getBoundingClientRect();
      setJourney({
        id: Date.now() + Math.random(),
        fromX: detail.fromX,
        fromY: detail.fromY,
        toX: r.left + r.width / 2,
        toY: r.top + r.height / 2,
        color: detail.color,
      });
      setFlying(false);
    };
    window.addEventListener("hugoslekstuga:dot-travel", onTravel);
    return () =>
      window.removeEventListener("hugoslekstuga:dot-travel", onTravel);
  }, []);

  // Two-frame delay before switching to "flying" so the initial render
  // commits at fromX/fromY *without* a transition, then the next frame
  // sets the destination and the transition runs.
  useEffect(() => {
    if (!journey) return;
    const rafs = rafIdsRef.current;
    rafs.id1 = requestAnimationFrame(() => {
      rafs.id2 = requestAnimationFrame(() => setFlying(true));
    });
    const clear = window.setTimeout(() => {
      setJourney(null);
      setFlying(false);
    }, TRAVEL_MS + 40);
    return () => {
      cancelAnimationFrame(rafs.id1);
      cancelAnimationFrame(rafs.id2);
      window.clearTimeout(clear);
    };
  }, [journey]);

  if (!journey) return null;

  const x = flying ? journey.toX : journey.fromX;
  const y = flying ? journey.toY : journey.fromY;

  return (
    <>
      {/* Trail dots — render *behind* the main one (z-index 49), each
          smaller and fainter, each with a transition that starts later
          but ends at the same wall-clock time so they all arrive at the
          nav together. The result reads as a comet tail. */}
      {TRAIL.map((t, i) => {
        const size = DOT_SIZE * t.sizeRatio;
        const dur = TRAVEL_MS - t.delayMs;
        return (
          <div
            key={`trail-${i}-${journey.id}`}
            aria-hidden
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: 9999,
              background: journey.color,
              opacity: t.opacity,
              transform: `translate(${x}px, ${y}px) scale(${flying ? 0.5 : 1})`,
              transition: flying
                ? `transform ${dur}ms cubic-bezier(0.65, 0, 0.35, 1) ${t.delayMs}ms`
                : "none",
              pointerEvents: "none",
              zIndex: 49,
              willChange: "transform",
            }}
          />
        );
      })}

      {/* Main dot — the one that lands at the nav. */}
      <div
        key={journey.id}
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: DOT_SIZE,
          height: DOT_SIZE,
          marginLeft: -DOT_SIZE / 2,
          marginTop: -DOT_SIZE / 2,
          borderRadius: 9999,
          background: journey.color,
          transform: `translate(${x}px, ${y}px) scale(${flying ? 0.6 : 1})`,
          transition: flying
            ? `transform ${TRAVEL_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
            : "none",
          pointerEvents: "none",
          zIndex: 50,
          willChange: "transform",
        }}
      />
    </>
  );
}
