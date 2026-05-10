"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import SurpriseButton from "@/components/SurpriseButton";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

/**
 * The homepage IS the map.
 *
 * Map fills the viewport (minus nav). Two small icon balls float
 * top-right: re-cluster (pink ⥁) and Surprise (yellow ?). The cluster
 * legend keeps the bottom-center.
 *
 * No grid/map toggle: the search palette (⌘K) covers the linear-list use
 * case, so committing fully to the map keeps the page playful.
 */
export default function HomeShell() {
  const [resetTrigger, setResetTrigger] = useState(0);

  return (
    <div className="relative h-[calc(100dvh-72px)] w-full overflow-hidden">
      {/* Map fills the layer below all overlays. */}
      <div className="absolute inset-0">
        <ToolMap fullBleed resetTrigger={resetTrigger} />
      </div>

      {/* Top-right: re-cluster + surprise balls. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-start gap-2 sm:right-6 sm:top-6">
        <div className="pointer-events-auto flex items-center gap-2">
          <ReclusterButton onClick={() => setResetTrigger((t) => t + 1)} />
          <SurpriseButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Pink ball matching the Surprise yellow ball — same dimensions, same
 * chunky shadow. Icon ⥁ ("circular arrow") reads as "shake the layout".
 * Adds a quick spin animation while the new cluster settles.
 */
function ReclusterButton({ onClick }: { onClick: () => void }) {
  const [spinning, setSpinning] = useState(false);

  const handle = () => {
    if (spinning) return;
    setSpinning(true);
    onClick();
    window.setTimeout(() => setSpinning(false), 600);
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label="Re-cluster the map"
      title="Shake the map"
      className="btn-chunk relative flex h-14 w-14 items-center justify-center rounded-full bg-pink font-display text-2xl font-extrabold text-cream transition-transform disabled:cursor-progress sm:h-16 sm:w-16 sm:text-3xl"
      style={{
        transform: spinning ? "rotate(360deg)" : undefined,
        transition: spinning
          ? "transform 600ms cubic-bezier(0.34, 1.4, 0.64, 1)"
          : "transform 200ms ease",
      }}
    >
      <span aria-hidden>⥁</span>
    </button>
  );
}
