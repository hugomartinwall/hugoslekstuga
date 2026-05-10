"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { tools, type Tool } from "@/lib/tools";
import { LINKS, neighboursOf } from "@/lib/links";
import {
  CLUSTERS,
  CLUSTER_ORDER,
  TOOL_CLUSTER,
  pathFor,
  preferredTextOnCluster,
  type ClusterId,
} from "@/lib/clusters";
import { COLOR_HEX, preferredTextHex } from "@/lib/colors";
import { clamp } from "@/lib/math";

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
  /** Smoothed display lean angle, in degrees. */
  lean: number;
  dragVx: number;
  dragVy: number;
  dragLastT: number;
  dragLastX: number;
  dragLastY: number;
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
// Physics tuned for the 16-node graph after a deep polish pass:
// - DAMPING raised (less drag) so motion lingers — the "glide" feel,
//   nodes don't snap to a stop when forces relax.
// - REPEL raised slightly so nodes have breathing room without
//   needing extra centre pull.
// - CENTER_PULL nudged up to give a clearer "weight toward the
//   middle" — the gravity feel.
// - WOBBLE_FORCE halved so idle motion is alive, not jittery.
// - MAX_V lowered so nothing whips across the canvas at once.
const TARGET_DIST = 170;
const SPRING_K = 0.028;
const REPEL = 2800;
const CENTER_PULL = 0.0055;
const DAMPING = 0.94;
const WOBBLE_FORCE = 0.025;
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
const CURSOR_MAGNET_RADIUS = 140;
const CURSOR_MAGNET_FORCE = 0.13;
const RECLUSTER_BURST_SPEED = 9;
// Lean (tilt) follows velocity, smoothed. Lower gain + lower max +
// longer lerp = calmer, more deliberate body language as nodes move.
const TILT_VELOCITY_GAIN = 1.0;
const TILT_MAX_DEG = 12;
const TILT_LERP = 0.15;
/** How aggressively the dragged node chases the cursor each frame. */
const DRAG_LERP = 0.5;
/** Hard cap on per-frame velocity. Lowered with the new lower damping
 *  so glide doesn't compound into a slingshot when forces stack. */
const MAX_V = 11;
const MIN_W = 320;
const MIN_H = 480;

type ToolMapProps = {
  /**
   * When true: drop the card styling (border, shadow, rounded corners,
   * background). Map fills its parent's box completely. Used by the
   * homepage where the map IS the page.
   */
  fullBleed?: boolean;
  /**
   * Increment to trigger a re-cluster from the parent. The page renders
   * its own re-cluster button positioned alongside the Surprise ball;
   * it pokes this counter to ask the map to scatter and re-form.
   */
  resetTrigger?: number;
};

