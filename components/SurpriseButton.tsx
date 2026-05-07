"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool } from "@/lib/tools";

const ROLL_FRAMES = 5;
const ROLL_FRAME_MS = 85;
const LAND_HOLD_MS = 220;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function SurpriseButton() {
  const router = useRouter();
  const [face, setFace] = useState<Tool | null>(null);
  const [rolling, setRolling] = useState(false);
  const lockRef = useRef(false);

  const surprise = useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setRolling(true);
    const target = tools[Math.floor(Math.random() * tools.length)];
    let last = "";
    for (let i = 0; i < ROLL_FRAMES; i++) {
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

  return (
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
  );
}
