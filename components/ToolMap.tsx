"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool } from "@/lib/tools";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { COLOR_HEX, CREAM_HEX, INK_HEX, preferredTextHex } from "@/lib/colors";
import { drawArcadeCabinet, pixelDisc, withAlpha } from "@/lib/hugo/sprite";
import { screenFor, STILL_T } from "@/lib/hugo/cabinet-screens";
import { cabinetRow, swarmCenterY, type CabinetRow } from "@/lib/home-layout";
import { iconForSlug, iconRuns } from "@/lib/pixel-icons";
import { getWordmarkRect } from "@/lib/wordmark-bridge";
import { clamp } from "@/lib/math";

/**
 * The homepage room: a swarm of tools above a row of arcade cabinets.
 *
 * Two kinds of thing live here, and they behave differently on purpose:
 *
 *   TOOLS are orbs. They float: a gentle pull toward the middle of the
 *   free band, a mutual repel so labels do not overlap, a slow wander,
 *   drag-to-fling, click-to-open. Each shows its name underneath.
 *
 *   GAMES are furniture. They stand in a row along the floor at about
 *   twice the size, stay put, and each screen plays a small scene from
 *   its own game (lib/hugo/cabinet-screens.ts). Where they stand comes
 *   from lib/home-layout.ts, which the title and the hints read too.
 *
 * The swarm is kept fully on screen — labels included — and out of the
 * cabinet row, the title, the corner mascot and the top-right keys.
 * Two layers do that. The soft zones push, as they always did, and give
 * the swarm its shape. Under them are the Keeps (see `Keep`, `guard`):
 * an orb that is at rest never lies on the title, the hint, the mascot,
 * a key or the parkour's controls, whatever its neighbours are doing.
 *
 * Every tool and game is a real link (an SVG <a href>): a screen reader
 * lists them, and another button or a modified click is the browser's.
 * A plain click still sends Hugo to fetch the tool.
 *
 * Under reduced motion the swarm holds still. It is shown where the
 * same physics would bring it to rest (`settle`), nothing drifts or
 * bursts, an orb moves only while it is being dragged, and the frame
 * loop stops while nothing is changing.
 */

type Node = {
  tool: Tool;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  phase: number;
  /** Wander heading for the attract-mode drift (lazily seeded). */
  heading?: number;
  entranceStart: number;
  hasSparkled: boolean;
  dragVx: number;
  dragVy: number;
  dragLastT: number;
  dragLastX: number;
  dragLastY: number;
  /** A game: it stands in the arcade row instead of floating. Its
   *  position is set from the row layout every frame, physics never
   *  touches it, and it cannot be dragged. */
  cabinet?: boolean;
  /** Half the width of the name label under the node — the swarm is
   *  clamped by this, not by the orb, so no label leaves the screen. */
  labelHalf: number;
  /** performance.now() of the last explode — the cabinet hops. (Under
   *  reduced motion the orbs hop too: nothing flies.) */
  hopAt?: number;
  /** Clear of every keep-out box when last looked at. The guard stops a
   *  kept orb at the edge of a box; one that is not kept is inside a box
   *  and is being walked out of it. */
  kept: boolean;
  /** Steps of free flight left. The entrance burst, a fling and the
   *  forbidden button go through the boxes, as they always did. */
  thrown: number;
  /** Time spent being walked out of a box, in sixtieths of a second
   *  (the walk starts slowly). */
  escort: number;
  /** The way out it has taken, so it does not dither between two. */
  exit: { keep: string; side: Side } | null;
  /** Sent across the title to the emptier side: the face it is heading
   *  for. See `rebalance`. */
  route: "top" | "bottom" | null;
};

type Side = "left" | "right" | "top" | "bottom";

type Drag = {
  slug: string;
  /** A press on a cabinet: it can become a click, never a drag. */
  fixed: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  /** Where the node should be — set by pointermove, chased by the raf loop. */
  targetX: number;
  targetY: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  /** click confetti uses gravity; entrance sparkles don't. */
  kind: "click" | "sparkle";
};

type Ripple = {
  x: number;
  y: number;
  /** ms (performance.now) */
  start: number;
  /** Stagger relative to start. */
  delay: number;
  color: string;
  /** Set for a cabinet: the ring is a stepped frame of this size, not
   *  a stepped disc. */
  box?: { w: number; h: number };
};

const NODE_R = 26;
const LABEL_OFFSET = NODE_R + 18; // distance from node centre to label baseline
// Physics — like dropping things into water.
//
// Heavy drag, slow throws, very weak push between dots, very gentle
// gravity. Movement feels viscous: a fling slides a short distance
// and decelerates, dots can rest right next to each other, gravity
// takes 5-10 seconds to drift a dragged dot back to centre.
// The wall bounce is softened so a thrown dot kisses the wall
// instead of springing off.
/**
 * Pull toward the centre of the free band, per frame per px of distance.
 * The repel is DERIVED from it (see `repelFor`), so the swarm fills the
 * same share of the room at any size instead of puddling in the middle
 * of a phone or lining the walls of a 1080p monitor.
 */
const CENTER_PULL = 0.0003;
/** How far the swarm should spread from the centre, as a share of the
 *  room's width and of the free band's height. */
const FILL_X = 0.34;
const FILL_Y = 0.38;
/** Repel force is capped below this distance so two orbs dropped on
 *  each other part firmly instead of being fired across the room. */
const REPEL_MIN_DIST = 20;

/**
 * The repel strength that makes N orbs settle on a ring of radius R.
 * For N equal bodies on a ring, each one's pull c·R balances the radial
 * part of the others' k/d² pushes: R³ = k·S/(4c), S = Σ 1/sin(πj/N).
 */
function repelFor(count: number, radius: number): number {
  if (count < 2) return 0;
  let sum = 0;
  for (let j = 1; j < count; j++) sum += 1 / Math.sin((Math.PI * j) / count);
  return (4 * CENTER_PULL * radius * radius * radius) / sum;
}

/** The corner mascot's box (top-left) — orbs keep out of it. */
const HUGO_ZONE: Zone = {
  x: 0,
  y: 0,
  w: 92,
  h: 92,
  open: { right: true, bottom: true },
};
/** The mascot himself, breathing included: what must never be covered. */
const HUGO_KEEP: Keep = { id: "mascot", x: 0, y: 0, w: 68, h: 66 };
/** The top-right keys (search, about, the forbidden button). Their box
 *  is measured from the page (`measureKeys`); these are the sizes used
 *  until the first measurement. */
const KEYS_ZONE_W = 348;
const KEYS_KEEP_H = 102;
/** How far the keys' soft zone reaches below the keys themselves. */
const KEYS_ZONE_SKIRT = 14;
/** The parkour's controls hint: a line of words HomeShell shows while a
 *  run is on. Where it is is measured from the page (`measureHint`).
 *  Until the first measurement, and if there is nothing to measure, it
 *  is taken to be where HomeShell has drawn it so far: a 15px line 24px
 *  down, as wide as the room, the words centred in it. */
const PARKOUR_HINT_TOP = 24;
const PARKOUR_HINT_LINE = 15;
/** The most the words take of the line they are set in: about 308px as
 *  drawn today, and air on both sides. */
const PARKOUR_HINT_W = 360;
/** How far above and below the line the swarm keeps away. */
const PARKOUR_HINT_SKIRT = 3;
/** Frames, from the start of a run, for which the line is looked for on
 *  every frame (it is drawn a moment after the run starts). */
const PARKOUR_HINT_LOOKS = 120;

/** A box the swarm keeps out of. `open` names the sides an orb can be
 *  pushed out through — a box in a corner of the room only has two. */
type Zone = {
  x: number;
  y: number;
  w: number;
  h: number;
  open?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
};

/**
 * Something an orb must never cover, as a box in room coordinates: the
 * title with the hint under it, the mascot, the keys, the parkour's
 * controls hint.
 *
 * A Zone is a suggestion: a spring that pushes, which a crowd can push
 * back against, and which used to leave an orb parked on the title. A
 * Keep is the rule underneath it. An orb that is in one is walked out by
 * the nearest side it can really leave by, and an orb that is out cannot
 * drift back in. Only free flight goes through (see `Node.thrown`).
 */
type Keep = { id: string; x: number; y: number; w: number; h: number };

/** The least distance between an orb (its body or its name) and a Keep. */
const KEEP_GAP = 8;
/** How far below its centre an orb reaches, name label included. */
const LABEL_REACH = LABEL_OFFSET + 4;
/** The hint line under the title: HomeShell hangs a 16px line 22px below
 *  the letters. The title's Keep reaches down to the bottom of it. */
const HINT_REACH = 38;
/** Speed at which an orb is walked out of a Keep: px a step when the
 *  frames come on time, which is 120px a second. */
const ESCORT_V = 2;
/** The swarm itself takes one step a frame, whatever the frame rate, as
 *  it always has: its drift, a fling and the burst run slower on a
 *  machine that draws fewer frames. The walk out of a Keep is the one
 *  thing that keeps time instead: a frame that comes late walks as far
 *  as the frames it stands for would have (up to MAX_PACE of them), so
 *  the title is clear as soon on a busy machine as on an idle one. Left
 *  to the frame count it was not: at ten frames a second an orb was
 *  still on the title 11 to 16 seconds after the page had loaded. */
const FRAME_MS = 1000 / 60;
const MAX_PACE = 8;
/** Steps of free flight at the entrance, so the burst plays as before. */
const ENTRANCE_FREE = 40;
/** Steps of free flight after the forbidden button. */
const EXPLODE_FREE = 60;
/** A release faster than this (px a step) is a fling, and flies free
 *  until its own momentum is spent. */
const FLING_SPEED = 3;
/** Elbow room between two settled orbs: the gap kept between their
 *  boxes, the spring that keeps it, and the most that spring may push. */
const ELBOW_ROOM = 4;
const ELBOW_K = 0.03;
const ELBOW_MAX = 0.4;
/** One orb's seat, for counting how many a part of the room can hold. */
const SEAT_W = 104;
const SEAT_H = 92;
/** Reduced motion: the most steps spent finding where the swarm rests. */
const SETTLE_STEPS = 12000;

/** Where the swarm may be, and where its centre is. */
type Bounds = {
  width: number;
  /** The y the swarm must stay above: the top of the arcade row's band. */
  bottom: number;
  cx: number;
  cy: number;
};

/** Everything the swarm steers by in one frame. */
type Room = {
  bounds: Bounds;
  /** The title's soft box and its pad (see `wordmarkPad`). */
  avoid: Zone | null;
  pad: number;
  narrow: boolean;
  zones: Zone[];
  keeps: Keep[];
  /** The title's Keep, when the title is on screen and the room is wide
   *  enough to go round it. */
  title: Keep | null;
};

/** Standing orders that outlive a frame. */
type Swarm = {
  /** Count the orbs above and below the title once they have all come to
   *  a legal place, and send the extras across. Set when the swarm is
   *  made, when the room changes size and when the title moves; never
   *  by the passing of time, so nothing crosses the title unprompted. */
  rebalance: boolean;
};

const DAMPING = 0.92;
/** Velocity retained after bouncing off a wall. 0.45 = 45% kept —
 *  enough to register as a bounce, soft enough not to feel rubbery. */
const BOUNCE_DAMPING = 0.45;
const WOBBLE_FORCE = 0.012;
/** Attract-mode drift: constant gentle wander so the orbs never sit
 *  still — the lab prototype's motion (slow patrol, soft turns). */
const DRIFT_SPEED = 0.35;
const DRIFT_TURN = 0.1;
const WOBBLE_RATE = 0.0005;
const ENTRANCE_DURATION = 480;
const ENTRANCE_STAGGER = 40;
const CLICK_BOUNCE_MS = 240;
const RIPPLE_DURATION = 700;
const RIPPLE_COUNT = 3;
const RIPPLE_STAGGER_MS = 110;
const PARTICLE_LIFE_DECAY = 0.022;
const PARTICLE_GRAVITY = 0.06;
const PARTICLE_FRICTION = 0.93;
const SPARKLE_LIFE_DECAY = 0.045;
const SPARKLE_FRICTION = 0.9;
/** How aggressively the dragged node chases the cursor each frame. */
const DRAG_LERP = 0.5;
/** Hard cap on per-frame velocity. Lowered for the water feel — a
 *  fling slides a short distance instead of whipping across the
 *  canvas. */
const MAX_V = 18;
/** Velocity cap during an explosion burst — lets the initial fling
 *  read as snappy before damping pulls it back under MAX_V. */
