"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import HugoParkour from "@/components/hugo/HugoParkour";
import PixelWordmark from "@/components/PixelWordmark";

const ToolMap = dynamic(() => import("@/components/ToolMap"), { ssr: false });

/** Names for toys that no longer exist — only used by the retired notice. */
const RETIRED_NAMES: Record<string, string> = {
  case: "the case converter",
  cleantext: "the text cleaner",
  convert: "the document converter",
  diff: "the diff",
  pdf: "the PDF tool",
  qr: "the QR maker",
  read: "the text analyser",
  typing: "the typing test",
  stretch: "the stretch guide",
};

/**
 * The homepage IS the map.
 *
 * Map fills the viewport (minus nav). Two small icon balls float
 * top-right: explode (pink ✸) and Surprise (yellow ?). The map is a
 * free-floating swarm; explode throws every dot outward in a
 * confetti burst and gravity pulls them home.
 *
 * No grid/map toggle: the search palette (⌘K) covers the linear-list use
 * case, so committing fully to the map keeps the page playful.
 */
export default function HomeShell() {
  const [explodeTrigger, setExplodeTrigger] = useState(0);
  const [retiredName, setRetiredName] = useState<string | null>(null);
  const [powerOn, setPowerOn] = useState(false);
  const [parkour, setParkour] = useState(false);
  /** Bottom edge of the marquee (viewport px) — the attract hint sits
   *  just under it, completing the logo + PRESS START composition. */
  const [markBottom, setMarkBottom] = useState<number | null>(null);
  /** Tagline of the swarm orb under the cursor — whispered along the
   *  bottom edge. Kept after hover ends so the fade-out has text. */
  const [whisper, setWhisper] = useState<string | null>(null);
  const [whisperOn, setWhisperOn] = useState(false);

  // The marquee publishes its layout whenever it (re)draws; the swarm
  // broadcasts which orb the cursor is on. Both feed small bits of
  // page chrome here.
  useEffect(() => {
    const onLayout = (e: Event) => {
      const detail = (e as CustomEvent<{ bottom: number } | null>).detail;
      setMarkBottom(detail ? detail.bottom : null);
    };
    const onHover = (e: Event) => {
      const detail = (
        e as CustomEvent<{ tagline?: string } | null>
      ).detail;
      if (detail?.tagline) {
        setWhisper(detail.tagline);
        setWhisperOn(true);
      } else {
        setWhisperOn(false);
      }
    };
    window.addEventListener("hugoslekstuga:wordmark-layout", onLayout);
    window.addEventListener("hugoslekstuga:tool-hover", onHover);
    return () => {
      window.removeEventListener("hugoslekstuga:wordmark-layout", onLayout);
      window.removeEventListener("hugoslekstuga:tool-hover", onHover);
    };
  }, []);

  // The bottom hint follows the mode — attract invitation normally,
  // controls while Hugo's parkour owns the room.
  useEffect(() => {
    const onStart = () => setParkour(true);
    const onEnd = () => setParkour(false);
    window.addEventListener("hugoslekstuga:parkour-start", onStart);
    window.addEventListener("hugoslekstuga:parkour-end", onEnd);
    return () => {
      window.removeEventListener("hugoslekstuga:parkour-start", onStart);
      window.removeEventListener("hugoslekstuga:parkour-end", onEnd);
    };
  }, []);

  // CRT power-on — the room switches on the first time this session
  // reaches the homepage, then stays warm. Reduced motion skips it
  // (the keyframe is also gated in globals.css).
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (window.sessionStorage.getItem("hugoslekstuga:crt-on")) return;
      window.sessionStorage.setItem("hugoslekstuga:crt-on", "1");
    } catch {
      return;
    }
    const tid = window.setTimeout(() => setPowerOn(true), 30);
    return () => window.clearTimeout(tid);
  }, []);

  // A bookmark to a retired tool redirects here with ?retired=<slug>.
  // Acknowledge the loss once, then clean the URL so refreshes stay quiet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("retired");
    if (!slug) return;
    const name = RETIRED_NAMES[slug];
    if (name) {
      // Let the map settle before the notice fades in.
      window.setTimeout(() => setRetiredName(name), 600);
      window.setTimeout(() => setRetiredName(null), 7600);
    }
    params.delete("retired");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (rest ? `?${rest}` : ""),
    );
  }, []);

  return (
    <div
      className={`scanlines relative h-dvh w-full overflow-hidden ${
        powerOn ? "crt-on" : ""
      }`}
    >
      {/* Visually-hidden page heading + intro. The homepage UI is
          almost entirely an SVG map, so the crawler and screen
          readers would otherwise see an empty page. This is the
          actual page identity for them. */}
      <h1 className="sr-only">
        Hugos Lekstuga — a small playhouse of browser tools
      </h1>
      <p className="sr-only">
        Hugo spends the off-hours on experiments that occasionally turn
        into something worth sharing. Hugos Lekstuga (Swedish for
        Hugo&rsquo;s playground) is where they land — small, playful
        browser tools that run in your tab. No accounts, no uploads, no
        analytics.
      </p>
      {/* Map fills the layer below all overlays. */}
      <div className="absolute inset-0">
        <ToolMap fullBleed explodeTrigger={explodeTrigger} />
      </div>

      {/* The marquee — HUGOS LEKSTUGA as phosphor pixels, centred in
          the swarm. Pointer-transparent; sits above the map's trail
          canvas, below every overlay. */}
      <PixelWordmark powerOn={powerOn} />

      {/* The room takes the hit when the forbidden button is pressed. */}
      {explodeTrigger > 0 && (
        <div
          key={explodeTrigger}
          aria-hidden
          className="screen-flicker pointer-events-none absolute inset-0 z-20"
        />
      )}

      {/* Attract-mode hint — the arcade's standing invitation, blinking
          right under the marquee (the PRESS START idiom). While the
          parkour owns the room it drops to the bottom edge and shows
          the controls instead. */}
      <p
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 z-10 text-center font-pixel text-[10px] uppercase tracking-[0.3em] text-ink-muted ${
          parkour ? "bottom-5" : "press-blink"
        }`}
        style={
          parkour
            ? undefined
            : markBottom !== null
              ? { top: markBottom + 22 }
              : { bottom: 20 }
        }
      >
        {parkour ? "← → move · ↑ jump · esc gives up" : "press any tool"}
      </p>

      {/* Hover whisper — the hovered orb's tagline, murmured along
          the bottom edge the hint vacated. */}
      <p
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-5 z-10 text-center font-pixel text-[10px] uppercase tracking-[0.24em] text-ink-muted transition-opacity duration-300"
        style={{ opacity: whisperOn && !parkour ? 0.85 : 0 }}
      >
        {whisper}
      </p>

      {/* The hidden game — long-press the corner Hugo to start it. */}
      <HugoParkour />

      {/* Retired-tool notice: a small line at the bottom, gone in 7s. */}
      {retiredName && (
        <div className="fade-rise pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
          <p className="notch-sm border border-line bg-cream-deep px-4 py-2 text-center text-sm text-ink-soft" style={{ marginBottom: 28 }}>
            Hugo put {retiredName} away. The toys he still plays with are all
            here.
          </p>
        </div>
      )}

      {/* Top-right: the one forbidden button. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-start sm:right-6 sm:top-6">
        <div className="pointer-events-auto">
          <ExplodeButton onClick={() => setExplodeTrigger((t) => t + 1)} />
        </div>
      </div>
    </div>
  );
}

/**
 * The big red arcade button. Every cabinet has one, every cabinet
 * labels it DO NOT PRESS, and everyone presses it. A square coral
 * keycap in a dark housing plate with the warning in small print —
 * the honest arcade form of the thing.
 */
function ExplodeButton({ onClick }: { onClick: () => void }) {
  const [pulsing, setPulsing] = useState(false);

  const handle = () => {
    if (pulsing) return;
    setPulsing(true);
    onClick();
    window.setTimeout(() => setPulsing(false), 400);
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label="Do not press (explodes the map)"
      title="DO NOT PRESS"
      className="notch-sm flex flex-col items-center gap-1.5 border border-line bg-cream-deep px-3 pb-2 pt-3"
      style={{
        transform: pulsing ? "scale(1.12)" : undefined,
        transition: pulsing
          ? "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "transform 220ms ease",
      }}
    >
      <span
        aria-hidden
        className="btn-chunk flex h-10 w-10 items-center justify-center bg-tomato font-display text-xl text-cream"
      >
        ✸
      </span>
      <span
        aria-hidden
        className="font-pixel text-[8px] uppercase tracking-[0.18em] text-ink-muted"
      >
        do not press
      </span>
    </button>
  );
}
