"use client";

import { useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import Slider from "@/components/Slider";
import { findTool } from "@/lib/tools";
import { COLOR_HEX, CREAM_HEX, INK_HEX } from "@/lib/colors";
import { hexRgb } from "@/lib/hugo/sprite";
import { hugoMoodEvent, hugoSawTool } from "@/lib/hugo-state";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

/**
 * Pixla — any picture, down to its pixels.
 *
 * The whole trick is two canvas passes: draw the image small (the
 * browser's downscale filter does the averaging — that IS the
 * pixelation), optionally remap every pixel to a fixed palette with
 * ordered Bayer dithering (the site's own dither motif, and honest
 * pixel-art practice), then blow it back up with smoothing off so
 * every cell lands crisp. Nothing leaves the tab — same physics as
 * strip.
 */

type PaletteId = "original" | "nattoppet" | "gray";

type PixlaSettings = {
  /** Output grid width in cells. */
  cells: number;
  palette: PaletteId;
  dither: boolean;
};

const SETTINGS_KEY = "hugoslekstuga:pixla:settings";
const DEFAULT_SETTINGS: PixlaSettings = {
  cells: 48,
  palette: "nattoppet",
  dither: true,
};

/** The site's own colours: the 8 phosphor accents + ink + room dark. */
const NATTOPPET_PALETTE: string[] = [
  ...Object.values(COLOR_HEX),
  INK_HEX,
  CREAM_HEX,
];

/** Four steps of the room-dark → phosphor ramp. */
const GRAY_PALETTE: string[] = [CREAM_HEX, "#4a5266", "#9aa4b2", INK_HEX];

const PALETTE_OPTIONS: { value: PaletteId; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "keep the photo's colours" },
  { value: "nattoppet", label: "Nattöppet", hint: "this site's 10 phosphors" },
  { value: "gray", label: "Phosphor gray", hint: "4-step monochrome" },
];

/** Ordered 4×4 Bayer matrix, the classic. */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** How far the dither threshold pushes a channel before mapping. */
const DITHER_SPREAD = 56;

function paletteRgb(id: PaletteId): [number, number, number][] | null {
  if (id === "original") return null;
  const hexes = id === "nattoppet" ? NATTOPPET_PALETTE : GRAY_PALETTE;
  return hexes.map((h) => hexRgb(h));
}