const EXPLODE_MAX_V = 80;
/** How long the cap is raised after an explode (ms). Damping does the
 *  rest of the work once we drop back to MAX_V. */
const EXPLODE_WINDOW_MS = 380;
/** Outward velocity range applied to every dot on explode. */
const EXPLODE_SPEED_MIN = 48;
const EXPLODE_SPEED_MAX = 78;
const MIN_W = 320;
const MIN_H = 480;
/** Clearance kept between orb centres and the marquee's rect so the
 *  wordmark stays legible — node radius + label breathing room. That's
 *  the desktop value: on narrow canvases the marquee spans nearly the
 *  whole room, so the pad shrinks toward WORDMARK_PAD_MIN and the
 *  avoidance turns porous — orbs may drift behind the title (the
 *  wordmark canvas paints above the map, so they slide under it). */
const WORDMARK_PAD = NODE_R + 26;
/** How far a name label reaches below its orb's edge. */
const LABEL_HANG = 30;
/** The strip under the title where the attract hint blinks. */
const HINT_BAND = 30;
const WORDMARK_PAD_MIN = 8;
/** Below this canvas width the avoidance goes porous: shrunken pad,
 *  halved push, no drift-heading deflection. */
const WORDMARK_NARROW_W = 768;
function wordmarkPad(width: number): number {
  if (width >= WORDMARK_NARROW_W) return WORDMARK_PAD;
  const t = Math.max(0, (width - MIN_W) / (WORDMARK_NARROW_W - MIN_W));
  return WORDMARK_PAD_MIN + (WORDMARK_PAD - WORDMARK_PAD_MIN) * t;
}

/** Estimated half-width of a name label (10px Silkscreen, tracked):
 *  about 8.2px a character. An estimate on purpose — measuring text
 *  waits on a web font, and a few px either way only moves a clamp. */
function labelHalfWidth(title: string): number {
  return Math.max(NODE_R, (title.length * 8.2 + 6) / 2);
}

/** Icon bitmaps as runs, computed once per slug. */
const ICON_RUNS = new Map<string, { y: number; x: number; w: number }[]>();
function runsFor(slug: string) {
  let runs = ICON_RUNS.get(slug);
  if (!runs) {
    runs = iconRuns(iconForSlug(slug, false));
    ICON_RUNS.set(slug, runs);
  }
  return runs;
}

const GAME_COUNT = tools.filter((t) => isGameSlug(t.slug)).length;

/** The eight nav-dot colours in the same order BrandDot stores them
 *  in. Reading the persisted index from localStorage and looking up
 *  here gives ToolMap the user's chosen colour to pass into the
 *  Hugo-fetches-the-tool event payload. Module-scope so it allocates
 *  once and pairs neatly with COLOR_HEX from lib/colors.ts. */
const NAV_DOT_HEXES: readonly string[] = [
  COLOR_HEX.tomato,
  COLOR_HEX.blue,
  COLOR_HEX.yellow,
  COLOR_HEX.pink,
  COLOR_HEX.green,
  COLOR_HEX.purple,
  COLOR_HEX.orange,
  COLOR_HEX.teal,
];

function readNavDotColor(): string {
  if (typeof window === "undefined") return NAV_DOT_HEXES[0];
  try {
    const raw = window.localStorage.getItem("hugoslekstuga:dot-color");
    if (raw === null) return NAV_DOT_HEXES[0];
    const idx = JSON.parse(raw) as number;
    if (
      typeof idx === "number" &&
      Number.isFinite(idx) &&
      idx >= 0 &&
      idx < NAV_DOT_HEXES.length
    ) {
      return NAV_DOT_HEXES[idx];
    }
  } catch {
    // localStorage disabled, malformed JSON, etc — fall through to default
  }
  return NAV_DOT_HEXES[0];
}

type ToolMapProps = {
  /**
   * Increment to trigger an explosion from the parent. The page
   * renders its own explode button positioned alongside the Surprise
   * ball; it pokes this counter and every dot is flung outward from
   * the centre, confetti scatters, gravity pulls everything home.
   */
  explodeTrigger?: number;
};

