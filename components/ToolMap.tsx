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
  /** performance.now() of the last explode — the cabinet hops. */
  hopAt?: number;
};

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
/** The top-right keys (search, about, the forbidden button). */
const KEYS_ZONE_W = 348;
const KEYS_ZONE_H = 116;

/** A box the swarm keeps out of. `open` names the sides an orb can be
 *  pushed out through — a box in a corner of the room only has two. */
type Zone = {
  x: number;
  y: number;
  w: number;
  h: number;
  open?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
};

/** Where the swarm may be, and where its centre is. */
type Bounds = {
  width: number;
  /** The y the swarm must stay above: the top of the arcade row's band. */
  bottom: number;
  cx: number;
  cy: number;
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
  }, [bouncingSlug]);

  useEffect(() => {
    const onStart = () => (parkourRef.current = true);
    const onEnd = () => (parkourRef.current = false);
    window.addEventListener("hugoslekstuga:parkour-start", onStart);
    window.addEventListener("hugoslekstuga:parkour-end", onEnd);
    return () => {
      window.removeEventListener("hugoslekstuga:parkour-start", onStart);
      window.removeEventListener("hugoslekstuga:parkour-end", onEnd);
    };
  }, []);

  // Declared above its first caller so the react-hooks compiler-aware
  // lint rule (variable-accessed-before-declared) is happy.
  function initNodes(w: number, h: number) {
    // The `size` state lags the actual container during the initial
    // `useLayoutEffect → setState → re-render` cycle. If we trust
    // `size` here, dots spawn at the wrong centre and the centre
    // pull is too gentle to migrate them once they've settled. Read
    // the container directly so the spawn position is always the
    // real centre, regardless of size-state timing.
    const rect = containerRef.current?.getBoundingClientRect();
    const actualW = rect && rect.width > MIN_W ? rect.width : w;
    const actualH = rect && rect.height > MIN_H ? rect.height : h;
    const row = cabinetRow(actualW, actualH, GAME_COUNT);
    const cx = actualW / 2;
    const cy = swarmCenterY(actualH, row.reserve);
    const t0 = performance.now();
    const floaters = tools.filter((t) => !isGameSlug(t.slug));
    const games = tools.filter((t) => isGameSlug(t.slug));
    // Tools burst out of the middle of the free band.
    nodesRef.current = floaters.map((t, i) => {
      const angle = (i / floaters.length) * Math.PI * 2;
      return {
        tool: t,
        x: cx + (Math.random() - 0.5) * 20,
        y: cy + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * 1.5,
        vy: Math.sin(angle) * 1.5,
        pinned: false,
        phase: Math.random() * Math.PI * 2,
        entranceStart: t0 + i * ENTRANCE_STAGGER,
        hasSparkled: false,
        dragVx: 0,
        dragVy: 0,
        dragLastT: 0,
        dragLastX: 0,
        dragLastY: 0,
        labelHalf: labelHalfWidth(t.title),
      };
    });
    // Games switch on in the row, left to right, after the tools.
    games.forEach((t, i) => {
      const c = row.centers[i];
      nodesRef.current.push({
        tool: t,
        x: c.x,
        y: c.y,
        vx: 0,
        vy: 0,
        pinned: false,
        phase: 0,
        entranceStart: t0 + (floaters.length + i * 2) * ENTRANCE_STAGGER,
        hasSparkled: true,
        dragVx: 0,
        dragVy: 0,
        dragLastT: 0,
        dragLastX: 0,
        dragLastY: 0,
        cabinet: true,
        labelHalf: row.w / 2,
      });
    });
    nodeBySlug.current = new Map(nodesRef.current.map((n) => [n.tool.slug, n]));
    particlesRef.current = [];
    ripplesRef.current = [];
    initializedRef.current = true;
    setNow(t0);
  }

  useEffect(() => {
    if (initializedRef.current) return;
    if (size.w <= MIN_W && size.h <= MIN_H) return;
    initNodes(size.w, size.h);
  }, [size]);

  // Mirror the React `hovered` state into a ref so the rAF loop reads
  // the latest value without becoming a function of changing closures.
  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const listener = (e: MediaQueryListEvent) => {
      reduceMotionRef.current = e.matches;
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
        return;
      }
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
    let raf = 0;

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
        if (n.cabinet) {
          // A machine, not an orb: it stands still, its screen plays its
          // own game, and the forbidden button makes it hop.
          const hopK = n.hopAt ? (nowTs - n.hopAt) / EXPLODE_WINDOW_MS : 1;
          const hop = hopK >= 0 && hopK < 1 ? Math.sin(hopK * Math.PI) * 22 : 0;
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
        // Bloom — the hover feedback lives here now.
        const glowR = r * (isHov ? 2.2 : 1.8);
        const grad = ctx.createRadialGradient(n.x, n.y, 1, n.x, n.y, glowR);
        grad.addColorStop(0, withAlpha(color, isHov ? 0.38 : 0.3));
        grad.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(n.x - glowR, n.y - glowR, glowR * 2, glowR * 2);
        pixelDisc(ctx, n.x, n.y, r, color);
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
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
      const bounds: Bounds = {
        width: size.w,
        bottom: size.h - row.reserve,
        cx: size.w / 2,
        cy: swarmCenterY(size.h, row.reserve),
      };
      const zones: Zone[] = [
        HUGO_ZONE,
        {
          x: size.w - KEYS_ZONE_W,
          y: 0,
          w: KEYS_ZONE_W,
          h: KEYS_ZONE_H,
          open: { left: true, bottom: true },
        },
      ];

      // Attract-mode drift — every free orb patrols the room at a slow
      // constant speed with a softly wandering heading, turning back at
      // the edges of the band it lives in. This is what keeps the screen
      // alive (and the phosphor trails fed) even when nobody's touching
      // it. The marquee publishes its rect (viewport == canvas coords
      // here); patrols that wander into it get their heading steered
      // back out so they don't park on the title.
      // The title's keep-out box is taller than the title: a name label
      // hangs under every orb, so an orb above needs that much more room,
      // and the hint line blinks just underneath.
      const mark = getWordmarkRect();
      const avoid = mark
        ? {
            x: mark.x,
            y: mark.y - LABEL_HANG,
            w: mark.w,
            h: mark.h + LABEL_HANG + HINT_BAND,
          }
        : null;
      const pad = wordmarkPad(size.w);
      const narrow = size.w < WORDMARK_NARROW_W;
      if (!reduceMotionRef.current) {
        for (const n of nodesRef.current) {
          if (n.pinned || n.cabinet) continue;
          let heading = n.heading ?? n.phase * Math.PI * 2;
          heading += (Math.random() - 0.5) * DRIFT_TURN;
          n.x += Math.cos(heading) * DRIFT_SPEED;
          n.y += Math.sin(heading) * DRIFT_SPEED;
          const mx = n.labelHalf + 14;
          const my = NODE_R + 14;
          const floor = bounds.bottom - LABEL_OFFSET - 14;
          if ((n.x < mx && Math.cos(heading) < 0) || (n.x > size.w - mx && Math.cos(heading) > 0)) {
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

      const wobbleAmplitude = reduceMotionRef.current ? 0 : WOBBLE_FORCE;
      const inExplode =
        explodeAtRef.current > 0 &&
        performance.now() - explodeAtRef.current < EXPLODE_WINDOW_MS;
      const vCap = inExplode ? EXPLODE_MAX_V : MAX_V;
      step(nodesRef.current, bounds, wobbleAmplitude, vCap, avoid, pad, zones);

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
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

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
      const node = nodeBySlug.current.get(slug);
      if (!node) return;
      const rect = containerRef.current!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {}
      // Pointer interaction must never leave a "chosen" focus ring on
      // the node — that's keyboard feedback (Tab draws it via CSS).
      (e.currentTarget as SVGGElement).blur?.();
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
    const color = COLOR_HEX[node.tool.color];
    const now = performance.now();

    // Multi-ring ripple.
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      ripplesRef.current.push({
        x: node.x,
        y: node.y,
        start: now,
        delay: i * RIPPLE_STAGGER_MS,
        color,
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

  const onSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {}
      const node = nodeBySlug.current.get(drag.slug);
      if (node && !drag.fixed) {
        node.pinned = false;
        node.vx = clamp(node.dragVx, -25, 25);
        node.vy = clamp(node.dragVy, -25, 25);
      }
      const wasClick = !drag.moved;
      dragRef.current = null;
      if (wasClick) {
        commitNavigation(drag.slug);
      }
    },
    [commitNavigation],
  );

  const explode = useCallback(() => {
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
      <svg
        width={size.w}
        height={size.h}
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={onCanvasPointerLeave}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerUp}
        style={{ touchAction: "none", userSelect: "none", position: "relative" }}
      >
        {/* Click ripples */}
        <g pointerEvents="none">
          {ripplesRef.current.map((r, i) => {
            const t = (now - r.start - r.delay) / RIPPLE_DURATION;
            if (t < 0 || t >= 1) return null;
            const eased = 1 - Math.pow(1 - t, 2);
            const radius = NODE_R + eased * NODE_R * 2.8;
            const opacity = (1 - t) * 0.55;
            return (
              <circle
                key={`ripple-${i}-${r.start}-${r.delay}`}
                cx={r.x}
                cy={r.y}
                r={radius}
                fill="none"
                stroke={r.color}
                strokeWidth={3 * (1 - t * 0.6)}
                opacity={opacity}
              />
            );
          })}
        </g>

        {/* Nodes. Every one is a <g data-slug data-r transform="translate(x, y) …">
            in this one <svg>: Hugo's parkour reads exactly that to turn the
            room into its first level (cabinets also carry data-w / data-h,
            their flat top is a platform). Keep the contract if you edit. */}
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

            return (
              <g
                key={n.tool.slug}
                transform={`translate(${n.x}, ${n.y}) scale(${scale})`}
                onPointerDown={(e) => onSvgPointerDown(e, n.tool.slug)}
                onPointerEnter={() => setHovered(n.tool.slug)}
                onPointerLeave={() => setHovered((h) => (h === n.tool.slug ? null : h))}
                style={{
                  cursor: dragRef.current && !isGame ? "grabbing" : "pointer",
                  opacity,
                  transition: "opacity 220ms ease",
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${n.tool.title}`}
                data-slug={n.tool.slug}
                data-r={halfH}
                data-w={isGame ? row.w : undefined}
                data-h={isGame ? row.h : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    commitNavigation(n.tool.slug);
                  }
                }}
              >
                {/* Transparent hit-target — the visible body (glow +
                    pixel core, or the cabinet for games) is painted on
                    the canvas below, where motion smears into phosphor
                    trails. The class gives keyboard focus a ring. */}
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
  const push = (0.05 + 0.1 * Math.min(1, m / 80)) * strength;
  if (m === dL) n.vx -= push;
  else if (m === dR) n.vx += push;
  else if (m === dT) n.vy -= push;
  else n.vy += push;
}

function step(
  nodes: Node[],
  bounds: Bounds,
  wobbleAmp: number,
  vCap: number,
  avoid: Zone | null,
  pad: number,
  zones: Zone[],
): number {
  if (nodes.length === 0) return 0;
  const now = performance.now();
  const floaters = nodes.filter((n) => !n.cabinet);

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
    }
  }

  const wobbleT = now * WOBBLE_RATE;
  const narrow = bounds.width < WORDMARK_NARROW_W;

  for (const n of floaters) {
    if (n.pinned) continue;
    // Gravity — toward the middle of the free band. The only attractor
    // in the system; the cursor doesn't influence it.
    n.vx += (bounds.cx - n.x) * CENTER_PULL;
    n.vy += (bounds.cy - n.y) * CENTER_PULL;
    // Idle wobble — long-period drift so the swarm feels alive at rest.
    if (wobbleAmp > 0) {
      n.vx += Math.sin(wobbleT + n.phase) * wobbleAmp;
      n.vy += Math.cos(wobbleT * 1.3 + n.phase * 1.7) * wobbleAmp;
    }
    // Marquee avoidance — a soft push out of the wordmark's rect along
    // the nearest edge, stronger the deeper the orb sits. Avoidance,
    // not a wall: drags and explode bursts pass through. Narrow rooms
    // get half the shove — porous, not a fence.
    if (avoid) pushOut(n, avoid, pad, narrow ? 0.5 : 1);
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
    if (n.vx > vCap) n.vx = vCap;
    else if (n.vx < -vCap) n.vx = -vCap;
    if (n.vy > vCap) n.vy = vCap;
    else if (n.vy < -vCap) n.vy = -vCap;
    n.x += n.vx;
    n.y += n.vy;
    // Walls — hit one, velocity reflects with energy loss. The sides
    // are measured from the LABEL, which is wider than the orb, so a
    // name never leaves the screen; the floor is the top of the arcade
    // row's band, minus room for the label underneath. The `vx < 0`
    // checks make sure we only invert on impact, never re-bounce a
    // node that gravity is already pulling away from the wall.
    const left = n.labelHalf + 6;
    const right = bounds.width - n.labelHalf - 6;
    const top = NODE_R + 6;
    const bottom = bounds.bottom - LABEL_OFFSET - 8;
    if (n.x < left) {
      n.x = left;
      if (n.vx < 0) n.vx = -n.vx * BOUNCE_DAMPING;
    } else if (n.x > right) {
      n.x = right;
      if (n.vx > 0) n.vx = -n.vx * BOUNCE_DAMPING;
    }
    if (n.y < top) {
      n.y = top;
      if (n.vy < 0) n.vy = -n.vy * BOUNCE_DAMPING;
    } else if (n.y > bottom) {
      n.y = bottom;
      if (n.vy > 0) n.vy = -n.vy * BOUNCE_DAMPING;
    }
  }
  return 0;
}
