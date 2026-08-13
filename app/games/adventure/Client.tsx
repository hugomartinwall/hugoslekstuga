"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createAdventure } from "@/lib/adventure/game";
import { resolveGameFonts } from "@/lib/adventure/fonts";
import { CREAM_HEX } from "@/lib/colors";

/**
 * Adventure — fullscreen from first paint. The whole game is imperative
 * canvas code in lib/adventure/; this component only owns the mount/unmount
 * lifecycle and the "back to playhouse" navigation from the pause menu.
 */
export default function Client() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = createAdventure(canvas, {
      onExit: () => router.push("/"),
      fonts: resolveGameFonts(),
    });
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    // No rubber-banding: a thumb that slides off the virtual stick and
    // reaches the page edge must not bounce the whole viewport on iOS.
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      game.destroy();
    };
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        backgroundColor: CREAM_HEX,
        // iOS touch hardening: a long-press on the attack button must not
        // pop the text selection callout or the magnifier over the fight.
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ touchAction: "none" }}
        aria-label="Adventure — a top-down action adventure. Move with WASD or the arrow keys, swing your sword with space, and buy upgrades between fights. On touch screens, use the on-screen stick and buttons."
      />
    </div>
  );
}