function nearest(
  palette: [number, number, number][],
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    // Green-weighted distance — cheap and close enough to the eye.
    const d = 3 * dr * dr + 6 * dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export default function PixlaPage() {
  const tool = findTool("pixla")!;
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** The decoded source image — a ref because ImageBitmap isn't
   *  render state; `version` bumps to re-run the pixel pass. */
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [version, setVersion] = useState(0);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [grid, setGrid] = useState<{ w: number; h: number } | null>(null);

  const [settings, setSettings] = useLocalStorageState<PixlaSettings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );
  const cells = settings.cells ?? DEFAULT_SETTINGS.cells;
  const palette = settings.palette ?? DEFAULT_SETTINGS.palette;
  const dither = settings.dither ?? DEFAULT_SETTINGS.dither;

  useEffect(() => {
    hugoSawTool("pixla");
  }, []);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setError("");
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      bitmapRef.current?.close();
      bitmapRef.current = bitmap;
      setFilename(file.name);
      setVersion((v) => v + 1);
    } catch {
      setError("Couldn't read that file as an image.");
    }
  };

  // Paste-from-clipboard — same convenience strip ships.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleFile(f);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The pixel pass — downscale, remap, publish the small canvas. */
  const renderSmall = (): HTMLCanvasElement | null => {
    const bitmap = bitmapRef.current;
    if (!bitmap) return null;
    const gw = Math.max(2, Math.min(cells, bitmap.width));
    const gh = Math.max(2, Math.round((gw * bitmap.height) / bitmap.width));
    const small = document.createElement("canvas");
    small.width = gw;
    small.height = gh;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, gw, gh);

    const pal = paletteRgb(palette);
    if (pal) {
      const img = ctx.getImageData(0, 0, gw, gh);
      const d = img.data;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const i = (y * gw + x) * 4;
          if (d[i + 3] < 8) continue; // keep transparency transparent
          let r = d[i];
          let g = d[i + 1];
          let b = d[i + 2];
          if (dither) {
            const t = (BAYER_4[y % 4][x % 4] / 16 - 0.5) * DITHER_SPREAD;
            r = Math.max(0, Math.min(255, r + t));
            g = Math.max(0, Math.min(255, g + t));
            b = Math.max(0, Math.min(255, b + t));
          }
          const [nr, ng, nb] = nearest(pal, r, g, b);
          d[i] = nr;
          d[i + 1] = ng;
          d[i + 2] = nb;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    return small;
  };

  // Re-run the pass whenever the image or a knob changes.
  useEffect(() => {
    const preview = previewRef.current;
    const small = renderSmall();
    if (!preview || !small) return;
    setGrid({ w: small.width, h: small.height });
    // Integer upscale so preview cells are whole pixels.
    const scale = Math.max(1, Math.floor(560 / small.width));
    preview.width = small.width * scale;
    preview.height = small.height * scale;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, preview.width, preview.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, cells, palette, dither]);

  const download = async () => {
    const small = renderSmall();
    if (!small) return;
    // Export at an integer scale that clears ~640px on the long side —
    // big enough to use anywhere, still perfectly crisp.
    const scale = Math.max(1, Math.ceil(640 / Math.max(small.width, small.height)));
    const out = document.createElement("canvas");
    out.width = small.width * scale;
    out.height = small.height * scale;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, out.width, out.height);
    const blob: Blob | null = await new Promise((res) =>
      out.toBlob(res, "image/png"),
    );
    if (!blob) {
      setError("Couldn't encode the PNG.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (filename.replace(/\.[^.]+$/, "") || "sprite") + "-pixla.png";
    a.click();
    URL.revokeObjectURL(url);
    hugoMoodEvent("happy");
  };

  const hasImage = version > 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream-deep p-6 text-center transition-colors hover:bg-tomato-soft"
        >
          <span className="font-display text-base font-extrabold">
            {hasImage ? "Drop another image" : "Drop or paste an image"}
          </span>
          <span className="text-xs text-ink-muted">
            JPEG, PNG, anything the browser can decode · stays in your tab
          </span>
          <span className="text-[10px] text-ink-muted">
            <kbd className="rounded border border-ink-soft bg-cream-deep px-1.5 py-0.5 font-mono">
              ⌘V
            </kbd>{" "}
            also works
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            className="hidden"
          />
        </label>

        {error && (
          <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-2 text-sm">
            {error}
          </p>
        )}

        {hasImage && (
          <>
            <div className="card-chunk flex flex-col items-center gap-2 rounded-[var(--radius-card)] bg-cream-deep p-4">
              <canvas
                ref={previewRef}
                className="max-h-[420px] max-w-full border border-line"
                style={{ imageRendering: "pixelated" }}
              />
              {grid && (
                <p className="font-pixel text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  {grid.w} × {grid.h} cells
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-ink-muted bg-cream-deep p-3">
              <Slider
                label="Pixels across"
                value={cells}
                min={8}
                max={128}
                step={4}
                onChange={(v) => setSettings((s) => ({ ...s, cells: v }))}
                color="tomato"
                hint="Fewer = chunkier. 32–64 is the sprite sweet spot."
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Palette
                </span>
                {PALETTE_OPTIONS.map((opt) => {
                  const active = palette === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.hint}
                      onClick={() =>
                        setSettings((s) => ({ ...s, palette: opt.value }))
                      }
                      className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                        active
                          ? "bg-tomato text-cream"
                          : "bg-cream-deep hover:bg-tomato-soft"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={dither}
                    disabled={palette === "original"}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, dither: e.target.checked }))
                    }
                    className="accent-tomato"
                  />
                  <span
                    className={
                      palette === "original" ? "text-ink-muted" : undefined
                    }
                  >
                    Bayer dither
                  </span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={download}
                className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-6 py-2 font-display text-base font-extrabold text-cream"
              >
                Download PNG ▦
              </button>
              <span className="text-xs text-ink-muted">
                Exported crisp, at a clean integer scale.
              </span>
            </div>
          </>
        )}

        <p className="text-xs text-ink-muted">
          The pixelation is a canvas downscale, the palette a
          nearest-colour remap with ordered dithering. Your image never
          leaves the browser.
        </p>
      </div>
    </ToolFrame>
  );
}
