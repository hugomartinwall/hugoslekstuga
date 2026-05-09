"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Point = { x: number; y: number };

type Stroke = {
  points: Point[];
  color: string;
  size: number;
  mode: "pen" | "eraser";
};

const COLORS = [
  "#1a1812",
  "#ff5a3c",
  "#ffc233",
  "#4f66f2",
  "#ff7ab2",
  "#3fa66e",
  "#9333ea",
  "#f97316",
  "#0d9488",
];

const SIZES = [2, 4, 8, 16];

const CANVAS_W = 1280;
const CANVAS_H = 800;
const BG = "#fbf6ee";

export default function SketchPage() {
  const tool = findTool("sketch")!;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState<number>(4);
  const [mode, setMode] = useState<"pen" | "eraser">("pen");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Stroke | null>(null);

  // Re-render the whole canvas whenever the stroke list changes.
  useLayoutEffect(() => {
    redraw(canvasRef.current, strokes, drawingRef.current);
  }, [strokes]);

  // Pointer handlers operate on raw canvas coordinates.
  const toPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const xCSS = e.clientX - rect.left;
    const yCSS = e.clientY - rect.top;
    return {
      x: (xCSS / rect.width) * CANVAS_W,
      y: (yCSS / rect.height) * CANVAS_H,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      if (!c) return;
      c.setPointerCapture(e.pointerId);
      const p = toPoint(e);
      const stroke: Stroke = {
        points: [p],
        color,
        size,
        mode,
      };
      drawingRef.current = stroke;
      // Visual feedback as user draws — paint directly to the canvas.
      drawSegment(c, p, p, stroke);
    },
    [toPoint, color, size, mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      const stroke = drawingRef.current;
      if (!c || !stroke) return;
      const p = toPoint(e);
      const last = stroke.points[stroke.points.length - 1];
      stroke.points.push(p);
      drawSegment(c, last, p, stroke);
    },
    [toPoint],
  );

  const onPointerUp = useCallback(() => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke) return;
    if (stroke.points.length < 2) {
      // Treat single-tap as a tiny dot
      stroke.points = [stroke.points[0], stroke.points[0]];
    }
    setStrokes((prev) => [...prev, stroke]);
  }, []);

  const undo = useCallback(() => {
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setStrokes([]);
  }, []);

  const download = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sketch-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        setMode((m) => (m === "pen" ? "eraser" : "pen"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        <Toolbar
          color={color}
          setColor={setColor}
          size={size}
          setSize={setSize}
          mode={mode}
          setMode={setMode}
          onUndo={undo}
          onClear={clear}
          onDownload={download}
          empty={strokes.length === 0}
        />

        <div className="card-chunk overflow-hidden rounded-[var(--radius-card)] bg-cream">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="block w-full touch-none"
            style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, cursor: mode === "pen" ? "crosshair" : "cell" }}
          />
        </div>

        <p className="text-xs text-ink-muted">
          Shortcuts: <kbd className="rounded border border-ink-muted bg-cream-deep px-1 py-0.5 font-mono text-[10px]">⌘Z</kbd> undo ·
          <kbd className="ml-2 rounded border border-ink-muted bg-cream-deep px-1 py-0.5 font-mono text-[10px]">E</kbd> toggle eraser
        </p>
      </div>
    </ToolFrame>
  );
}

function Toolbar({
  color,
  setColor,
  size,
  setSize,
  mode,
  setMode,
  onUndo,
  onClear,
  onDownload,
  empty,
}: {
  color: string;
  setColor: (c: string) => void;
  size: number;
  setSize: (n: number) => void;
  mode: "pen" | "eraser";
  setMode: (m: "pen" | "eraser") => void;
  onUndo: () => void;
  onClear: () => void;
  onDownload: () => void;
  empty: boolean;
}) {
  return (
    <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-cream p-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode("pen")}
          className={`rounded-full border-2 border-ink px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "pen" ? "bg-teal text-cream" : "bg-cream"
          }`}
        >
          Pen
        </button>
        <button
          type="button"
          onClick={() => setMode("eraser")}
          className={`rounded-full border-2 border-ink px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "eraser" ? "bg-teal text-cream" : "bg-cream"
          }`}
        >
          Eraser
        </button>
      </div>
      <Divider />
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setColor(c);
              setMode("pen");
            }}
            aria-label={`color ${c}`}
            className={`h-7 w-7 rounded-full border-2 ${color === c && mode === "pen" ? "border-ink ring-2 ring-ink ring-offset-2 ring-offset-cream" : "border-ink"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            setMode("pen");
          }}
          className="ml-1 h-7 w-7 cursor-pointer rounded-full border-2 border-ink bg-cream p-0.5"
          aria-label="custom color"
        />
      </div>
      <Divider />
      <div className="flex items-center gap-1">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            aria-label={`size ${s}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink transition-colors ${
              size === s ? "bg-teal-soft" : "bg-cream"
            }`}
          >
            <span
              className="rounded-full bg-ink"
              style={{ width: `${Math.min(s + 2, 16)}px`, height: `${Math.min(s + 2, 16)}px` }}
            />
          </button>
        ))}
      </div>
      <Divider />
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={empty}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-xs font-bold transition-colors hover:bg-teal-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-xs font-bold transition-colors hover:bg-tomato-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="btn-chunk rounded-full border-2 border-ink bg-teal px-3 py-1.5 text-xs font-bold text-cream"
        >
          Download
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="hidden h-7 w-px bg-ink/20 sm:inline-block" aria-hidden />;
}

function redraw(
  canvas: HTMLCanvasElement | null,
  strokes: Stroke[],
  current: Stroke | null,
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) drawStroke(ctx, s);
  if (current) drawStroke(ctx, current);
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;
  if (stroke.mode === "eraser") {
    ctx.strokeStyle = BG;
  } else {
    ctx.strokeStyle = stroke.color;
  }
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Single-point dot
  if (stroke.points.length < 2) {
    ctx.fillStyle = stroke.mode === "eraser" ? BG : stroke.color;
    ctx.beginPath();
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSegment(
  canvas: HTMLCanvasElement,
  from: Point,
  to: Point,
  stroke: Stroke,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;
  ctx.strokeStyle = stroke.mode === "eraser" ? BG : stroke.color;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}
