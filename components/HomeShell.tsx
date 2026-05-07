"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ToolCard from "@/components/ToolCard";
import SurpriseButton from "@/components/SurpriseButton";
import { tools } from "@/lib/tools";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

const STORAGE_KEY = "hugoslekstuga:home:view";

type View = "grid" | "map";

/**
 * The homepage shell.
 *
 * Map view: the map fills the entire viewport (minus the nav). Title,
 * subtitle, view toggle, and the Surprise Me button float on top as
 * solid-ish panels — the page IS the map.
 *
 * Grid view: classic scroll layout with cards. Useful when someone wants
 * to scan the toolset linearly.
 */
export default function HomeShell() {
  const [view, setView] = useState<View>("map");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "grid" || saved === "map") setView(saved);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {}
  }, [view, hydrated]);

  if (view === "grid") {
    return <GridView setView={setView} />;
  }
  return <MapView setView={setView} />;
}

/* -------------------------------------------------------------------------
 * Map view — the playhouse, full-bleed.
 * -----------------------------------------------------------------------*/

function MapView({ setView }: { setView: (v: View) => void }) {
  // Map fills the viewport minus the nav. Using dvh so mobile address-bar
  // collapse doesn't change the canvas height mid-interaction.
  return (
    <div className="relative h-[calc(100dvh-72px)] w-full overflow-hidden">
      {/* Map fills the whole layer */}
      <div className="absolute inset-0">
        <ToolMap fullBleed />
      </div>

      {/* Top zone — hero + controls.
          Mobile: stacked column, controls wrap below the hero.
          Desktop: hero on the left, controls in a vertical stack on the right.
          Bottom of the map stays clear for the cluster legend. */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-col gap-3 sm:left-6 sm:right-6 sm:top-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="card-chunk pointer-events-auto max-w-md rounded-[var(--radius-card)] bg-cream/95 p-4 backdrop-blur sm:p-6">
          <h1 className="font-display text-2xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Small,{" "}
            <span className="text-tomato">useful</span>{" "}
            <span className="text-blue">browser</span>{" "}
            <span className="text-pink">tools</span>.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft sm:mt-3 sm:text-base">
            Quick tools that do one thing well — no signup, no upload, no
            tracking. Drag a node, click to open.
          </p>
        </div>

        <div className="pointer-events-auto flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <ViewToggle view="map" setView={setView} />
          <span className="rounded-full border-2 border-ink bg-cream/95 px-3 py-1 text-xs font-bold backdrop-blur">
            {tools.length} tools
          </span>
          <span className="hidden rounded-full bg-cream/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft backdrop-blur sm:block">
            Or just dive in
          </span>
          <SurpriseButton />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Grid view — the alternate browse mode, classic page layout.
 * -----------------------------------------------------------------------*/

function GridView({ setView }: { setView: (v: View) => void }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      <section className="py-12 sm:py-16">
        <div className="flex max-w-3xl flex-col gap-5">
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Small,
            <br />
            <span className="text-tomato">useful</span>{" "}
            <span className="text-blue">browser</span>{" "}
            <span className="text-pink">tools</span>.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-ink-soft sm:text-xl">
            Quick tools that do one thing well — no signup, no upload, no
            tracking. Just open a tab and use them.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            The tools
          </h2>
          <div className="flex items-center gap-3">
            <ViewToggle view="grid" setView={setView} />
            <span className="text-sm font-medium text-ink-muted">
              {tools.length} so far
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Or just dive in
          </span>
          <SurpriseButton />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Shared
 * -----------------------------------------------------------------------*/

function ViewToggle({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  return (
    <div className="flex items-center gap-0 rounded-full border-2 border-ink bg-cream/95 p-0.5 text-xs font-bold backdrop-blur">
      <button
        type="button"
        onClick={() => setView("grid")}
        className={`rounded-full px-3 py-1 transition-colors ${
          view === "grid" ? "bg-ink text-cream" : "text-ink-soft hover:text-ink"
        }`}
      >
        Grid
      </button>
      <button
        type="button"
        onClick={() => setView("map")}
        className={`rounded-full px-3 py-1 transition-colors ${
          view === "map" ? "bg-ink text-cream" : "text-ink-soft hover:text-ink"
        }`}
      >
        Map
      </button>
    </div>
  );
}