export default function ToolMap({
  fullBleed = false,
  resetTrigger = 0,
}: ToolMapProps = {}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [, tick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeCluster, setActiveCluster] = useState<ClusterId | null>(null);
  const [bouncingSlug, setBouncingSlug] = useState<string | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const dragRef = useRef<Drag | null>(null);
  /** Cursor position over the SVG (null when outside or while dragging). */
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const initializedRef = useRef(false);
  const reduceMotionRef = useRef(false);

  const nodeBySlug = useRef<Map<string, Node>>(new Map());

  const neighbourMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of tools) m.set(t.slug, neighboursOf(t.slug));
    return m;
  }, []);

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

  useEffect(() => {
    if (initializedRef.current) return;
    if (size.w <= MIN_W && size.h <= MIN_H) return;
    initNodes(size.w, size.h, false);
  }, [size]);

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

  function initNodes(w: number, h: number, burst: boolean) {
    const cx = w / 2;
    const cy = h / 2;
    const burstSpeed = burst ? RECLUSTER_BURST_SPEED : 1.5;
    const innerJitter = burst ? 8 : 20;
    const now = performance.now();
    nodesRef.current = tools.map((t, i) => {
      const angle = (i / tools.length) * Math.PI * 2;
      return {
        tool: t,
        x: cx + (Math.random() - 0.5) * innerJitter,
        y: cy + (Math.random() - 0.5) * innerJitter,
        vx: Math.cos(angle) * burstSpeed,
        vy: Math.sin(angle) * burstSpeed,
        pinned: false,
        phase: Math.random() * Math.PI * 2,
        entranceStart: now + i * ENTRANCE_STAGGER,
        hasSparkled: false,
        lean: 0,
        dragVx: 0,
        dragVy: 0,
        dragLastT: 0,
        dragLastX: 0,
        dragLastY: 0,
      };
    });
    nodeBySlug.current = new Map(nodesRef.current.map((n) => [n.tool.slug, n]));
    particlesRef.current = [];
    ripplesRef.current = [];
    initializedRef.current = true;
    tick((c) => c + 1);
  }

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
      step(
        nodesRef.current,
        nodeBySlug.current,
        LINKS,
        size.w,
        size.h,
        wobbleAmplitude,
        dragRef.current === null,
        cursorRef.current,
        dragRef.current?.slug,
      );

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

      tick((c) => c + 1);
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

      // Don't snap the node's position here — that produces jitter when
      // pointer events fire irregularly between animation frames. Just
      // store the target; the raf loop will lerp the node toward it at
      // a fixed cadence.
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
        setBouncingSlug(drag.slug);
        triggerClickFx(drag.slug);
        window.setTimeout(() => {
          router.push(pathFor(drag.slug));
        }, CLICK_BOUNCE_MS);
      }
    },
    [router, triggerClickFx],
  );

  const reset = useCallback(() => {
    initializedRef.current = false;
    initNodes(size.w, size.h, true);
  }, [size.w, size.h]);

  // External re-cluster trigger — page increments resetTrigger and the map
  // shakes itself out. Skip the very first run (resetTrigger starts at 0
  // and we don't want to re-cluster on mount).
  const lastResetRef = useRef(resetTrigger);
  useEffect(() => {
    if (resetTrigger !== lastResetRef.current && initializedRef.current) {
      lastResetRef.current = resetTrigger;
      reset();
    }
  }, [resetTrigger, reset]);

  const hoveredNeighbours = hovered ? (neighbourMap.get(hovered) ?? new Set()) : null;
  const now = performance.now();

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
        {/* Edges */}
        <g>
          {LINKS.map(([from, to]) => {
            const a = nodeBySlug.current.get(from);
            const b = nodeBySlug.current.get(to);
            if (!a || !b) return null;
            const ent = Math.min(getEntrance(a, now), getEntrance(b, now));
            if (ent <= 0) return null;
            const isHi =
              hovered !== null && (hovered === from || hovered === to);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const stretch = Math.max(0, (d - TARGET_DIST) / TARGET_DIST);
            const tension = Math.min(1, stretch * 1.6);
            const cFrom = TOOL_CLUSTER[from];
            const cTo = TOOL_CLUSTER[to];
            const sameTheme = cFrom !== undefined && cFrom === cTo;
            const tintHex = sameTheme && cFrom ? CLUSTERS[cFrom].color : null;

            const clusterMatchA = activeCluster === null || cFrom === activeCluster;
            const clusterMatchB = activeCluster === null || cTo === activeCluster;
            const clusterMatchBoth = clusterMatchA && clusterMatchB;
            const clusterMatchEither = clusterMatchA || clusterMatchB;
            const clusterDim =
              activeCluster !== null
                ? clusterMatchBoth
                  ? 1
                  : clusterMatchEither
                    ? 0.18
                    : 0.05
                : 1;

            let stroke: string;
            let width: number;
            let baseOpacity: number;
            if (isHi) {
              stroke = "#1a1812";
              width = 2;
              baseOpacity = 1;
            } else if (tintHex) {
              const op = 0.32 + tension * 0.45;
              stroke = tintHex;
              width = 1.6 + tension * 2.2;
              baseOpacity = op;
            } else {
              const op = 0.14 + tension * 0.55;
              stroke = `rgba(26, 24, 18, 1)`;
              width = 1.2 + tension * 2.2;
              baseOpacity = op;
            }
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={width}
                strokeLinecap="round"
                pointerEvents="none"
                opacity={ent * baseOpacity * clusterDim}
              />
            );
          })}
        </g>

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
            const isNeighbour = hoveredNeighbours?.has(n.tool.slug);
            const cluster = TOOL_CLUSTER[n.tool.slug];
            const dimByHover = hovered !== null && !isHovered && !isNeighbour;
            const dimByCluster =
              activeCluster !== null && cluster !== activeCluster;
            const opacity = dimByCluster ? 0.28 : dimByHover ? 0.45 : 1;
            const entrance = getEntrance(n, now);
            const isBouncing = bouncingSlug === n.tool.slug;
            const isDragging = dragRef.current?.slug === n.tool.slug;
            const baseScale = entrance;
            const hoverScale = isHovered ? 1.12 : 1;
            const bounceScale = isBouncing ? 1.3 : 1;
            const scale = baseScale * hoverScale * bounceScale;

            // Velocity-driven lean: smoothly approach the target tilt.
            const sourceVx = isDragging ? n.dragVx : n.vx;
            const targetLean = clamp(
              sourceVx * TILT_VELOCITY_GAIN,
              -TILT_MAX_DEG,
              TILT_MAX_DEG,
            );
            n.lean = n.lean + (targetLean - n.lean) * TILT_LERP;

            return (
              <g
                key={n.tool.slug}
                transform={`translate(${n.x}, ${n.y}) rotate(${n.lean.toFixed(2)}) scale(${scale})`}
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
                    setBouncingSlug(n.tool.slug);
                    triggerClickFx(n.tool.slug);
                    window.setTimeout(() => {
                      router.push(pathFor(n.tool.slug));
                    }, CLICK_BOUNCE_MS);
                  }
                }}
              >
                {/* Solid drop shadow */}
                <circle cx={0} cy={SHADOW_DY} r={NODE_R} fill="#1a1812" opacity={0.85} />
                <circle
                  r={NODE_R}
                  fill={COLOR_HEX[n.tool.color]}
                  stroke="#1a1812"
                  strokeWidth={isHovered ? 3 : 2}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={20}
                  fill={preferredTextHex(n.tool.color)}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
                >
                  {n.tool.emoji}
                </text>
                {isHovered && entrance >= 1 && (
                  <g pointerEvents="none">
                    {/* Counter-rotate so the tooltip stays upright. */}
                    <g transform={`rotate(${(-n.lean).toFixed(2)})`}>
                      <rect
                        x={-90}
                        y={NODE_R + 14}
                        width={180}
                        height={48}
                        rx={10}
                        fill="#1a1812"
                      />
                      <text
                        x={0}
                        y={NODE_R + 32}
                        textAnchor="middle"
                        fill="#fbf6ee"
                        fontSize={13}
                        fontWeight={800}
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {n.tool.title}
                      </text>
                      <text
                        x={0}
                        y={NODE_R + 50}
                        textAnchor="middle"
                        fill="rgba(251, 246, 238, 0.75)"
                        fontSize={11}
                      >
                        {truncate(n.tool.tagline, 30)}
                      </text>
                    </g>
                  </g>
                )}
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
            onClick={reset}
            className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            ↻ Re-cluster
          </button>
        </div>
      )}

      {/* In fullBleed mode the page renders its own re-cluster button next
          to the Surprise ball, so we don't need an in-map control. */}

      {/* Cluster legend */}
      <div className="absolute inset-x-0 bottom-3 flex flex-wrap justify-center gap-1.5 px-3">
        {CLUSTER_ORDER.map((id) => {
          const c = CLUSTERS[id];
          const active = activeCluster === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setActiveCluster((cur) => (cur === id ? null : id))
              }
              className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-all"
              style={{
                background: active ? c.color : "rgba(251,246,238,0.92)",
                color: active ? preferredTextOnCluster(id) : "#1a1812",
                boxShadow: active ? "0 3px 0 0 #1a1812" : "none",
                transform: active ? "translateY(-1px)" : "none",
              }}
            >
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                style={{ background: c.color, border: "1px solid #1a1812" }}
              />
              {c.label}
            </button>
          );
        })}
      </div>
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

