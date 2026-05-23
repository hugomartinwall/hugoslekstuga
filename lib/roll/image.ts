/**
 * Helpers for turning user-picked images into wheel thumbnails.
 *
 * The wheel needs square images (each entry sits in a circular slot
 * on the slice and in the editor row). Source files are anything the
 * native file picker accepts — usually a phone photo or a downloaded
 * logo, often non-square and often huge. We center-crop to square,
 * downscale to 256×256 max, and JPEG-encode at q=0.85 so each entry's
 * image is ~15–25 KB base64 in localStorage. 30 entries × 25 KB ≈
 * under 1 MB; the localStorage quota is 5–10 MB.
 *
 * `createImageBitmap(file, { imageOrientation: "from-image" })`
 * honours EXIF rotation flags from phone cameras, so a portrait
 * photo doesn't render sideways.
 *
 * HEIC support is not wired here. Most phones convert on share via
 * the system file picker, so HEIC rarely reaches the browser as-is;
 * when it does, `createImageBitmap` rejects and the caller surfaces
 * an inline error.
 */

const MAX_DIMENSION = 256;
const JPEG_QUALITY = 0.85;

/**
 * Read a File, center-crop to square, scale to ≤ 256×256, encode to
 * JPEG at q=0.85, return the base64 data URL.
 *
 * Throws if the file can't be decoded as an image — caller should
 * catch and surface a UI message.
 */
export async function fileToWheelThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const short = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - short) / 2);
    const sy = Math.floor((bitmap.height - short) / 2);
    const out = Math.min(short, MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, short, short, 0, 0, out, out);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}
