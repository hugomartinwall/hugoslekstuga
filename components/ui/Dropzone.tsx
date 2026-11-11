"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A place to put a file: drop one on it, click it, or tab to it and
 * press Enter. The file input is visually hidden but still focusable,
 * so the keyboard reaches the picker; while something is dragged over,
 * the frame turns the accent colour.
 *
 * It hands back the files and nothing else. Paste handling, format
 * rules and what happens next stay with the tool.
 */
export default function Dropzone({
  title,
  hint,
  accept,
  multiple = false,
  onFiles,
  className = "",
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  /** Extra content under the hint (a key legend, a note). */
  children?: ReactNode;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`card-chunk flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${
        over ? "is-on bg-(--accent-soft)" : "bg-cream-deep"
      } ${className}`.trim()}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          // Let the same file be chosen twice in a row.
          e.target.value = "";
        }}
      />
      <span className="font-display text-2xl leading-tight text-ink">{title}</span>
      {hint ? <span className="text-sm text-ink-soft">{hint}</span> : null}
      {children}
    </label>
  );
}
