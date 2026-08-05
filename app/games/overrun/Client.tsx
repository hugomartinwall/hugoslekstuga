"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createOverrun } from "@/lib/overrun/game";
import { resolveGameFonts } from "@/lib/overrun/fonts";
import { CREAM_HEX } from "@/lib/colors";

/**
 * Overrun — fullscreen from first paint. The whole game is imperative
 * canvas code in lib/overrun/; this component only owns the mount/unmount
 * lifecycle and the "back to playhouse" navigation from the pause menu.
 */
export default function Client() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = createOverrun(canvas, {
      onExit: () => router.push("/"),
      fonts: resolveGameFonts(),
    });
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      game.destroy();
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50" style={{ backgroundColor: CREAM_HEX }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ touchAction: "none" }}
        aria-label="Overrun — a real-time strategy game. Drag from your nodes to send units."
      />
    </div>
  );
}
