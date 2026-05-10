import type { ConversionOptions, ConversionResult, Format } from "./types";
import { stripExt } from "./types";
import { convertImage } from "./image";

/**
 * HEIC / HEIF input. iPhones export these by default; converting them is
 * one of the most common moments for a converter to meet a user.
 *
 * Strategy: decode the HEIC to a lossless PNG via heic2any, then route
 * through the regular image converter so quality + max-long-edge controls
 * apply uniformly. Two encode/decodes for a single conversion, but it
 * keeps all image-shaping logic in one place.
 */
type Heic2Any = (input: {
  blob: Blob;
  toType?: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

export async function convertHeic(
  file: File,
  to: Format,
  options?: ConversionOptions,
): Promise<ConversionResult> {
  if (to !== "jpg" && to !== "png" && to !== "webp") {
    throw new Error(`Cannot convert HEIC to ${to}`);
  }

  const heic2anyMod = (await import("heic2any")) as unknown as {
    default: Heic2Any;
  };
  const heic2any = heic2anyMod.default;

  // Decode to PNG (lossless intermediate). heic2any's quality param doesn't
  // help here because the regular image converter applies its own quality.
  const decoded = await heic2any({ blob: file, toType: "image/png" });
  const decodedBlob = Array.isArray(decoded) ? decoded[0] : decoded;

  // Wrap as a File so the image converter can route it. The original
  // base name is preserved through stripExt — the .heic extension is
  // dropped and the target extension is added.
  const intermediate = new File(
    [decodedBlob],
    `${stripExt(file.name)}.png`,
    { type: "image/png" },
  );

  return convertImage(intermediate, to, options);
}
