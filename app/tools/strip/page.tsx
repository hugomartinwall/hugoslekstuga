"use client";

import { useCallback, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Finding = {
  category: "gps" | "camera" | "time" | "software" | "other";
  label: string;
  value: string;
};

const CATEGORY_TINT: Record<Finding["category"], string> = {
  gps: "bg-tomato-soft",
  camera: "bg-blue-soft",
  time: "bg-purple-soft",
  software: "bg-orange-soft",
  other: "bg-yellow-soft",
};

const CATEGORY_LABEL: Record<Finding["category"], string> = {
  gps: "Location",
  camera: "Camera",
  time: "Time",
  software: "Software",
  other: "Other",
};

function fmtNumber(n: unknown): string {
  if (typeof n !== "number") return String(n);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4);
}

function findingsFromExif(exif: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];

  // GPS
  if (exif.latitude !== undefined && exif.longitude !== undefined) {
    out.push({
      category: "gps",
      label: "GPS coordinates",
      value: `${fmtNumber(exif.latitude)}, ${fmtNumber(exif.longitude)}`,
    });
  }
  if (exif.GPSAltitude !== undefined) {
    out.push({
      category: "gps",
      label: "Altitude",
      value: `${fmtNumber(exif.GPSAltitude)} m`,
    });
  }

  // Camera
  if (exif.Make) out.push({ category: "camera", label: "Camera make", value: String(exif.Make) });
  if (exif.Model) out.push({ category: "camera", label: "Camera model", value: String(exif.Model) });
  if (exif.LensModel) out.push({ category: "camera", label: "Lens", value: String(exif.LensModel) });
  if (exif.FNumber) out.push({ category: "camera", label: "Aperture", value: `f/${fmtNumber(exif.FNumber)}` });
  if (exif.ExposureTime) out.push({ category: "camera", label: "Exposure", value: `${fmtNumber(exif.ExposureTime)}s` });
  if (exif.ISO) out.push({ category: "camera", label: "ISO", value: String(exif.ISO) });

  // Time
  if (exif.DateTimeOriginal) {
    const d = exif.DateTimeOriginal as Date | string;
    out.push({
      category: "time",
      label: "Taken",
      value: d instanceof Date ? d.toLocaleString() : String(d),
    });
  }
  if (exif.ModifyDate) {
    const d = exif.ModifyDate as Date | string;
    out.push({
      category: "time",
      label: "Modified",
      value: d instanceof Date ? d.toLocaleString() : String(d),
    });
  }

  // Software
  if (exif.Software) out.push({ category: "software", label: "Software", value: String(exif.Software) });
  if (exif.HostComputer) out.push({ category: "software", label: "Host computer", value: String(exif.HostComputer) });

  // Other
  if (exif.Copyright) out.push({ category: "other", label: "Copyright", value: String(exif.Copyright) });
  if (exif.Artist) out.push({ category: "other", label: "Artist", value: String(exif.Artist) });
  if (exif.UserComment) out.push({ category: "other", label: "Comment", value: String(exif.UserComment) });
  if (exif.Orientation && exif.Orientation !== 1) {
    out.push({ category: "other", label: "Orientation", value: String(exif.Orientation) });
  }

  return out;
}

export default function StripPage() {
  const tool = findTool("strip")!;
  const [filename, setFilename] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [stripped, setStripped] = useState<{ url: string; size: number } | null>(null);
  const [stripping, setStripping] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [error, setError] = useState<string>("");
  const [hasParsed, setHasParsed] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setError("");
    setStripped(null);
    setHasParsed(false);
    setFilename(file.name);
    setOriginalSize(file.size);
    const url = URL.createObjectURL(file);
    setImageUrl(url);

    try {
      // Dynamically import exifr — only loaded when needed
      const exifr = await import("exifr");
      const exif = (await exifr.parse(file, true)) ?? {};
      const found = findingsFromExif(exif as Record<string, unknown>);
      setFindings(found);
      setHasParsed(true);
    } catch (e) {
      setFindings([]);
      setHasParsed(true);
      // Not an error per se — file just had no EXIF
      console.warn("EXIF parse:", e);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  const stripAndDownload = useCallback(async () => {
    if (!imageUrl || stripping) return;
    setStripping(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("could not load image"));
        img.src = imageUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(img, 0, 0);
      const blob: Blob = await new Promise((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("encode failed"))),
          "image/jpeg",
          0.92,
        );
      });
      const url = URL.createObjectURL(blob);
      setStripped({ url, size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not strip");
    } finally {
      setStripping(false);
    }
  }, [imageUrl, stripping]);

  const downloadStripped = () => {
    if (!stripped) return;
    const a = document.createElement("a");
    a.href = stripped.url;
    a.download = filename.replace(/\.[^.]+$/, "") + "-clean.jpg";
    a.click();
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="card-chunk flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-cream p-6 text-center transition-colors hover:bg-tomato-soft"
        >
          <span className="font-display text-base font-extrabold">
            Drop an image
          </span>
          <span className="text-xs text-ink-muted">
            JPEG, PNG, HEIC · stays in your browser
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

        {error && (
          <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-2 text-sm">
            {error}
          </p>
        )}

        {imageUrl && (
          <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={filename}
              className="max-h-48 rounded-md border-2 border-ink"
            />
            <div className="flex-1 text-sm">
              <p className="font-mono text-xs text-ink-muted">{filename}</p>
              <p className="text-xs text-ink-muted">
                {Math.ceil(originalSize / 1024).toLocaleString()} KB
              </p>
              <div className="mt-2">
                {!hasParsed ? (
                  <p className="text-xs text-ink-muted">…reading metadata…</p>
                ) : findings.length === 0 ? (
                  <p className="text-sm">
                    <span className="font-bold text-green">Already clean.</span>{" "}
                    No EXIF metadata found in this file.
                  </p>
                ) : (
                  <p className="text-sm">
                    <span className="font-bold text-tomato">
                      Found {findings.length} thing
                      {findings.length === 1 ? "" : "s"}.
                    </span>{" "}
                    Strip below to clear.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {findings.length > 0 && (
          <ul className="flex flex-col gap-2">
            {findings.map((f, i) => (
              <li
                key={`${f.label}-${i}`}
                className={`fade-rise card-chunk flex items-center justify-between gap-3 rounded-[var(--radius-card)] p-3 ${CATEGORY_TINT[f.category]}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    {CATEGORY_LABEL[f.category]} · {f.label}
                  </span>
                  <span className="font-mono text-sm">{f.value}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {imageUrl && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={stripAndDownload}
              disabled={stripping}
              className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-6 py-2 font-display text-base font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
            >
              {stripping ? "…stripping…" : "Strip and prepare ↯"}
            </button>
            {stripped && (
              <button
                type="button"
                onClick={downloadStripped}
                className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold"
              >
                Download clean ({Math.ceil(stripped.size / 1024)} KB)
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Strips EXIF (GPS, camera, timestamps), XMP, and any embedded
          thumbnails by re-encoding through a canvas. Output is JPEG.
          Everything happens locally — no upload.
        </p>
      </div>
    </ToolFrame>
  );
}
