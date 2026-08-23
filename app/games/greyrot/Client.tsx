"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { resolveGameFonts } from "@/lib/greyrot/fonts";

/**
 * Greyrot — fullscreen from first paint. The game is imperative three.js and
 * DOM code in lib/greyrot/; this component owns the mount/unmount lifecycle
 * and the way out.
 *
 * Two children, not one. Unlike Overrun and Adventure — which paint their
 * whole HUD onto the canvas — Greyrot's HUD is real DOM: four classes append
 * into `#ui` and inject their own prefixed stylesheets there. So the canvas
 * gets a sibling, and the game gets both nodes handed to it.
 *
 * The engine is imported inside the effect rather than at module scope. That
 * keeps three.js (~119 KB gz) off any bundle the server touches, and means the
 * chunk is fetched when someone actually opens the game.
 */
export default function Client() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const uiRoot = uiRef.current;
    if (!canvas || !uiRoot) return;

    // The canvas holds keyboard focus: browser-quirks binds Space and the
    // arrows there so they stop scrolling the page during play without
    // swallowing those keys anywhere else on the site.
    canvas.focus();

    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    // `cancelled` covers the StrictMode double-mount and a player who leaves
    // while the world is still being built: the boot is async, so cleanup can
    // run before there is anything to clean.
    let cancelled = false;
    let handle: { destroy(): void } | null = null;

    void import("@/lib/greyrot/main").then(({ createGreyrot }) =>
      createGreyrot(canvas, uiRoot, {
        onExit: () => router.push("/"),
        fonts: resolveGameFonts(),
      }).then((h) => {
        if (cancelled) h.destroy();
        else handle = h;
      }),
    );

    return () => {
      cancelled = true;
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      handle?.destroy();
    };
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        // Greyrot's own night, not the site's page surface: the world renders
        // edge to edge from the first frame, so this only shows for an instant
        // and must not flash a lighter colour behind the sky.
        backgroundColor: "#0a0d14",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="block h-full w-full outline-none"
        style={{ touchAction: "none" }}
        aria-label="Greyrot — a real-time action adventure. Move toward what you want to face, queue two elements on Q W E A S D, and press Space to cast along your facing. Escape leaves."
      />
      {/*
       * The HUD root.
       *
       * `pointerEvents: "none"` here, and DELIBERATELY no rule granting it
       * back to the children. A blanket `#ui > * { pointer-events: auto }` has
       * specificity (1,0,1) and beats the (0,1,0) `pointer-events: none` on
       * `.sp-root` — which is a full-viewport div, so it computes to `auto` and
       * shields the entire canvas. Measured cost when that rule existed: the
       * virtual stick moved the hero 0.0000 m over 40 held ticks, touch mode
       * never latched, and a touch-only pilot stood still for 1,865 ticks with
       * every stage uncleared. It never looked wrong in a screenshot. Every
       * interactive HUD element declares its own `pointer-events: auto`.
       *
       * The safe-area padding is why page.tsx sets viewport-fit=cover.
       */}
      <div
        ref={uiRef}
        id="ui"
        className="pointer-events-none fixed inset-0"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
        }}
      />
    </div>
  );
}
