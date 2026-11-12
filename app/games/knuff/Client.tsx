"use client";

import { useEffect, useRef, useState } from "react";
import { CREAM_HEX } from "@/lib/colors";
import { ROOT_LABEL } from "@/lib/knuff/content/copy";
import { resolveKnuffFonts } from "@/lib/knuff/fonts";
import { createKnuff, type KnuffView } from "@/lib/knuff/game";

/**
 * Knuff: full-screen from first paint. The whole game is imperative
 * canvas code in lib/knuff/; this component owns the mount and the
 * unmount and nothing else.
 *
 * The root is the game's one touch surface: it fills the page, the canvas
 * fills it, and the room, the top bar and the thumb deck are all drawn in
 * that canvas. So the protections the other games put on their canvas are
 * on the root here (no browser panning, no text selection, no callout): a
 * pull that began beside a canvas would be taken by the browser as a
 * scroll and cancelled. The game's keys are heard on the root too, which
 * is why it can take the focus.
 */
export default function Client() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<KnuffView>({ screen: "start" });

  // One effect, and everything it does is undone by its clean-up, so
  // StrictMode's mount, clean-up and second mount end with one game, one
  // frame loop and one set of listeners.
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const game = createKnuff(root, canvas, { fonts: resolveKnuffFonts(), onChange: setView });
    // The page lock is a class (see html.game-open in globals.css), not
    // inline styles: nothing is saved here and nothing is restored.
    document.documentElement.classList.add("game-open");
    root.focus({ preventScroll: true });
    // He is on stage here: the corner mascot yields the screen.
    window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-stage", { detail: { present: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-stage", { detail: { present: false } }));
      document.documentElement.classList.remove("game-open");
      game.destroy();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="application"
      aria-label={ROOT_LABEL}
      data-screen={view.screen}
      className="fixed inset-0 z-50 outline-none"
      style={{
        backgroundColor: CREAM_HEX,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
