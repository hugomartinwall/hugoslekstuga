import type { ConversionOptions, ConversionResult, Format } from "./types";
import { stripExt } from "./types";

const mimeFor: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Encode an image into a target raster format. Optionally apply a quality
 * factor (lossy outputs only) and a max-long-edge cap to shrink large
 * source images. PNG/GIF skip the quality factor since neither uses one
 * in the canvas API.
 */
export async function convertImage(
  file: File,
  to: Format,
  options?: ConversionOptions,
): Promise<ConversionResult> {
  if (!(to in mimeFor)) {
    throw new Error(`Cannot convert image to ${to}`);
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  // Optional resize: shrink so the long edge is at most `maxLongEdge` pixels.
  // Upscaling is never applied — small sources stay small.
  const maxLong = options?.maxLongEdge ?? null;
  const naturalLong = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = maxLong && maxLong > 0 && maxLong < naturalLong
    ? maxLong / naturalLong
    : 1;
  const outWidth = Math.max(1, Math.round(img.naturalWidth * scale));
  const outHeight = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  // Fill background with white for JPG (no alpha channel).
  if (to === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, outWidth, outHeight);

  // Quality only matters for lossy formats. The canvas API ignores the
  // quality argument for png/gif so we omit it explicitly.
  const lossy = to === "jpg" || to === "webp";
  const qualityNorm = lossy ? clamp01((options?.quality ?? 85) / 100) : undefined;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Conversion failed."));
      },
      mimeFor[to],
      qualityNorm,
    );
  });

  return {
    blob,
    filename: `${stripExt(file.name)}.${to}`,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 0.05) return 0.05;
  if (n > 1) return 1;
  return n;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("File read failed."));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}
