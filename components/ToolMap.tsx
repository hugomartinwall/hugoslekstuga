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
import { pathFor } from "@/lib/clusters";
import { COLOR_HEX, preferredTextHex } from "@/lib/colors";
import { clamp } from "@/lib/math";

/**
 * Free-floating swarm of tool dots.
 *
 * No edges, no clusters, no legend. Each dot shows its name underneath
 * so you don't have to hover to read it. Physics is just three forces:
 *
 *   1. centre pull   — gentle gravity toward the canvas centre
 *   2. cursor pull   — when your cursor is on the canvas, dots are
 *                      drawn toward it as well (the "interactive
 *                      gravity"). Move your mouse, the swarm leans;
 *                      move it off, the swarm drifts back to centre.
 *   3. mutual repel  — dots push apart so labels don't overlap.
 *
 * Plus drag-to-fling, click-to-open, idle wobble.
 */

/**
 * Anchored "nav" roles. These dots float in the swarm but pull
 * toward fixed anchor points along the top edge instead of the
 * canvas centre, and click-routes to navigation actions rather than
 * a tool page. They replace the old top-nav links.
 */
type AnchorRole = "search" | "about";

type Node = {
  tool: Tool;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  phase: number;
  entranceStart: number;
  hasSparkled: boolean;
  dragVx: number;
  dragVy: number;
  dragLastT: number;
  dragLastX: number;
  dragLastY: number;
  /** Anchored "nav" role — present only for the two pseudo-tool
   *  dots that live up top (Search and About). When set, gravity
   *  targets this node's own anchor instead of the canvas centre,
   *  and click-handling routes to a palette / route instead of a
   *  tool page. */
  role?: AnchorRole;
};

