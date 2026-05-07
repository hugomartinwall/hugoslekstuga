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
import { tools, type Tool, type ToolColor } from "@/lib/tools";
import { LINKS, neighboursOf } from "@/lib/links";
import {
  CLUSTERS,
  CLUSTER_ORDER,
  TOOL_CLUSTER,
  type ClusterId,
} from "@/lib/clusters";

const COLOR_HEX: Record<ToolColor, string> = {
  tomato: "#ff5a3c",
  blue: "#4f66f2",
  yellow: "#ffc233",
  pink: "#ff7ab2",
  green: "#3fa66e",
  purple: "#9333ea",
  orange: "#f97316",
  teal: "#0d9488",
};

const COLOR_TEXT: Record<ToolColor, string> = {
  tomato: "#fbf6ee",
  blue: "#fbf6ee",
  yellow: "#1a1812",
  pink: "#1a1812",
  green: "#fbf6ee",
  purple: "#fbf6ee",
  orange: "#fbf6ee",
  teal: "#fbf6ee",
};

type Node = {
  tool: Tool;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  phase: number;
  entranceStart: number;
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
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0..1, decays
  color: string;
  size: number;
};

type Ripple = {
  x: number;
  y: number;
  start: number; // ms
  color: string;
};

const NODE_R = 26;
const SHADOW_DY = 4;
const TARGET_DIST = 110;
const SPRING_K = 0.05;
const REPEL = 2800;
const CENTER_PULL = 0.0035;
const DAMPING = 0.85;
const WOBBLE_FORCE = 0.05;
const ENTRANCE_DURATION = 420;
const ENTRANCE_STAGGER = 30;
const CLICK_BOUNCE_MS = 240;
const RIPPLE_DURATION = 600;
const PARTICLE_LIFE_DECAY = 0.022;
const PARTICLE_GRAVITY = 0.06;
const PARTICLE_FRICTION = 0.93;
const MIN_W = 320;
const MIN_H = 480;

