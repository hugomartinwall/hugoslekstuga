"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool } from "@/lib/tools";
import { pathFor } from "@/lib/clusters";

const ROLL_FRAMES = 8;
const ROLL_FRAME_MS = 60;
const LAND_HOLD_MS = 140;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A small circular icon ball. On click it rapidly cycles tool emojis
 * inside the ball, then navigates to a random tool. The label is just
 * "?" — saying "Surprise me" out loud would give it away. The surprise
 * is the page that loads.
 */
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
    router.push(pathFor(target.slug));
  }, [router]);

  return (
    <button
      type="button"
      onClick={surprise}
      disabled={rolling}
      aria-label="Open a random tool"
      title="Open a random tool"
      className="btn-chunk relative flex h-14 w-14 items-center justify-center rounded-full bg-yellow font-display text-2xl font-extrabold text-ink transition-transform hover:rotate-[8deg] disabled:cursor-progress sm:h-16 sm:w-16 sm:text-3xl"
    >
      {rolling && face ? (
        <span
          key={face.slug}
          aria-hidden
          className="featured-in"
          style={{ display: "inline-block" }}
        >
          {face.emoji}
        </span>
      ) : (
        <span aria-hidden>?</span>
      )}
    </button>
  );
}
