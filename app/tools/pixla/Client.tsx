"use client";

import { useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import PixelIcon from "@/components/PixelIcon";
import Slider from "@/components/Slider";
import { ChipGroup } from "@/components/ui/Chip";
import Dropzone from "@/components/ui/Dropzone";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import Switch from "@/components/ui/Switch";
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

/** The same three as chips: each hint rides along as the chip's tooltip. */
const PALETTE_CHIPS = PALETTE_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
  title: opt.hint,
}));

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

/**
 * How big the preview is shown. Layout only: the pass below decides the
 * picture's pixels, these two decide how large they appear, and they do
 * it in CSS so the answer follows the panel and the window by itself.
 *
 * A cell is always a whole number of CSS pixels (so of device pixels
 * too, on a 1x, 2x or 3x screen), the most that fit:
 *
 *   - across, the panel (100cqw, less the 2px of hairline), and never
 *     more than the canvas's own size, which the pass keeps to 560px;
 *   - down, `--fit-h`, the height the page can spare (set on the panel).
 *
 * Two exceptions keep a tall picture at a high cell count from turning
 * into a stamp: 2px cells are used while they stay under PREVIEW_MAX_H
 * even if that is taller than `--fit-h`, and a strip so tall that not
 * even 1px cells fit is simply shrunk to PREVIEW_MAX_H.
 */
const PREVIEW_MAX_W = 560;
/** The canvas's `max-h-[480px]` class says the same thing for browsers
 *  without round() or cqw, where the two functions below are ignored and
 *  the canvas is shrunk to fit instead, as it used to be. */
const PREVIEW_MAX_H = 480;
const PREVIEW_ROOM_W = `min(100cqw - 2px, ${PREVIEW_MAX_W}px)`;

function previewWidth(w: number, h: number): string {
  const perRow = w / h;
  // The 0.01px keeps a height limit that lands exactly on a step from
  // losing that step to float rounding.
  const fits = `round(down, min(${PREVIEW_ROOM_W}, var(--fit-h) * ${perRow} + 0.01px), ${w}px)`;
  const twoPx = `min(${2 * w}px, round(down, min(${PREVIEW_ROOM_W}, ${PREVIEW_MAX_H * perRow + 0.01}px), ${w}px))`;
  const shrunk = `min(${w}px, 100cqw - 2px, ${PREVIEW_MAX_H * perRow}px)`;
  return `max(${fits}, ${twoPx}, ${shrunk})`;
}

/**
 * The height kept free for the picture: all it could take at this shape,
 * whatever the cell count. The picture changes size in steps as the
 * slider moves; with the space held open, nothing below it (the slider
 * included) moves while it is being dragged.
 */
function previewStageHeight(w: number, h: number): string {
  return `calc(round(up, min(var(--fit-h), ${PREVIEW_ROOM_W} * ${h / w}), 1px) + 2px)`;
}

/**
 * The palette chips and the dropzone are native radio and file inputs
 * now. They used to be buttons and an input that could not take focus,
 * and a paste with the focus on one of them loaded the image, so the
 * paste listener still has to let them through. (A focused slider still
 * swallows the paste, as it always has: an old fault, left for its own
 * fix.)
 */
