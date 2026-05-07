"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ToolCard from "@/components/ToolCard";
import SurpriseButton from "@/components/SurpriseButton";
import { tools } from "@/lib/tools";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

const STORAGE_KEY = "hugoslekstuga:home:view";

type View = "grid" | "map";

export default function ToolsSection() {
  // Map is the default — the playhouse opens onto the graph. Returning
  // visitors who chose Grid keep their preference via localStorage.
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

  return (
    <section id="tools" className="scroll-mt-24 pb-20">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          The tools
        </h2>
        <div className="flex items-center gap-3">
          <ViewToggle view={view} setView={setView} />
          <span className="text-sm font-medium text-ink-muted">
            {tools.length} so far
          </span>
        </div>
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      ) : (
        <ToolMap />
      )}

      <div className="mt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Or just dive in
        </span>
        <SurpriseButton />
      </div>
    </section>
  );
}

function ViewToggle({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  return (
    <div className="flex items-center gap-0 rounded-full border-2 border-ink bg-cream p-0.5 text-xs font-bold">
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
