"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "@/lib/survival-maxx/style.css";

/**
 * Survival Maxx — fullscreen from first paint. The game is imperative
 * three.js plus a DOM interface in lib/survival-maxx/; this component owns
 * the mount/unmount lifecycle and the way out.
 *
 * The game builds its own arena, loading splash and touch joystick under the
 * root div handed to it, and injects the shell rules it needs there. Its main
 * stylesheet is imported above: every selector in it is `.rz-` prefixed, so
 * nothing leaks into the rest of the site.
 *
 * The engine is imported inside the effect rather than at module scope. That
 * keeps three.js off any bundle the server touches, and means the chunk is
 * fetched when someone actually opens the game.
 */
export default function Client() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    // `cancelled` covers the StrictMode double-mount and a player who leaves
    // while the game is still booting: creation is async, so cleanup can run
    // before there is anything to clean.
    let cancelled = false;
    let handle: { destroy(): void } | null = null;

    void import("@/lib/survival-maxx/main").then(({ createSurvivalMaxx }) =>
      createSurvivalMaxx(root, { onExit: () => router.push("/") }).then(
        (h) => {
          if (cancelled) h.destroy();
          else handle = h;
        },
      ),
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
      ref={rootRef}
      className="fixed inset-0 z-50"
      style={{
        // The game's own night, not the site's page surface: the arena paints
        // edge to edge from the first frame, so this only shows for an instant.
        backgroundColor: "#151c23",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "none",
      }}
      aria-label="Survival Maxx — an arena survival game. Move with WASD, arrows or by dragging; weapons fire on their own; Space or the Dash button dodges."
    />
  );
}
