"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const RAMPS: { id: string; label: string; chars: string }[] = [
  { id: "blocks", label: "Blocks", chars: " ░▒▓█" },
  { id: "ascii", label: "Classic ASCII", chars: " .:-=+*#%@" },
  { id: "dense", label: "Dense", chars: ' .`\'^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$' },
  { id: "binary", label: "Binary", chars: " █" },
];

type Mode = "mono" | "color";

export default function AsciiPage() {
  const tool = findTool("ascii")!;
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [width, setWidth] = useState(80);
  const [contrast, setContrast] = useState(1.0);
  const [rampId, setRampId] = useState("ascii");
  const [mode, setMode] = useState<Mode>("mono");
  const [output, setOutput] = useState<string>("");
  const [colorOutput, setColorOutput] = useState<{ ch: string; color: string }[][]>([]);
  const [copied, setCopied] = useState(false);
  const dropRef = useRef<HTMLLabelElement>(null);

  const ramp = RAMPS.find((r) => r.id === rampId) ?? RAMPS[1];

  const generate = useCallback(
    (img: HTMLImageElement) => {
      const targetWidth = width;
      const aspect = img.height / img.width;
      // Characters are taller than wide — compensate
      const targetHeight = Math.max(1, Math.round(targetWidth * aspect * 0.5));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const data = ctx.getImageData(0, 0, targetWidth, targetHeight).data;

      const lines: string[] = [];
      const colorLines: { ch: string; color: string }[][] = [];
      const rampChars = ramp.chars;
      const rampLen = rampChars.length;
      for (let y = 0; y < targetHeight; y++) {
        let line = "";
        const colorRow: { ch: string; color: string }[] = [];
        for (let x = 0; x < targetWidth; x++) {
          const i = (y * targetWidth + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Perceptual luminance
          let l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          // Apply contrast
          l = Math.max(0, Math.min(1, (l - 0.5) * contrast + 0.5));
          const idx = Math.min(rampLen - 1, Math.floor(l * rampLen));
          const ch = rampChars[idx];
          line += ch;
          colorRow.push({ ch, color: `rgb(${r}, ${g}, ${b})` });
        }
        lines.push(line);
        colorLines.push(colorRow);
      }
      setOutput(lines.join("\n"));
      setColorOutput(colorLines);
    },
    [width, contrast, ramp],
  );

  useEffect(() => {
    if (imageEl) generate(imageEl);
  }, [imageEl, generate]);

  const handleFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImageEl(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <label
          ref={dropRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream p-6 text-center transition-colors hover:bg-green-soft"
        >
          <span className="font-display text-base font-extrabold">
            Drop an image
          </span>
          <span className="text-xs text-ink-muted">
            or click to choose · stays in your browser
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="hidden"
          />
        </label>

        {imageEl && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Slider
                label="Width (cols)"
                value={width}
                min={20}
                max={160}
                onChange={setWidth}
              />
              <Slider
                label="Contrast"
                value={Math.round(contrast * 100)}
                min={50}
                max={250}
                onChange={(v) => setContrast(v / 100)}
                unit="%"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Density
              </span>
              {RAMPS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRampId(r.id)}
                  className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    rampId === r.id ? "bg-green text-cream" : "bg-cream hover:bg-green-soft"
                  }`}
                >
                  {r.label}
                </button>
              ))}
              <span className="ml-auto text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Mode
              </span>
              {(["mono", "color"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    mode === m ? "bg-green text-cream" : "bg-cream hover:bg-green-soft"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <pre
              className="card-chunk overflow-x-auto rounded-[var(--radius-card)] bg-cream-deep p-3 font-mono leading-[1] text-[8px] sm:text-[10px]"
              style={{ whiteSpace: "pre" }}
            >
              {mode === "mono"
                ? output
                : colorOutput.map((row, y) => (
                    <div key={y} style={{ lineHeight: 1 }}>
                      {row.map((c, x) => (
                        <span key={x} style={{ color: c.color }}>{c.ch}</span>
                      ))}
                    </div>
                  ))}
            </pre>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="btn-chunk rounded-[var(--radius-button)] bg-green px-5 py-2 font-display text-base font-extrabold text-cream"
              >
                {copied ? "Copied!" : "Copy text"}
              </button>
            </div>
          </>
        )}

        <p className="text-xs text-ink-muted">
          Photos work best with the &ldquo;Dense&rdquo; ramp. Logos and silhouettes
          look great with &ldquo;Blocks&rdquo;.
        </p>
      </div>
    </ToolFrame>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-md border-2 border-ink bg-cream-deep p-2 text-xs">
      <span className="flex items-center justify-between font-semibold uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink">
          {value}
          {unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-green"
      />
    </label>
  );
}