export default function ToolMap({
  explodeTrigger = 0,
}: ToolMapProps = {}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  // `now` is the wall-clock fed to the JSX (ripple progress, entrance
  // scale). The rAF loop pushes a fresh performance.now() into this
  // state each frame — keeps render impure-free for the react-hooks
  // purity rule and doubles as the per-frame re-render trigger so we
  // no longer need a separate `tick` counter.
  const [now, setNow] = useState<number>(() =>
    typeof performance !== "undefined" ? performance.now() : 0,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [bouncingSlug, setBouncingSlug] = useState<string | null>(null);
  /** True once the nodes exist. Under reduced motion they are made late:
   *  only when they can be shown where they will stay. */
  const [ready, setReady] = useState(false);
  const nodesRef = useRef<Node[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const dragRef = useRef<Drag | null>(null);
  /** Cursor position over the SVG (null when outside or while dragging). */
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const initializedRef = useRef(false);
  const reduceMotionRef = useRef(false);
  /** performance.now() of the last explode trigger. Raises the
   *  velocity cap for EXPLODE_WINDOW_MS so the initial fling reads
   *  as a real burst before damping pulls everything back together. */
  const explodeAtRef = useRef(0);

  const nodeBySlug = useRef<Map<string, Node>>(new Map());
  /** Mirror of `hovered` state into a ref so the rAF loop can read it
   *  without becoming a function of state-changing closures. */
  const hoveredRef = useRef<string | null>(null);
  /** Same mirroring for the click-bounce, read by the trail painter. */
  const bouncingRef = useRef<string | null>(null);
  /** True while Hugo's parkour is running — orbs become platforms:
   *  clicks don't navigate and the idle play-fetch stays quiet. */
  const parkourRef = useRef(false);
  /** The phosphor screen — a canvas under the SVG. The orbs' visible
   *  bodies (glow + pixel-stepped core) are painted here every frame
   *  over a translucent dark wash instead of a clear, so motion smears
   *  into decaying trails: the attract-mode look from the lab
   *  prototype. The SVG above keeps hit-targets, emoji, labels, rings
   *  and all interaction — zero behaviour moved. */
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** This frame's arcade row (the loop refreshes it from the room size). */
  const rowRef = useRef<CabinetRow>(cabinetRow(800, 600, GAME_COUNT));
  /** Tracks whether the last frame had a tool active (hovered or
   *  dragged) so we know when to dispatch the null event signalling
   *  end-of-hover to BrandDot. */
  const wasToolActiveRef = useRef(false);
  /** The swarm's standing orders (see `Swarm`). */
  const swarmRef = useRef<Swarm>({ rebalance: false });
  /** Where Search, About and the forbidden button are, as last measured. */
  const keysRef = useRef<Keep | null>(null);
  /** Where the parkour's controls hint is, as last measured in this run
   *  (null: not measured yet, or no run is on). */
  const hintRef = useRef<Keep | null>(null);
  /** The last press the pointer handlers dealt with. The click event that
   *  follows a press is already spoken for; a click with no press behind
   *  it came from the keyboard or from assistive technology. */
  const pressRef = useRef<{ slug: string; at: number } | null>(null);
  /** Reduced motion: the room size the swarm was put to rest in. */
  const restRef = useRef<{ w: number; h: number } | null>(null);
  /** Starts the frame loop again after it has stopped. It only stops
   *  under reduced motion, while nothing is changing. */
  const wakeRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      // Layout size, not getBoundingClientRect — the homepage's CRT
      // power-on scales an ancestor (scaleY 0.02) right as the initial
      // ResizeObserver callback lands, and gBCR includes transforms.
      // offsetWidth/Height are transform-immune.
      const el = containerRef.current!;
      const w = Math.max(MIN_W, el.offsetWidth);
      const h = Math.max(MIN_H, el.offsetHeight);
      setSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Keep the trail canvas matched to the layout size. A resize resets
  // the persistence buffer (full clear) — same as the lab prototype.
  // DPR capped at 2: this canvas repaints full-viewport every frame.
  useLayoutEffect(() => {
    const canvas = trailCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
    }
  }, [size]);

  useEffect(() => {
    bouncingRef.current = bouncingSlug;
    wakeRef.current();
  }, [bouncingSlug]);

  useEffect(() => {
    // The controls hint belongs to one run: it is measured afresh in each.
    const onStart = () => {
      parkourRef.current = true;
      hintRef.current = null;
      wakeRef.current();
    };
    const onEnd = () => {
      parkourRef.current = false;
      hintRef.current = null;
      wakeRef.current();
    };
    // The title has moved (or has just been drawn): a still swarm has to
    // look again.
    const onMark = () => wakeRef.current();
    window.addEventListener("hugoslekstuga:parkour-start", onStart);
    window.addEventListener("hugoslekstuga:parkour-end", onEnd);
    window.addEventListener("hugoslekstuga:wordmark-layout", onMark);
    return () => {
      window.removeEventListener("hugoslekstuga:parkour-start", onStart);
      window.removeEventListener("hugoslekstuga:parkour-end", onEnd);
      window.removeEventListener("hugoslekstuga:wordmark-layout", onMark);
    };
  }, []);

  // Declared above its first caller so the react-hooks compiler-aware
  // lint rule (variable-accessed-before-declared) is happy.
  function initNodes(w: number, h: number) {
    // The `size` state lags the actual container during the initial
    // `useLayoutEffect → setState → re-render` cycle. If we trust
    // `size` here, dots spawn at the wrong centre: on the wrong side of
    // the title, which they can no longer cross. Read the container
    // directly so the spawn position is always the real centre,
    // regardless of size-state timing. Layout size, as everywhere on
    // this page: getBoundingClientRect is squashed by the CRT power-on.
    const el = containerRef.current;
    const actualW = el && el.offsetWidth > MIN_W ? el.offsetWidth : w;
    const actualH = el && el.offsetHeight > MIN_H ? el.offsetHeight : h;
    const row = cabinetRow(actualW, actualH, GAME_COUNT);
    const t0 = performance.now();
    const still = prefersReducedMotion();
    const nodes = spawn(actualW, actualH, row, t0, still);
    swarmRef.current.rebalance = true;
    if (still) {
      // Reduced motion: no burst and no glide. The same physics is run
      // ahead, out of sight, and the swarm is shown where it ends up.
      if (el) keysRef.current = measureKeys(el, actualW, actualH);
      settle(
        nodes,
        roomFor(
          actualW,
          actualH,
          row,
          getWordmarkRect(),
          keysRef.current,
          parkourRef.current ? (hintRef.current ?? usualHint(actualW)) : null,
        ),
        swarmRef.current,
      );
      restRef.current = { w: actualW, h: actualH };
    }
    nodesRef.current = nodes;
    nodeBySlug.current = new Map(nodes.map((n) => [n.tool.slug, n]));
    particlesRef.current = [];
    ripplesRef.current = [];
    initializedRef.current = true;
    setNow(t0);
    setReady(true);
  }

  useEffect(() => {
    if (initializedRef.current) return;
    if (size.w <= MIN_W && size.h <= MIN_H) return;
    if (!prefersReducedMotion()) {
      initNodes(size.w, size.h);
      return;
    }
    // Reduced motion: nothing is shown until it can be shown where it
    // will stay, and that depends on where the title is. The title is
    // drawn a moment after the page (it waits for its font), so wait
    // for it to be there and to have stopped moving. Not for ever: a
    // title that never comes must not cost the visitor the tools.
    let raf = 0;
    let seen = "";
    let steady = 0;
    const giveUp = performance.now() + 6000;
    const look = () => {
      const m = getWordmarkRect();
      const key = m ? `${m.x},${m.y},${m.w},${m.h}` : "";
      steady = key !== "" && key === seen ? steady + 1 : 0;
      seen = key;
      if (steady >= 2 || performance.now() > giveUp) {
        initNodes(size.w, size.h);
        return;
      }
      raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  // Mirror the React `hovered` state into a ref so the rAF loop reads
  // the latest value without becoming a function of changing closures.
  useEffect(() => {
    hoveredRef.current = hovered;
    wakeRef.current();
  }, [hovered]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const listener = (e: MediaQueryListEvent) => {
      reduceMotionRef.current = e.matches;
      // Switched on mid-visit: the swarm is put to rest on the next frame.
      restRef.current = null;
      wakeRef.current();
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  // Idle "play fetch on his own" — after IDLE_MS without input, Hugo
  // leaves the nav, flies out to a random swarm dot, taps it (the dot
  // bounces in the swarm physics via the nudge event), flies home. No
  // navigation, no route push. Just ambient life. Gated off mobile
  // (no cursor signal) and reduced motion. Cooldown after each fetch
  // so he doesn't pester a returning visitor.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover)").matches) return;

    const IDLE_MS = 60_000;
    const COOLDOWN_MS = 30_000;
    const POLL_MS = 5_000;

    let lastActivity = performance.now();
    let cooldownUntil = 0;
    let traveling = false;
    let pollTid: number | null = null;

    const onActivity = () => {
      lastActivity = performance.now();
    };

    const onTraveling = (e: Event) => {
      const detail = (e as CustomEvent<{ traveling: boolean }>).detail;
      if (!detail) return;
      traveling = detail.traveling;
      if (!traveling) {
        cooldownUntil = performance.now() + COOLDOWN_MS;
        lastActivity = performance.now();
      }
    };

    const fire = () => {
      // Pick a random non-pinned tool. Skip pinned (currently dragged).
      const candidates = nodesRef.current.filter((n) => !n.pinned && !n.cabinet);
      if (candidates.length === 0) return;
      const node =
        candidates[Math.floor(Math.random() * candidates.length)];
      const rect = containerRef.current?.getBoundingClientRect();
      const navDot =
        document.querySelector<HTMLElement>("[data-brand-dot]");
      if (!rect || !navDot) return;
      const navRect = navDot.getBoundingClientRect();
      const isMobile = window.innerWidth < 640;
      const duration = isMobile ? 560 : 720;
      try {
        window.dispatchEvent(
          new CustomEvent("hugoslekstuga:dot-travel", {
            detail: {
              fromX: rect.left + node.x,
              fromY: rect.top + node.y,
              toX: navRect.left + navRect.width / 2,
              toY: navRect.top + navRect.height / 2,
              color: COLOR_HEX[node.tool.color],
              navColor: readNavDotColor(),
              duration,
              // New: "nudge" mode tells TravelingDot to skip the
              // looking-down scoop pose and the route-push side effect.
              // The contact moment dispatches dot-nudge-target back
              // into ToolMap, which applies the impulse.
              mode: "nudge",
              slug: node.tool.slug,
            },
          }),
        );
      } catch {
        // dispatch can fail in legacy browsers — fail silent
      }
    };

    const poll = () => {
      const nowT = performance.now();
      if (
        !document.hidden &&
        !traveling &&
        !parkourRef.current &&
        nowT > cooldownUntil &&
        nowT - lastActivity > IDLE_MS
      ) {
        fire();
      }
      pollTid = window.setTimeout(poll, POLL_MS);
    };
    pollTid = window.setTimeout(poll, POLL_MS);

    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("click", onActivity);
    window.addEventListener("hugoslekstuga:hugo-traveling", onTraveling);

    return () => {
      if (pollTid) window.clearTimeout(pollTid);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener(
        "hugoslekstuga:hugo-traveling",
        onTraveling,
      );
    };
  }, []);

  // Receive the nudge-target dispatched by TravelingDot at the contact
  // moment of an idle fetch. Adds a small impulse to the named node so
  // it visibly bobs in the swarm physics — the tap reads as "Hugo
  // poked this one."
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onNudge = (e: Event) => {
      const detail = (
        e as CustomEvent<{ slug: string; vx: number; vy: number }>
      ).detail;
      if (!detail) return;
      const node = nodeBySlug.current.get(detail.slug);
      if (!node) return;
      if (node.cabinet) {
        node.hopAt = performance.now();
        wakeRef.current();
        return;
      }
      // Reduced motion: the swarm holds still, so there is nothing to bob.
      if (reduceMotionRef.current) return;
      node.vx += detail.vx;
      node.vy += detail.vy;
    };
    window.addEventListener("hugoslekstuga:dot-nudge-target", onNudge);
    return () =>
      window.removeEventListener(
        "hugoslekstuga:dot-nudge-target",
        onNudge,
      );
  }, []);

  // Simulation loop.
  useEffect(() => {
    if (!initializedRef.current) return;
    const container = containerRef.current;
    let raf = 0;
    /** performance.now() of the last frame (0: there was none). */
    let last = 0;
    let frame = 0;
    /** Frames of the parkour run that is on (0: none is). */
    let run = 0;
    /** The title's rect on the last frame, to notice when it moves. */
    let lastMark = "";

    // The phosphor pass. Runs right after physics: wash the screen
    // with a translucent dark rect (the decay — old light fades
    // instead of vanishing), then paint every orb's glow and
    // pixel-stepped core at its fresh position. Movement therefore
    // smears. Under reduced motion the wash becomes a full clear:
    // same orbs, no trails, nothing animates that shouldn't.
    const paintTrails = (nowTs: number) => {
      const canvas = trailCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      if (reduceMotionRef.current) {
        ctx.clearRect(0, 0, size.w, size.h);
      } else {
        ctx.fillStyle = "rgba(7, 8, 15, 0.5)";
        ctx.fillRect(0, 0, size.w, size.h);
      }
      const hov = hoveredRef.current || dragRef.current?.slug || null;
      const row = rowRef.current;
      const screenT = reduceMotionRef.current ? STILL_T : nowTs / 1000;
      for (const n of nodesRef.current) {
        const entrance = getEntrance(n, nowTs);
        if (entrance <= 0.02) continue;
        const isHov = hov === n.tool.slug;
        const color = COLOR_HEX[n.tool.color];
        ctx.globalAlpha = hov !== null && !isHov ? 0.55 : 1;
        // The forbidden button makes a cabinet hop (and, under reduced
        // motion, an orb too).
        const hop = hopOf(n, nowTs);
        if (n.cabinet) {
          // A machine, not an orb: it stands still, its screen plays its
          // own game, and the forbidden button makes it hop.
          const scale = entrance * (isHov ? 1.04 : 1);
          const cy = n.y - hop + (1 - entrance) * 24;
          const glowR = row.h * (isHov ? 1.05 : 0.86);
          const grad = ctx.createRadialGradient(n.x, cy, 4, n.x, cy, glowR);
          grad.addColorStop(0, withAlpha(color, isHov ? 0.3 : 0.2));
          grad.addColorStop(1, withAlpha(color, 0));
          ctx.fillStyle = grad;
          ctx.fillRect(n.x - glowR, cy - glowR, glowR * 2, glowR * 2);
          const painter = screenFor(n.tool.slug);
          drawArcadeCabinet(
            ctx,
            n.x,
            cy,
            row.unit * scale,
            color,
            (put) => painter(put, screenT),
            isHov,
          );
          continue;
        }
        const scale =
          entrance *
          (isHov ? 1.08 : 1) *
          (bouncingRef.current === n.tool.slug ? 1.3 : 1);
        const r = NODE_R * scale;
        const oy = n.y - hop;
        // Bloom — the hover feedback lives here now.
        const glowR = r * (isHov ? 2.2 : 1.8);
        const grad = ctx.createRadialGradient(n.x, oy, 1, n.x, oy, glowR);
        grad.addColorStop(0, withAlpha(color, isHov ? 0.38 : 0.3));
        grad.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(n.x - glowR, oy - glowR, glowR * 2, glowR * 2);
        pixelDisc(ctx, n.x, oy, r, color);
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      raf = 0;
      const reduce = reduceMotionRef.current;
      // How many sixtieths of a second this frame stands for: 1 when the
      // frames come on time (or faster), more when this one is late. Only
      // the walk out of a Keep goes by it (see FRAME_MS).
      const frameAt = performance.now();
      const pace =
        last > 0 ? clamp((frameAt - last) / FRAME_MS, 1, MAX_PACE) : 1;
      last = frameAt;

      // Smooth-drag: chase the pointer target at a fixed cadence so the
      // node moves at one pixel-rate regardless of how often pointermove
      // fires. This is what eliminates the jittery teleport-feel.
      const drag = dragRef.current;
      if (drag && !drag.fixed) {
        const dragNode = nodeBySlug.current.get(drag.slug);
        if (dragNode) {
          dragNode.x += (drag.targetX - dragNode.x) * DRAG_LERP;
          dragNode.y += (drag.targetY - dragNode.y) * DRAG_LERP;
        }
      }

      // The arcade row: where the cabinets stand this frame. Recomputed
      // from the room size so a resize re-seats them at once.
      const row = cabinetRow(size.w, size.h, GAME_COUNT);
      rowRef.current = row;
      let seat = 0;
      for (const n of nodesRef.current) {
        if (!n.cabinet) continue;
        const c = row.centers[seat++];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        n.labelHalf = row.w / 2;
      }

      // The keys are measured now and then, not assumed: a font that
      // arrives late or a longer caption changes their size. Not during
      // the parkour, whose win panel has keys of its own.
      if (container && !parkourRef.current && frame % 30 === 0) {
        keysRef.current = measureKeys(container, size.w, size.h);
      }
      frame++;
      // The parkour's controls hint is HomeShell's to place, so it is
      // measured as well: on every frame of a run until the line is there
      // (it is drawn a moment after the run starts), now and then after,
      // and on the first frame in a room that has changed size.
      run = parkourRef.current ? run + 1 : 0;
      if (
        container &&
        run > 0 &&
        (hintRef.current === null ? run <= PARKOUR_HINT_LOOKS : run % 30 === 1)
      ) {
        hintRef.current =
          measureHint(container, size.w, size.h) ?? hintRef.current;
      }

      // The marquee publishes its rect (viewport == canvas coords here).
      const mark = getWordmarkRect();
      const room = roomFor(
        size.w,
        size.h,
        row,
        mark,
        keysRef.current,
        run > 0 ? (hintRef.current ?? usualHint(size.w)) : null,
      );
      // A new room, or a title that has moved: count the two sides of
      // the title again once everything has found a legal place.
      const markKey = mark ? `${mark.x},${mark.y},${mark.w},${mark.h}` : "";
      if (markKey !== lastMark) {
        lastMark = markKey;
        swarmRef.current.rebalance = true;
      }

      if (reduce) {
        // Reduced motion: the swarm holds still. Nothing drifts, nothing
        // is stepped, and when nothing changes the loop stops (below).
        const floaters = nodesRef.current.filter((n) => !n.cabinet);
        const rest = restRef.current;
        if (!drag && (!rest || rest.w !== size.w || rest.h !== size.h)) {
          // A room of another size (or reduced motion switched on just
          // now): find the resting places for this one, and go there.
          for (const n of floaters) n.thrown = 0;
          swarmRef.current.rebalance = true;
          settle(nodesRef.current, room, swarmRef.current);
          restRef.current = { w: size.w, h: size.h };
        }
        for (const n of floaters) {
          if (n.pinned) continue;
          n.vx = 0;
          n.vy = 0;
          // Something else in the room has moved (the title, a key, the
          // parkour's hint), or the visitor has just let go of this orb:
          // if it is in the way, or on top of another, it steps to the
          // nearest free spot. Otherwise it stays exactly where it is.
          if (
            !clearAt(n, n.x, n.y, room) ||
            (!n.kept && crowdedAt(n, n.x, n.y, floaters, 0))
          ) {
            placeFree(n, floaters, room);
          }
          n.kept = true;
          n.thrown = 0;
          n.route = null;
        }
      } else {
        const inExplode =
          explodeAtRef.current > 0 &&
          performance.now() - explodeAtRef.current < EXPLODE_WINDOW_MS;
        const opts = {
          drift: true,
          wobble: WOBBLE_FORCE,
          vCap: inExplode ? EXPLODE_MAX_V : MAX_V,
          pace,
        };
        // One step a frame, whatever the frame rate: the swarm's clock is
        // the display's, as it always was.
        step(nodesRef.current, room, opts, swarmRef.current);
      }

      // Paint the phosphor screen from the freshly stepped positions.
      paintTrails(performance.now());

      // Particles.
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.kind === "click") {
          p.vx *= PARTICLE_FRICTION;
          p.vy *= PARTICLE_FRICTION;
          p.vy += PARTICLE_GRAVITY;
          p.life -= PARTICLE_LIFE_DECAY;
        } else {
          p.vx *= SPARKLE_FRICTION;
          p.vy *= SPARKLE_FRICTION;
          p.life -= SPARKLE_LIFE_DECAY;
        }
        if (p.life <= 0) ps.splice(i, 1);
      }

      // Cull old ripples.
      const now = performance.now();
      ripplesRef.current = ripplesRef.current.filter(
        (r) => now - r.start - r.delay < RIPPLE_DURATION,
      );

      // Sparkle on entrance landing — once per node, when entrance crosses 1.
      for (const n of nodesRef.current) {
        if (n.hasSparkled) continue;
        const e = getEntrance(n, now);
        if (e >= 1) {
          n.hasSparkled = true;
          emitSparkle(particlesRef.current, n.x, n.y);
        }
      }

      // Tell Hugo (BrandDot in the nav) which swarm tool the user is
      // currently engaging with so his eyes can open and track it.
      // The "active" tool is whichever the user is hovering, falling
      // back to whichever is being dragged. Position is dispatched in
      // viewport coords each frame so the gaze tracks the dot as
      // physics drifts it.
      const activeSlug =
        hoveredRef.current || dragRef.current?.slug || null;
      if (activeSlug && containerRef.current && typeof window !== "undefined") {
        const node = nodeBySlug.current.get(activeSlug);
        if (node) {
          const rect = containerRef.current.getBoundingClientRect();
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:tool-hover", {
              detail: {
                x: rect.left + node.x,
                y: rect.top + node.y,
                // Additive — BrandDot's gaze only reads x/y; HomeShell
                // whispers the tagline along the bottom edge.
                slug: node.tool.slug,
                tagline: node.tool.tagline,
              },
            }),
          );
          wasToolActiveRef.current = true;
        }
      } else if (wasToolActiveRef.current) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:tool-hover", { detail: null }),
          );
        }
        wasToolActiveRef.current = false;
      }

      setNow(performance.now());
      // Reduced motion: a frame is only drawn when something changed. The
      // loop runs on while a drag, a hop or a particle is in progress and
      // then stops; `wakeRef` starts it again.
      const busy =
        dragRef.current !== null ||
        ps.length > 0 ||
        ripplesRef.current.length > 0 ||
        // A run has begun and its controls hint is still to be found.
        (run > 0 && run <= PARKOUR_HINT_LOOKS && hintRef.current === null) ||
        nodesRef.current.some(
          (n) =>
            n.hopAt !== undefined && now - n.hopAt < EXPLODE_WINDOW_MS + 50,
        );
      if (!reduce || busy) raf = requestAnimationFrame(loop);
      else {
        // Stopped. The next frame, whenever it comes, starts afresh: it
        // is not late, and it takes a new look at where the keys are.
        last = 0;
        frame = 0;
      }
    };
    wakeRef.current = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      wakeRef.current = () => {};
    };
  }, [size, ready]);

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        cursorRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }

      // Continue handling drag move if a drag is active.
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      const node = nodeBySlug.current.get(drag.slug);
      if (!node || !rect) return;
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      if (
        Math.abs(localX - drag.startX) > 8 ||
        Math.abs(localY - drag.startY) > 8
      ) {
        drag.moved = true;
      }
      // A cabinet is furniture: the press can still turn into a click,
      // but it does not come along with the pointer.
      if (drag.fixed) return;
      const floor = size.h - rowRef.current.reserve - LABEL_OFFSET - 8;
      const newX = clamp(
        localX - drag.offsetX,
        node.labelHalf + 6,
        size.w - node.labelHalf - 6,
      );
      const newY = clamp(localY - drag.offsetY, NODE_R + 6, floor);

      // Track velocity in cursor-space (used for momentum on release).
      const now = performance.now();
      const dt = Math.max(8, now - node.dragLastT);
      node.dragVx = ((newX - node.dragLastX) / dt) * 16;
      node.dragVy = ((newY - node.dragLastY) / dt) * 16;
      node.dragLastT = now;
      node.dragLastX = newX;
      node.dragLastY = newY;

      drag.targetX = newX;
      drag.targetY = newY;
    },
    [size.w, size.h],
  );

  const onCanvasPointerLeave = useCallback(() => {
    cursorRef.current = null;
  }, []);

  const onSvgPointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, slug: string) => {
      // Every node is a link. Only a plain primary press plays with the
      // swarm (a drag, a fling, the fetch flight). Any other button, and
      // any press with a modifier held, belongs to the browser: a new
      // tab, a new window, the link's menu.
      if (!isPlainPress(e)) return;
      const node = nodeBySlug.current.get(slug);
      if (!node) return;
      // One hand at a time. A second finger, or a press whose release
      // never arrived, finds the swarm still holding an orb for another
      // pointer. That orb is put down where it is: no throw, no click.
      // Left held it would never move again (its own release is not this
      // drag's, and is ignored), and a held orb is the one thing the
      // Keeps do not walk off the title.
      const held = dragRef.current;
      const heldNode =
        held && !held.fixed ? nodeBySlug.current.get(held.slug) : undefined;
      if (heldNode) {
        heldNode.pinned = false;
        heldNode.kept = false;
        heldNode.thrown = 0;
      }
      const rect = containerRef.current!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {}
      // Pointer interaction must never leave a "chosen" focus ring on
      // the node — that's keyboard feedback (Tab draws it via CSS). The
      // link around the node is what holds the focus.
      (e.currentTarget.parentNode as SVGAElement | null)?.blur?.();
      wakeRef.current();
      dragRef.current = {
        slug,
        fixed: Boolean(node.cabinet),
        pointerId: e.pointerId,
        startX: localX,
        startY: localY,
        offsetX: localX - node.x,
        offsetY: localY - node.y,
        moved: false,
        targetX: node.x,
        targetY: node.y,
      };
      if (node.cabinet) return;
      node.pinned = true;
      node.vx = 0;
      node.vy = 0;
      node.dragVx = 0;
      node.dragVy = 0;
      node.dragLastT = performance.now();
      node.dragLastX = node.x;
      node.dragLastY = node.y;
    },
    [],
  );

  const triggerClickFx = useCallback((slug: string) => {
    const node = nodeBySlug.current.get(slug);
    if (!node) return;
    // Reduced motion: no rings and no confetti. The orb's jump in size
    // (the click bounce) is the feedback, and it does not move.
    if (reduceMotionRef.current) return;
    const color = COLOR_HEX[node.tool.color];
    const now = performance.now();

    // Multi-ring ripple, in the shape of the thing that was pressed.
    const box = node.cabinet
      ? { w: rowRef.current.w, h: rowRef.current.h }
      : undefined;
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      ripplesRef.current.push({
        x: node.x,
        y: node.y,
        start: now,
        delay: i * RIPPLE_STAGGER_MS,
        color,
        box,
      });
    }

    // Confetti.
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 3.5;
      particlesRef.current.push({
        x: node.x,
        y: node.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 1,
        color,
        size: 3 + Math.random() * 3,
        kind: "click",
      });
    }
  }, []);

  /**
   * Commit a click on a tool dot. Hugo (the brand dot) leaves his
   * nav post, flies down to the clicked tool, briefly looks at it,
   * carries it back. The route push fires at the *start of his
   * return flight* (~T+400ms from click) so the new tool page is
   * rendered behind him by the time he lands and the page's header
   * card can expand from his landing position.
   *
   * Used by both the pointer click and keyboard activation paths.
   */
  const commitNavigation = useCallback(
    (slug: string) => {
      // Mid-parkour the orbs are platforms, not links.
      if (parkourRef.current) return;
      const node = nodeBySlug.current.get(slug);
      if (!node) return;
      setBouncingSlug(slug);
      triggerClickFx(slug);
      const rect = containerRef.current?.getBoundingClientRect();
      const navDot = document.querySelector<HTMLElement>("[data-brand-dot]");
      const targetPath = pathFor(slug);
      if (rect && navDot && typeof window !== "undefined") {
        // Freeze the nav position at click time. The nav doesn't move
        // mid-flight, but reading once and reusing keeps the contract
        // clean — TravelingDot never has to touch the DOM again.
        const navRect = navDot.getBoundingClientRect();
        // Mobile gets a shorter total duration (560ms vs 720ms) because
        // the swarm-to-nav distance is much smaller on a 375px viewport
        // and the same absolute speed would feel hurried.
        const isMobile = window.innerWidth < 640;
        const duration = isMobile ? 560 : 720;
        try {
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:dot-travel", {
              detail: {
                // The tool position (where Hugo flies TO)
                fromX: rect.left + node.x,
                fromY: rect.top + node.y,
                // The nav-dot position (where Hugo starts FROM and RETURNS TO)
                toX: navRect.left + navRect.width / 2,
                toY: navRect.top + navRect.height / 2,
                // The tool's accent colour (Hugo tints toward this during scoop)
                color: COLOR_HEX[node.tool.color],
                // The user's chosen nav-dot colour (Hugo's "true" colour).
                // Read from the same key BrandDot writes — keeps Hugo
                // matching whatever colour the user picked.
                navColor: readNavDotColor(),
                duration,
              },
            }),
          );
        } catch {
          // Safari < 15 etc — fail silent; navigation continues
        }
        // Route push at start-of-return-flight: anticipation (80ms) +
        // outbound (260ms) + scoop (60ms) = 400ms. Or scale for mobile.
        const pushDelay = isMobile ? (duration * 400) / 720 : 400;
        window.setTimeout(() => {
          router.push(targetPath);
        }, pushDelay);
      } else {
        // No nav dot in DOM (shouldn't happen but defensive). Skip the
        // Hugo animation entirely and just navigate after the click
        // bounce, like the pre-redesign behaviour.
        window.setTimeout(() => {
          router.push(targetPath);
        }, CLICK_BOUNCE_MS);
      }
    },
    [router, triggerClickFx],
  );

  /** Let go of whatever the pointer holds: the orb keeps the momentum
   *  the hand gave it. Under reduced motion it has none, and stays where
   *  it was put. */
  const release = useCallback((pointerId: number): Drag | null => {
    const drag = dragRef.current;
    if (!drag) return null;
    if (pointerId !== drag.pointerId) return null;
    const node = nodeBySlug.current.get(drag.slug);
    if (node && !drag.fixed) {
      node.pinned = false;
      if (reduceMotionRef.current) {
        node.vx = 0;
        node.vy = 0;
        node.thrown = 0;
        if (drag.moved) {
          // No lag to catch up on: it is where the pointer left it. The
          // loop then looks at whether it can stay there.
          node.x = drag.targetX;
          node.y = drag.targetY;
          node.kept = false;
        }
      } else {
        node.vx = clamp(node.dragVx, -25, 25);
        node.vy = clamp(node.dragVy, -25, 25);
        // A real throw flies free, through whatever is in the way, for
        // as long as its own momentum lasts (the speed falls by DAMPING
        // a step). A gentle release does not: it is stopped at the
        // title like any drift.
        const speed = Math.hypot(node.vx, node.vy);
        node.thrown =
          speed > FLING_SPEED
            ? Math.min(EXPLODE_FREE, Math.ceil(Math.log(speed) / -Math.log(DAMPING)))
            : 0;
        node.kept = false;
      }
    }
    dragRef.current = null;
    wakeRef.current();
    return drag;
  }, []);

  const onSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {}
      const drag = release(e.pointerId);
      if (!drag) return;
      // The click event that follows this press is spoken for.
      pressRef.current = { slug: drag.slug, at: performance.now() };
      if (!drag.moved) {
        commitNavigation(drag.slug);
      }
    },
    [commitNavigation, release],
  );

  /** The press was taken away: on a long touch the browser opens the
   *  link's menu, and the system can interrupt. Let go, and open
   *  nothing (a cancel used to count as a click). */
  const onSvgPointerCancel = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      release(e.pointerId);
    },
    [release],
  );

  /** The link's own click. A press the pointer handlers dealt with has
   *  already flown (or was a drag, or a fling): the click is only kept
   *  from following the link. A click with no press behind it came from
   *  the keyboard (Enter) or from assistive technology: it runs the
   *  fetch flight too. A click with a modifier, or from another button,
   *  is left to the browser. */
  const onLinkClick = useCallback(
    (e: React.MouseEvent<Element>, slug: string) => {
      if (!isPlainPress(e)) return;
      e.preventDefault();
      const press = pressRef.current;
      pressRef.current = null;
      if (press && press.slug === slug && performance.now() - press.at < 700) {
        return;
      }
      commitNavigation(slug);
    },
    [commitNavigation],
  );

  const explode = useCallback(() => {
    if (reduceMotionRef.current) {
      // Reduced motion: nothing flies and nothing scatters. Everything
      // in the room hops once on its spot, the way the cabinets do.
      hopAll(nodesRef.current);
      wakeRef.current();
      return;
    }
    explodeAtRef.current = performance.now();
    detonate(
      nodesRef.current,
      particlesRef.current,
      size.w / 2,
      swarmCenterY(size.h, rowRef.current.reserve),
    );
  }, [size.w, size.h]);

  // External explode trigger.
  const lastExplodeRef = useRef(explodeTrigger);
  useEffect(() => {
    if (explodeTrigger !== lastExplodeRef.current && initializedRef.current) {
      lastExplodeRef.current = explodeTrigger;
      explode();
    }
  }, [explodeTrigger, explode]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
    >
      {/* The phosphor screen — orb bodies, glow, and their decay
          trails live here (painted by the rAF loop). Sits under the
          SVG so every hit-target, label and ripple stays interactive. */}
      <canvas
        ref={trailCanvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ width: size.w, height: size.h }}
      />
      {/* The nodes are links, and a browser lets a link be dragged off
          the page. Here a drag moves the orb, so that is switched off. */}
      <svg
        width={size.w}
        height={size.h}
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={onCanvasPointerLeave}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerCancel}
        onDragStart={(e) => e.preventDefault()}
        style={{ touchAction: "none", userSelect: "none", position: "relative" }}
      >
        {/* Click ripples: stepped, like everything else in the room.
            Around an orb, the rim of a stepped disc that grows a cell
            at a time; around a cabinet, a stepped frame. */}
        <g pointerEvents="none" shapeRendering="crispEdges">
          {ripplesRef.current.map((r, i) => {
            const t = (now - r.start - r.delay) / RIPPLE_DURATION;
            if (t < 0 || t >= 1) return null;
            const eased = 1 - Math.pow(1 - t, 2);
            const opacity = (1 - t) * 0.55;
            const cells = (px: number) => RING_CELL * Math.round(px / RING_CELL);
            const d = r.box
              ? frameRingPath(r.box.w, r.box.h, cells(eased * r.box.h * 0.28))
              : discRingPath(NODE_R + cells(eased * NODE_R * 2.8));
            return (
              <path
                key={`ripple-${i}-${r.start}-${r.delay}`}
                d={d}
                transform={`translate(${Math.round(r.x)}, ${Math.round(r.y)})`}
                fill={r.color}
                fillRule="evenodd"
                opacity={opacity}
              />
            );
          })}
        </g>

        {/* Nodes. Every one is a link around a <g data-slug data-r
            transform="translate(x, y) …"> in this one <svg>: Hugo's
            parkour reads exactly that <g> to turn the room into its first
            level (cabinets also carry data-w / data-h, their flat top is
            a platform). Keep the contract if you edit.

            The link is a real one (an SVG <a href>), so a screen reader
            lists the tools, and a middle click, a modified click and the
            link's menu do what they do on any link. A plain click is
            taken over: Hugo fetches the tool, then the page opens. */}
        <g>
          {nodesRef.current.map((n) => {
            const isHovered = hovered === n.tool.slug;
            const dim = hovered !== null && !isHovered;
            const opacity = dim ? 0.55 : 1;
            const entrance = getEntrance(n, now);
            const isBouncing = bouncingSlug === n.tool.slug;
            const color = COLOR_HEX[n.tool.color];
            const row = rowRef.current;
            const isGame = Boolean(n.cabinet);
            const scale = isGame
              ? entrance * (isHovered ? 1.04 : 1)
              : entrance * (isHovered ? 1.08 : 1) * (isBouncing ? 1.3 : 1);
            const halfW = isGame ? row.w / 2 : NODE_R;
            const halfH = isGame ? row.h / 2 : NODE_R;
            const labelY = isGame ? halfH + 18 : LABEL_OFFSET;
            // A cabinet's hop is painted on the canvas; an orb's whole
            // node hops (reduced motion only), icon and name with it.
            const hop = isGame ? 0 : hopOf(n, now);

            return (
              <a
                key={n.tool.slug}
                href={pathFor(n.tool.slug)}
                aria-label={`Open ${n.tool.title}`}
                className="swarm-link"
                draggable={false}
                onClick={(e) => onLinkClick(e, n.tool.slug)}
                onKeyDown={(e) => {
                  // Enter is the link's own key: it arrives as a click.
                  // Space opened a node before it was a link; it still does.
                  if (e.key === " ") {
                    e.preventDefault();
                    commitNavigation(n.tool.slug);
                  }
                }}
              >
                <g
                  transform={`translate(${n.x}, ${n.y - hop}) scale(${scale})`}
                  onPointerDown={(e) => onSvgPointerDown(e, n.tool.slug)}
                  onPointerEnter={() => setHovered(n.tool.slug)}
                  onPointerLeave={() => setHovered((h) => (h === n.tool.slug ? null : h))}
                  style={{
                    cursor: dragRef.current && !isGame ? "grabbing" : "pointer",
                    opacity,
                    transition: "opacity 220ms ease",
                  }}
                  data-slug={n.tool.slug}
                  data-r={halfH}
                  data-w={isGame ? row.w : undefined}
                  data-h={isGame ? row.h : undefined}
                >
                  {/* Transparent hit-target — the visible body (glow +
                      pixel core, or the cabinet for games) is painted on
                      the canvas below, where motion smears into phosphor
                      trails. */}
                  {isGame ? (
                    <rect
                      x={-halfW}
                      y={-halfH}
                      width={halfW * 2}
                      height={halfH * 2}
                      fill="transparent"
                      className="swarm-hit"
                    />
                  ) : (
                    <circle r={NODE_R} fill="transparent" className="swarm-hit" />
                  )}
                  {/* The keyboard-focus mark: a stepped ring a little way
                      out from the stepped disc (a stepped frame round a
                      cabinet). Invisible until the link has the keyboard's
                      focus; globals.css gives it its stroke then. */}
                  <path
                    className="swarm-ring"
                    d={
                      isGame
                        ? framePath(Math.round(halfW) + 4, Math.round(halfH) + 4, 4)
                        : ORB_FOCUS_RING
                    }
                    fill="none"
                    stroke="none"
                    shapeRendering="crispEdges"
                    pointerEvents="none"
                  />
                  {/* A tool wears its 12×12 icon, two px to the cell; a
                      game shows its screen instead (painted on the canvas). */}
                  {!isGame && (
                    <g
                      transform="translate(-12, -12) scale(2)"
                      fill={preferredTextHex(n.tool.color)}
                      shapeRendering="crispEdges"
                      pointerEvents="none"
                    >
                      {runsFor(n.tool.slug).map((r) => (
                        <rect
                          key={`${r.y}-${r.x}`}
                          x={r.x}
                          y={r.y}
                          width={r.w}
                          height={1}
                        />
                      ))}
                    </g>
                  )}
                  {/* Always-visible name label below */}
                  <text
                    y={labelY}
                    textAnchor="middle"
                    fontSize={isGame ? 11 : 10}
                    fill={INK_HEX}
                    pointerEvents="none"
                    style={{
                      fontFamily: "var(--font-pixel)",
                      fontWeight: isGame ? 700 : 400,
                      letterSpacing: "0.08em",
                      textTransform: isGame ? "uppercase" : undefined,
                    }}
                  >
                    {n.tool.title}
                  </text>
                  {/* Fresh arrival — a pixel price-tag pinned to the top-right
                      corner. Registry-driven (Tool.isNew); square corners
                      are the skin. */}
                  {n.tool.isNew && (
                    <g
                      transform={`translate(${halfW - (isGame ? 8 : 10)}, ${-halfH - (isGame ? 2 : -7)})`}
                      pointerEvents="none"
                    >
                      <rect x={-15} y={-7} width={30} height={14} fill={isGame ? INK_HEX : color} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        y={0.5}
                        fontSize={8}
                        fill={CREAM_HEX}
                        style={{
                          fontFamily: "var(--font-pixel)",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                        }}
                      >
                        NEW
                      </text>
                    </g>
                  )}
                </g>
              </a>
            );
          })}
        </g>

        {/* Particles (over nodes) */}
        <g pointerEvents="none">
          {particlesRef.current.map((p, i) => {
            const side = Math.max(2, Math.round(p.size * 1.6 * Math.max(0, p.life)));
            return (
              <rect
                key={i}
                x={Math.round(p.x - side / 2)}
                y={Math.round(p.y - side / 2)}
                width={side}
                height={side}
                fill={p.color}
                opacity={Math.max(0, p.life)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** The cell of every stepped ring here: the orb's own (see pixelDisc). */
const RING_CELL = 3;

/** The rows the canonical painter (pixelDisc, lib/hugo/sprite.ts) fills
 *  for a disc of radius `r`, read off the painter itself: a ring drawn
 *  from them has exactly the steps of the orb it goes round. */
function discRows(r: number): { y: number; half: number }[] {
  const rows: { y: number; half: number }[] = [];
  const probe = {
    fillStyle: "",
    fillRect(_x: number, y: number, w: number) {
      rows.push({ y, half: w / 2 });
    },
  };
  pixelDisc(probe as unknown as CanvasRenderingContext2D, 0, 0, r, "", RING_CELL);
  return rows;
}

const RING_PATHS = new Map<number, string>();

/** A stepped ring one cell thick, as a filled path round the origin:
 *  the stepped disc of radius `r` less the one a cell smaller. `r` is
 *  NODE_R plus whole cells, so the rows of the two line up. */
function discRingPath(r: number): string {
  let d = RING_PATHS.get(r);
  if (d !== undefined) return d;
  const inner = new Map(discRows(r - RING_CELL).map((row) => [row.y, row.half]));
  d = "";
  for (const { y, half } of discRows(r)) {
    const hole = inner.get(y) ?? 0;
    if (hole <= 0) {
      d += `M${-half},${y}h${half * 2}v${RING_CELL}h${-half * 2}z`;
    } else if (half > hole) {
      const w = half - hole;
      d += `M${-half},${y}h${w}v${RING_CELL}h${-w}zM${hole},${y}h${w}v${RING_CELL}h${-w}z`;
    }
  }
  RING_PATHS.set(r, d);
  return d;
}

/** The outline of the stepped disc of radius `r`, as one closed path
 *  for a stroke: down the right-hand steps, back up the left. */
function discOutlinePath(r: number): string {
  const rows = discRows(r);
  if (rows.length === 0) return "";
  const end = rows.length - 1;
  let d = `M${-rows[0].half},${rows[0].y}H${rows[0].half}`;
  for (let i = 0; i <= end; i++) {
    d += `V${rows[i].y + RING_CELL}`;
    if (i < end) d += `H${rows[i + 1].half}`;
  }
  d += `H${-rows[end].half}`;
  for (let i = end; i >= 0; i--) {
    d += `V${rows[i].y}`;
    if (i > 0) d += `H${-rows[i - 1].half}`;
  }
  return `${d}Z`;
}

/** The orb's keyboard-focus mark: two cells out from the body. */
const ORB_FOCUS_RING = discOutlinePath(NODE_R + RING_CELL * 2);

/** A frame with one stepped corner cut at each corner, as a closed path
 *  round the origin. `hw` and `hh` are half its width and height, `s`
 *  the size of the step. */
function framePath(hw: number, hh: number, s: number): string {
  return (
    `M${-hw + s},${-hh}H${hw - s}V${-hh + s}H${hw}V${hh - s}H${hw - s}V${hh}` +
    `H${-hw + s}V${hh - s}H${-hw}V${-hh + s}H${-hw + s}Z`
  );
}

/** A stepped frame one cell thick, `grow` px out from a box of `w` by
 *  `h`, as a filled path (even-odd: the inner frame is the hole). */
function frameRingPath(w: number, h: number, grow: number): string {
  const hw = Math.round(w / 2) + grow;
  const hh = Math.round(h / 2) + grow;
  return (
    framePath(hw, hh, RING_CELL) +
    framePath(hw - RING_CELL, hh - RING_CELL, RING_CELL)
  );
}

/** A press or a click that is the swarm's to answer: the primary button
 *  with no modifier held. Anything else is the browser's (a new tab, a
 *  new window, a download, the link's menu). */
function isPlainPress(e: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Reduced motion's answer to the forbidden button: every node hops
 *  once where it stands. At module scope for the same reason as
 *  `detonate` (the react-hooks linter and property writes). */
function hopAll(nodes: Node[]): void {
  const now = performance.now();
  for (const n of nodes) {
    if (!n.pinned) n.hopAt = now + Math.random() * 90;
  }
}

/** How high a node is off its spot, mid-hop (see `Node.hopAt`). */
function hopOf(n: Node, nowTs: number): number {
  if (n.hopAt === undefined) return 0;
  const k = (nowTs - n.hopAt) / EXPLODE_WINDOW_MS;
  return k >= 0 && k < 1 ? Math.sin(k * Math.PI) * 22 : 0;
}

/**
 * Where Search, About and the forbidden button are: the box around
 * every key that shares the room with the swarm, in the swarm's own
 * coordinates. Measured, because their size is not this file's to
 * know: HomeShell draws them, and a longer caption makes a wider key.
 *
 * The room is the nearest ancestor that holds a key outside the swarm.
 * Layout positions only (offsetLeft and friends, summed up to the
 * room), never getBoundingClientRect: the CRT power-on squashes that.
 * A key in a fixed layer (the parkour's win panel) has no offset
 * parent inside the room and is left out.
 */
function measureKeys(container: HTMLElement, w: number, h: number): Keep | null {
  let room = container.parentElement;
  let keys: HTMLElement[] = [];
  while (room && room !== document.body) {
    keys = Array.from(
      room.querySelectorAll<HTMLElement>("button, a[href]"),
    ).filter((el) => !container.contains(el) && el.offsetWidth > 0);
    if (keys.length > 0) break;
    room = room.parentElement;
  }
  if (!room || keys.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const el of keys) {
    const at = placeIn(el, room);
    if (!at) continue;
    x1 = Math.min(x1, at.x);
    y1 = Math.min(y1, at.y);
    x2 = Math.max(x2, at.x + el.offsetWidth);
    y2 = Math.max(y2, at.y + el.offsetHeight);
  }
  // Not the keys in the corner at all (a box that takes half the room):
  // better the usual corner than a wall across the swarm.
  if (x2 <= x1 || y2 <= y1 || x2 - x1 > w * 0.6 || y2 - y1 > h * 0.4) {
    return null;
  }
  // The strip between the keys and the edges of the room is theirs too.
  if (y1 < 64) y1 = 0;
  if (x2 > w - 64) x2 = w;
  return { id: "keys", x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Where `el` is in `room`, from layout offsets alone (never
 *  getBoundingClientRect: see `measureKeys`). Null when `room` is not on
 *  its chain of offset parents: an element in a fixed layer is not. */
function placeIn(
  el: HTMLElement,
  room: HTMLElement,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let at: HTMLElement | null = el;
  while (at && at !== room) {
    x += at.offsetLeft;
    y += at.offsetTop;
    at = at.offsetParent as HTMLElement | null;
  }
  return at === room ? { x, y } : null;
}

/**
 * The Keep for the parkour's controls hint, from the box its words are
 * set in and how they are set in it (`align`: the line's text-align).
 * The words take PARKOUR_HINT_W of the line at most. A hint near the
 * top of the room owns the strip above it too, as the keys do.
 */
function hintKeep(
  line: { x: number; y: number; w: number; h: number },
  align: string,
): Keep {
  const wide = Math.min(line.w, PARKOUR_HINT_W);
  const left =
    align === "center"
      ? line.x + (line.w - wide) / 2
      : align === "right" || align === "end"
        ? line.x + line.w - wide
        : line.x;
  const top =
    line.y - PARKOUR_HINT_SKIRT < 64 ? 0 : line.y - PARKOUR_HINT_SKIRT;
  return {
    id: "hint",
    x: left,
    y: top,
    w: wide,
    h: line.y + line.h + PARKOUR_HINT_SKIRT - top,
  };
}

/** The controls hint where HomeShell has drawn it so far (see
 *  PARKOUR_HINT_TOP): what the swarm goes by until it has measured. */
function usualHint(roomW: number): Keep {
  return hintKeep(
    { x: 0, y: PARKOUR_HINT_TOP, w: roomW, h: PARKOUR_HINT_LINE },
    "center",
  );
}

/**
 * Where the parkour's controls hint is, as a Keep in the swarm's own
 * coordinates. Measured, like the keys, because the line is HomeShell's
 * to place: wherever it is put, the swarm keeps off it.
 *
 * The line is the element marked `data-parkour-hint`. Should the mark
 * go missing, the line is told by what it says: the innermost element
 * on the page that holds all of it (one hidden for screen readers only
 * has no size, and is passed over). Its box is taken from layout
 * offsets alone, so a line that is moved with a transform is not seen
 * where it is drawn: place it with top, left, right, width or padding.
 * Null when there is no line to measure, or when what was found cannot
 * be it (a box across most of the room).
 */
function measureHint(container: HTMLElement, w: number, h: number): Keep | null {
  let room = container.parentElement;
  let line: HTMLElement | null = null;
  while (room && room !== document.body) {
    line = room.querySelector<HTMLElement>("[data-parkour-hint]");
    if (!line) {
      for (const el of room.querySelectorAll<HTMLElement>("p, div, span")) {
        if (el.offsetWidth < 8 || container.contains(el)) continue;
        const says = el.textContent ?? "";
        if (says.includes("move") && says.includes("esc gives up")) line = el;
      }
    }
    if (line) break;
    room = room.parentElement;
  }
  if (!room || !line || line.offsetWidth === 0) return null;
  const at = placeIn(line, room);
  if (!at) return null;
  // The words are set in the line's content box.
  const style = getComputedStyle(line);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const keep = hintKeep(
    {
      x: at.x + padL,
      y: at.y,
      w: Math.max(0, line.offsetWidth - padL - padR),
      h: line.offsetHeight,
    },
    style.textAlign,
  );
  if (keep.w <= 0 || keep.w > w * 0.6 || keep.h > h * 0.4) return null;
  return keep;
}

/**
 * The swarm at the moment it is made: the tools bunched in the middle of
 * the free band, about to burst apart, and the games standing in their
 * row. `still` is reduced motion: nothing makes an entrance, everything
 * is simply there (the caller then runs `settle`).
 */
function spawn(
  w: number,
  h: number,
  row: CabinetRow,
  t0: number,
  still: boolean,
): Node[] {
  const cx = w / 2;
  const cy = swarmCenterY(h, row.reserve);
  const floaters = tools.filter((t) => !isGameSlug(t.slug));
  const games = tools.filter((t) => isGameSlug(t.slug));
  const shown = t0 - ENTRANCE_DURATION;
  // Tools burst out of the middle of the free band.
  const nodes: Node[] = floaters.map((t, i) => {
    const angle = (i / floaters.length) * Math.PI * 2;
    return {
      tool: t,
      x: cx + (Math.random() - 0.5) * 20,
      y: cy + (Math.random() - 0.5) * 20,
      vx: Math.cos(angle) * 1.5,
      vy: Math.sin(angle) * 1.5,
      pinned: false,
      phase: Math.random() * Math.PI * 2,
      entranceStart: still ? shown : t0 + i * ENTRANCE_STAGGER,
      hasSparkled: still,
      dragVx: 0,
      dragVy: 0,
      dragLastT: 0,
      dragLastX: 0,
      dragLastY: 0,
      labelHalf: labelHalfWidth(t.title),
      kept: false,
      thrown: ENTRANCE_FREE,
      escort: 0,
      exit: null,
      route: null,
    };
  });
  // Games switch on in the row, left to right, after the tools.
  games.forEach((t, i) => {
    const c = row.centers[i];
    nodes.push({
      tool: t,
      x: c.x,
      y: c.y,
      vx: 0,
      vy: 0,
      pinned: false,
      phase: 0,
      entranceStart: still
        ? shown
        : t0 + (floaters.length + i * 2) * ENTRANCE_STAGGER,
      hasSparkled: true,
      dragVx: 0,
      dragVy: 0,
      dragLastT: 0,
      dragLastX: 0,
      dragLastY: 0,
      cabinet: true,
      labelHalf: row.w / 2,
      kept: true,
      thrown: 0,
      escort: 0,
      exit: null,
      route: null,
    });
  });
  return nodes;
}

function getEntrance(n: Node, now: number): number {
  const t = (now - n.entranceStart) / ENTRANCE_DURATION;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3);
}

function emitSparkle(particles: Particle[], x: number, y: number) {
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const speed = 1.2 + Math.random() * 1.0;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.85,
      color: CREAM_HEX,
      size: 2.5 + Math.random() * 1.5,
      kind: "sparkle",
    });
  }
}

/** Throw every dot outward from (cx, cy) at high velocity, then spit
 *  confetti — a per-dot puff in its own colour plus a big central
 *  burst pulling from the full palette. Mutates `nodes` and pushes to
 *  `particles` in place; lives at module scope so the react-hooks
 *  linter doesn't flag the property writes (same pattern as step). */
function detonate(
  nodes: Node[],
  particles: Particle[],
  cx: number,
  cy: number,
): void {
  const now = performance.now();
  for (const n of nodes) {
    if (n.pinned) continue;
    if (n.cabinet) {
      // Furniture does not fly. It jumps.
      n.hopAt = now + Math.random() * 90;
      continue;
    }
    let dx = n.x - cx;
    let dy = n.y - cy;
    let d = Math.hypot(dx, dy);
    if (d < 4) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
      d = 1;
    }
    const speed =
      EXPLODE_SPEED_MIN +
      Math.random() * (EXPLODE_SPEED_MAX - EXPLODE_SPEED_MIN);
    n.vx = (dx / d) * speed;
    n.vy = (dy / d) * speed;
    // Thrown: it flies through whatever is in the way, then finds its
    // way out again.
    n.thrown = EXPLODE_FREE;
    n.kept = false;
    n.route = null;
    // Small confetti puff in the dot's own colour.
    const nodeColor = COLOR_HEX[n.tool.color];
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      particles.push({
        x: n.x,
        y: n.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 0.6,
        life: 1,
        color: nodeColor,
        size: 2 + Math.random() * 2,
        kind: "click",
      });
    }
  }
  // Big central confetti — random colours from the whole palette.
  const allColors = tools.map((t) => COLOR_HEX[t.color]);
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 7;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 1,
      color: allColors[Math.floor(Math.random() * allColors.length)],
      size: 3 + Math.random() * 4,
      kind: "click",
    });
  }
}