function step(
  nodes: Node[],
  byId: Map<string, Node>,
  links: typeof LINKS,
  width: number,
  height: number,
  wobbleAmp: number,
  applyWobble: boolean,
  cursor: { x: number; y: number } | null,
  draggedSlug: string | undefined,
): number {
  if (nodes.length === 0) return 0;
  const now = performance.now();

  // Repulsion (O(n²)).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const d = Math.sqrt(d2);
      const f = -REPEL / Math.max(d2, 100);
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

  // Springs.
  for (const [from, to] of links) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const f = (d - TARGET_DIST) * SPRING_K;
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

  // Cursor magnet — gentle attraction toward cursor for nearby unpinned nodes.
  // Only when no drag is active (avoids fighting the user).
  if (cursor !== null && draggedSlug === undefined) {
    for (const n of nodes) {
      if (n.pinned) continue;
      const dx = cursor.x - n.x;
      const dy = cursor.y - n.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 8 && d < CURSOR_MAGNET_RADIUS) {
        const t = 1 - d / CURSOR_MAGNET_RADIUS;
        const f = CURSOR_MAGNET_FORCE * t * t;
        n.vx += (dx / d) * f;
        n.vy += (dy / d) * f;
      }
    }
  }

  const cx = width / 2;
  const cy = height / 2;
  const wobbleT = now * 0.0008;
  let totalMotion = 0;
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * CENTER_PULL;
    n.vy += (cy - n.y) * CENTER_PULL;
    if (applyWobble && wobbleAmp > 0) {
      n.vx += Math.sin(wobbleT + n.phase) * wobbleAmp;
      n.vy += Math.cos(wobbleT * 1.3 + n.phase * 1.7) * wobbleAmp;
    }
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    // Clamp velocity so a sudden force spike (e.g. a dragged node landing
    // right next to a stationary one) can't fling neighbours across the
    // canvas in a single frame.
    if (n.vx > MAX_V) n.vx = MAX_V;
    else if (n.vx < -MAX_V) n.vx = -MAX_V;
    if (n.vy > MAX_V) n.vy = MAX_V;
    else if (n.vy < -MAX_V) n.vy = -MAX_V;
    n.x += n.vx;
    n.y += n.vy;
    n.x = clamp(n.x, NODE_R + 4, width - NODE_R - 4);
    n.y = clamp(n.y, NODE_R + 4, height - NODE_R - 4);
    totalMotion += Math.abs(n.vx) + Math.abs(n.vy);
  }
  return totalMotion;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
