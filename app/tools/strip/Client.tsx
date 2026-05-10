"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import Slider from "@/components/Slider";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

type Finding = {
  category: "gps" | "camera" | "time" | "software" | "other";
  label: string;
  value: string;
};

type OutFormat = "auto" | "jpeg" | "png" | "webp";

type StripSettings = {
  format: OutFormat;
  quality: number; // 60..100, only meaningful for jpeg / webp output
};

const SETTINGS_KEY = "hugoslekstuga:strip:settings";
const DEFAULT_SETTINGS: StripSettings = { format: "auto", quality: 92 };

const FORMAT_OPTIONS: { value: OutFormat; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

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

function resolveOutType(
  format: OutFormat,
  originalType: string,
): "image/png" | "image/jpeg" | "image/webp" {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  // auto: keep PNG lossless; otherwise re-encode to JPEG.
  return originalType === "image/png" ? "image/png" : "image/jpeg";
}

function extForType(type: string): "png" | "jpg" | "webp" {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export default function StripPage() {
  const tool = findTool("strip")!;
  const [filename, setFilename] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [stripped, setStripped] = useState<{ url: string; size: number; type: string } | null>(null);
  const [stripping, setStripping] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [originalType, setOriginalType] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [hasParsed, setHasParsed] = useState(false);

  const [settings, setSettings] = useLocalStorageState<StripSettings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );

  // Defensive reads — older persisted shapes might be missing fields.
  const format: OutFormat = settings.format ?? "auto";
  const quality: number = settings.quality ?? 92;

  const resolvedOutType = resolveOutType(format, originalType);
  const showQualitySlider = resolvedOutType !== "image/png";

  const clearStripped = useCallback(() => {
    setStripped((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      clearStripped();
      setHasParsed(false);
      setFilename(file.name);
      setOriginalSize(file.size);
      setOriginalType(file.type);
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });

      try {
        const exifr = await import("exifr");
        const exif = (await exifr.parse(file, true)) ?? {};
        const found = findingsFromExif(exif as Record<string, unknown>);
        setFindings(found);
        setHasParsed(true);
      } catch (e) {
        setFindings([]);
        setHasParsed(true);
        // Not an error — file just had no EXIF.
        console.warn("EXIF parse:", e);
      }
    },
    [clearStripped],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  // Paste-from-clipboard. Screenshots are the natural feed for strip —
  // most macOS users have an image in the clipboard half the time, and
  // a fresh screenshot still carries Software / HostComputer / timestamp.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
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
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleFile(f);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  const stripAndDownload = useCallback(async () => {
    if (!imageUrl || stripping) return;
    setStripping(true);
    try {
      // Use createImageBitmap with imageOrientation: "from-image" so EXIF
      // orientation flags are baked into the pixel data and the canvas
      // dimensions reflect the *visual* width/height.
      const fileForBitmap = await fetch(imageUrl).then((r) => r.blob());
      const bitmap = await createImageBitmap(fileForBitmap, {
        imageOrientation: "from-image",
      });

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const outType = resolveOutType(format, originalType);
      const isLossy = outType !== "image/png";
      const outQuality = isLossy ? quality / 100 : undefined;

      const blob: Blob = await new Promise((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("encode failed"))),
          outType,
          outQuality,
        );
      });
      // Revoke the previous stripped URL before we replace it.
      setStripped((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), size: blob.size, type: outType };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not strip");
    } finally {
      setStripping(false);
    }
  }, [imageUrl, stripping, format, quality, originalType]);

  const downloadStripped = () => {
    if (!stripped) return;
    const a = document.createElement("a");
    a.href = stripped.url;
    a.download =
      filename.replace(/\.[^.]+$/, "") + `-clean.${extForType(stripped.type)}`;
    a.click();
  };

  // Changing format or quality invalidates the prepared blob — otherwise
  // the user could click Download and get a stale file from the old
  // settings. Clearing forces a fresh Strip click.
  const setFormat = (next: OutFormat) => {
    setSettings((s) => ({ ...s, format: next }));
    clearStripped();
  };

  const setQuality = (next: number) => {
    setSettings((s) => ({ ...s, quality: next }));
    clearStripped();
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
            Drop or paste an image
          </span>
          <span className="text-xs text-ink-muted">
            JPEG, PNG, HEIC · stays in your browser
          </span>
          <span className="text-[10px] text-ink-muted">
            <kbd className="rounded border border-ink-soft bg-cream-deep px-1.5 py-0.5 font-mono">
              ⌘V
            </kbd>{" "}
            also works
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
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Format
              </span>
              {FORMAT_OPTIONS.map((opt) => {
                const active = format === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormat(opt.value)}
                    className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                      active
                        ? "bg-tomato text-cream"
                        : "bg-cream hover:bg-tomato-soft"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              <span className="text-[10px] text-ink-muted">
                {format === "auto"
                  ? `→ ${extForType(resolvedOutType).toUpperCase()} (matches input)`
                  : `→ ${extForType(resolvedOutType).toUpperCase()}`}
              </span>
            </div>
            {showQualitySlider && (
              <Slider
                label="Quality"
                value={quality}
                min={60}
                max={100}
                step={1}
                unit="%"
                onChange={setQuality}
                color="tomato"
                hint="Higher = bigger file, closer to source. PNG is lossless and ignores this."
              />
            )}
          </div>
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

        {stripped && (
          <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream-deep p-4">
            <div className="grid grid-cols-2 gap-3">
              <figure className="flex flex-col gap-1">
                <figcaption className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Before
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="before"
                  className="max-h-40 w-full rounded-md border-2 border-ink object-contain"
                />
                <span className="text-[10px] text-ink-muted">
                  {Math.ceil(originalSize / 1024).toLocaleString()} KB ·{" "}
                  {findings.length} bit{findings.length === 1 ? "" : "s"} of metadata
                </span>
              </figure>
              <figure className="flex flex-col gap-1">
                <figcaption className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  After
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stripped.url}
                  alt="after"
                  className="max-h-40 w-full rounded-md border-2 border-ink object-contain"
                />
                <span className="text-[10px] text-ink-muted">
                  {Math.ceil(stripped.size / 1024).toLocaleString()} KB ·{" "}
                  <span className="font-semibold text-green">clean</span>
                </span>
              </figure>
            </div>
            <p className="text-[10px] text-ink-muted">
              Pixels intact, metadata gone.
            </p>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Re-encoding through a canvas physically erases EXIF, XMP, and any
          embedded thumbnails. The file never leaves the browser.
        </p>
      </div>
    </ToolFrame>
  );
}