/** Push a body out of a box along the nearest edge — a nudge, not a wall.
 *  `pad` widens the box sideways, `padY` (default: the same) up and down. */
function pushOut(
  n: Node,
  z: Zone,
  pad: number,
  strength: number,
  padY: number = pad,
): void {
  const ax = z.x - pad;
  const ay = z.y - padY;
  const ax2 = z.x + z.w + pad;
  const ay2 = z.y + z.h + padY;
  if (n.x <= ax || n.x >= ax2 || n.y <= ay || n.y >= ay2) return;
  // A side that is a wall of the room is no way out.
  const o = z.open;
  const dL = o && !o.left ? Infinity : n.x - ax;
  const dR = o && !o.right ? Infinity : ax2 - n.x;
  const dT = o && !o.top ? Infinity : n.y - ay;
  const dB = o && !o.bottom ? Infinity : ay2 - n.y;
  const m = Math.min(dL, dR, dT, dB);
  if (m === Infinity) return;
  const push = (0.05 + 0.1 * Math.min(1, m / 80)) * strength;
  if (m === dL) n.vx -= push;
  else if (m === dR) n.vx += push;
  else if (m === dT) n.vy -= push;
  else n.vy += push;
}

/** The room as the swarm sees it this frame: its walls, the soft zones
 *  that push and the Keeps that hold. Pure: the same numbers in, the
 *  same room out (the frame loop and the reduced-motion settle share it). */
