"use client";

import { useCallback, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const SIZES: { px: number; label: string; usage: string }[] = [
  { px: 16, label: "16×16", usage: "browser tab" },
  { px: 32, label: "32×32", usage: "browser tab (HiDPI)" },
  { px: 48, label: "48×48", usage: "Windows tile" },
  { px: 64, label: "64×64", usage: "general" },
  { px: 180, label: "180×180", usage: "Apple touch icon" },
  { px: 192, label: "192×192", usage: "Android home screen" },
  { px: 512, label: "512×512", usage: "PWA splash" },
];

const HTML_SNIPPET = `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />`;

const MANIFEST_SNIPPET = `{
  "name": "Your Site",
  "short_name": "Site",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#ffffff",
  "background_color": "#ffffff",
  "display": "standalone"
}`;

function resize(image: HTMLImageElement, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Cover the square with the image, centered
  const min = Math.min(image.width, image.height);
  const sx = (image.width - min) / 2;
  const sy = (image.height - min) / 2;
  ctx.drawImage(image, sx, sy, min, min, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

export default function FaviconPage() {
  const tool = findTool("favicon")!;
  const [previews, setPreviews] = useState<{ size: number; url: string }[]>([]);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedManifest, setCopiedManifest] = useState(false);

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const all = SIZES.map((s) => ({ size: s.px, url: resize(img, s.px) }));
      setPreviews(all);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const downloadOne = (size: number, url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download =
      size === 180
        ? "apple-touch-icon.png"
        : size === 192
        ? "android-chrome-192x192.png"
        : size === 512
        ? "android-chrome-512x512.png"
        : `favicon-${size}x${size}.png`;
    a.click();
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(HTML_SNIPPET);
      setCopiedHtml(true);
      window.setTimeout(() => setCopiedHtml(false), 1400);
    } catch {}
  };
  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(MANIFEST_SNIPPET);
      setCopiedManifest(true);
      window.setTimeout(() => setCopiedManifest(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream p-6 text-center transition-colors hover:bg-yellow-soft"
        >
          <span className="font-display text-base font-extrabold">
            Drop a square PNG (or any image)
          </span>
          <span className="text-xs text-ink-muted">
            512×512 or larger gives the cleanest results
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

        {previews.length > 0 && (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {previews.map((p) => {
                const meta = SIZES.find((s) => s.px === p.size)!;
                return (
                  <li
                    key={p.size}
                    className="card-chunk flex flex-col items-center gap-2 rounded-[var(--radius-card)] bg-cream p-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={`${p.size}×${p.size} favicon preview`}
                      className="rounded-md border-2 border-ink bg-cream-deep"
                      style={{
                        width: Math.min(96, p.size),
                        height: Math.min(96, p.size),
                        imageRendering: p.size <= 48 ? "pixelated" : undefined,
                      }}
                    />
                    <div className="text-center">
                      <p className="text-[11px] font-bold">{meta.label}</p>
                      <p className="text-[10px] text-ink-muted">{meta.usage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadOne(p.size, p.url)}
                      className="rounded-full border-2 border-ink bg-cream px-3 py-0.5 text-[11px] font-bold transition-colors hover:bg-yellow"
                    >
                      download
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  HTML snippet
                </p>
                <button
                  type="button"
                  onClick={copyHtml}
                  className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-yellow"
                >
                  {copiedHtml ? "copied!" : "copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-md border-2 border-ink bg-cream-deep p-3 font-mono text-xs">
                {HTML_SNIPPET}
              </pre>
              <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  manifest.json
                </p>
                <button
                  type="button"
                  onClick={copyManifest}
                  className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-yellow"
                >
                  {copiedManifest ? "copied!" : "copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-md border-2 border-ink bg-cream-deep p-3 font-mono text-xs">
                {MANIFEST_SNIPPET}
              </pre>
            </div>
          </>
        )}

        <p className="text-xs text-ink-muted">
          Output is PNG at every standard size. Modern browsers prefer PNG
          over .ico, so this covers everything except very old IE.
        </p>
      </div>
    </ToolFrame>
  );
}
