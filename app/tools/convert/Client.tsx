"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  detectFormat,
  formatLabel,
  type ConversionOptions,
  type Format,
} from "@/lib/convert/types";
import {
  QUALITY_TARGETS,
  RESIZE_TARGETS,
  runConversion,
  targetsFor,
} from "@/lib/convert/registry";
import { formatBytes } from "@/lib/format";

const IMAGE_FORMATS: Format[] = ["png", "jpg", "webp", "gif"];
const SIZE_CAP_PRESETS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "1280", value: 1280 },
  { label: "1920", value: 1920 },
  { label: "2560", value: 2560 },
];

type Stage =
  | { name: "idle" }
  | { name: "ready"; file: File; from: Format; to: Format }
  | { name: "working"; file: File; from: Format; to: Format }
  | { name: "done"; file: File; url: string; filename: string }
  | { name: "error"; message: string };

export default function ConvertPage() {
  const tool = findTool("convert")!;
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const [quality, setQuality] = useState<number>(85);
  const [maxLongEdge, setMaxLongEdge] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke any object URLs when stage changes/unmounts.
  useEffect(() => {
    return () => {
      if (stage.name === "done") URL.revokeObjectURL(stage.url);
    };
  }, [stage]);

  const acceptFile = useCallback((file: File) => {
    const from = detectFormat(file);
    if (!from) {
      setStage({
        name: "error",
        message: `Sorry — ${file.name || "that file"} is a format I don't recognize yet.`,
      });
      return;
    }
    const targets = targetsFor(from);
    if (targets.length === 0) {
      setStage({
        name: "error",
        message: `${formatLabel(from)} can be read, but no output format is supported yet.`,
      });
      return;
    }
    setStage({ name: "ready", file, from, to: targets[0] });
  }, []);

  const reset = useCallback(() => {
    setStage({ name: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onConvert = useCallback(async () => {
    if (stage.name !== "ready") return;
    const { file, from, to } = stage;
    setStage({ name: "working", file, from, to });
    try {
      const options: ConversionOptions = {
        quality,
        maxLongEdge,
      };
      const result = await runConversion(file, from, to, options);
      const url = URL.createObjectURL(result.blob);
      setStage({ name: "done", file, url, filename: result.filename });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setStage({ name: "error", message });
    }
  }, [stage, quality, maxLongEdge]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => setDragActive(false), []);

  // Paste-from-clipboard. Especially valuable for screenshots — most macOS
  // users have an image in their clipboard half the time. The handler is
  // active in idle and error states so a paste re-engages the tool, and
  // also in ready/done so a quick "actually, this image instead" works.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Don't hijack pastes inside form controls (none on this page yet,
      // but cheap insurance for future).
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            acceptFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptFile]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        {(stage.name === "idle" || stage.name === "error") && (
          <DropZone
            dragActive={dragActive}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onPick={() => inputRef.current?.click()}
          />
        )}

        {stage.name === "ready" && (
          <ReadyPanel
            stage={stage}
            quality={quality}
            setQuality={setQuality}
            maxLongEdge={maxLongEdge}
            setMaxLongEdge={setMaxLongEdge}
            onConvert={onConvert}
            onReset={reset}
            onChangeTarget={(to) =>
              setStage({ name: "ready", file: stage.file, from: stage.from, to })
            }
          />
        )}

        {stage.name === "working" && (
          <div className="card-chunk rounded-[var(--radius-card)] bg-cream p-6 text-center">
            <p className="font-display text-xl font-bold">
              Converting{" "}
              <span className="text-blue">
                {formatLabel(stage.from)} → {formatLabel(stage.to)}
              </span>
              …
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Doing it locally in your browser. No upload.
            </p>
          </div>
        )}

        {stage.name === "done" && (
          <DonePanel stage={stage} onReset={reset} />
        )}

        {stage.name === "error" && (
          <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-4 text-sm font-medium text-ink">
            {stage.message}
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) acceptFile(f);
          }}
        />

        <SupportInfo />
      </div>
    </ToolFrame>
  );
}

function DropZone({
  dragActive,
  onDrop,
  onDragOver,
  onDragLeave,
  onPick,
}: {
  dragActive: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onPick: () => void;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`card-chunk flex flex-col items-center gap-4 rounded-[var(--radius-card)] p-10 text-center transition-colors sm:p-14 ${
        dragActive ? "bg-blue-soft" : "bg-cream"
      }`}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-blue text-2xl"
        aria-hidden
      >
        ⇪
      </div>
      <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        Drop a file here
      </p>
      <p className="text-sm text-ink-soft">or paste, or pick</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onPick}
          className="btn-chunk rounded-[var(--radius-button)] bg-blue px-6 py-3 font-display text-base font-extrabold text-cream"
        >
          Choose a file
        </button>
        <span className="hidden items-center gap-1 text-xs text-ink-muted sm:inline-flex">
          or
          <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
            ⌘V
          </kbd>
          a screenshot
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Files never leave your browser.
      </p>
    </div>
  );
}

