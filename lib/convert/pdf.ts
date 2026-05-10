import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

export async function convertPdf(
  file: File,
  to: Format,
): Promise<ConversionResult> {
  if (to !== "txt" && to !== "png") {
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

  if (to === "txt") {
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

  // PNG: render the first page at 2× scale for crispness. Multi-page PDFs
  // collapse to "page 1 thumbnail" — useful for OG images, deck covers,
  // README hero shots. Multi-page export would need a zip and is out of
  // scope for this pass.
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed."))),
      "image/png",
    );
  });
  return {
    blob,
    filename: `${stripExt(file.name)}-page1.png`,
  };
}
