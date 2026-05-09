"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ToolColor } from "@/lib/tools";
import { bgClass, bgSoftClass, preferredTextClass } from "@/lib/colors";

/**
 * Shared drop zone — drag-and-drop area with a click-to-browse fallback.
 *
 * Tools that compose extra logic around the file pick (PDF merge's
 * multi-file queue, Convert's format detection bridge) keep their own
 * inline implementations. This component covers the "drop one file, do
 * one thing with it" case the simplest tools share.
 */
export default function DropZone({
  color,
  emoji = "⇪",
  primary,
  buttonLabel = "Choose a file",
  hint,
  onFile,
  acceptMime,
  multiple = false,
  onFiles,
  extra,
}: {
  color: ToolColor;
  emoji?: string;
  primary: string;
  buttonLabel?: string;
  hint?: string;
  onFile: (file: File) => void;
  onFiles?: (files: File[]) => void;
  acceptMime?: string;
  multiple?: boolean;
  extra?: ReactNode;
}) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (multiple && onFiles) {
      onFiles(Array.from(files));
    } else {
      onFile(files[0]);
    }
  };

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragActive) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      className={`card-chunk flex flex-col items-center gap-4 rounded-[var(--radius-card)] p-10 text-center transition-colors ${
        dragActive ? bgSoftClass(color) : "bg-cream"
      }`}
    >
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink ${bgClass(color)} text-2xl ${preferredTextClass(color)}`}
        aria-hidden
      >
        {emoji}
      </div>
      <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {primary}
      </p>
      <p className="text-sm text-ink-soft">or</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`btn-chunk rounded-[var(--radius-button)] ${bgClass(color)} px-6 py-3 font-display text-base font-extrabold ${preferredTextClass(color)}`}
      >
        {buttonLabel}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={acceptMime}
        multiple={multiple}
        onChange={(e) => {
          handleFiles(e.target.files);
          // Allow re-picking the same file by resetting the input value.
          e.target.value = "";
        }}
        className="hidden"
      />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      {extra}
    </div>
  );
}
