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

const NODE_R = 26;
const TARGET_DIST = 110;
const SPRING_K = 0.05;
const REPEL = 2800;
const CENTER_PULL = 0.0035;
const DAMPING = 0.85;
const MIN_W = 320;
const MIN_H = 480;

export default function ToolMap() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [, tick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const initializedRef = useRef(false);
  const reduceMotionRef = useRef(false);

  // Map slugs to node refs for fast lookup during sim.
  const nodeBySlug = useRef<Map<string, Node>>(new Map());

  const neighbourMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of tools) m.set(t.slug, neighboursOf(t.slug));
    return m;
  }, []);

  // Initial measure + resize observer.
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

  // Initialize nodes once we have a real size.
  useEffect(() => {
    if (initializedRef.current) return;
    if (size.w <= MIN_W && size.h <= MIN_H) return;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.min(size.w, size.h) * 0.32;
    nodesRef.current = tools.map((t, i) => {
      const angle = (i / tools.length) * Math.PI * 2;
      return {
        tool: t,
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    });
    nodeBySlug.current = new Map(nodesRef.current.map((n) => [n.tool.slug, n]));
    initializedRef.current = true;
    tick((c) => c + 1);
  }, [size]);

  // Detect reduced motion preference.
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

  // Simulation loop.
  useEffect(() => {
    if (!initializedRef.current) return;
    let raf = 0;
    let settledFrames = 0;
    const loop = () => {
      const moved = step(nodesRef.current, nodeBySlug.current, LINKS, size.w, size.h);
      // If the cumulative motion is small for many frames, slow down updates.
      if (moved < 0.5 && dragRef.current === null) {
        settledFrames++;
      } else {
        settledFrames = 0;
      }
      // After ~200 settled frames (~3.3s), pause re-renders until something changes.
      if (settledFrames < 200 || reduceMotionRef.current === false) {
        tick((c) => c + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  // Pointer handling on the SVG.
  const onSvgPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>, slug: string) => {
      const node = nodeBySlug.current.get(slug);
      if (!node) return;
      const rect = containerRef.current!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
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
      node.x = clamp(localX - drag.offsetX, NODE_R, size.w - NODE_R);
      node.y = clamp(localY - drag.offsetY, NODE_R, size.h - NODE_R);
    },
    [size.w, size.h],
  );

  const onSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore — already released
      }
      const node = nodeBySlug.current.get(drag.slug);
      if (node) node.pinned = false;
      const wasClick = !drag.moved;
      dragRef.current = null;
      if (wasClick) {
        router.push(`/tools/${drag.slug}`);
      }
    },
    [router],
  );

  const reset = useCallback(() => {
    if (!initializedRef.current) return;
    initializedRef.current = false;
    setSize((s) => ({ ...s }));
    // Trigger re-init via the size effect by toggling a state.
    setTimeout(() => {
      const cx = size.w / 2;
      const cy = size.h / 2;
      const r = Math.min(size.w, size.h) * 0.32;
      nodesRef.current = tools.map((t, i) => {
        const angle = (i / tools.length) * Math.PI * 2;
        return {
          tool: t,
          x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30,
          y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
          pinned: false,
        };
      });
      nodeBySlug.current = new Map(nodesRef.current.map((n) => [n.tool.slug, n]));
      initializedRef.current = true;
      tick((c) => c + 1);
    }, 0);
  }, [size.w, size.h]);

  const hoveredNeighbours = hovered ? (neighbourMap.get(hovered) ?? new Set()) : null;

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
            const isHi =
              hovered !== null &&
              (hovered === from ||
                hovered === to);
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isHi ? "#1a1812" : "rgba(26, 24, 18, 0.18)"}
                strokeWidth={isHi ? 2 : 1.4}
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodesRef.current.map((n) => {
            const isHovered = hovered === n.tool.slug;
            const isNeighbour = hoveredNeighbours?.has(n.tool.slug);
            const dim = hovered !== null && !isHovered && !isNeighbour;
            const r = isHovered ? NODE_R + 4 : NODE_R;
            return (
              <g
                key={n.tool.slug}
                transform={`translate(${n.x}, ${n.y})`}
                onPointerDown={(e) => onSvgPointerDown(e as unknown as React.PointerEvent<SVGSVGElement>, n.tool.slug)}
                onPointerEnter={() => setHovered(n.tool.slug)}
                onPointerLeave={() => setHovered((h) => (h === n.tool.slug ? null : h))}
                style={{ cursor: dragRef.current ? "grabbing" : "pointer", opacity: dim ? 0.4 : 1, transition: "opacity 180ms ease" }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${n.tool.title}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/tools/${n.tool.slug}`);
                  }
                }}
              >
                <circle
                  r={r}
                  fill={COLOR_HEX[n.tool.color]}
                  stroke="#1a1812"
                  strokeWidth={isHovered ? 3 : 2}
                  style={{ transition: "r 200ms ease" }}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={isHovered ? 22 : 18}
                  fill={COLOR_TEXT[n.tool.color]}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
                >
                  {n.tool.emoji}
                </text>
                {/* Tooltip on hover */}
                {isHovered && (
                  <g pointerEvents="none">
                    <rect
                      x={-90}
                      y={NODE_R + 12}
                      width={180}
                      height={48}
                      rx={10}
                      fill="#1a1812"
                    />
                    <text
                      x={0}
                      y={NODE_R + 30}
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
                      y={NODE_R + 48}
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
      </svg>

      {/* Floating controls */}
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
    </div>
  );
}

function step(
  nodes: Node[],
  byId: Map<string, Node>,
  links: typeof LINKS,
  width: number,
  height: number,
): number {
  if (nodes.length === 0) return 0;

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

  // Springs along edges.
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

  // Centring + damping + integration.
  const cx = width / 2;
  const cy = height / 2;
  let totalMotion = 0;
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * CENTER_PULL;
    n.vy += (cy - n.y) * CENTER_PULL;
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