function roomFor(
  w: number,
  h: number,
  row: CabinetRow,
  mark: { x: number; y: number; w: number; h: number } | null,
  keys: Keep | null,
  hint: Keep | null,
): Room {
  const narrow = w < WORDMARK_NARROW_W;
  const keysKeep: Keep = keys ?? {
    id: "keys",
    x: w - KEYS_ZONE_W + 1,
    y: 0,
    w: KEYS_ZONE_W - 1,
    h: KEYS_KEEP_H,
  };
  const zones: Zone[] = [
    HUGO_ZONE,
    {
      x: keysKeep.x - 1,
      y: 0,
      w: w - keysKeep.x + 1,
      h: keysKeep.y + keysKeep.h + KEYS_ZONE_SKIRT,
      open: { left: true, bottom: true },
    },
  ];
  const keeps: Keep[] = [];
  // The title's keep-out box is taller than the title: a name label
  // hangs under every orb, so an orb above needs that much more room,
  // and the hint line blinks just underneath.
  const avoid = mark
    ? {
        x: mark.x,
        y: mark.y - LABEL_HANG,
        w: mark.w,
        h: mark.h + LABEL_HANG + HINT_BAND,
      }
    : null;
  // Narrow rooms keep the old porous title: there is no way round it.
  const title: Keep | null =
    mark && !narrow
      ? { id: "title", x: mark.x, y: mark.y, w: mark.w, h: mark.h + HINT_REACH }
      : null;
  if (title) keeps.push(title);
  keeps.push(HUGO_KEEP, keysKeep);
  if (hint) {
    // A parkour run is on: its controls hint has a place in the room.
    // (Along the top, so far; then the room's edge is no way out.)
    zones.push({
      x: hint.x,
      y: hint.y,
      w: hint.w,
      h: hint.h,
      open: { left: true, right: true, bottom: true, top: hint.y > 0 },
    });
    keeps.push(hint);
  }
  return {
    bounds: {
      width: w,
      bottom: h - row.reserve,
      cx: w / 2,
      cy: swarmCenterY(h, row.reserve),
    },
    avoid,
    pad: wordmarkPad(w),
    narrow,
    zones,
    keeps,
    title,
  };
}

