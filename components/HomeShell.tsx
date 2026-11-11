"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import HugoParkour from "@/components/hugo/HugoParkour";
import PixelWordmark from "@/components/PixelWordmark";
import HomeList from "@/components/HomeList";
import PixelIcon from "@/components/PixelIcon";
import Keycap from "@/components/ui/Keycap";
import { tools } from "@/lib/tools";
import { isGameSlug } from "@/lib/clusters";
import { cabinetRow, ROOM_MIN_WIDTH } from "@/lib/home-layout";

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
  munch: "the blob arcade",
  noodle: "the snake pit",
};

const GAME_COUNT = tools.filter((t) => isGameSlug(t.slug)).length;

/**
 * The homepage, in two layouts built from the same parts.
 *
 * From 768px up it is THE ROOM: one screen, no scrolling. The tools
 * float as a swarm around the pixel title, the games stand along the
 * floor as a row of arcade cabinets, and search, about and the one
 * forbidden button sit in the top-right corner. The room is also the
 * first level of Hugo's parkour.
 *
 * Below that it is THE LIST (components/HomeList.tsx): the same title,
 * games and tools as a short scrolling page a thumb can use. The list
 * is in the server-rendered HTML; the room's swarm is client-only, and
 * it is only mounted when the room is what is on screen.
 */