function isChipOrPicker(t: HTMLElement): boolean {
  if (t.tagName !== "INPUT") return false;
  const type = (t as HTMLInputElement).type;
  return type === "radio" || type === "file";
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
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) &&
        !isChipOrPicker(t)
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
      <div className="flex flex-col gap-4 sm:gap-5">
        {/* Roomy while it is the whole page; a slim bar once there is a
            picture: smaller hint, and the key legend runs on after it
            instead of taking a line of its own. The legend is a keyboard
            shortcut, so it is not shown where there is no keyboard. Its
            20px of height is spelled out so the bar is a whole number of
            pixels tall and every hairline under it stays sharp. */}
        <Dropzone
          title={hasImage ? "Drop another image" : "Drop or paste an image"}
          hint={
            <span className={hasImage ? "block text-xs leading-5" : "block"}>
              JPEG, PNG, anything the browser can decode · stays in your tab{" "}
              <span
                className={`h-5 items-center gap-1.5 text-xs text-ink-muted pointer-coarse:hidden ${
                  hasImage
                    ? "mx-1.5 inline-flex align-top whitespace-nowrap"
                    : "mt-2 flex justify-center"
                }`}
              >
                <kbd className="kbd-chunk">⌘V</kbd> also works
              </span>
            </span>
          }
          accept="image/*"
          onFiles={(files) => {
            const f = files[0];
            if (f) handleFile(f);
          }}
          className={hasImage ? "py-3!" : undefined}
        />

        {error && (
          <Panel
            as="p"
            tone="danger"
            className={`px-4 py-3 text-sm ${hasImage ? "max-sm:-order-1" : ""}`}
          >
            {error}
          </Panel>
        )}

        {/* On a phone the picture, its knobs and the download key come
            first once there is a picture, and "Drop another image" moves
            under them: a phone's first screen has room for one or the
            other. An error then sits between the two, next to whichever
            key caused it. From `sm` up the dropzone stays on top, where a
            dragged file can always find it. */}
        {hasImage && (
          <div className="flex flex-col gap-4 max-sm:-order-2 sm:gap-5">
            {/* The panel is a size container: the canvas reads its width
                (100cqw) to pick a whole-pixel scale, see previewWidth().
                --fit-h is the height the picture may take: what the first
                screen has left once everything else on it is counted
                (about 32rem on a phone, 33.5rem with the dropzone above),
                so the download key stays in view. Never over 420px, and
                never under 320px on a phone, where a portrait photo would
                shrink to a thumbnail, or 252px from `sm` up. */}
            <Panel className="@container flex flex-col items-center gap-2 p-3 [--fit-h:clamp(320px,100svh_-_32rem,420px)] sm:p-4 sm:[--fit-h:clamp(252px,100svh_-_33.5rem,420px)]">
              <div
                className="flex items-center justify-center"
                style={{
                  minHeight: grid
                    ? previewStageHeight(grid.w, grid.h)
                    : undefined,
                }}
              >
                <canvas
                  ref={previewRef}
                  className="box-content max-h-[480px] max-w-[calc(100%-2px)] border border-line"
                  style={{
                    imageRendering: "pixelated",
                    width: grid ? previewWidth(grid.w, grid.h) : undefined,
                  }}
                />
              </div>
              {grid && (
                <p className="label-pixel">
                  {grid.w} × {grid.h} cells
                </p>
              )}
            </Panel>

            <Panel className="flex flex-col gap-3 p-3 sm:p-4">
              <Slider
                label="Pixels across"
                value={cells}
                min={8}
                max={128}
                step={4}
                onChange={(v) => setSettings((s) => ({ ...s, cells: v }))}
                hint="Fewer = chunkier. 32–64 is the sprite sweet spot."
              />
              {/* One row from `sm` up; on a phone the label, the chips and
                  the switch each take a row, in that order. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  id="pixla-palette-label"
                  className="label-pixel w-full sm:w-auto"
                >
                  Palette
                </span>
                <ChipGroup
                  labelledBy="pixla-palette-label"
                  options={PALETTE_CHIPS}
                  value={palette}
                  onChange={(v) => setSettings((s) => ({ ...s, palette: v }))}
                  className="w-full sm:w-auto"
                  chipClassName="max-sm:flex-auto max-sm:px-2"
                />
                <Switch
                  checked={dither}
                  onChange={(next) =>
                    setSettings((s) => ({ ...s, dither: next }))
                  }
                  label="Bayer dither"
                  disabled={palette === "original"}
                  className="md:ml-auto"
                />
              </div>
            </Panel>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Keycap tone="accent" size="lg" onClick={download}>
                Download PNG
                <PixelIcon name="pixla" size={12} />
              </Keycap>
              <span className="text-xs text-ink-muted">
                Exported crisp, at a clean integer scale.
              </span>
            </div>
          </div>
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
