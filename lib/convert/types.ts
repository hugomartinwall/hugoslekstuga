export type Format =
  | "png"
  | "jpg"
  | "webp"
  | "gif"
  | "heic"
  | "csv"
  | "tsv"
  | "json"
  | "xlsx"
  | "yaml"
  | "md"
  | "html"
  | "pdf"
  | "docx"
  | "txt";

export type ConversionResult = {
  blob: Blob;
  filename: string;
};

/** Per-conversion options. Only image targets currently use these; others ignore. */
export type ConversionOptions = {
  /** 50–100. Applied for lossy outputs (jpg/webp). */
  quality?: number;
  /** Cap the long edge in pixels. null/undefined = keep natural size. */
  maxLongEdge?: number | null;
};

const formatLabels: Record<Format, string> = {
  png: "PNG image",
  jpg: "JPG image",
  webp: "WebP image",
  gif: "GIF image",
  heic: "HEIC image",
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  xlsx: "Excel (.xlsx)",
  yaml: "YAML",
  md: "Markdown",
  html: "HTML",
  pdf: "PDF",
  docx: "Word (.docx)",
  txt: "Plain text",
};

export function formatLabel(f: Format): string {
  return formatLabels[f];
}

export function detectFormat(file: File): Format | null {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "gif") return "gif";
  if (ext === "heic" || ext === "heif") return "heic";
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (ext === "json") return "json";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt") return "txt";
  // Fallback: MIME-based detection for clipboard-pasted images that may
  // not have an extension in the filename.
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.type === "image/heic" || file.type === "image/heif") return "heic";
  return null;
}

export function stripExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}
