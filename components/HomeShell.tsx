"use client";

import dynamic from "next/dynamic";
import SurpriseButton from "@/components/SurpriseButton";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

/**
 * The homepage IS the map.
 *
 * Map fills the viewport (minus nav). Hero floats top-left as a solid-ish
 * card. A small Surprise icon ball floats top-right. The cluster legend
 * keeps the bottom-center; a re-cluster chip lives bottom-left.
 *
 * No grid/map toggle: the search palette (⌘K) covers the linear-list use
 * case, so committing fully to the map keeps the page playful.
 */
export default function HomeShell() {
  return (
    <div className="relative h-[calc(100dvh-72px)] w-full overflow-hidden">
      {/* Map fills the layer below all overlays. */}
      <div className="absolute inset-0">
        <ToolMap fullBleed />
      </div>

      {/* Top zone: hero on the left, Surprise ball on the right. */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-3 sm:left-6 sm:right-6 sm:top-6">
        <div className="card-chunk pointer-events-auto max-w-md rounded-[var(--radius-card)] bg-cream/95 p-4 backdrop-blur sm:p-6">
          <h1 className="font-display text-3xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Pick a{" "}
            <span className="text-tomato">dot</span>.{" "}
            <span className="block sm:inline">
              Any{" "}
              <span className="text-blue">dot</span>.
            </span>
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft sm:mt-3 sm:text-base">
            Each one is a tiny browser tool that does one small thing well.
            No signup, nothing uploaded, all running in this tab.
          </p>
        </div>

        <div className="pointer-events-auto">
          <SurpriseButton />
        </div>
      </div>
    </div>
  );
}
