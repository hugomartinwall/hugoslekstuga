import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

const mimeFor: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function convertImage(
  file: File,
  to: Format,
): Promise<ConversionResult> {
  if (!(to in mimeFor)) {
    throw new Error(`Cannot convert image to ${to}`);
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  // Fill background with white for JPG (no alpha channel).
  if (to === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Conversion failed."));
      },
      mimeFor[to],
      to === "jpg" ? 0.92 : undefined,
    );
  });

  return {
    blob,
    filename: `${stripExt(file.name)}.${to}`,
  };
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
