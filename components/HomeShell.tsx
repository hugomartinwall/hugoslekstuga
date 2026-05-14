"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import SurpriseButton from "@/components/SurpriseButton";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

/**
 * The homepage IS the map.
 *
 * Map fills the viewport (minus nav). Two small icon balls float
 * top-right: explode (pink ✸) and Surprise (yellow ?). The map is a
 * free-floating swarm; explode throws every dot outward in a
 * confetti burst and gravity pulls them home.
 *
 * No grid/map toggle: the search palette (⌘K) covers the linear-list use
 * case, so committing fully to the map keeps the page playful.
 */
export default function HomeShell() {
  const [explodeTrigger, setExplodeTrigger] = useState(0);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {/* Visually-hidden page heading + intro. The homepage UI is
          almost entirely an SVG map, so the crawler and screen
          readers would otherwise see an empty page. This is the
          actual page identity for them. */}
      <h1 className="sr-only">
        Hugos Lekstuga — a small playhouse of browser tools
      </h1>
      <p className="sr-only">
        Hugo spends the off-hours on experiments that occasionally turn
        into something worth sharing. Hugos Lekstuga (Swedish for
        Hugo&rsquo;s playground) is where they land — small, playful
        browser tools that run in your tab. No accounts, no uploads, no
        analytics.
      </p>
      {/* Map fills the layer below all overlays. */}
      <div className="absolute inset-0">
        <ToolMap fullBleed explodeTrigger={explodeTrigger} />
      </div>

      {/* Top-right: explode + surprise balls. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-start gap-2 sm:right-6 sm:top-6">
        <div className="pointer-events-auto flex items-center gap-2">
          <ExplodeButton onClick={() => setExplodeTrigger((t) => t + 1)} />
          <SurpriseButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Pink ball matching the Surprise yellow ball — same dimensions, same
 * chunky shadow. Icon ✸ (heavy eight-pointed star) reads as "burst".
 * A quick scale-pulse on click gives the button a satisfying "thunk"
 * while the dots fly outward.
 */
function ExplodeButton({ onClick }: { onClick: () => void }) {
  const [pulsing, setPulsing] = useState(false);

  const handle = () => {
    if (pulsing) return;
    setPulsing(true);
    onClick();
    window.setTimeout(() => setPulsing(false), 400);
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label="Explode the map"
      title="Explode"
      className="btn-chunk relative flex h-14 w-14 items-center justify-center rounded-full bg-pink font-display text-2xl font-extrabold text-cream transition-transform disabled:cursor-progress sm:h-16 sm:w-16 sm:text-3xl"
      style={{
        transform: pulsing ? "scale(1.25)" : undefined,
        transition: pulsing
          ? "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "transform 220ms ease",
      }}
    >
      <span aria-hidden>✸</span>
    </button>
  );
}