type Drag = {
  slug: string;
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
const SHADOW_DY = 4;
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
 * Physics constants are tuned for a ~400px canvas — what you get on
 * mobile portrait. At larger canvases the absolute pull becomes
 * proportionally too gentle and the swarm clusters into a small puddle
 * in the corner instead of filling the canvas. PHYSICS_BASELINE is the
 * canvas size where the constants below feel right; on bigger canvases
 * we scale REPEL up (so dots push each other apart further) and
 * CENTER_PULL down (so gravity doesn't keep them packed). The end
 * result: the swarm fills 60–80% of the viewport at any size.
 */
const PHYSICS_BASELINE = 400;
const CENTER_PULL = 0.0003;
const REPEL = 100;
/** Anchored nav dots get a much stronger pull toward their own
 *  anchor than tool dots get toward the canvas centre — they stay
 *  perched up top even as the swarm jostles them. */
const ANCHOR_PULL = 0.008;

/**
 * The two top-edge "nav" pseudo-tools — Search opens the ⌘K palette
 * (no route push), About goes to /about. They render as ordinary
 * swarm dots so they read as part of the playhouse, but their
 * physics anchors them to fixed spots along the top.
 */
const ANCHOR_TOOLS: Record<AnchorRole, Tool> = {
  search: {
    slug: "$search",
    title: "Search",
    tagline: "Find a tool by name.",
    description: "Opens the ⌘K palette — type to filter every tool.",
    color: "yellow",
    emoji: "⌕",
  },
  about: {
    slug: "$about",
    title: "About",
    tagline: "What this place is.",
    description: "The story, the rules, the things you won't find here.",
    color: "pink",
    emoji: "i",
  },
};

/** Anchor coordinates for each nav dot. Computed from canvas size so
 *  the dots track viewport resizes. Search sits left-of-centre along
 *  the top; About sits right-of-centre. y=110 puts the dot's top edge
 *  at ~84, comfortably below the ~68px corner buttons and Hugo's
 *  ~55px brand mark — at 375px viewport the old y=70 packed the
 *  anchored dots side-by-side with the Explode / Surprise pills. */
function anchorPos(role: AnchorRole, w: number): { x: number; y: number } {
  const y = 110;
  if (role === "search") {
    return { x: Math.max(140, Math.min(w * 0.34, w - 280)), y };
  }
  return { x: Math.max(220, Math.min(w * 0.66, w - 160)), y };
}
const DAMPING = 0.92;
/** Velocity retained after bouncing off a wall. 0.45 = 45% kept —
 *  enough to register as a bounce, soft enough not to feel rubbery. */
const BOUNCE_DAMPING = 0.45;
const WOBBLE_FORCE = 0.012;
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
   * When true: drop the card styling (border, shadow, rounded corners,
   * background). Map fills its parent's box completely. Used by the
   * homepage where the map IS the page.
   */
  fullBleed?: boolean;
  /**
   * Increment to trigger an explosion from the parent. The page
   * renders its own explode button positioned alongside the Surprise
   * ball; it pokes this counter and every dot is flung outward from
   * the centre, confetti scatters, gravity pulls everything home.
   */
  explodeTrigger?: number;
};

export default function ToolMap({
  fullBleed = false,
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
  /** Tracks whether the last frame had a tool active (hovered or
   *  dragged) so we know when to dispatch the null event signalling
   *  end-of-hover to BrandDot. */
  const wasToolActiveRef = useRef(false);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const r = containerRef.current!.getBoundingClientRect();
      const w = Math.max(MIN_W, r.width);
      const h = Math.max(MIN_H, r.height);
      setSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
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
    const cx = actualW / 2;
    const cy = actualH / 2;
    const t0 = performance.now();
    nodesRef.current = tools.map((t, i) => {
      const angle = (i / tools.length) * Math.PI * 2;
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
      };
    });
    // Spawn the two anchored nav dots near their final positions so
    // they don't drift in from the centre on mount. Their gravity to
    // the anchor still settles them precisely.
    const anchorRoles: AnchorRole[] = ["search", "about"];
    anchorRoles.forEach((role, i) => {
      const a = anchorPos(role, actualW);
      nodesRef.current.push({
        tool: ANCHOR_TOOLS[role],
        x: a.x,
        y: a.y,
        vx: 0,
        vy: 0,
        pinned: false,
        phase: Math.random() * Math.PI * 2,
        entranceStart: t0 + (tools.length + i) * ENTRANCE_STAGGER,
        hasSparkled: false,
        dragVx: 0,
        dragVy: 0,
        dragLastT: 0,
        dragLastX: 0,
        dragLastY: 0,
        role,
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
      const candidates = nodesRef.current.filter((n) => !n.pinned);
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
    const loop = () => {
      // Smooth-drag: chase the pointer target at a fixed cadence so the
      // node moves at one pixel-rate regardless of how often pointermove
      // fires. This is what eliminates the jittery teleport-feel.
      const drag = dragRef.current;
      if (drag) {
        const dragNode = nodeBySlug.current.get(drag.slug);
        if (dragNode) {
          dragNode.x += (drag.targetX - dragNode.x) * DRAG_LERP;
          dragNode.y += (drag.targetY - dragNode.y) * DRAG_LERP;
        }
      }

      const wobbleAmplitude = reduceMotionRef.current ? 0 : WOBBLE_FORCE;
      const inExplode =
        explodeAtRef.current > 0 &&
        performance.now() - explodeAtRef.current < EXPLODE_WINDOW_MS;
      const vCap = inExplode ? EXPLODE_MAX_V : MAX_V;
      step(nodesRef.current, size.w, size.h, wobbleAmplitude, vCap);

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
              detail: { x: rect.left + node.x, y: rect.top + node.y },
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
      const newX = clamp(localX - drag.offsetX, NODE_R, size.w - NODE_R);
      const newY = clamp(localY - drag.offsetY, NODE_R, size.h - NODE_R);

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
      dragRef.current = {
        slug,
        pointerId: e.pointerId,
        startX: localX,
        startY: localY,
        offsetX: localX - node.x,
        offsetY: localY - node.y,
        moved: false,
        targetX: node.x,
        targetY: node.y,
      };
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
      const node = nodeBySlug.current.get(slug);
      if (!node) return;
      setBouncingSlug(slug);
      triggerClickFx(slug);
      // Special anchored nav dots: Search opens the ⌘K palette
      // (no flight, no route push), About navigates to /about with
      // the standard Hugo fetch.
      if (node.role === "search") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:open-search"),
          );
        }
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      const navDot = document.querySelector<HTMLElement>("[data-brand-dot]");
      // About uses a fixed pathname rather than pathFor(slug).
      const targetPath =
        node.role === "about" ? "/about" : pathFor(slug);
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
      if (node) {
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
      size.h / 2,
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
      className={
        fullBleed
          ? "relative h-full w-full overflow-hidden"
          : "card-chunk relative w-full overflow-hidden rounded-[var(--radius-card)] bg-cream"
      }
      style={
        fullBleed ? undefined : { height: "min(80vh, 720px)", minHeight: "480px" }
      }
    >
      <svg
        width={size.w}
        height={size.h}
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={onCanvasPointerLeave}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerUp}
        style={{ touchAction: "none", userSelect: "none" }}
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

        {/* Nodes */}
        <g>
          {nodesRef.current.map((n) => {
            const isHovered = hovered === n.tool.slug;
            const dim = hovered !== null && !isHovered;
            const opacity = dim ? 0.55 : 1;
            const entrance = getEntrance(n, now);
            const isBouncing = bouncingSlug === n.tool.slug;
            const baseScale = entrance;
            const hoverScale = isHovered ? 1.08 : 1;
            const bounceScale = isBouncing ? 1.3 : 1;
            const scale = baseScale * hoverScale * bounceScale;
            // Games (munch, noodle) are a different category of thing
            // — render them bigger with a pulsing outer ring so they
            // read as games at a glance without needing a legend.
            const isGame = n.tool.slug === "munch" || n.tool.slug === "noodle";
            const r = isGame ? NODE_R * 1.5 : NODE_R;
            const labelY = isGame ? r + 18 : LABEL_OFFSET;
            const emojiSize = isGame ? 28 : 20;
            const color = COLOR_HEX[n.tool.color];

            return (
              <g
                key={n.tool.slug}
                transform={`translate(${n.x}, ${n.y}) scale(${scale})`}
                onPointerDown={(e) => onSvgPointerDown(e, n.tool.slug)}
                onPointerEnter={() => setHovered(n.tool.slug)}
                onPointerLeave={() => setHovered((h) => (h === n.tool.slug ? null : h))}
                style={{
                  cursor: dragRef.current ? "grabbing" : "pointer",
                  opacity,
                  transition: "opacity 220ms ease",
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${n.tool.title}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    commitNavigation(n.tool.slug);
                  }
                }}
              >
                {/* Munch's pulsing live-multiplayer ring (under the
                    shadow so it radiates outward without lifting). */}
                {isGame && (
                  <circle
                    cx={0}
                    cy={0}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.55}
                  >
                    <animate
                      attributeName="r"
                      values={`${r};${r * 1.55}`}
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.55;0"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                {/* Solid drop shadow */}
                <circle cx={0} cy={SHADOW_DY} r={r} fill="#1a1812" opacity={0.85} />
                <circle
                  r={r}
                  fill={color}
                  stroke="#1a1812"
                  strokeWidth={isHovered ? 3 : isGame ? 3 : 2}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={emojiSize}
                  fill={preferredTextHex(n.tool.color)}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
                >
                  {n.tool.emoji}
                </text>
                {/* Always-visible name label below the dot */}
                <text
                  y={labelY}
                  textAnchor="middle"
                  fontSize={isGame ? 14 : 13}
                  fill="#1a1812"
                  pointerEvents="none"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    letterSpacing: isGame ? "0.04em" : "-0.01em",
                    textTransform: isGame ? "uppercase" : undefined,
                  }}
                >
                  {n.tool.title}
                </text>
              </g>
            );
          })}
        </g>

        {/* Particles (over nodes) */}
        <g pointerEvents="none">
          {particlesRef.current.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.size * Math.max(0, p.life)}
              fill={p.color}
              stroke={p.kind === "click" ? "#1a1812" : "none"}
              strokeWidth={p.kind === "click" ? 1 : 0}
              opacity={Math.max(0, p.life)}
            />
          ))}
        </g>
      </svg>

      {/* Top controls — only when card-styled. In fullBleed mode the page
          owns the top zone and provides its own hero / controls. */}
      {!fullBleed && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-between gap-3 px-3 sm:px-5">
          <p className="pointer-events-none rounded-full border-2 border-ink bg-cream/90 px-3 py-1 text-xs font-semibold text-ink-soft backdrop-blur">
            Drag a tool · click to open
          </p>
          <button
            type="button"
            onClick={explode}
            className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            ✸ Explode
          </button>
        </div>
      )}
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
      color: "#fbf6ee",
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
  for (const n of nodes) {
    if (n.pinned) continue;
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

function step(
  nodes: Node[],
  width: number,
  height: number,
  wobbleAmp: number,
  vCap: number,
): number {
  if (nodes.length === 0) return 0;
  const now = performance.now();

  // Scale physics by the smallest canvas dimension. At the baseline
  // (~400px = mobile portrait) scale is 1 and behaviour matches what
  // the existing constants were tuned for. On a 1280×800 desktop the
  // canvas height (728 after nav) is the constraint → scale ≈ 1.82.
  //
  // Equilibrium pair distance for a centre-pull / repel system scales
  // as cube-root(repel / centre_pull). To make the swarm equilibrium
  // grow roughly *linearly* with canvas size we need repel/centre_pull
  // to scale by scale³. We split it: repel grows by scale³, centre_pull
  // shrinks by scale². End result on desktop: ~6× repel, ~1/3 centre
  // pull — the swarm spreads to fill instead of puddling.
  const scale = Math.max(1, Math.min(width, height) / PHYSICS_BASELINE);
  const scale2 = scale * scale;
  const scale3 = scale2 * scale;
  const repelScaled = REPEL * scale3;
  const centerPullScaled = CENTER_PULL / scale2;

  // Mutual repulsion (O(n²)) — keeps labels from overlapping.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const d = Math.sqrt(d2);
      const f = -repelScaled / Math.max(d2, 100);
      const fx = (dx / d) * f;
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

  const cx = width / 2;
  const cy = height / 2;
  const wobbleT = now * WOBBLE_RATE;

  for (const n of nodes) {
    if (n.pinned) continue;
    if (n.role) {
      // Anchored nav dot — strong pull to its own top-edge anchor,
      // no idle wobble. It still participates in mutual repel so
      // tool dots give it room.
      const a = anchorPos(n.role, width);
      n.vx += (a.x - n.x) * ANCHOR_PULL;
      n.vy += (a.y - n.y) * ANCHOR_PULL;
    } else {
      // Gravity — tool dots pull toward the canvas centre. The only
      // attractor in the system; cursor doesn't influence it.
      n.vx += (cx - n.x) * centerPullScaled;
      n.vy += (cy - n.y) * centerPullScaled;
      // Idle wobble — long-period drift so the swarm feels alive at rest.
      if (wobbleAmp > 0) {
        n.vx += Math.sin(wobbleT + n.phase) * wobbleAmp;
        n.vy += Math.cos(wobbleT * 1.3 + n.phase * 1.7) * wobbleAmp;
      }
    }
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    if (n.vx > vCap) n.vx = vCap;
    else if (n.vx < -vCap) n.vx = -vCap;
    if (n.vy > vCap) n.vy = vCap;
    else if (n.vy < -vCap) n.vy = -vCap;
    n.x += n.vx;
    n.y += n.vy;
    // Wall bounce — hit a side, velocity reflects with energy loss.
    // The `vx < 0` checks make sure we only invert on impact, never
    // re-bounce a node that gravity is already pulling away from
    // the wall.
    const left = NODE_R + 4;
    const right = width - NODE_R - 4;
    const top = NODE_R + 4;
    // Extra bottom room so labels aren't clipped.
    const bottom = height - LABEL_OFFSET - 12;
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
