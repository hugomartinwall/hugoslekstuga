"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { isTextEntry } from "@/lib/keyboard";
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

/** The slider's stops: every cell count a picture can be shown at. */
const CELLS_MIN = 8;
const CELLS_MAX = 128;
const CELLS_STEP = 4;

type Grid = { w: number; h: number };

/** The grid a picture of this size becomes at a cell count. The pixel
 *  pass and the layout both ask here, so they cannot disagree. */
function gridFor(cells: number, width: number, height: number): Grid {
  const w = Math.max(2, Math.min(cells, width));
  return { w, h: Math.max(2, Math.round((w * height) / width)) };
}

/**
 * How big the preview is shown. Layout only: the pass below decides the
 * picture's pixels, these functions decide how large they appear, and
 * they do it in CSS so the answer follows the panel and the window by
 * itself.
 *
 * A cell is always a whole number of CSS pixels (so of device pixels
 * too, on a 1x, 2x or 3x screen), the most that fit:
 *
 *   - across, the panel (100cqw, less the 2px of hairline; written as
 *     1.99px, because 100cqw can come out a hair under a whole pixel
 *     and round() would then lose a whole step), and never
 *     more than the canvas's own size, which the pass keeps to 560px;
 *   - down, the stage: the height kept free for this picture.
 *
 * The stage is one height for all of the slider's stops, so nothing
 * below the picture (the slider included) moves while it is dragged. It
 * is as tall as the picture gets at its tallest stop when every stop
 * takes the most whole pixels that fit `--fit-h`, the height the page
 * can spare (set on the panel). A picture too tall for that even at 1px
 * a cell keeps its 1px cells and gets a stage that holds them, as long
 * as PREVIEW_CRISP_H is enough; a taller one (a strip) is simply shrunk
 * to the stage, the one case of a cell that is not a whole pixel.
 */
const PREVIEW_MAX_W = 560;
/** Whole pixels come before `--fit-h` up to this height. A short desktop
 *  window spares 256px, and a phone screenshot at the slider's top stop
 *  is some 280 to 310 rows: it still gets them. On a phone `--fit-h` is
 *  never less than this, so there the stage never outgrows `--fit-h`. */
const PREVIEW_CRISP_H = 320;
const PREVIEW_ROOM_W = `min(100cqw - 1.99px, ${PREVIEW_MAX_W}px)`;

/** The widest a grid can be shown with whole-pixel cells, in the panel
 *  and under a height. 0px if not even 1px cells fit. The stage and the
 *  canvas both come from this one rule, which is why they agree. */
function widthUnder(height: string, g: Grid): string {
  // The 0.01px keeps a height that lands exactly on a step from losing
  // that step to float rounding.
  return `round(down, min(${PREVIEW_ROOM_W}, (${height} + 0.01px) * ${g.w} / ${g.h}), ${g.w}px)`;
}

/** The stage's height for a picture, less the hairline: `--stage-h`. */
function previewStage(width: number, height: number): string {
  const tall = new Set<string>();
  let rows = 0;
  for (let cells = CELLS_MIN; cells <= CELLS_MAX; cells += CELLS_STEP) {
    const g = gridFor(cells, width, height);
    tall.add(`${widthUnder("var(--fit-h)", g)} * ${g.h} / ${g.w}`);
    rows = Math.max(rows, g.h);
  }
  // And 1px cells at the top stop, if their rows fit under the taller of
  // `--fit-h` and PREVIEW_CRISP_H; if not, that much for the strip.
  return `max(min(${rows}px, round(down, max(var(--fit-h), ${PREVIEW_CRISP_H}px), 1px)), ${[...tall].join(", ")})`;
}

/** The canvas's width at one grid: whole-pixel cells under the stage, or
 *  (the strip) whatever width the stage's height leaves it. */
function previewWidth(g: Grid): string {
  return `max(${widthUnder("var(--stage-h)", g)}, min(${g.w}px, var(--stage-h) * ${g.w} / ${g.h}))`;
}

