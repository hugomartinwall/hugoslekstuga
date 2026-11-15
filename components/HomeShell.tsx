"use client";

import { useEffect, useRef, useState, type AnimationEvent } from "react";
import dynamic from "next/dynamic";
import HugoParkour from "@/components/hugo/HugoParkour";
import PixelWordmark from "@/components/PixelWordmark";
import HomeList from "@/components/HomeList";
import PixelIcon from "@/components/PixelIcon";
import Keycap from "@/components/ui/Keycap";
import { tools } from "@/lib/tools";
import { isGameSlug } from "@/lib/clusters";
import { cabinetRow, ROOM_MEDIA } from "@/lib/home-layout";

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

/** An arrow in the parkour's controls hint: a pixel icon set in the line
 *  of text (the stylesheet's reset makes every <svg> a block). */
const HINT_ARROW = "inline-block align-middle";

/**
 * The homepage, in two layouts built from the same parts.
 *
 * In a window at least 48rem wide and 35rem tall (768 by 560 at the
 * usual text size) it is THE ROOM: one screen, no scrolling. The tools
 * float as a swarm around the pixel title, the games stand along the
 * floor as a row of arcade cabinets, and search, about and the one
 * forbidden button sit in the top-right corner. The room is also the
 * first level of Hugo's parkour.
 *
 * In anything smaller (a phone, a phone held sideways, a short desktop
 * window) it is THE LIST (components/HomeList.tsx): the same title,
 * games and tools as a short scrolling page a thumb can use. The list
 * is in the server-rendered HTML; the room's swarm is client-only, and
 * it is only mounted when the room is what is on screen.
 *
 * Which of the two shows is one question asked in two places: the
 * stylesheet's `room:` and `list:` variants (app/globals.css) and
 * ROOM_MEDIA (lib/home-layout.ts), which holds the same query.
 */
