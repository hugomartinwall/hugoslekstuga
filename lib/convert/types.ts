export type Format =
  | "png"
  | "jpg"
  | "webp"
  | "gif"
  | "csv"
  | "json"
  | "xlsx"
  | "md"
  | "html"
  | "pdf"
  | "docx"
  | "txt";

export type ConversionResult = {
  blob: Blob;
  filename: string;
};

export type Conversion = {
  from: Format;
  to: Format;
  label: string;
  run: (file: File) => Promise<ConversionResult>;
};

const formatLabels: Record<Format, string> = {
  png: "PNG image",
  jpg: "JPG image",
  webp: "WebP image",
  gif: "GIF image",
  csv: "CSV",
  json: "JSON",
  xlsx: "Excel (.xlsx)",
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
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt") return "txt";
  return null;
}

export function stripExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}
