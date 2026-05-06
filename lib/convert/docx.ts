import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

export async function convertDocx(
  file: File,
  to: Format,
): Promise<ConversionResult> {
  const mammoth = (await import("mammoth")) as unknown as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };

  const arrayBuffer = await file.arrayBuffer();
  const base = stripExt(file.name);

  if (to === "html") {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const doc = wrapHtml(base, result.value);
    return {
      blob: new Blob([doc], { type: "text/html;charset=utf-8" }),
      filename: `${base}.html`,
    };
  }

  if (to === "txt") {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return {
      blob: new Blob([result.value], { type: "text/plain;charset=utf-8" }),
      filename: `${base}.txt`,
    };
  }

  throw new Error(`Unsupported DOCX output: ${to}`);
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1812; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