/** How far an orb's centre may go: the sides are measured from the
 *  LABEL, which is wider than the orb, so a name never leaves the
 *  screen; the floor is the top of the arcade row's band, minus room
 *  for the label underneath. */
function wallsFor(n: Node, bounds: Bounds) {
  return {
    left: n.labelHalf + 6,
    right: bounds.width - n.labelHalf - 6,
    top: NODE_R + 6,
    bottom: bounds.bottom - LABEL_OFFSET - 8,
  };
}

/** The box an orb's CENTRE has to stay out of for its body and its name
 *  to clear `k` by KEEP_GAP. The body is taken to be as wide as the
 *  name: simpler than the true shape, and never too small. */
function keepBox(n: Node, k: Keep) {
  return {
    x1: k.x - n.labelHalf - KEEP_GAP,
    y1: k.y - LABEL_REACH - KEEP_GAP,
    x2: k.x + k.w + n.labelHalf + KEEP_GAP,
    y2: k.y + k.h + NODE_R + KEEP_GAP,
  };
}

function inBox(
  b: { x1: number; y1: number; x2: number; y2: number },
  x: number,
  y: number,
): boolean {
  return x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2;
}

/** The first Keep whose box holds (x, y) for this orb, if any. */
function keepAt(n: Node, x: number, y: number, keeps: Keep[]): Keep | null {
  for (const k of keeps) if (inBox(keepBox(n, k), x, y)) return k;
  return null;
}

