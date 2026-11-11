"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A place to put a file: drop one on it, click it, or tab to it and
 * press Enter. The file input is visually hidden but still focusable,
 * so the keyboard reaches the picker; while something is dragged over,
 * the frame turns the accent colour.
 *
 * It hands back the files and how they came, and nothing else. Paste
 * handling, format rules and what happens next stay with the tool. The
 * picker has already filtered by `accept`; a drop has not, so a tool
 * that must not take just anything checks what was dropped.
 *
 * `size`
 *   roomy   the default: the dropzone is what the page is about
 *   slim    a bar: there is already a picture and this is "another one"
 */
export default function Dropzone({
  title,
  hint,
  accept,
  multiple = false,
  onFiles,
  size = "roomy",
  className = "",
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[], from: "drop" | "picker") => void;
  size?: "roomy" | "slim";
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
      onDragLeave={(e) => {
        // Leaving for one of its own children (the title, the hint) is
        // not leaving: without this the lit frame flickers as a dragged
        // file crosses the words.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1), "drop");
      }}
      className={`card-chunk flex flex-col items-center justify-center gap-2 px-6 text-center ${
        size === "slim" ? "py-3" : "py-10"
      } ${over ? "is-on bg-(--accent-soft)" : "bg-cream-deep"} ${className}`.trim()}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files, "picker");
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
