"use client";

import { useCallback, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:trace:options";

type Detail = "fast" | "standard" | "high" | "max";

type Options = {
  numberofcolors: number;
  pathomit: number;
  scale: number;
  detail: Detail;
};

const DEFAULTS: Options = {
  numberofcolors: 8,
  pathomit: 8,
  scale: 1,
  detail: "standard",
};

// Per-detail clamps. "fast" matches the previous hard 384px cap; "max"
// disables clamping (useful for clean logos and icons that should keep
// every pixel) but produces much larger SVGs and slower trace times.
const DETAIL_MAX_SIDE: Record<Detail, number | null> = {
  fast: 256,
  standard: 384,
  high: 768,
  max: null,
};

// Loaded lazily because the lib is ~30 KB and not needed until trace.
type ImageTracer = {
  imagedataToSVG: (
    imageData: ImageData,
    options?: Record<string, unknown>,
  ) => string;
};

export default function TracePage() {
  const tool = findTool("trace")!;
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [options, setOptions] = useLocalStorageState<Options>(STORAGE_KEY, DEFAULTS);
  const [svg, setSvg] = useState<string>("");
  const [tracing, setTracing] = useState(false);
  const [error, setError] = useState<string>("");
  const [tracerRef, setTracerRef] = useState<ImageTracer | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImageEl(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  const trace = useCallback(async () => {
    if (!imageEl || tracing) return;
    setTracing(true);
    setError("");
    try {
      const tracer =
        tracerRef ??
        ((await import("imagetracerjs")).default as ImageTracer);
      if (!tracerRef) setTracerRef(tracer);

      // Resize the image down for tracing to keep things fast and small.
      const detail = options.detail ?? "standard";
      const maxSide = DETAIL_MAX_SIDE[detail];
      const scale =
        maxSide === null
          ? 1
          : Math.min(1, maxSide / Math.max(imageEl.width, imageEl.height));
      const w = Math.max(1, Math.round(imageEl.width * scale));
      const h = Math.max(1, Math.round(imageEl.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(imageEl, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);

      const svgString = tracer.imagedataToSVG(data, {
        numberofcolors: options.numberofcolors,
        pathomit: options.pathomit,
        scale: options.scale,
        ltres: 1,
        qtres: 1,
        strokewidth: 1,
        roundcoords: 1,
      });
      setSvg(svgString);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not trace");
    } finally {
      setTracing(false);
    }
  }, [imageEl, options, tracing, tracerRef]);

  const downloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trace.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySvg = async () => {
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream p-6 text-center transition-colors hover:bg-orange-soft"
        >
          <span className="font-display text-base font-extrabold">
            Drop a bitmap
          </span>
          <span className="text-xs text-ink-muted">
            Logos and silhouettes trace cleanest · stays in your browser
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="hidden"
          />
        </label>

        {imageEl && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Detail
              </span>
              {(
                [
                  { id: "fast", label: "Fast" },
                  { id: "standard", label: "Standard" },
                  { id: "high", label: "High" },
                  { id: "max", label: "Max" },
                ] as { id: Detail; label: string }[]
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, detail: d.id }))}
                  className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    (options.detail ?? "standard") === d.id
                      ? "bg-orange text-cream"
                      : "bg-cream hover:bg-orange-soft"
                  }`}
                  title={
                    d.id === "fast"
                      ? "256px max — quickest"
                      : d.id === "standard"
                      ? "384px max — balanced"
                      : d.id === "high"
                      ? "768px max — keeps logo edges sharp"
                      : "no clamp — biggest output, slowest"
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Slider
                label="Colours"
                value={options.numberofcolors}
                min={2}
                max={16}
                onChange={(v) =>
                  setOptions((o) => ({ ...o, numberofcolors: v }))
                }
              />
              <Slider
                label="Path detail"
                value={options.pathomit}
                min={0}
                max={50}
                onChange={(v) => setOptions((o) => ({ ...o, pathomit: v }))}
                hint="lower = more paths, more detail"
              />
              <Slider
                label="Scale"
                value={options.scale}
                min={1}
                max={4}
                step={1}
                onChange={(v) => setOptions((o) => ({ ...o, scale: v }))}
              />
            </div>

            <button
              type="button"
              onClick={trace}
              disabled={tracing}
              className="btn-chunk self-start rounded-[var(--radius-button)] bg-orange px-6 py-2 font-display text-base font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
            >
              {tracing ? "…tracing…" : svg ? "Trace again" : "Trace"}
            </button>
          </>
        )}

        {error && (
          <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-2 text-sm">
            {error}
          </p>
        )}

        {svg && (
          <>
            <div className="card-chunk flex aspect-square w-full max-w-md items-center justify-center self-center rounded-[var(--radius-card)] bg-cream p-3">
              <div
                className="h-full w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={downloadSvg}
                className="btn-chunk rounded-[var(--radius-button)] bg-orange px-5 py-2 font-display text-sm font-extrabold text-cream"
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={copySvg}
                className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold"
              >
                {copied ? "Copied!" : "Copy markup"}
              </button>
              <span className="text-xs text-ink-muted">
                {Math.ceil(svg.length / 1024)} KB
              </span>
            </div>
          </>
        )}

        <p className="text-xs text-ink-muted">
          Tracing flattens an image to a few colour regions and traces each
          as an SVG path. Best results: high-contrast logos, icons,
          silhouettes. Photos work but produce huge files.
        </p>
      </div>
    </ToolFrame>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-md border-2 border-ink bg-cream-deep p-2 text-xs">
      <span className="flex items-center justify-between font-semibold uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-orange"
      />
      {hint && <span className="text-[10px] text-ink-muted">{hint}</span>}
    </label>
  );
}
