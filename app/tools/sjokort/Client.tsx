"use client";

import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { MapShell } from "./MapShell";

export default function SjokortClient() {
  const tool = findTool("sjokort")!;
  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-3">
        <div className="card-chunk relative h-[65vh] min-h-[420px] w-full overflow-hidden rounded-[var(--radius-card)]">
          <MapShell />
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          Tiles from OpenStreetMap &amp; OpenSeaMap. This is the one tool here
          that loads from the open web — those servers see an anonymous tile
          request, never you. Your location stays on your device.
        </p>
      </div>
    </ToolFrame>
  );
}
