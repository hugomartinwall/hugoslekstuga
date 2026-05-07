import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

export async function convertPdf(
  file: File,
  to: Format,
): Promise<ConversionResult> {
  if (to !== "txt") {
    throw new Error(`Unsupported PDF output: ${to}`);
  }

  // Lazy-load pdfjs only when called — its internals touch DOM/worker APIs.
  const pdfjs = await import("pdfjs-dist");
  // Worker is vendored at /public/vendor/pdf.worker.min.mjs (copied from
  // node_modules/pdfjs-dist/build at build time). The site's promise is
  // "stays in your browser" — pulling the worker from unpkg.com would
  // make a runtime CDN call, breaking that promise and offline use.
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    parts.push(`# Page ${p}\n\n${pageText}`);
  }

  const text = parts.join("\n\n");
  return {
    blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
    filename: `${stripExt(file.name)}.txt`,
  };
}