function ReadyPanel({
  stage,
  quality,
  setQuality,
  maxLongEdge,
  setMaxLongEdge,
  onConvert,
  onReset,
  onChangeTarget,
}: {
  stage: { name: "ready"; file: File; from: Format; to: Format };
  quality: number;
  setQuality: (n: number) => void;
  maxLongEdge: number | null;
  setMaxLongEdge: (n: number | null) => void;
  onConvert: () => void;
  onReset: () => void;
  onChangeTarget: (t: Format) => void;
}) {
  const targets = targetsFor(stage.from);
  const isImageInput =
    IMAGE_FORMATS.includes(stage.from) || stage.from === "heic";
  const showQuality = QUALITY_TARGETS.includes(stage.to);
  const showResize = RESIZE_TARGETS.includes(stage.to);
  return (
    <div className="card-chunk flex flex-col gap-5 rounded-[var(--radius-card)] bg-cream p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          {isImageInput && stage.from !== "heic" && <ImageThumb file={stage.file} />}
          <div className="flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              File
            </p>
            <p className="font-display text-lg font-bold tracking-tight break-all">
              {stage.file.name}
            </p>
            <p className="text-sm text-ink-soft">
              {formatLabel(stage.from)} · {formatBytes(stage.file.size)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
        >
          Pick a different file
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          htmlFor="convert-target"
        >
          Convert to
        </label>
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChangeTarget(t)}
              className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${
                stage.to === t
                  ? "bg-blue text-cream"
                  : "bg-cream hover:bg-blue-soft"
              }`}
            >
              {formatLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {(showQuality || showResize) && (
        <ImageOptions
          showQuality={showQuality}
          quality={quality}
          setQuality={setQuality}
          showResize={showResize}
          maxLongEdge={maxLongEdge}
          setMaxLongEdge={setMaxLongEdge}
        />
      )}

      <button
        type="button"
        onClick={onConvert}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-blue px-6 py-3 font-display text-base font-extrabold text-cream"
      >
        Convert →
      </button>
    </div>
  );
}

function ImageOptions({
  showQuality,
  quality,
  setQuality,
  showResize,
  maxLongEdge,
  setMaxLongEdge,
}: {
  showQuality: boolean;
  quality: number;
  setQuality: (n: number) => void;
  showResize: boolean;
  maxLongEdge: number | null;
  setMaxLongEdge: (n: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Image options
      </p>
      {showQuality && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-ink">Quality</span>
            <span className="font-mono text-xs tabular-nums text-ink">
              {quality}
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full accent-blue"
            aria-label="Output quality"
          />
          <p className="text-[11px] text-ink-muted">
            Lower means smaller file size, more visible compression. 85 is a
            sensible default.
          </p>
        </div>
      )}
      {showResize && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-ink">
              Cap long edge
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-muted">
              {maxLongEdge ? `${maxLongEdge}px` : "off"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SIZE_CAP_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setMaxLongEdge(p.value)}
                className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                  maxLongEdge === p.value
                    ? "bg-blue text-cream"
                    : "bg-cream hover:bg-blue-soft"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-muted">
            Shrinks oversized images. Smaller sources are left at their
            original size.
          </p>
        </div>
      )}
    </div>
  );
}

function ImageThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  // Wraps an external resource (object URL) into React state with proper
  // lifecycle — has to be in an effect so the cleanup runs on unmount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border-2 border-ink bg-cream-deep">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Preview"
          className="h-full w-full object-cover"
        />
      ) : null}
    </div>
  );
}

function DonePanel({
  stage,
  onReset,
}: {
  stage: { name: "done"; file: File; url: string; filename: string };
  onReset: () => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-5 rounded-[var(--radius-card)] bg-green-soft p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-green text-lg">
          ✓
        </div>
        <p className="font-display text-xl font-bold">Done.</p>
      </div>
      <p className="text-sm text-ink-soft">
        Your file is ready: <span className="font-bold">{stage.filename}</span>
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href={stage.url}
          download={stage.filename}
          className="btn-chunk rounded-[var(--radius-button)] bg-green px-6 py-3 font-display text-base font-extrabold text-cream"
        >
          Download
        </a>
        <button
          type="button"
          onClick={onReset}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-6 py-3 font-display text-base font-extrabold"
        >
          Convert another file
        </button>
      </div>
    </div>
  );
}

function SupportInfo() {
  return (
    <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-4 text-sm">
      <summary className="cursor-pointer font-display text-base font-bold">
        What can it convert?
      </summary>
      <ul className="mt-3 flex flex-col gap-1 pl-4 text-ink-soft">
        <li>
          <strong>Images:</strong> PNG ↔ JPG ↔ WebP ↔ GIF · plus quality and
          size controls
        </li>
        <li>
          <strong>HEIC →</strong> JPG / PNG / WebP (the iPhone format)
        </li>
        <li>
          <strong>Tabular:</strong> CSV ↔ TSV ↔ JSON ↔ Excel (.xlsx)
        </li>
        <li>
          <strong>YAML ↔ JSON</strong> (for configs, k8s, GitHub Actions)
        </li>
        <li>
          <strong>Markdown ↔ HTML</strong>
        </li>
        <li>
          <strong>PDF →</strong> plain text, or first page as PNG
        </li>
        <li>
          <strong>Word (.docx) →</strong> HTML, Markdown, or plain text
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        Conversions out of PDF or DOCX into other office formats need
        server-side tools and aren&rsquo;t in this version. Everything you
        see here runs locally — no upload.
      </p>
    </details>
  );
}
