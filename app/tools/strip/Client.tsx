"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import Slider from "@/components/Slider";
import { ChipGroup } from "@/components/ui/Chip";
import Dropzone from "@/components/ui/Dropzone";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import { isTextEntry } from "@/lib/keyboard";
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

/**
 * A picture on the page: fitted whole inside a square-cornered hairline
 * frame of a set size, on a 4px page-dark mount. The mount is what keeps
 * a picture that almost fills its frame from looking like a frame with
 * two thick sides. Each use adds the frame's size.
 *
 * The text classes only show when the browser cannot draw the file (a
 * HEIC in Chrome, say). The frame then holds the file's name, and they
 * keep it small, muted and wrapped; left alone it is large, white and
 * cut off where the frame ends.
 */
const THUMB =
  "border border-line bg-cream object-contain p-1 text-xs text-ink-muted wrap-anywhere";

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

  // This page has always taken whatever the picker returns, but only an
  // image from a drop. So a drop is noted on its way down to the dropzone
  // (capture) and the note is cleared on its way back up.
  const dropped = useRef(false);
  const onFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (dropped.current && !f.type.startsWith("image/")) return;
    handleFile(f);
  };

  // Paste-from-clipboard. Screenshots are the natural feed for strip —
  // most macOS users have an image in the clipboard half the time, and
  // a fresh screenshot still carries Software / HostComputer / timestamp.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // A paste into a text field is that field's. Anything else on the
      // page (a format chip, the slider, the dropzone, nothing at all)
      // has no use for a picture, so the paste loads it.
      if (isTextEntry(e.target)) return;
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
      <div
        className="flex flex-col gap-4 sm:gap-5"
        onDropCapture={() => {
          dropped.current = true;
        }}
        onDrop={() => {
          dropped.current = false;
        }}
        onPaste={onPasteInControl}
      >
        {/* Roomy while it is the whole page, a slim bar once there is a
            picture: then the first screen belongs to the picture and the
            key that strips it. The bar is built like Pixla's: the hint
            drops a size, and the key legend, which sits on its own line
            in the roomy dropzone, runs on after it. The legend is a
            keyboard shortcut, so it is not shown where there is no
            keyboard; there the hint, if it has to wrap, breaks in the
            middle (balanced) instead of leaving one word behind. */}
        <Dropzone
          title="Drop or paste an image"
          hint={
            <span
              className={
                imageUrl
                  ? "block text-xs leading-5 pointer-coarse:text-balance"
                  : "block text-balance"
              }
            >
              JPEG, PNG, HEIC · stays in your browser{" "}
              <span
                className={`h-5 items-center gap-1.5 text-xs text-ink-muted pointer-coarse:hidden ${
                  imageUrl
                    ? "mx-1.5 inline-flex align-top whitespace-nowrap"
                    : "mt-2 flex justify-center"
                }`}
              >
                <kbd className="kbd-chunk">⌘V</kbd> also works
              </span>
            </span>
          }
          accept="image/*"
          onFiles={onFiles}
          size={imageUrl ? "slim" : "roomy"}
        />

        {imageUrl && (
          <Panel className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
            {/* The frame is a set size, so a panorama, a portrait and an
                icon all leave the panel the same height and nothing is
                ever stretched out of shape. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={filename}
              className={`h-25 w-25 shrink-0 sm:h-40 sm:w-56 ${THUMB}`}
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="wrap-anywhere text-xs text-ink-muted">{filename}</p>
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
          </Panel>
        )}

        {/* The order from here on is: how to save it, the keys, what went
            wrong, the result, and only then the list of what was found.
            The list can run to a dozen rows, and it used to sit between
            "Strip below to clear." and the key that does it. */}
        {imageUrl && (
          <Panel className="flex flex-col gap-4 p-3 sm:p-4">
            <div className="flex flex-col gap-1.5">
              {/* Label on the left, what it comes to on the right: the
                  same line the quality slider has. */}
              <div className="flex items-center justify-between gap-3">
                <span id="strip-format-label" className="label-pixel">
                  Format
                </span>
                <span className="text-xs text-ink-muted">
                  {format === "auto"
                    ? `→ ${extForType(resolvedOutType).toUpperCase()} (matches input)`
                    : `→ ${extForType(resolvedOutType).toUpperCase()}`}
                </span>
              </div>
              {/* On a phone the four share the row edge to edge, with a
                  little less padding so they still fit one row at 320px. */}
              <ChipGroup
                labelledBy="strip-format-label"
                options={FORMAT_OPTIONS}
                value={format}
                onChange={setFormat}
                chipClassName="max-sm:flex-auto max-sm:px-2"
              />
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
                hint="Higher = bigger file, closer to source. PNG is lossless and ignores this."
              />
            )}
          </Panel>
        )}

        {imageUrl && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Busy, not unavailable: it keeps most of its colour and the
                pointer says "working". The width is held from `sm` up so
                the key does not shrink around "…stripping…" and jolt the
                one beside it. */}
            <Keycap
              tone="accent"
              size="lg"
              onClick={stripAndDownload}
              disabled={stripping}
              className="disabled:cursor-progress disabled:opacity-80 sm:min-w-60"
            >
              {stripping ? "…stripping…" : "Strip and prepare ↯"}
            </Keycap>
            {stripped && (
              <Keycap size="lg" onClick={downloadStripped}>
                Download clean ({Math.ceil(stripped.size / 1024)} KB)
              </Keycap>
            )}
          </div>
        )}

        {/* Under the key that caused it, where the eye already is. */}
        {error && (
          <Panel
            as="p"
            tone="danger"
            className="px-4 py-3 text-sm [--ring-c:var(--color-tomato)]"
          >
            {error}
          </Panel>
        )}

        {stripped && (
          <Panel className="flex flex-col gap-3 p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-3">
              <figure className="flex min-w-0 flex-col gap-1">
                <figcaption className="label-pixel">Before</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="before"
                  className={`h-28 w-full sm:h-40 ${THUMB}`}
                />
                <span className="text-xs text-ink-muted">
                  {Math.ceil(originalSize / 1024).toLocaleString()} KB ·{" "}
                  {findings.length} bit{findings.length === 1 ? "" : "s"} of metadata
                </span>
              </figure>
              <figure className="flex min-w-0 flex-col gap-1">
                <figcaption className="label-pixel">After</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stripped.url}
                  alt="after"
                  className={`h-28 w-full sm:h-40 ${THUMB}`}
                />
                <span className="text-xs text-ink-muted">
                  {Math.ceil(stripped.size / 1024).toLocaleString()} KB ·{" "}
                  <span className="font-semibold text-green">clean</span>
                </span>
              </figure>
            </div>
            <p className="text-xs text-ink-muted">
              Pixels intact, metadata gone.
            </p>
          </Panel>
        )}

        {/* Two to a row from `sm` up. The first column is rounded down to a
            whole pixel and the second takes the rest: split evenly, an odd
            width would start the right-hand column on a half pixel and
            smear its hairlines. */}
        {findings.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-[round(down,calc((100%_-_0.5rem)_/_2),1px)_minmax(0,1fr)]">
            {findings.map((f, i) => (
              <li
                key={`${f.label}-${i}`}
                className={`fade-rise card-chunk flex min-w-0 flex-col gap-1 px-4 py-3 ${CATEGORY_TINT[f.category]}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="label-pixel text-ink-soft">
                  {CATEGORY_LABEL[f.category]} · {f.label}
                </span>
                <span className="wrap-anywhere text-sm">{f.value}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-ink-muted">
          Re-encoding through a canvas physically erases EXIF, XMP, and any
          embedded thumbnails. The file never leaves the browser.
        </p>
      </div>
    </ToolFrame>
  );
}
