"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:easing:state";

type State = { x1: number; y1: number; x2: number; y2: number };

const DEFAULT: State = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };

const PRESETS: { name: string; state: State }[] = [
  { name: "linear", state: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { name: "ease", state: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
  { name: "ease-in", state: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { name: "ease-out", state: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { name: "ease-in-out", state: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { name: "playful", state: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
  { name: "anticipate", state: { x1: 0.7, y1: -0.4, x2: 0.4, y2: 1 } },
  { name: "snap", state: { x1: 0.85, y1: 0, x2: 0.15, y2: 1 } },
];

const W = 280;
const H = 280;
const PAD = 30;

// Convert (x in [0,1], y in [-0.5, 1.5]) to canvas coords
function toScreen(x: number, y: number): { sx: number; sy: number } {
  const sx = PAD + x * (W - 2 * PAD);
  // y goes top-down, but we want 0 at the bottom
  const yMin = -0.5;
  const yMax = 1.5;
  const t = (y - yMin) / (yMax - yMin);
  const sy = H - PAD - t * (H - 2 * PAD);
  return { sx, sy };
}

function fromScreen(sx: number, sy: number): { x: number; y: number } {
  const x = (sx - PAD) / (W - 2 * PAD);
  const yMin = -0.5;
  const yMax = 1.5;
  const t = (H - PAD - sy) / (H - 2 * PAD);
  const y = yMin + t * (yMax - yMin);
  return {
    x: Math.max(0, Math.min(1, x)),
    y,
  };
}

// Cubic bezier with start point (0,0) and end point (1,1). The control
// points (x1,y1) and (x2,y2) define the curve. Both axes use the same
// shape; pass either pair of x-values (or y-values) to evaluate that axis.
function bezierAt(t: number, c1: number, c2: number): number {
  const c = 3 * c1;
  const b = 3 * (c2 - c1) - c;
  const a = 1 - c - b;
  return ((a * t + b) * t + c) * t;
}

function bezierDerivAt(t: number, c1: number, c2: number): number {
  const c = 3 * c1;
  const b = 3 * (c2 - c1) - c;
  const a = 1 - c - b;
  return (3 * a * t + 2 * b) * t + c;
}

/**
 * CSS easing curves are parameterised by *time on the x-axis*, but the
 * underlying bezier is parameterised by t. To get the real visual y
 * value at time x, we have to first solve x(t) = x for t — Newton-Raphson
 * converges in 3-5 iterations on these tame curves. Without this, the
 * in-page preview disagrees with how a browser actually animates the
 * easing for asymmetric curves.
 */
function easeY(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xt = bezierAt(t, x1, x2);
    const dx = bezierDerivAt(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    const next = t - (xt - x) / dx;
    if (Math.abs(next - t) < 1e-5) {
      t = next;
      break;
    }
    t = next;
  }
  return bezierAt(Math.max(0, Math.min(1, t)), y1, y2);
}

export default function EasingPage() {
  const tool = findTool("easing")!;
  const [state, setState] = useState<State>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const draggingRef = useRef<"p1" | "p2" | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (typeof parsed.x1 === "number") setState(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const css = useMemo(
    () =>
      `cubic-bezier(${state.x1.toFixed(2)}, ${state.y1.toFixed(2)}, ${state.x2.toFixed(2)}, ${state.y2.toFixed(2)})`,
    [state],
  );

  const onPointerDown = (handle: "p1" | "p2") => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = handle;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const handle = draggingRef.current;
    if (!handle || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    const { x, y } = fromScreen(sx, sy);
    if (handle === "p1") setState((s) => ({ ...s, x1: x, y1: y }));
    else setState((s) => ({ ...s, x2: x, y2: y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const play = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    setProgress(0);
    const start = performance.now();
    const dur = 1400;
    const step = (t: number) => {
      const e = (t - start) / dur;
      if (e >= 1) {
        setProgress(1);
        setPlaying(false);
        return;
      }
      setProgress(e);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [playing]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  // Build the SVG bezier path
  const start = toScreen(0, 0);
  const end = toScreen(1, 1);
  const c1 = toScreen(state.x1, state.y1);
  const c2 = toScreen(state.x2, state.y2);
  const path = `M ${start.sx} ${start.sy} C ${c1.sx} ${c1.sy}, ${c2.sx} ${c2.sy}, ${end.sx} ${end.sy}`;

  // Animated dot — use the easing
  const eased = easeY(progress, state.x1, state.y1, state.x2, state.y2);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-cream p-4 sm:flex-row sm:items-stretch">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="touch-none"
          >
            {/* Background grid */}
            <rect
              x={PAD}
              y={PAD}
              width={W - 2 * PAD}
              height={H - 2 * PAD}
              fill="#f5ecdb"
              stroke="#1a1812"
              strokeWidth={2}
            />
            {/* Y=0 and Y=1 reference lines */}
            <line
              x1={PAD}
              y1={toScreen(0, 0).sy}
              x2={W - PAD}
              y2={toScreen(0, 0).sy}
              stroke="#8a857a"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <line
              x1={PAD}
              y1={toScreen(0, 1).sy}
              x2={W - PAD}
              y2={toScreen(0, 1).sy}
              stroke="#8a857a"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {/* Bezier curve */}
            <path d={path} fill="none" stroke="#0d9488" strokeWidth={3} />
            {/* Control handles */}
            <line
              x1={start.sx}
              y1={start.sy}
              x2={c1.sx}
              y2={c1.sy}
              stroke="#1a1812"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <line
              x1={end.sx}
              y1={end.sy}
              x2={c2.sx}
              y2={c2.sy}
              stroke="#1a1812"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Endpoints */}
            <circle cx={start.sx} cy={start.sy} r={5} fill="#1a1812" />
            <circle cx={end.sx} cy={end.sy} r={5} fill="#1a1812" />
            {/* Draggable handles */}
            <circle
              cx={c1.sx}
              cy={c1.sy}
              r={11}
              fill="#0d9488"
              stroke="#1a1812"
              strokeWidth={2}
              onPointerDown={onPointerDown("p1")}
              className="cursor-grab"
            />
            <circle
              cx={c2.sx}
              cy={c2.sy}
              r={11}
              fill="#ff7ab2"
              stroke="#1a1812"
              strokeWidth={2}
              onPointerDown={onPointerDown("p2")}
              className="cursor-grab"
            />
          </svg>

          <div className="flex flex-1 flex-col items-stretch gap-3 self-stretch">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Preview
            </p>
            <div className="relative flex h-12 w-full items-center rounded-md border-2 border-ink bg-cream-deep px-2">
              <div
                className="h-7 w-7 rounded-full border-2 border-ink bg-teal"
                style={{
                  transform: `translateX(${eased * (100 - 18)}%)`,
                }}
              />
            </div>
            <button
              type="button"
              onClick={play}
              disabled={playing}
              className="btn-chunk rounded-[var(--radius-button)] bg-teal px-4 py-2 font-display text-sm font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
            >
              {playing ? "…playing…" : "Play ▷"}
            </button>
            <p className="font-mono text-[11px] text-ink-muted">
              p1 = ({state.x1.toFixed(2)}, {state.y1.toFixed(2)}) ·{" "}
              p2 = ({state.x2.toFixed(2)}, {state.y2.toFixed(2)})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Presets
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setState(p.state)}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-teal-soft"
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2">
          <pre className="card-chunk flex-1 overflow-x-auto rounded-[var(--radius-card)] bg-cream-deep p-3 font-mono text-xs">
{`transition-timing-function: ${css};`}
          </pre>
          <button
            type="button"
            onClick={copy}
            className="btn-chunk shrink-0 rounded-[var(--radius-button)] bg-teal px-4 py-2 font-display text-sm font-extrabold text-cream"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <p className="text-xs text-ink-muted">
          The y-axis can go above 1 or below 0 for overshoot and anticipation.
          Drag the green handle (P1) and pink handle (P2) to shape the curve.
        </p>
      </div>
    </ToolFrame>
  );
}