export default function ToolMap() {
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
    initNodes(size.w, size.h);
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

  function initNodes(w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.28;
    const now = performance.now();
    nodesRef.current = tools.map((t, i) => {
      const angle = (i / tools.length) * Math.PI * 2;
      return {
        tool: t,
        x: cx + Math.cos(angle) * (r * 0.2) + (Math.random() - 0.5) * 20,
        y: cy + Math.sin(angle) * (r * 0.2) + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * 1.5,
        vy: Math.sin(angle) * 1.5,
        pinned: false,
        phase: Math.random() * Math.PI * 2,
        entranceStart: now + i * ENTRANCE_STAGGER,
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

  // Simulation loop: physics + particles + ripples.
  useEffect(() => {
    if (!initializedRef.current) return;
    let raf = 0;
    const loop = () => {
      const wobbleAmplitude = reduceMotionRef.current ? 0 : WOBBLE_FORCE;
      step(
        nodesRef.current,
        nodeBySlug.current,
        LINKS,
        size.w,
        size.h,
        wobbleAmplitude,
        dragRef.current === null,
      );
      // Tick particles.
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= PARTICLE_FRICTION;
        p.vy *= PARTICLE_FRICTION;
        p.vy += PARTICLE_GRAVITY;
        p.life -= PARTICLE_LIFE_DECAY;
        if (p.life <= 0) ps.splice(i, 1);
      }
      // Cull old ripples.
      const now = performance.now();
      ripplesRef.current = ripplesRef.current.filter(
        (r) => now - r.start < RIPPLE_DURATION,
      );
      tick((c) => c + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

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

  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      const node = nodeBySlug.current.get(drag.slug);
      if (!node) return;
      const rect = containerRef.current!.getBoundingClientRect();
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

      const now = performance.now();
      const dt = Math.max(8, now - node.dragLastT);
      node.dragVx = ((newX - node.dragLastX) / dt) * 16;
      node.dragVy = ((newY - node.dragLastY) / dt) * 16;
      node.dragLastT = now;
      node.dragLastX = newX;
      node.dragLastY = newY;

      node.x = newX;
      node.y = newY;
    },
    [size.w, size.h],
  );

  const triggerClickFx = useCallback((slug: string) => {
    const node = nodeBySlug.current.get(slug);
    if (!node) return;
    const color = COLOR_HEX[node.tool.color];
    // Ripple
    ripplesRef.current.push({
      x: node.x,
      y: node.y,
      start: performance.now(),
      color,
    });
    // Particles
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 3;
      particlesRef.current.push({
        x: node.x,
        y: node.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1, // slight upward bias
        life: 1,
        color,
        size: 3 + Math.random() * 3,
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
          router.push(`/tools/${drag.slug}`);
        }, CLICK_BOUNCE_MS);
      }
    },
    [router, triggerClickFx],
  );

  const reset = useCallback(() => {
    initializedRef.current = false;
    initNodes(size.w, size.h);
  }, [size.w, size.h]);

  const hoveredNeighbours = hovered ? (neighbourMap.get(hovered) ?? new Set()) : null;
  const now = performance.now();

  return (
    <div
      ref={containerRef}
      className="card-chunk relative w-full overflow-hidden rounded-[var(--radius-card)] bg-cream"
      style={{ height: "min(80vh, 720px)", minHeight: "480px" }}
    >
      <svg
        width={size.w}
        height={size.h}
        onPointerMove={onSvgPointerMove}
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

            // Cluster filter dimming
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

        {/* Click ripples (under nodes) */}
        <g pointerEvents="none">
          {ripplesRef.current.map((r, i) => {
            const t = (now - r.start) / RIPPLE_DURATION;
            if (t >= 1) return null;
            const eased = 1 - Math.pow(1 - t, 2);
            const radius = NODE_R + eased * NODE_R * 2.5;
            const opacity = (1 - t) * 0.6;
            return (
              <circle
                key={`ripple-${i}-${r.start}`}
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
            const baseScale = entrance;
            const hoverScale = isHovered ? 1.12 : 1;
            const bounceScale = isBouncing ? 1.3 : 1;
            const scale = baseScale * hoverScale * bounceScale;
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
                      router.push(`/tools/${n.tool.slug}`);
                    }, CLICK_BOUNCE_MS);
                  }
                }}
              >
                {/* Solid drop shadow — chunky brand style. */}
                <circle
                  cx={0}
                  cy={SHADOW_DY}
                  r={NODE_R}
                  fill="#1a1812"
                  opacity={0.85}
                />
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
                  fill={COLOR_TEXT[n.tool.color]}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
                >
                  {n.tool.emoji}
                </text>
                {isHovered && entrance >= 1 && (
                  <g pointerEvents="none">
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
              stroke="#1a1812"
              strokeWidth={1}
              opacity={Math.max(0, p.life)}
            />
          ))}
        </g>
      </svg>

      {/* Top-right control */}
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

      {/* Cluster legend */}
      <div className="absolute inset-x-0 bottom-3 flex flex-wrap justify-center gap-1.5 px-3">
        {CLUSTER_ORDER.map((id) => {
          const c = CLUSTERS[id];
          const active = activeCluster === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                setActiveCluster((cur) => (cur === id ? null : id))
              }
              className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-all"
              style={{
                background: active ? c.color : "rgba(251,246,238,0.92)",
                color: active
                  ? id === "time" || id === "creative"
                    ? "#1a1812"
                    : "#fbf6ee"
                  : "#1a1812",
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

function step(
  nodes: Node[],
  byId: Map<string, Node>,
  links: typeof LINKS,
  width: number,
  height: number,
  wobbleAmp: number,
  applyWobble: boolean,
): number {
  if (nodes.length === 0) return 0;
  const now = performance.now();

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
    n.x += n.vx;
    n.y += n.vy;
    n.x = clamp(n.x, NODE_R + 4, width - NODE_R - 4);
    n.y = clamp(n.y, NODE_R + 4, height - NODE_R - 4);
    totalMotion += Math.abs(n.vx) + Math.abs(n.vy);
  }
  return totalMotion;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