/**
 * The side an orb inside `k` should leave by: the nearest one it can
 * really leave by. A side is no way out if the orb would end up through
 * a wall of the room (the bug this replaces: beside the title, the
 * nearest edge was the wall side, and the orb was pushed into the wall
 * for ever) or inside another Keep (under the keys, the way up out of
 * the title leads into the keys). `prefer` is the side already chosen;
 * it is kept unless another is clearly nearer.
 */
function wayOut(
  n: Node,
  k: Keep,
  room: Room,
  prefer: Side | null,
): Side | null {
  const b = keepBox(n, k);
  const wall = wallsFor(n, room.bounds);
  const sides: [Side, number, number, number][] = [
    ["top", n.y - b.y1, n.x, b.y1],
    ["bottom", b.y2 - n.y, n.x, b.y2],
    ["left", n.x - b.x1, b.x1, n.y],
    ["right", b.x2 - n.x, b.x2, n.y],
  ];
  let best: Side | null = null;
  let bestCost = Infinity;
  let spare: Side | null = null;
  let spareCost = Infinity;
  for (const [side, dist, ex, ey] of sides) {
    if (ex < wall.left || ex > wall.right || ey < wall.top || ey > wall.bottom) {
      continue;
    }
    const cost = side === prefer ? dist - 12 : dist;
    // Out of this box and into another is only a last resort.
    const blocked = room.keeps.some(
      (o) => o !== k && inBox(keepBox(n, o), ex, ey),
    );
    if (blocked) {
      if (cost < spareCost) {
        spareCost = cost;
        spare = side;
      }
    } else if (cost < bestCost) {
      bestCost = cost;
      best = side;
    }
  }
  return best ?? spare;
}

/** Walk an orb one frame toward `side` of the box `b` it is in: at least
 *  ESCORT_V px that way for every sixtieth of a second the frame stands
 *  for (`pace`), whatever the crowd is pushing, starting slowly, and no
 *  further than the face itself (a step past it could be a step into the
 *  next box, and two boxes that meet would pass the orb back and forth).
 *  What a late frame adds is distance only: the orb leaves the box with
 *  the momentum of one step, as it does when the frames come on time. */
function walk(
  n: Node,
  side: Side,
  b: { x1: number; y1: number; x2: number; y2: number },
  pace: number,
): void {
  n.escort += pace;
  const speed = Math.min(ESCORT_V, 0.25 * n.escort);
  const dx = side === "left" ? -1 : side === "right" ? 1 : 0;
  const dy = side === "top" ? -1 : side === "bottom" ? 1 : 0;
  const along = n.vx * dx + n.vy * dy;
  if (along < speed) {
    const add = speed - along;
    n.x += dx * add;
    n.y += dy * add;
    n.vx += dx * add;
    n.vy += dy * add;
  }
  const more = speed * (pace - 1);
  n.x += dx * more;
  n.y += dy * more;
  if (side === "top" && n.y < b.y1) n.y = b.y1;
  else if (side === "bottom" && n.y > b.y2) n.y = b.y2;
  else if (side === "left" && n.x < b.x1) n.x = b.x1;
  else if (side === "right" && n.x > b.x2) n.x = b.x2;
}

/**
 * The rule under the soft zones, run on every orb after it has moved.
 *
 *   - In free flight (a burst, a fling, the forbidden button) nothing is
 *     checked: that goes through, as it always did.
 *   - An orb that was clear a step ago and has just crossed into a Keep
 *     is put back on the face it crossed. So nothing drifts in.
 *   - An orb that is inside one (it was born there, dropped there, flew
 *     there, or the box moved over it) is walked out by `wayOut`.
 *
 * (px, py) is where the orb was before this step; `pace` is how many
 * sixtieths of a second the step stands for (see `walk`).
 */
function guard(
  n: Node,
  px: number,
  py: number,
  room: Room,
  pace: number,
): void {
  if (n.thrown > 0) {
    n.thrown--;
    n.kept = false;
    n.escort = 0;
    n.exit = null;
    return;
  }
  const wall = wallsFor(n, room.bounds);
  if (n.route && room.title) {
    // Crossing the title on purpose (see `rebalance`).
    const b = keepBox(n, room.title);
    const across = n.route === "bottom" ? n.y >= b.y2 : n.y <= b.y1;
    if (!across) {
      walk(n, n.route, b, pace);
      n.x = clamp(n.x, wall.left, wall.right);
      n.y = clamp(n.y, wall.top, wall.bottom);
      return;
    }
  }
  n.route = null;
  if (n.kept) {
    // Back onto the face it came through, unless that face is outside
    // the room (the room has just shrunk around it): then it is inside
    // the box for good and is walked out like any other.
    for (const k of room.keeps) {
      const b = keepBox(n, k);
      if (!inBox(b, n.x, n.y)) continue;
      if (py <= b.y1 && b.y1 >= wall.top) {
        n.y = b.y1;
        if (n.vy > 0) n.vy = 0;
      } else if (py >= b.y2 && b.y2 <= wall.bottom) {
        n.y = b.y2;
        if (n.vy < 0) n.vy = 0;
      } else if (px <= b.x1 && b.x1 >= wall.left) {
        n.x = b.x1;
        if (n.vx > 0) n.vx = 0;
      } else if (px >= b.x2 && b.x2 <= wall.right) {
        n.x = b.x2;
        if (n.vx < 0) n.vx = 0;
      }
    }
  }
  const k = keepAt(n, n.x, n.y, room.keeps);
  if (!k) {
    n.kept = true;
    n.escort = 0;
    n.exit = null;
    return;
  }
  n.kept = false;
  const side = wayOut(n, k, room, n.exit && n.exit.keep === k.id ? n.exit.side : null);
  if (!side) return; // nowhere to go: the room is too small for it
  n.exit = { keep: k.id, side };
  walk(n, side, keepBox(n, k), pace);
  n.x = clamp(n.x, wall.left, wall.right);
  n.y = clamp(n.y, wall.top, wall.bottom);
  if (!keepAt(n, n.x, n.y, room.keeps)) {
    n.kept = true;
    n.escort = 0;
    n.exit = null;
  }
}

/** How many orbs a part of the room can seat, given the spans their
 *  centres may take there. */
function seats(w: number, h: number): number {
  if (w < 0 || h < 0) return 0;
  return (Math.floor(w / SEAT_W) + 1) * (Math.floor(h / SEAT_H) + 1);
}

/**
 * Even out the two sides of the title.
 *
 * The swarm is born in the middle of the room, which is where the title
 * is, and the burst throws each orb above it or below it by chance.
 * While the title was only a soft zone the crowded side leaked through
 * it until the two evened out (and sometimes an orb stopped halfway:
 * the bug). Now that nothing drifts across, the count is done once,
 * here: each side gets a share of the orbs in proportion to the seats
 * it has (a short room has a small pocket above the title, between the
 * mascot and the keys, and a full row below), and if one side is more
 * than one and a half over its share, the extras are sent across.
 * Where the room is wide enough to go round the title the orbs still
 * find their own way, as before.
 */
function rebalance(floaters: Node[], room: Room): void {
  const title = room.title;
  if (!title) return;
  const half = 32; // a typical name
  const top = title.y - LABEL_REACH - KEEP_GAP;
  const bottom = title.y + title.h + NODE_R + KEEP_GAP;
  const wallL = half + 6;
  const wallR = room.bounds.width - half - 6;
  const wallT = NODE_R + 6;
  const floor = room.bounds.bottom - LABEL_OFFSET - 8;
  // The boxes in the top corners take a bite out of the space above.
  let cornerL = wallL;
  let cornerR = wallR;
  let cornerB = wallT;
  for (const k of room.keeps) {
    if (k === title) continue;
    if (k.x <= 0) cornerL = Math.max(cornerL, k.x + k.w + half + KEEP_GAP);
    else if (k.x + k.w >= room.bounds.width) {
      cornerR = Math.min(cornerR, k.x - half - KEEP_GAP);
    } else continue;
    cornerB = Math.max(cornerB, k.y + k.h + NODE_R + KEEP_GAP);
  }
  const seatsAbove =
    seats(cornerR - cornerL, Math.min(top, cornerB) - wallT) +
    (top > cornerB ? seats(wallR - wallL, top - cornerB) : 0);
  const seatsBelow = seats(wallR - wallL, floor - bottom);
  if (seatsAbove + seatsBelow === 0) return;
  const above = floaters.filter((n) => n.y <= top);
  const below = floaters.filter((n) => n.y >= bottom);
  const total = above.length + below.length;
  const share = (total * seatsAbove) / (seatsAbove + seatsBelow);
  if (above.length > share + 1.5) {
    // Nearest the title first; one that is not over the title at all
    // (it can simply come down past the end of it) before any that is.
    const over = (n: Node) =>
      n.x > title.x - n.labelHalf && n.x < title.x + title.w + n.labelHalf;
    const movers = above
      .filter((n) => keepBox(n, title).y2 <= floor)
      .sort((a, b) => Number(over(a)) - Number(over(b)) || b.y - a.y)
      .slice(0, above.length - Math.ceil(share));
    for (const n of movers) {
      n.route = "bottom";
      n.kept = false;
      n.escort = 0;
    }
  } else if (above.length < share - 1.5) {
    const movers = below
      .filter((n) => {
        const b = keepBox(n, title);
        if (b.y1 < wallT) return false;
        return !room.keeps.some(
          (o) => o !== title && inBox(keepBox(n, o), n.x, b.y1),
        );
      })
      .sort((a, b) => a.y - b.y)
      .slice(0, Math.floor(share) - above.length);
    for (const n of movers) {
      n.route = "top";
      n.kept = false;
      n.escort = 0;
    }
  }
}

/** Attract-mode drift — every free orb patrols the room at a slow
 *  constant speed with a softly wandering heading, turning back at
 *  the edges of the band it lives in. This is what keeps the screen
 *  alive (and the phosphor trails fed) even when nobody's touching
 *  it. Patrols that wander into the title's box get their heading
 *  steered back out so they don't park on the title. */
