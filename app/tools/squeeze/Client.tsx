"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { formatBytes } from "@/lib/format";
import DropZone from "@/components/DropZone";

type Format = "auto" | "jpeg" | "png" | "webp";

type CompressedResult = {
  blob: Blob;
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
};

export default function SqueezePage() {
  const tool = findTool("squeeze")!;
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [maxLong, setMaxLong] = useState<number>(1600);
  const [quality, setQuality] = useState<number>(80);
  const [format, setFormat] = useState<Format>("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompressedResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Cleanup object URLs.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [originalUrl, resultUrl]);

  const acceptFile = useCallback(
    (f: File) => {
      if (!f.type.startsWith("image/")) return;
      // Cleanup previous
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResult(null);
      setResultUrl(null);
      setFile(f);
      const url = URL.createObjectURL(f);
      setOriginalUrl(url);
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src = url;
    },
    [originalUrl, resultUrl],
  );

  const compress = useCallback(async () => {
    if (!file || !naturalSize) return;
    setBusy(true);
    try {
      const r = await compressImage(file, naturalSize, maxLong, quality, format);
      const u = URL.createObjectURL(r.blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResult(r);
      setResultUrl(u);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [file, naturalSize, maxLong, quality, format, resultUrl]);

  // Auto-compress when settings change (after a file is selected). Debounced
  // by 220 ms so dragging the size or quality slider doesn't recompress the
  // image on every tick — for 4000-px screenshots that was visibly laggy.
  useEffect(() => {
    if (!file) return;
    const id = window.setTimeout(() => {
      compress();
    }, 220);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, maxLong, quality, format]);

  const reset = () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setOriginalUrl(null);
    setNaturalSize(null);
    setResult(null);
    setResultUrl(null);
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        {!file ? (
          <DropZone
            color="orange"
            primary="Drop an image"
            acceptMime="image/*"
            hint="PNG, JPG, WebP, GIF — files never leave your browser."
            onFile={acceptFile}
          />
        ) : (
          <FileInfo
            file={file}
            originalUrl={originalUrl}
            natural={naturalSize}
            onReset={reset}
          />
        )}

        {file && (
          <Controls
            maxLong={maxLong}
            setMaxLong={setMaxLong}
            quality={quality}
            setQuality={setQuality}
            format={format}
            setFormat={setFormat}
          />
        )}

        {file && result && (
          <ResultPanel
            file={file}
            result={result}
            url={resultUrl!}
            busy={busy}
          />
        )}
      </div>
    </ToolFrame>
  );
}

function FileInfo({
  file,
  originalUrl,
  natural,
  onReset,
}: {
  file: File;
  originalUrl: string | null;
  natural: { w: number; h: number } | null;
  onReset: () => void;
}) {
  return (
    <div className="card-chunk flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] bg-cream p-4">
      {originalUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={originalUrl}
          alt=""
          className="h-20 w-20 rounded-[12px] border-2 border-ink object-cover"
        />
      )}
      <div className="flex flex-col">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Original
        </p>
        <p className="font-display text-base font-bold tracking-tight break-all">
          {file.name}
        </p>
        <p className="text-sm text-ink-soft">
          {natural ? `${natural.w}×${natural.h}` : "…"} · {formatBytes(file.size)}
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="ml-auto rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
      >
        Pick another
      </button>
    </div>
  );
}

function Controls({
  maxLong,
  setMaxLong,
  quality,
  setQuality,
  format,
  setFormat,
}: {
  maxLong: number;
  setMaxLong: (n: number) => void;
  quality: number;
  setQuality: (n: number) => void;
  format: Format;
  setFormat: (f: Format) => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-5 rounded-[var(--radius-card)] bg-cream p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Max long edge
          </p>
          <p className="font-display text-base font-bold tabular-nums">
            {maxLong}px
          </p>
        </div>
        <input
          type="range"
          min={400}
          max={4000}
          step={100}
          value={maxLong}
          onChange={(e) => setMaxLong(Number(e.target.value))}
          className="w-full accent-orange"
        />
        <div className="flex flex-wrap gap-2">
          {[800, 1280, 1600, 2400].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setMaxLong(s)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                maxLong === s ? "bg-orange text-cream" : "bg-cream hover:bg-orange-soft"
              }`}
            >
              {s}px
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Quality
          </p>
          <p className="font-display text-base font-bold tabular-nums">
            {quality}%
          </p>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
          className="w-full accent-orange"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Output format
        </p>
        <div className="flex flex-wrap gap-2">
          {(["auto", "jpeg", "png", "webp"] as Format[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                format === f ? "bg-orange text-cream" : "bg-cream hover:bg-orange-soft"
              }`}
            >
              {f === "auto" ? "Auto" : f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({
  file,
  result,
  url,
  busy,
}: {
  file: File;
  result: CompressedResult;
  url: string;
  busy: boolean;
}) {
  const ratio = file.size > 0 ? result.blob.size / file.size : 1;
  const savedPct = Math.max(0, 1 - ratio) * 100;
  const grew = ratio > 1;
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const ext = result.format === "jpeg" ? "jpg" : result.format;
  const filename = `${baseName}-squeezed.${ext}`;

  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-orange-soft p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Squeezed
          {busy && <span className="ml-2 text-ink-muted">· working…</span>}
        </p>
        <p className="font-mono text-xs text-ink-soft">{filename}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Size" value={formatBytes(result.blob.size)} sub={savedPct > 0 ? `${savedPct.toFixed(0)}% smaller` : grew ? "larger — try lower quality" : "same"} />
        <Stat label="Dimensions" value={`${result.width}×${result.height}`} />
        <Stat label="Format" value={result.format.toUpperCase()} />
      </div>
      <a
        href={url}
        download={filename}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-orange px-6 py-3 font-display text-base font-extrabold text-cream"
      >
        Download
      </a>
      {/* Visual preview */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Compressed result"
        className="mt-1 max-h-72 w-full rounded-[12px] border-2 border-ink bg-cream object-contain"
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border-2 border-ink bg-cream p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="font-display text-lg font-extrabold leading-none tabular-nums">
        {value}
      </p>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

async function compressImage(
  file: File,
  natural: { w: number; h: number },
  maxLong: number,
  quality: number,
  format: Format,
): Promise<CompressedResult> {
  const dataUrl = await readDataUrl(file);
  const img = await loadImage(dataUrl);
  const { w, h } = scaleToMaxLong(natural, maxLong);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  // For JPEG we need a non-transparent background.
  const targetMime = pickMime(format, file.type);
  if (targetMime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Compression failed"));
      },
      targetMime,
      targetMime === "image/png" ? undefined : quality / 100,
    );
  });

  return {
    blob,
    width: w,
    height: h,
    format: targetMime === "image/jpeg" ? "jpeg" : targetMime === "image/webp" ? "webp" : "png",
  };
}

function pickMime(format: Format, originalMime: string): "image/jpeg" | "image/png" | "image/webp" {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  // Auto: prefer the original where possible, otherwise jpeg.
  if (originalMime === "image/png") return "image/png";
  if (originalMime === "image/webp") return "image/webp";
  return "image/jpeg";
}

function scaleToMaxLong(
  natural: { w: number; h: number },
  maxLong: number,
): { w: number; h: number } {
  const long = Math.max(natural.w, natural.h);
  if (long <= maxLong) return { w: natural.w, h: natural.h };
  const ratio = maxLong / long;
  return {
    w: Math.round(natural.w * ratio),
    h: Math.round(natural.h * ratio),
  };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
