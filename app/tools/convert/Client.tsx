"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  detectFormat,
  formatLabel,
  type Format,
} from "@/lib/convert/types";
import { runConversion, targetsFor } from "@/lib/convert/registry";
import { formatBytes } from "@/lib/format";

const IMAGE_FORMATS: Format[] = ["png", "jpg", "webp", "gif"];

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
        message: `Sorry — ${file.name} is a format I don't recognize yet.`,
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
      const result = await runConversion(file, from, to);
      const url = URL.createObjectURL(result.blob);
      setStage({ name: "done", file, url, filename: result.filename });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setStage({ name: "error", message });
    }
  }, [stage]);

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
      <p className="text-sm text-ink-soft">or</p>
      <button
        type="button"
        onClick={onPick}
        className="btn-chunk rounded-[var(--radius-button)] bg-blue px-6 py-3 font-display text-base font-extrabold text-cream"
      >
        Choose a file
      </button>
      <p className="mt-2 text-xs text-ink-muted">
        Files never leave your browser.
      </p>
    </div>
  );
}

function ReadyPanel({
  stage,
  onConvert,
  onReset,
  onChangeTarget,
}: {
  stage: { name: "ready"; file: File; from: Format; to: Format };
  onConvert: () => void;
  onReset: () => void;
  onChangeTarget: (t: Format) => void;
}) {
  const targets = targetsFor(stage.from);
  const isImage = IMAGE_FORMATS.includes(stage.from);
  return (
    <div className="card-chunk flex flex-col gap-5 rounded-[var(--radius-card)] bg-cream p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          {isImage && <ImageThumb file={stage.file} />}
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
          <strong>Images:</strong> PNG ↔ JPG ↔ WebP ↔ GIF
        </li>
        <li>
          <strong>Tabular:</strong> CSV ↔ JSON ↔ Excel (.xlsx)
        </li>
        <li>
          <strong>Markdown ↔ HTML</strong>
        </li>
        <li>
          <strong>PDF →</strong> plain text
        </li>
        <li>
          <strong>Word (.docx) →</strong> HTML or plain text
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        Conversions out of PDF/DOCX into other office formats need server-side
        tools and aren&rsquo;t in this version.
      </p>
    </details>
  );
}
