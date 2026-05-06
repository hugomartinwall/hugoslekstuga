import type { ConversionResult, Format } from "./types";
import { convertImage } from "./image";
import { convertTabular } from "./tabular";
import { convertMarkdown } from "./markdown";
import { convertPdf } from "./pdf";
import { convertDocx } from "./docx";

const IMAGE_FORMATS: Format[] = ["png", "jpg", "webp", "gif"];
const TABULAR_FORMATS: Format[] = ["csv", "json", "xlsx"];

export function targetsFor(from: Format): Format[] {
  if (IMAGE_FORMATS.includes(from)) {
    return IMAGE_FORMATS.filter((f) => f !== from);
  }
  if (TABULAR_FORMATS.includes(from)) {
    return TABULAR_FORMATS.filter((f) => f !== from);
  }
  if (from === "md") return ["html"];
  if (from === "html") return ["md"];
  if (from === "pdf") return ["txt"];
  if (from === "docx") return ["html", "txt"];
  return [];
}

export async function runConversion(
  file: File,
  from: Format,
  to: Format,
): Promise<ConversionResult> {
  if (IMAGE_FORMATS.includes(from) && IMAGE_FORMATS.includes(to)) {
    return convertImage(file, to);
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
  ...TABULAR_FORMATS,
  "md",
  "html",
  "pdf",
  "docx",
];
