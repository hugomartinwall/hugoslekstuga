import type { ConversionOptions, ConversionResult, Format } from "./types";
import { convertImage } from "./image";
import { convertHeic } from "./heic";
import { convertTabular } from "./tabular";
import { convertMarkdown } from "./markdown";
import { convertPdf } from "./pdf";
import { convertDocx } from "./docx";
import { convertYaml } from "./yaml";

const IMAGE_FORMATS: Format[] = ["png", "jpg", "webp", "gif"];
const TABULAR_FORMATS: Format[] = ["csv", "tsv", "json", "xlsx"];

export function targetsFor(from: Format): Format[] {
  if (IMAGE_FORMATS.includes(from)) {
    return IMAGE_FORMATS.filter((f) => f !== from);
  }
  if (from === "heic") {
    // HEIC is input-only. Decode to a more universal raster.
    return ["jpg", "png", "webp"];
  }
  if (from === "json") {
    // JSON straddles tabular and structured-config: it can become any
    // tabular format OR YAML.
    return [...TABULAR_FORMATS.filter((f) => f !== "json"), "yaml"];
  }
  if (TABULAR_FORMATS.includes(from)) {
    return TABULAR_FORMATS.filter((f) => f !== from);
  }
  if (from === "yaml") return ["json"];
  if (from === "md") return ["html"];
  if (from === "html") return ["md"];
  if (from === "pdf") return ["txt", "png"];
  if (from === "docx") return ["html", "md", "txt"];
  return [];
}

export async function runConversion(
  file: File,
  from: Format,
  to: Format,
  options?: ConversionOptions,
): Promise<ConversionResult> {
  if (from === "heic") {
    return convertHeic(file, to, options);
  }
  if (IMAGE_FORMATS.includes(from) && IMAGE_FORMATS.includes(to)) {
    return convertImage(file, to, options);
  }
  if (
    (from === "yaml" && to === "json") ||
    (from === "json" && to === "yaml")
  ) {
    return convertYaml(file, from, to);
  }
  if (TABULAR_FORMATS.includes(from) && TABULAR_FORMATS.includes(to)) {
    return convertTabular(file, from, to);
  }
  if ((from === "md" && to === "html") || (from === "html" && to === "md")) {
    return convertMarkdown(file, from, to);
  }
  if (from === "pdf") return convertPdf(file, to);
  if (from === "docx") return convertDocx(file, to);
  throw new Error(`No converter for ${from} → ${to}`);
}

export const SUPPORTED_INPUTS: Format[] = [
  ...IMAGE_FORMATS,
  "heic",
  ...TABULAR_FORMATS,
  "yaml",
  "md",
  "html",
  "pdf",
  "docx",
];

/** Image targets that respect the quality slider (lossy encoders). */
export const QUALITY_TARGETS: Format[] = ["jpg", "webp"];

/** Image targets that respect the size cap. */
export const RESIZE_TARGETS: Format[] = ["jpg", "png", "webp"];
