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
// Physics — playful and bouncy.
//
// CENTER_PULL is the only attractor and it's deliberately weak — you
// can fling a dot all the way across the canvas and it'll travel
// before gravity reels it back. Walls bounce (BOUNCE_DAMPING below)
// so a strong throw ricochets a few times before settling.
const CENTER_PULL = 0.0008;
const REPEL = 4800;
const DAMPING = 0.96;
/** Velocity retained after bouncing off a wall. 0.6 = 60% kept,
 *  40% lost to the impact. Lower = more squishy, higher = more rubber. */
const BOUNCE_DAMPING = 0.6;
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
const RECLUSTER_BURST_SPEED = 9;
/** How aggressively the dragged node chases the cursor each frame. */
const DRAG_LERP = 0.5;
/** Hard cap on per-frame velocity — high enough that a fling carries. */
const MAX_V = 30;
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
      step(nodesRef.current, size.w, size.h, wobbleAmplitude);

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

  // External re-cluster trigger.
  const lastResetRef = useRef(resetTrigger);
  useEffect(() => {
    if (resetTrigger !== lastResetRef.current && initializedRef.current) {
      lastResetRef.current = resetTrigger;
      reset();
    }
  }, [resetTrigger, reset]);

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
            // Munch is a game, not a tool — render it bigger with a
            // pulsing outer ring so it reads as a different category
            // of thing on the map without needing a label or legend.
            const isMunch = n.tool.slug === "munch";
            const r = isMunch ? NODE_R * 1.5 : NODE_R;
            const labelY = isMunch ? r + 18 : LABEL_OFFSET;
            const emojiSize = isMunch ? 28 : 20;
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
                    setBouncingSlug(n.tool.slug);
                    triggerClickFx(n.tool.slug);
                    window.setTimeout(() => {
                      router.push(pathFor(n.tool.slug));
                    }, CLICK_BOUNCE_MS);
                  }
                }}
              >
                {/* Munch's pulsing live-multiplayer ring (under the
                    shadow so it radiates outward without lifting). */}
                {isMunch && (
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
                  strokeWidth={isHovered ? 3 : isMunch ? 3 : 2}
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
                  fontSize={isMunch ? 14 : 13}
                  fill="#1a1812"
                  pointerEvents="none"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    letterSpacing: isMunch ? "0.04em" : "-0.01em",
                    textTransform: isMunch ? "uppercase" : undefined,
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
            onClick={reset}
            className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            ↻ Re-cluster
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

function step(
  nodes: Node[],
  width: number,
  height: number,
  wobbleAmp: number,
): number {
  if (nodes.length === 0) return 0;
  const now = performance.now();

  // Mutual repulsion (O(n²)) — keeps labels from overlapping.
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

  const cx = width / 2;
  const cy = height / 2;
  const wobbleT = now * WOBBLE_RATE;

  for (const n of nodes) {
    if (n.pinned) continue;
    // Gravity — pulls every dot toward the canvas centre. The only
    // attractor in the system; cursor doesn't influence it.
    n.vx += (cx - n.x) * CENTER_PULL;
    n.vy += (cy - n.y) * CENTER_PULL;
    // Idle wobble — long-period drift so the swarm feels alive at rest.
    if (wobbleAmp > 0) {
      n.vx += Math.sin(wobbleT + n.phase) * wobbleAmp;
      n.vy += Math.cos(wobbleT * 1.3 + n.phase * 1.7) * wobbleAmp;
    }
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    if (n.vx > MAX_V) n.vx = MAX_V;
    else if (n.vx < -MAX_V) n.vx = -MAX_V;
    if (n.vy > MAX_V) n.vy = MAX_V;
    else if (n.vy < -MAX_V) n.vy = -MAX_V;
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
