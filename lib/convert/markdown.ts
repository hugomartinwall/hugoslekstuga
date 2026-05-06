import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

export async function convertMarkdown(
  file: File,
  from: Format,
  to: Format,
): Promise<ConversionResult> {
  const text = await file.text();
  const base = stripExt(file.name);

  if (from === "md" && to === "html") {
    const { marked } = await import("marked");
    const html = await marked.parse(text, { gfm: true, breaks: false });
    const doc = wrapHtml(base, html);
    return {
      blob: new Blob([doc], { type: "text/html;charset=utf-8" }),
      filename: `${base}.html`,
    };
  }

  if (from === "html" && to === "md") {
    const TurndownMod = (await import("turndown")) as unknown as {
      default: new (opts?: Record<string, unknown>) => {
        turndown: (html: string) => string;
      };
    };
    const td = new TurndownMod.default({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    const md = td.turndown(text);
    return {
      blob: new Blob([md], { type: "text/markdown;charset=utf-8" }),
      filename: `${base}.md`,
    };
  }

  throw new Error(`Unsupported markdown conversion: ${from} → ${to}`);
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1812; }
  pre { background: #f5ecdb; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  blockquote { border-left: 4px solid #ffc233; margin: 1rem 0; padding: 0.25rem 1rem; color: #4a463d; }
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
