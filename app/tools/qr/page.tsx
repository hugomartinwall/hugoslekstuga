"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Level = "L" | "M" | "Q" | "H";
type Size = 256 | 512 | 1024;

export default function QrPage() {
  const tool = findTool("qr")!;
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Level>("M");
  const [size, setSize] = useState<Size>(512);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const trimmed = useMemo(() => text.trim(), [text]);

  useEffect(() => {
    if (!trimmed) {
      setPngUrl(null);
      setSvgString(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QR = await import("qrcode");
        const canvas = canvasRef.current;
        if (canvas) {
          await QR.toCanvas(canvas, trimmed, {
            errorCorrectionLevel: level,
            width: size,
            margin: 2,
            color: { dark: "#1a1812", light: "#fbf6ee" },
          });
          if (!cancelled) setPngUrl(canvas.toDataURL("image/png"));
        }
        const svg = await QR.toString(trimmed, {
          type: "svg",
          errorCorrectionLevel: level,
          margin: 2,
          color: { dark: "#1a1812", light: "#fbf6ee" },
        });
        if (!cancelled) {
          setSvgString(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't make a QR for that input.",
          );
          setPngUrl(null);
          setSvgString(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmed, level, size]);

  const downloadPng = () => {
    if (!pngUrl) return;
    triggerDownload(pngUrl, "qr-code.png");
  };

  const downloadSvg = () => {
    if (!svgString) return;
    const url = URL.createObjectURL(
      new Blob([svgString], { type: "image/svg+xml" }),
    );
    triggerDownload(url, "qr-code.svg");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ToolFrame tool={tool}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:gap-10">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="qr-text"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Text or URL
            </label>
            <textarea
              id="qr-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://hugoslekstuga.se"
              rows={4}
              className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Error correction
            </p>
            <div className="flex flex-wrap gap-2">
              {(["L", "M", "Q", "H"] as Level[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                    level === l
                      ? "bg-tomato text-cream"
                      : "bg-cream hover:bg-tomato-soft"
                  }`}
                >
                  {labelForLevel(l)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Image size (PNG export)
            </p>
            <div className="flex flex-wrap gap-2">
              {([256, 512, 1024] as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                    size === s
                      ? "bg-tomato text-cream"
                      : "bg-cream hover:bg-tomato-soft"
                  }`}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 self-start">
          <div
            className={`card-chunk flex aspect-square w-full max-w-xs items-center justify-center rounded-[var(--radius-card)] bg-cream p-3 ${
              !trimmed ? "border-dashed" : ""
            }`}
          >
            {trimmed ? (
              <canvas
                ref={canvasRef}
                className="h-full w-full"
                aria-label="Generated QR code"
              />
            ) : (
              <p className="text-center text-sm text-ink-muted">
                Type something to see a QR code.
              </p>
            )}
          </div>

          {trimmed && pngUrl && svgString && (
            <div className="flex w-full max-w-xs flex-col gap-2">
              <button
                type="button"
                onClick={downloadPng}
                className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-4 py-2 font-display text-base font-extrabold text-cream"
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={downloadSvg}
                className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-2 font-display text-base font-extrabold"
              >
                Download SVG
              </button>
            </div>
          )}
        </div>
      </div>
    </ToolFrame>
  );
}

function labelForLevel(l: Level): string {
  switch (l) {
    case "L":
      return "L · 7%";
    case "M":
      return "M · 15%";
    case "Q":
      return "Q · 25%";
    case "H":
      return "H · 30%";
  }
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
