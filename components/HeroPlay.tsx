"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool } from "@/lib/tools";
import { CLUSTER_ORDER, CLUSTERS, TOOL_CLUSTER, type ClusterId } from "@/lib/clusters";

const PILL_TEXT_DARK = new Set<ClusterId>(["time", "creative"]);

const ROLL_FRAMES = 5;
const ROLL_FRAME_MS = 85;
const LAND_HOLD_MS = 220;

export default function HeroPlay() {
  const router = useRouter();
  const [face, setFace] = useState<Tool | null>(null);
  const [rolling, setRolling] = useState(false);
  const lockRef = useRef(false);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const surprise = useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setRolling(true);
    const target = tools[Math.floor(Math.random() * tools.length)];
    let last = "";
    for (let i = 0; i < ROLL_FRAMES; i++) {
      // Pick a frame that isn't the same as the last one or the final target.
      let pick: Tool;
      let attempts = 0;
      do {
        pick = tools[Math.floor(Math.random() * tools.length)];
        attempts++;
      } while (
        attempts < 8 &&
        (pick.title === last || pick.slug === target.slug)
      );
      last = pick.title;
      setFace(pick);
      await sleep(ROLL_FRAME_MS);
    }
    setFace(target);
    await sleep(LAND_HOLD_MS);
    router.push(`/tools/${target.slug}`);
  }, [router]);

  const pickFromCluster = useCallback(
    (id: ClusterId) => {
      if (lockRef.current) return;
      const candidates = tools.filter((t) => TOOL_CLUSTER[t.slug] === id);
      if (candidates.length === 0) return;
      const t = candidates[Math.floor(Math.random() * candidates.length)];
      router.push(`/tools/${t.slug}`);
    },
    [router],
  );

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={surprise}
        disabled={rolling}
        aria-live="polite"
        className="btn-chunk relative rounded-[var(--radius-button)] bg-yellow px-6 py-3 font-display text-lg font-extrabold disabled:cursor-progress"
      >
        <span className="relative inline-block min-w-[210px] text-center">
          {face ? (
            <span key={face.slug} className="featured-in inline-flex items-center gap-1.5">
              <span aria-hidden>{face.emoji}</span>
              <span>{face.title}</span>
            </span>
          ) : (
            <>Surprise me →</>
          )}
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          or a mood:
        </span>
        {CLUSTER_ORDER.map((id) => {
          const c = CLUSTERS[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => pickFromCluster(id)}
              disabled={rolling}
              className="group rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_0_var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: c.color,
                color: PILL_TEXT_DARK.has(id) ? "#1a1812" : "#fbf6ee",
              }}
              aria-label={`Open a random ${c.label} tool`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