function drift(floaters: Node[], room: Room): void {
  const { bounds, avoid, pad, narrow, zones } = room;
  for (const n of floaters) {
    if (n.pinned) continue;
    let heading = n.heading ?? n.phase * Math.PI * 2;
    heading += (Math.random() - 0.5) * DRIFT_TURN;
    n.x += Math.cos(heading) * DRIFT_SPEED;
    n.y += Math.sin(heading) * DRIFT_SPEED;
    const mx = n.labelHalf + 14;
    const my = NODE_R + 14;
    const floor = bounds.bottom - LABEL_OFFSET - 14;
    if ((n.x < mx && Math.cos(heading) < 0) || (n.x > bounds.width - mx && Math.cos(heading) > 0)) {
      heading = Math.PI - heading;
    }
    if ((n.y < my && Math.sin(heading) < 0) || (n.y > floor && Math.sin(heading) > 0)) {
      heading = -heading;
    }
    // Narrow rooms skip the deflection entirely — the pushed
    // pad in step() is enough, and patrols may cross behind the
    // marquee instead of pinning against its band.
    if (
      !narrow &&
      avoid &&
      n.x > avoid.x - pad &&
      n.x < avoid.x + avoid.w + pad &&
      n.y > avoid.y - pad &&
      n.y < avoid.y + avoid.h + pad
    ) {
      heading =
        Math.atan2(
          n.y - (avoid.y + avoid.h / 2),
          n.x - (avoid.x + avoid.w / 2),
        ) +
        (Math.random() - 0.5) * 0.4;
    }
    for (const z of zones) {
      const zp = NODE_R + 10;
      if (
        n.x > z.x - zp &&
        n.x < z.x + z.w + zp &&
        n.y > z.y - zp &&
        n.y < z.y + z.h + zp
      ) {
        heading =
          Math.atan2(n.y - (z.y + z.h / 2), n.x - (z.x + z.w / 2)) +
          (Math.random() - 0.5) * 0.4;
      }
    }
    n.heading = heading;
  }
}

/** One step of the swarm (the frame loop takes one a frame): the drift,
 *  the forces, the walls and then the Keeps. */
function step(
  nodes: Node[],
  room: Room,
  opts: { drift: boolean; wobble: number; vCap: number; pace: number },
  swarm: Swarm,
): void {
  if (nodes.length === 0) return;
  const now = performance.now();
  const { bounds, avoid, pad, narrow, zones } = room;
  const floaters = nodes.filter((n) => !n.cabinet);
  // Where each orb stood before anything moved it: the guard needs it.
  const before = floaters.map((n) => [n.x, n.y] as const);

  if (opts.drift) drift(floaters, room);

  // The swarm should fill the same share of the room at any size. Aim
  // for an ellipse (the room is wider than the free band is tall): the
  // repel is derived for a ring of radius ry, and pushes act `aspect`
  // times further sideways, which stretches that ring to rx.
  const ry = Math.max(90, FILL_Y * bounds.bottom);
  const rx = Math.max(ry, FILL_X * bounds.width);
  const aspect = rx / ry;
  const repel = repelFor(floaters.length, ry);
  const minD2 = REPEL_MIN_DIST * REPEL_MIN_DIST;

  // Mutual repulsion (O(n²)) — keeps labels from overlapping.
  for (let i = 0; i < floaters.length; i++) {
    for (let j = i + 1; j < floaters.length; j++) {
      const a = floaters[i];
      const b = floaters[j];
      const dx = (b.x - a.x) / aspect;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const d = Math.sqrt(d2);
      const f = -repel / Math.max(d2, minD2);
      const fx = (dx / d) * f * aspect;
      const fy = (dy / d) * f;
      if (!a.pinned) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned) {
        b.vx -= fx;
        b.vy -= fy;
      }
      // Elbow room. The repel is a far-field force: in a short room,
      // where the title's box leaves one row above it and one below, it
      // is too gentle to stop two orbs at rest from standing on each
      // other's names. Two settled orbs whose boxes (body and name)
      // overlap are eased apart along the shorter way out. A burst, a
      // fling and a dragged orb are left alone.
      if (a.kept && b.kept) {
        const overX = a.labelHalf + b.labelHalf + ELBOW_ROOM - Math.abs(b.x - a.x);
        const overY = NODE_R + LABEL_REACH + ELBOW_ROOM - Math.abs(b.y - a.y);
        if (overX > 0 && overY > 0) {
          const sx = b.x >= a.x ? 1 : -1;
          const sy = b.y >= a.y ? 1 : -1;
          // The shorter way, unless it is shut and the longer one is not.
          // In the short room the row under the title has no height to
          // spare: of two orbs stacked there, one is on the floor and the
          // other against the title's box. Neither can give way up or
          // down, and they stood on each other for hundreds of steps
          // until the far-field push had slid one aside.
          const openX =
            clearAt(a, a.x - sx * overX, a.y, room) ||
            clearAt(b, b.x + sx * overX, b.y, room);
          const openY =
            clearAt(a, a.x, a.y - sy * overY, room) ||
            clearAt(b, b.x, b.y + sy * overY, room);
          const sideways = overX < overY ? openX || !openY : openX && !openY;
          if (sideways) {
            const e = Math.min(ELBOW_MAX, overX * ELBOW_K) * sx;
            a.vx -= e;
            b.vx += e;
          } else {
            const e = Math.min(ELBOW_MAX, overY * ELBOW_K) * sy;
            a.vy -= e;
            b.vy += e;
          }
        }
      }
    }
  }

  const wobbleT = now * WOBBLE_RATE;

  for (let i = 0; i < floaters.length; i++) {
    const n = floaters[i];
    if (n.pinned) {
      // In the visitor's hand: it goes where the hand goes.
      n.kept = false;
      n.thrown = 0;
      n.escort = 0;
      n.exit = null;
      n.route = null;
      continue;
    }
    const wall = wallsFor(n, bounds);
    // Gravity — toward the middle of the free band. The only attractor
    // in the system; the cursor doesn't influence it.
    n.vx += (bounds.cx - n.x) * CENTER_PULL;
    n.vy += (bounds.cy - n.y) * CENTER_PULL;
    // Idle wobble — long-period drift so the swarm feels alive at rest.
    if (opts.wobble > 0) {
      n.vx += Math.sin(wobbleT + n.phase) * opts.wobble;
      n.vy += Math.cos(wobbleT * 1.3 + n.phase * 1.7) * opts.wobble;
    }
    // Marquee avoidance — a soft push out of the wordmark's rect along
    // the nearest edge, stronger the deeper the orb sits. Avoidance,
    // not a wall: drags and explode bursts pass through. Narrow rooms
    // get half the shove — porous, not a fence. Sideways the pad is
    // measured from the name, which is wider than the orb, and a side
    // the orb cannot get past the title on is no way out.
    if (avoid) {
      if (narrow) pushOut(n, avoid, pad, 0.5);
      else {
        const padX = Math.max(pad, n.labelHalf + KEEP_GAP + 12);
        pushOut(
          n,
          {
            ...avoid,
            open: {
              top: avoid.y - pad >= wall.top,
              bottom: avoid.y + avoid.h + pad <= wall.bottom,
              left: avoid.x - padX >= wall.left,
              right: avoid.x + avoid.w + padX <= wall.right,
            },
          },
          padX,
          1,
          pad,
        );
      }
    }
    // The corner mascot and the top-right keys get the same treatment,
    // a little firmer: an orb parked on a button hides it. The push is a
    // spring, so an orb leaned on by its neighbours settles a dozen
    // pixels inside the padded box; the pad is sized so that this still
    // leaves its edge (and, sideways, its label) clear of the box itself.
    for (const z of zones) {
      pushOut(n, z, Math.max(NODE_R + 20, n.labelHalf + 8), 3, NODE_R + 20);
    }

    n.vx *= DAMPING;
    n.vy *= DAMPING;
    if (n.vx > opts.vCap) n.vx = opts.vCap;
    else if (n.vx < -opts.vCap) n.vx = -opts.vCap;
    if (n.vy > opts.vCap) n.vy = opts.vCap;
    else if (n.vy < -opts.vCap) n.vy = -opts.vCap;
    n.x += n.vx;
    n.y += n.vy;
    // Walls — hit one, velocity reflects with energy loss (see
    // `wallsFor`). The `vx < 0` checks make sure we only invert on
    // impact, never re-bounce a node that gravity is already pulling
    // away from the wall.
    if (n.x < wall.left) {
      n.x = wall.left;
      if (n.vx < 0) n.vx = -n.vx * BOUNCE_DAMPING;
    } else if (n.x > wall.right) {
      n.x = wall.right;
      if (n.vx > 0) n.vx = -n.vx * BOUNCE_DAMPING;
    }
    if (n.y < wall.top) {
      n.y = wall.top;
      if (n.vy < 0) n.vy = -n.vy * BOUNCE_DAMPING;
    } else if (n.y > wall.bottom) {
      n.y = wall.bottom;
      if (n.vy > 0) n.vy = -n.vy * BOUNCE_DAMPING;
    }
    guard(n, before[i][0], before[i][1], room, opts.pace);
  }

  if (
    swarm.rebalance &&
    room.title &&
    floaters.every((n) => n.kept && !n.pinned && !n.route)
  ) {
    swarm.rebalance = false;
    rebalance(floaters, room);
  }
}

/** Reduced motion: run the swarm ahead to where it comes to rest, so it
 *  can be shown there and left there. The same physics as a frame, with
 *  no drift and no wobble, and nobody watching. */
function settle(nodes: Node[], room: Room, swarm: Swarm): void {
  const floaters = nodes.filter((n) => !n.cabinet);
  // At rest when nothing has moved a fiftieth of a pixel in twenty steps.
  // (Not when the speeds are zero: an orb leaning on a Keep is pushed
  // into it and put back every step, and stands perfectly still.)
  let was = floaters.map((n) => [n.x, n.y]);
  for (let i = 0; i < SETTLE_STEPS; i++) {
    step(
      nodes,
      room,
      { drift: false, wobble: 0, vCap: MAX_V, pace: 1 },
      swarm,
    );
    if (i % 20 !== 19) continue;
    const still = floaters.every(
      (n, k) =>
        Math.abs(n.x - was[k][0]) < 0.02 && Math.abs(n.y - was[k][1]) < 0.02,
    );
    if (
      still &&
      i > 240 &&
      !swarm.rebalance &&
      floaters.every((n) => n.kept && !n.route)
    ) {
      break;
    }
    was = floaters.map((n) => [n.x, n.y]);
  }
  for (const n of floaters) {
    n.vx = 0;
    n.vy = 0;
  }
}

/** Whether an orb standing at (x, y) is inside the walls and clear of
 *  every Keep. */
function clearAt(n: Node, x: number, y: number, room: Room): boolean {
  const wall = wallsFor(n, room.bounds);
  if (x < wall.left || x > wall.right || y < wall.top || y > wall.bottom) {
    return false;
  }
  return keepAt(n, x, y, room.keeps) === null;
}

/** Whether an orb standing at (x, y) would lie over another orb or
 *  its name, or come within `gap` of doing so. */
function crowdedAt(
  n: Node,
  x: number,
  y: number,
  floaters: Node[],
  gap: number,
): boolean {
  for (const m of floaters) {
    if (m === n) continue;
    if (
      Math.abs(m.x - x) < n.labelHalf + m.labelHalf + gap &&
      Math.abs(m.y - y) < NODE_R + LABEL_REACH + gap
    ) {
      return true;
    }
  }
  return false;
}

/** Reduced motion: put an orb on the nearest spot that is clear of the
 *  Keeps and of the other orbs. It steps there at once; nothing glides. */
function placeFree(n: Node, floaters: Node[], room: Room): void {
  let spare: { x: number; y: number } | null = null;
  const reach = Math.hypot(room.bounds.width, room.bounds.bottom);
  for (let r = 0; r <= reach; r += 6) {
    const count = r === 0 ? 1 : Math.max(8, Math.ceil((Math.PI * 2 * r) / 12));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = n.x + Math.cos(a) * r;
      const y = n.y + Math.sin(a) * r;
      if (!clearAt(n, x, y, room)) continue;
      if (!crowdedAt(n, x, y, floaters, ELBOW_ROOM + 2)) {
        n.x = x;
        n.y = y;
        return;
      }
      if (!spare) spare = { x, y };
    }
  }
  if (spare) {
    n.x = spare.x;
    n.y = spare.y;
  }
}