export default function HomeShell() {
  const [explodeTrigger, setExplodeTrigger] = useState(0);
  const [retiredName, setRetiredName] = useState<string | null>(null);
  const [powerOn, setPowerOn] = useState(false);
  const [parkour, setParkour] = useState(false);
  /** Which layout is on screen. Unknown until mounted, so nothing
   *  client-only is created for a layout that is not showing. */
  const [layout, setLayout] = useState<"unknown" | "room" | "list">("unknown");
  const layoutRef = useRef(layout);
  /** Height the arcade row takes at the bottom of the room — the title
   *  centres in what is left above it. */
  const [rowReserve, setRowReserve] = useState(0);
  const roomRef = useRef<HTMLDivElement>(null);
  /** Bottom edge of the marquee (viewport px) — the attract hint sits
   *  just under it, completing the logo + PRESS START composition. */
  const [markBottom, setMarkBottom] = useState<number | null>(null);
  /** Tagline of the thing under the cursor — whispered where the hint
   *  blinks. Kept after hover ends so the fade-out has text. */
  const [whisper, setWhisper] = useState<string | null>(null);
  const [whisperOn, setWhisperOn] = useState(false);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Room or list: decided by width, in step with the `md:` classes below.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${ROOM_MIN_WIDTH}px)`);
    const apply = () => setLayout(mq.matches ? "room" : "list");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // The arcade row's height follows the room's size. Layout size, never
  // getBoundingClientRect: the CRT power-on squashes the room mid-measure.
  useEffect(() => {
    if (layout !== "room") return;
    const room = roomRef.current;
    if (!room) return;
    const measure = () => {
      const row = cabinetRow(room.offsetWidth, room.offsetHeight, GAME_COUNT);
      setRowReserve(row.reserve);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(room);
    return () => ro.disconnect();
  }, [layout]);

  // The marquee publishes its layout whenever it (re)draws; the swarm
  // broadcasts what the cursor is on. Both feed small bits of page
  // chrome here.
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

  // The hint follows the mode — attract invitation normally, controls
  // while Hugo's parkour owns the room. The parkour only exists in the
  // room: a long-press in a narrow desktop window starts nothing.
  useEffect(() => {
    const onStart = () => {
      if (layoutRef.current === "room") setParkour(true);
    };
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

  const press = () => setExplodeTrigger((t) => t + 1);
  const retiredNotice = retiredName ? (
    <p className="notch-sm bg-cream-deep px-4 py-2 text-center text-sm text-ink-soft">
      Hugo put {retiredName} away. The toys he still plays with are all here.
    </p>
  ) : null;

  return (
    <>
      {/* Visually-hidden page heading + intro. The room is almost
          entirely a canvas, so the crawler and screen readers would
          otherwise find very little. This is the page's identity for
          them. */}
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

      {/* ── The list: phones ─────────────────────────────────────────── */}
      <div
        className={`scanlines relative md:hidden ${powerOn ? "crt-on" : ""}`}
        style={{ transformOrigin: "50% 30vh" }}
      >
        {explodeTrigger > 0 && (
          <div
            key={explodeTrigger}
            aria-hidden
            className="screen-flicker pointer-events-none fixed inset-0 z-20"
          />
        )}
        <HomeList powerOn={powerOn && layout === "list"} jolt={explodeTrigger}>
          {retiredNotice ? (
            <div className="fade-rise mt-8 flex justify-center">{retiredNotice}</div>
          ) : null}
          <div className="mt-9 flex items-end justify-between gap-3">
            <HomeKeys />
            <ExplodeButton onClick={press} />
          </div>
        </HomeList>
      </div>

      {/* ── The room: everything from a tablet up ────────────────────── */}
      <div
        ref={roomRef}
        className={`scanlines relative hidden h-dvh w-full overflow-hidden md:block ${
          powerOn ? "crt-on" : ""
        }`}
      >
        {/* The swarm and the arcade row fill the layer below all overlays. */}
        <div className="absolute inset-0">
          {layout === "room" && <ToolMap explodeTrigger={explodeTrigger} />}
        </div>

        {/* The marquee — HUGOS LEKSTUGA as phosphor pixels, centred in
            the band above the arcade row. Pointer-transparent; sits
            above the map's trail canvas, below every overlay. */}
        {layout === "room" && (
          <PixelWordmark powerOn={powerOn} bottomInset={rowReserve} />
        )}

        {/* The room takes the hit when the forbidden button is pressed. */}
        {explodeTrigger > 0 && (
          <div
            key={explodeTrigger}
            aria-hidden
            className="screen-flicker pointer-events-none absolute inset-0 z-20"
          />
        )}

        {/* Attract-mode hint — the arcade's standing invitation, blinking
            right under the marquee (the PRESS START idiom). Hovering a
            tool or a cabinet swaps it for that thing's tagline; while
            the parkour owns the room, the controls sit along the top. */}
        {parkour ? (
          <p
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-6 z-10 text-center font-pixel text-[10px] uppercase tracking-[0.3em] text-ink-muted"
          >
            ← → move · ↑ jump · esc gives up
          </p>
        ) : (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 h-4 text-center font-pixel text-[10px] uppercase text-ink-muted"
            style={
              markBottom !== null
                ? { top: markBottom + 22 }
                : { top: "50%" }
            }
          >
            <p
              className={`absolute inset-x-0 tracking-[0.3em] ${
                whisperOn ? "" : "press-blink"
              }`}
              style={{ opacity: whisperOn ? 0 : undefined }}
            >
              press any tool
            </p>
            <p
              className="absolute inset-x-0 tracking-[0.24em] transition-opacity duration-300"
              style={{ opacity: whisperOn ? 0.9 : 0 }}
            >
              {whisper}
            </p>
          </div>
        )}

        {/* The hidden game — long-press the corner Hugo to start it. */}
        {layout === "room" && <HugoParkour />}

        {/* Retired-tool notice: a small line under the hint, gone in 7s. */}
        {retiredNotice && (
          <div
            className="fade-rise pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4"
            style={{ top: (markBottom ?? 300) + 56 }}
          >
            {retiredNotice}
          </div>
        )}

        {/* Top-right: search, about, and the one forbidden button. They
            go quiet while the parkour owns the room. */}
        <div
          className={`pointer-events-none absolute right-3 top-3 z-10 flex items-start gap-3 sm:right-6 sm:top-6 ${
            parkour ? "opacity-30" : ""
          }`}
        >
          <div
            className={parkour ? "pointer-events-none flex pt-1" : "pointer-events-auto flex pt-1"}
            inert={parkour}
          >
            <HomeKeys />
          </div>
          <div
            className={parkour ? "pointer-events-none" : "pointer-events-auto"}
            inert={parkour}
          >
            <ExplodeButton onClick={press} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Search and About. They used to float in the swarm as two more orbs,
 * which made them look like toys; they are doors, so they are keys.
 */
function HomeKeys() {
  return (
    <div className="flex items-center gap-2.5">
      <Keycap
        size="sm"
        className="min-h-11"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("hugoslekstuga:open-search"))
        }
      >
        <PixelIcon name="search" size={12} />
        <span className="font-pixel text-[10px] tracking-[0.1em] uppercase">
          search
        </span>
      </Keycap>
      <Keycap href="/about" size="sm" className="min-h-11">
        <PixelIcon name="about" size={12} />
        <span className="font-pixel text-[10px] tracking-[0.1em] uppercase">
          about
        </span>
      </Keycap>
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