export default function PixlaPage() {
  const tool = findTool("pixla")!;
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** The decoded source image — a ref because ImageBitmap isn't
   *  render state. What render needs of it is its size: `source`, a new
   *  object for every picture, which also re-runs the pixel pass. */
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [source, setSource] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");

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
      setSource({ w: bitmap.width, h: bitmap.height });
    } catch {
      setError("Couldn't read that file as an image.");
    }
  };

  // Paste-from-clipboard — same convenience strip ships.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // A paste into a text field is that field's. Anything else on the
      // page (a chip, the slider, the dropzone, nothing at all) has no
      // use for a picture, so the paste loads it.
      if (isTextEntry(e.target)) return;
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
    const { w: gw, h: gh } = gridFor(cells, bitmap.width, bitmap.height);
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

  // Re-run the pass whenever the image or a knob changes. A layout
  // effect: the canvas gets the new grid's pixels before the browser
  // paints the box that render has just sized for that grid, so no frame
  // shows one grid's pixels in another grid's box.
  useLayoutEffect(() => {
    const preview = previewRef.current;
    const small = renderSmall();
    if (!preview || !small) return;
    // Integer upscale so preview cells are whole pixels.
    const scale = Math.max(1, Math.floor(560 / small.width));
    preview.width = small.width * scale;
    preview.height = small.height * scale;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, preview.width, preview.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, cells, palette, dither]);

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

  // The grid is worked out here, from the picture's size and the slider,
  // and not kept in state: the caption, the canvas's box and (through
  // the layout effect above) its pixels are one grid's in every frame.
  const grid = source && gridFor(cells, source.w, source.h);
  const hasImage = source !== null;

  // Roomy while it is the whole page; a slim bar once there is a
  // picture: smaller hint, and the key legend runs on after it instead
  // of taking a line of its own. The legend is a keyboard shortcut, so
  // it is not shown where there is no keyboard. Its 20px of height is
  // spelled out so the bar is a whole number of pixels tall and every
  // hairline under it stays sharp.
  const dropzone = (className?: string) => (
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
      size={hasImage ? "slim" : "roomy"}
      className={className}
    />
  );
  const errorNote = (className = "") =>
    error && (
      <Panel as="p" tone="danger" className={`px-4 py-3 text-sm ${className}`}>
        {error}
      </Panel>
    );

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4 sm:gap-5">
        {/* On a phone the picture, its knobs and the download key come
            first once there is a picture, and "Drop another image" sits
            under them: a phone's first screen has room for one or the
            other. That is a second dropzone, at the end, and the two
            swap at `sm`. (One dropzone moved down with CSS `order` kept
            its old place in the Tab order: from the back key down to the
            dropzone, then up to the slider.) An error sits right before
            whichever dropzone is shown: on a phone that is between the
            download key and the dropzone, next to whichever caused it.
            From `sm` up the dropzone stays on top, where a dragged file
            can always find it. */}
        {dropzone(hasImage ? "max-sm:hidden" : undefined)}
        {errorNote(hasImage ? "max-sm:hidden" : undefined)}

        {source && grid && (
          <div className="flex flex-col gap-4 sm:gap-5">
            {/* The panel is a size container: the stage and the canvas
                read its width (100cqw) to pick a whole-pixel scale, see
                previewStage() and previewWidth(). --fit-h is the height
                the picture may take: what the first screen has left once
                everything else on it is counted (about 32rem on a phone,
                33.5rem with the dropzone above), so the download key
                stays in view. Never over 420px, and never under 320px on
                a phone, where a portrait photo would shrink to a
                thumbnail, or 256px from `sm` up: 128 cells at 2px each,
                so a square picture keeps 2px cells at the top stop.
                Below `sm` the sides are 8px and not 12: the same 256px
                then fit across from a 314px layout up, which covers a
                320px phone and a 1280px window zoomed to 400% with a
                scrollbar that takes room. */}
            <Panel className="@container flex flex-col items-center gap-2 p-3 [--fit-h:clamp(320px,100svh_-_32rem,420px)] max-sm:px-2 sm:p-4 sm:[--fit-h:clamp(256px,100svh_-_33.5rem,420px)]">
              <div
                className="flex items-center justify-center"
                style={
                  {
                    "--stage-h": previewStage(source.w, source.h),
                    height: "calc(var(--stage-h) + 2px)",
                  } as CSSProperties
                }
              >
                {/* max-h and max-w are for browsers without round() or
                    cqw: the width below is ignored there and the canvas
                    is shrunk to fit instead, as it used to be. */}
                <canvas
                  ref={previewRef}
                  className="box-content max-h-[480px] max-w-[calc(100%-2px)] border border-line"
                  style={{
                    imageRendering: "pixelated",
                    width: previewWidth(grid),
                  }}
                />
              </div>
              <p className="label-pixel">
                {grid.w} × {grid.h} cells
              </p>
            </Panel>

            <Panel className="flex flex-col gap-3 p-3 sm:p-4">
              <Slider
                label="Pixels across"
                value={cells}
                min={CELLS_MIN}
                max={CELLS_MAX}
                step={CELLS_STEP}
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

        {hasImage && errorNote("sm:hidden")}
        {hasImage && dropzone("sm:hidden")}

        <p className="text-xs text-ink-muted">
          The pixelation is a canvas downscale, the palette a
          nearest-colour remap with ordered dithering. Your image never
          leaves the browser.
        </p>
      </div>
    </ToolFrame>
  );
}
