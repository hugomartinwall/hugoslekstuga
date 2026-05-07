"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Mode = "encode" | "decode";

export default function Base64Page() {
  const tool = findTool("base64")!;
  const [mode, setMode] = useState<Mode>("encode");
  const [dataUrl, setDataUrl] = useState<string>("");
  const [pasted, setPasted] = useState<string>("");
  const [previewError, setPreviewError] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDataUrl(reader.result);
        setPreviewError("");
      }
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const copyDataUrl = async () => {
    if (!dataUrl) return;
    try {
      await navigator.clipboard.writeText(dataUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const downloadFromPasted = useCallback(() => {
    if (!pasted) return;
    const a = document.createElement("a");
    a.href = pasted;
    // Detect ext from MIME
    const m = pasted.match(/^data:image\/([\w.+-]+);/);
    const ext = m ? m[1].split("+")[0] : "img";
    a.download = `decoded.${ext === "svg" ? "svg" : ext}`;
    a.click();
  }, [pasted]);

  // Validate pasted data URL
  useEffect(() => {
    if (!pasted) {
      setPreviewError("");
      return;
    }
    if (!pasted.startsWith("data:image/")) {
      setPreviewError("Pasted text doesn't look like a data URL (data:image/…)");
    } else {
      setPreviewError("");
    }
  }, [pasted]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-center gap-0 self-center rounded-full border-2 border-ink bg-cream p-0.5 text-xs font-bold">
          {(["encode", "decode"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                mode === m ? "bg-blue text-cream" : "text-ink-soft"
              }`}
            >
              {m === "encode" ? "Image → data URL" : "Data URL → image"}
            </button>
          ))}
        </div>

        {mode === "encode" ? (
          <>
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream p-6 text-center transition-colors hover:bg-blue-soft"
            >
              <span className="font-display text-base font-extrabold">
                Drop an image
              </span>
              <span className="text-xs text-ink-muted">
                or click to choose · stays in your browser
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="hidden"
              />
            </label>

            {dataUrl && (
              <>
                <div className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-blue-soft p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={dataUrl}
                    alt="Encoded preview"
                    className="max-h-64 rounded-md border-2 border-ink"
                  />
                  <span className="font-mono text-xs text-ink-muted">
                    {Math.ceil(dataUrl.length / 1024).toLocaleString()} KB
                    encoded
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Data URL
                  </p>
                  <textarea
                    value={dataUrl}
                    readOnly
                    rows={4}
                    className="card-chunk min-h-[100px] rounded-[var(--radius-card)] bg-cream-deep p-3 font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={copyDataUrl}
                      className="btn-chunk rounded-[var(--radius-button)] bg-blue px-5 py-2 font-display text-sm font-extrabold text-cream"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDataUrl("")}
                      className="text-xs font-semibold text-ink-muted hover:text-ink"
                    >
                      clear
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="data:image/png;base64,iVBORw0KGgoAAAA…"
              rows={6}
              className="card-chunk min-h-[140px] rounded-[var(--radius-card)] bg-cream p-3 font-mono text-xs focus:outline-none"
            />
            {previewError && (
              <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-2 text-xs">
                {previewError}
              </p>
            )}
            {pasted && !previewError && (
              <div className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-blue-soft p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pasted}
                  alt="Decoded preview"
                  className="max-h-64 rounded-md border-2 border-ink"
                  onError={() =>
                    setPreviewError("Couldn't render — the data URL may be invalid.")
                  }
                />
                <button
                  type="button"
                  onClick={downloadFromPasted}
                  className="btn-chunk rounded-[var(--radius-button)] bg-blue px-5 py-2 font-display text-sm font-extrabold text-cream"
                >
                  Download
                </button>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-ink-muted">
          Data URLs let you embed an image directly in CSS, JSON, or HTML —
          no separate file. Useful for icons, but heavy for big images.
        </p>
      </div>
    </ToolFrame>
  );
}