export default function HomeShell() {
  const [explodeTrigger, setExplodeTrigger] = useState(0);
  /** The press whose flicker is on the screen now; 0 when none is. */
  const [flickerOf, setFlickerOf] = useState(0);
  const [retiredName, setRetiredName] = useState<string | null>(null);
  /** True while the CRT power-on plays, and only then. */
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

  // Room or list: decided by the window's width and height, with the
  // same query the `room:` and `list:` classes below are built on, so
  // what is mounted is always what the stylesheet is showing.
  useEffect(() => {
    const mq = window.matchMedia(ROOM_MEDIA);
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
  // room: a long-press in a window too narrow or too short for it starts
  // nothing. A run that is on when the window leaves the room's size is
  // ended by the game itself as it is taken off the page (HugoParkour
  // announces parkour-end when it unmounts mid-run), and that lands here.
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
  // (the keyframe is also gated in globals.css). `powerOn` goes back to
  // false when the animation has played (powerOnPlayed, below).
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

  const press = () => {
    const next = explodeTrigger + 1;
    setExplodeTrigger(next);
    setFlickerOf(next);
  };

  // A one-shot animation plays again whenever its element is shown again
  // after being hidden, and each layout's wrapper is hidden whenever the
  // other layout shows. So the two one-shots here are taken away once
  // they have played. The power-on's class comes off both wrappers: it
  // used to stay for the life of the page, and the screen switched on
  // again each time the window crossed the room's size (as it did in a
  // print, which shows the hidden list from its first frame, a thin
  // strip). A flicker's overlay is unmounted: after one press of the
  // forbidden button the screen used to flicker on every crossing. Only
  // the wrapper that is on screen plays, so only that one reports the
  // end, and that is enough. PixelWordmark lights its letters when
  // `powerOn` turns true and takes no notice of it turning false.
  const powerOnPlayed = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.animationName === "crt-on") {
      setPowerOn(false);
    }
  };

  const retiredNotice = retiredName ? (
    <p className="plate-chunk bg-cream-deep px-4 py-2 text-center text-sm text-ink-soft">
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

      {/* ── The list: phones, and any window too small for the room ────
          (`data-home` names the two layouts for DevTools and for tests.
          No script reads it, and one style does: in forced colours a
          key in the room draws its focus band inside itself, see the
          kit's forced-colours block in app/globals.css.) */}
      <div
        data-home="list"
        className={`scanlines relative room:hidden ${powerOn ? "crt-on" : ""}`}
        style={{ transformOrigin: "50% 30vh" }}
        onAnimationEnd={powerOnPlayed}
      >
        {flickerOf > 0 && (
          <div
            key={flickerOf}
            aria-hidden
            onAnimationEnd={() => setFlickerOf(0)}
            className="screen-flicker pointer-events-none fixed inset-0 z-20"
          />
        )}
        <HomeList
          powerOn={powerOn && layout === "list"}
          jolt={explodeTrigger}
          notice={retiredNotice}
        >
          <div className="mt-9 flex items-end justify-between gap-3">
            <HomeKeys />
            <ExplodeButton onClick={press} />
          </div>
        </HomeList>
      </div>

      {/* ── The room: a window at least 48rem wide and 35rem tall ────── */}
      <div
        ref={roomRef}
        data-home="room"
        className={`scanlines relative h-dvh w-full overflow-hidden list:hidden ${
          powerOn ? "crt-on" : ""
        }`}
        onAnimationEnd={powerOnPlayed}
      >
        {/* Top-right: search, about, and the one forbidden button. First
            in the room's markup so that Tab reaches them where the eye
            does: after the corner mascot (top left), before the swarm and
            the arcade row below. They are placed absolutely, so where
            they stand in the markup moves nothing on screen. They go
            quiet while the parkour owns the room: dimmed, and in a room
            narrower than 64rem (1024px at the usual text size, and the
            hint grows with the text) gone altogether, because there the
            controls hint needs their place. The hint's 308px are centred
            along the top and the keys reach 346px in from the right edge,
            so the two meet at 1000px, and below that the hint's last
            words ran across the dimmed Search key. (The keys make way
            and the hint stays put, in the middle of the top edge at
            every size: that is the strip ToolMap keeps its orbs out
            of while a run is on.) */}
        <div
          className={`pointer-events-none absolute right-6 top-6 z-10 flex items-start gap-3 ${
            parkour ? "opacity-30 max-[64rem]:opacity-0" : ""
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
        {flickerOf > 0 && (
          <div
            key={flickerOf}
            aria-hidden
            onAnimationEnd={() => setFlickerOf(0)}
            className="screen-flicker pointer-events-none absolute inset-0 z-20"
          />
        )}

        {/* Attract-mode hint — the arcade's standing invitation, blinking
            right under the marquee (the PRESS START idiom). Hovering a
            tool or a cabinet swaps it for that thing's tagline; while
            the parkour owns the room, the controls sit along the top.
            The arrows there are pixel icons (a Unicode arrow is drawn by
            whatever fallback font the system has), each named for a
            screen reader by the key it stands for. `data-parkour-hint`
            marks the line for the swarm, which keeps its orbs off it
            (ToolMap looks for the mark). */}
        {parkour ? (
          <p
            data-parkour-hint
            className="pointer-events-none absolute inset-x-0 top-6 z-10 text-center font-pixel text-[10px] uppercase tracking-[0.3em] text-ink-muted"
          >
            <PixelIcon name="back" size={12} label="left arrow" className={HINT_ARROW} />{" "}
            <PixelIcon name="forward" size={12} label="right arrow" className={HINT_ARROW} />{" "}
            move ·{" "}
            <PixelIcon name="up" size={12} label="up arrow" className={HINT_ARROW} />{" "}
            jump · esc gives up
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
      <Keycap href="/about" prefetch={false} size="sm" className="min-h-11">
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
 *
 * The whole housing is the button (the coral cap alone is 40px, under
 * what a finger needs), so the keyboard-focus ring is drawn on the
 * plate: the kit's focus rule covers a plate that is pressed. The
 * warning is the kit's micro-label, 10px like every other small label
 * on the page. It used to be 8px, and the plate's padding is what makes
 * room for the difference: the key is the size it was (108 by 78), so
 * the three keys take the same corner of the room as before, which is
 * the corner the swarm (ToolMap) keeps clear for them.
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
      className="plate-chunk flex flex-col items-center gap-1.5 bg-cream-deep px-1.5 pb-1.5 pt-2.5"
      style={{
        transform: pulsing ? "scale(1.12)" : undefined,
        transition: pulsing
          ? "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "transform 220ms ease",
      }}
    >
      <span
        aria-hidden
        className="btn-chunk flex h-10 w-10 items-center justify-center bg-tomato text-cream"
      >
        <PixelIcon name="burst" size={24} />
      </span>
      <span aria-hidden className="label-pixel">
        do not press
      </span>
    </button>
  );
}
