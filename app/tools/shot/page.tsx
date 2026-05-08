"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  ASPECT_DIMENSIONS,
  BG_PRESETS,
  FRAMES,
  LANGUAGES,
  STARTER_CODE,
  THEMES,
  type Aspect,
  type BgPreset,
  type Frame,
} from "@/lib/shot/presets";
import { highlight } from "@/lib/shot/highlight";

type Mode = "image" | "code";

export default function ShotPage() {
  const tool = findTool("shot")!;

  const [mode, setMode] = useState<Mode>("code");
  const [bgId, setBgId] = useState<string>("playhouse");
  const [frame, setFrame] = useState<Frame>("macos");
  const [padding, setPadding] = useState(64);
  const [shadow, setShadow] = useState(40);
  const [radius, setRadius] = useState(12);
  const [aspect, setAspect] = useState<Aspect>("tweet");

  // Image mode
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  // Code mode
  const [code, setCode] = useState(STARTER_CODE);
  const [language, setLanguage] = useState("tsx");
  const [theme, setTheme] = useState("vitesse-dark");
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [windowTitle, setWindowTitle] = useState("Counter.tsx");
  const [browserUrl, setBrowserUrl] = useState("hugoslekstuga.se/sum");

  // Rendered code from Shiki
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [themeBg, setThemeBg] = useState<string>("#0d1117");
  const [highlighting, setHighlighting] = useState(false);

  // Export feedback
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>("");

  const sceneRef = useRef<HTMLDivElement>(null);

  // Run Shiki when code/language/theme changes (only in code mode). The
  // synchronous "highlighting" state flip is the canonical async-loading
  // signal and there's no useMemo-ish replacement — we genuinely depend
  // on a Promise resolving — so the lint disable is intentional here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "code") return;
    let cancelled = false;
    setHighlighting(true);
    highlight(code, language, theme)
      .then((r) => {
        if (!cancelled) {
          setHighlightedHtml(r.html);
          setThemeBg(r.bg);
          setHighlighting(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHighlighting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, code, language, theme]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ----- file & paste --------------------------------------------------

  const acceptFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // ----- export --------------------------------------------------------

  const exportPng = useCallback(
    async (scale: 1 | 2 | 3, action: "download" | "copy") => {
      const node = sceneRef.current;
      if (!node) return;
      setExportError("");
      setExporting(true);
      try {
        const { toPng, toBlob } = await import("html-to-image");
        const opts = {
          pixelRatio: scale,
          cacheBust: true,
          // Transparent backgrounds render as transparent PNGs.
          backgroundColor: bgId === "transparent" ? undefined : undefined,
        };
        if (action === "download") {
          const dataUrl = await toPng(node, opts);
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `shot-${Date.now()}.png`;
          a.click();
        } else {
          const blob = await toBlob(node, opts);
          if (blob && navigator.clipboard && "ClipboardItem" in window) {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          } else {
            throw new Error("Clipboard not available — try download.");
          }
        }
      } catch (e) {
        setExportError(e instanceof Error ? e.message : "Export failed");
      } finally {
        setExporting(false);
      }
    },
    [bgId],
  );

  // ----- derived -------------------------------------------------------

  const bg = useMemo<BgPreset>(
    () => BG_PRESETS.find((b) => b.id === bgId) ?? BG_PRESETS[0],
    [bgId],
  );
  const aspectDims = ASPECT_DIMENSIONS[aspect];

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        {/* Mode toggle */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "image", label: "Image" },
              { id: "code", label: "Code" },
            ] as { id: Mode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-start rounded-[var(--radius-card)] border-2 border-ink px-4 py-2 text-left transition-colors ${
                mode === m.id ? "bg-tomato text-cream" : "bg-cream hover:bg-tomato-soft"
              }`}
            >
              <span className="font-display text-base font-extrabold leading-tight">
                {m.label}
              </span>
              <span
                className={`text-xs ${mode === m.id ? "text-cream/80" : "text-ink-muted"}`}
              >
                {m.id === "image" ? "Drop a screenshot" : "Paste some code"}
              </span>
            </button>
          ))}
        </div>

        {/* Input */}
        {mode === "image" ? (
          <ImageInput
            imageDataUrl={imageDataUrl}
            onFile={acceptFile}
            onClear={() => setImageDataUrl(null)}
          />
        ) : (
          <CodeInput
            code={code}
            setCode={setCode}
            language={language}
            setLanguage={setLanguage}
            theme={theme}
            setTheme={setTheme}
            showLineNumbers={showLineNumbers}
            setShowLineNumbers={setShowLineNumbers}
            highlighting={highlighting}
          />
        )}

        {/* Preview */}
        <Preview
          sceneRef={sceneRef}
          bg={bg}
          frame={frame}
          padding={padding}
          shadow={shadow}
          radius={radius}
          aspect={aspect}
          aspectDims={aspectDims}
          mode={mode}
          imageDataUrl={imageDataUrl}
          highlightedHtml={highlightedHtml}
          themeBg={themeBg}
          showLineNumbers={showLineNumbers}
          windowTitle={windowTitle}
          browserUrl={browserUrl}
        />

        {/* Style controls */}
        <Controls
          bgId={bgId}
          setBgId={setBgId}
          frame={frame}
          setFrame={setFrame}
          padding={padding}
          setPadding={setPadding}
          shadow={shadow}
          setShadow={setShadow}
          radius={radius}
          setRadius={setRadius}
          aspect={aspect}
          setAspect={setAspect}
          windowTitle={windowTitle}
          setWindowTitle={setWindowTitle}
          browserUrl={browserUrl}
          setBrowserUrl={setBrowserUrl}
        />

        {/* Export */}
        <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-cream p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Export
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {([1, 2, 3] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => exportPng(s, "download")}
                disabled={exporting}
                className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-4 py-2 font-display text-sm font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
              >
                {exporting ? "…" : `${s}× PNG`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => exportPng(2, "copy")}
              disabled={exporting}
              className="rounded-full border-2 border-ink bg-cream px-4 py-2 font-display text-sm font-bold transition-colors hover:bg-tomato-soft disabled:cursor-progress disabled:opacity-80"
            >
              {copied ? "Copied!" : "Copy 2×"}
            </button>
            {exportError && (
              <span className="text-xs font-medium text-tomato">
                {exportError}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          The whole scene is rendered to a PNG in your browser — files,
          code, and screenshots never leave this device.
        </p>
      </div>
    </ToolFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Image input                                                          */
/* ------------------------------------------------------------------ */

function ImageInput({
  imageDataUrl,
  onFile,
  onClear,
}: {
  imageDataUrl: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-4 transition-colors ${
        drag ? "bg-tomato-soft" : "bg-cream"
      }`}
    >
      <p className="font-display text-base font-bold">
        {imageDataUrl ? "Image loaded" : "Drop a screenshot"}
      </p>
      <div className="ml-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-tomato-soft"
        >
          Choose file
        </button>
        {imageDataUrl && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code input                                                           */
/* ------------------------------------------------------------------ */

function CodeInput({
  code,
  setCode,
  language,
  setLanguage,
  theme,
  setTheme,
  showLineNumbers,
  setShowLineNumbers,
  highlighting,
}: {
  code: string;
  setCode: (s: string) => void;
  language: string;
  setLanguage: (s: string) => void;
  theme: string;
  setTheme: (s: string) => void;
  showLineNumbers: boolean;
  setShowLineNumbers: (b: boolean) => void;
  highlighting: boolean;
}) {
  return (
    <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs font-semibold">
          <span className="uppercase tracking-wide text-ink-muted">Lang</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-xs"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs font-semibold">
          <span className="uppercase tracking-wide text-ink-muted">Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-xs"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={showLineNumbers}
            onChange={(e) => setShowLineNumbers(e.target.checked)}
            className="h-4 w-4 accent-tomato"
          />
          <span>Line numbers</span>
        </label>
        {highlighting && (
          <span className="ml-auto text-xs font-semibold text-ink-muted">
            …highlighting…
          </span>
        )}
      </div>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        wrap="off"
        className="h-56 resize-y overflow-auto whitespace-pre rounded-md border-2 border-ink bg-cream-deep p-3 font-mono text-sm focus:outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview                                                              */
/* ------------------------------------------------------------------ */

type PreviewProps = {
  sceneRef: React.Ref<HTMLDivElement>;
  bg: BgPreset;
  frame: Frame;
  padding: number;
  shadow: number;
  radius: number;
  aspect: Aspect;
  aspectDims: { w: number; h: number } | null;
  mode: Mode;
  imageDataUrl: string | null;
  highlightedHtml: string;
  themeBg: string;
  showLineNumbers: boolean;
  windowTitle: string;
  browserUrl: string;
};

function Preview({
  sceneRef,
  bg,
  frame,
  padding,
  shadow,
  radius,
  aspect,
  aspectDims,
  mode,
  imageDataUrl,
  highlightedHtml,
  themeBg,
  showLineNumbers,
  windowTitle,
  browserUrl,
}: PreviewProps) {
  const sceneStyle: React.CSSProperties = {
    padding: `${padding}px`,
    background: bg.kind === "transparent" ? "transparent" : bg.css,
  };
  if (aspectDims) {
    sceneStyle.aspectRatio = `${aspectDims.w} / ${aspectDims.h}`;
  }

  const shadowCss = shadowFor(shadow);

  return (
    <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream-deep p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Preview ·{" "}
        {aspect === "free"
          ? "free aspect"
          : `${aspectDims?.w}×${aspectDims?.h}`}
      </p>
      <div
        className="relative w-full overflow-hidden rounded-md"
        style={
          bg.kind === "transparent"
            ? {
                backgroundImage:
                  "linear-gradient(45deg, #d8d3c5 25%, transparent 25%), linear-gradient(-45deg, #d8d3c5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8d3c5 75%), linear-gradient(-45deg, transparent 75%, #d8d3c5 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
              }
            : undefined
        }
      >
        <div
          ref={sceneRef}
          className="flex items-center justify-center"
          style={sceneStyle}
        >
          <FramedContent
            frame={frame}
            radius={radius}
            shadow={shadowCss}
            themeBg={themeBg}
            windowTitle={windowTitle}
            browserUrl={browserUrl}
          >
            {mode === "image" ? (
              <ImageContent imageDataUrl={imageDataUrl} />
            ) : (
              <CodeContent
                highlightedHtml={highlightedHtml}
                showLineNumbers={showLineNumbers}
              />
            )}
          </FramedContent>
        </div>
      </div>
    </div>
  );
}

function shadowFor(level: number): string {
  // Translate 0-100 into a soft drop-shadow with a long, low-opacity tail.
  const blur = (level / 100) * 80;
  const offset = (level / 100) * 24;
  const opacity = (level / 100) * 0.45;
  return `0 ${offset}px ${blur}px rgba(0,0,0,${opacity.toFixed(2)})`;
}

/* ------------------------------------------------------------------ */
/* Frame chrome                                                         */
/* ------------------------------------------------------------------ */

function FramedContent({
  frame,
  radius,
  shadow,
  themeBg,
  windowTitle,
  browserUrl,
  children,
}: {
  frame: Frame;
  radius: number;
  shadow: string;
  themeBg: string;
  windowTitle: string;
  browserUrl: string;
  children: React.ReactNode;
}) {
  const wrapperStyle: React.CSSProperties = {
    borderRadius: `${radius}px`,
    boxShadow: shadow,
    overflow: "hidden",
    background: themeBg,
    maxWidth: "100%",
  };
  if (frame === "border") {
    wrapperStyle.outline = "2px solid #1a1812";
    wrapperStyle.outlineOffset = "-2px";
  }
  return (
    <div style={wrapperStyle}>
      {frame === "macos" && <MacosTitleBar title={windowTitle} />}
      {frame === "browser" && <BrowserBar url={browserUrl} />}
      <div>{children}</div>
    </div>
  );
}

function MacosTitleBar({ title }: { title: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#ff5f57",
        }}
      />
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#febc2e",
        }}
      />
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#28c840",
        }}
      />
      <span
        className="ml-2 truncate font-mono text-xs"
        style={{ color: "rgba(255,255,255,0.7)" }}
      >
        {title}
      </span>
    </div>
  );
}

function BrowserBar({ url }: { url: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: "#ff5f57",
        }}
      />
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: "#febc2e",
        }}
      />
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: "#28c840",
        }}
      />
      <span
        className="ml-2 flex-1 truncate rounded-md px-2 py-0.5 font-mono text-[11px]"
        style={{
          background: "rgba(255,255,255,0.10)",
          color: "rgba(255,255,255,0.75)",
        }}
      >
        {url}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content                                                              */
/* ------------------------------------------------------------------ */

function ImageContent({ imageDataUrl }: { imageDataUrl: string | null }) {
  if (!imageDataUrl) {
    return (
      <div className="flex h-48 items-center justify-center font-mono text-sm text-cream/60">
        Drop a screenshot above
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={imageDataUrl}
      alt="Your screenshot"
      style={{ display: "block", maxWidth: "100%", width: "100%" }}
    />
  );
}

function CodeContent({
  highlightedHtml,
  showLineNumbers,
}: {
  highlightedHtml: string;
  showLineNumbers: boolean;
}) {
  return (
    <div
      className={`shot-code ${showLineNumbers ? "shot-code--lines" : ""}`}
      style={{
        padding: "20px 24px",
        fontSize: 14,
        lineHeight: 1.65,
        // Shiki injects color via inline styles on tokens, so most styling
        // happens here. We override the bg in the wrapper instead so the
        // code block fills the frame.
      }}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}
/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */

function Controls({
  bgId,
  setBgId,
  frame,
  setFrame,
  padding,
  setPadding,
  shadow,
  setShadow,
  radius,
  setRadius,
  aspect,
  setAspect,
  windowTitle,
  setWindowTitle,
  browserUrl,
  setBrowserUrl,
}: {
  bgId: string;
  setBgId: (s: string) => void;
  frame: Frame;
  setFrame: (f: Frame) => void;
  padding: number;
  setPadding: (n: number) => void;
  shadow: number;
  setShadow: (n: number) => void;
  radius: number;
  setRadius: (n: number) => void;
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  windowTitle: string;
  setWindowTitle: (s: string) => void;
  browserUrl: string;
  setBrowserUrl: (s: string) => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-cream p-4">
      {/* Backgrounds */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Background
        </p>
        <div className="flex flex-wrap gap-2">
          {BG_PRESETS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBgId(b.id)}
              title={b.label}
              aria-label={b.label}
              className={`relative h-10 w-10 overflow-hidden rounded-full border-2 border-ink transition-transform ${
                bgId === b.id ? "ring-2 ring-ink ring-offset-2 ring-offset-cream" : "hover:scale-105"
              }`}
              style={{
                background:
                  b.kind === "transparent"
                    ? "repeating-conic-gradient(#d8d3c5 0 25%, #fbf6ee 0 50%) 50% / 16px 16px"
                    : b.css,
              }}
            />
          ))}
        </div>
      </div>

      {/* Frame */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Frame
        </p>
        <div className="flex flex-wrap gap-2">
          {FRAMES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFrame(f.id)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                frame === f.id ? "bg-tomato text-cream" : "bg-cream hover:bg-tomato-soft"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {(frame === "macos" || frame === "browser") && (
          <input
            type="text"
            value={frame === "macos" ? windowTitle : browserUrl}
            onChange={(e) =>
              frame === "macos"
                ? setWindowTitle(e.target.value)
                : setBrowserUrl(e.target.value)
            }
            placeholder={frame === "macos" ? "window title" : "url"}
            className="w-full max-w-sm rounded-md border-2 border-ink bg-cream-deep px-2 py-1 font-mono text-xs focus:outline-none"
          />
        )}
      </div>

      {/* Aspect */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Aspect
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "free", label: "Free" },
              { id: "tweet", label: "Tweet 16:9" },
              { id: "square", label: "Square" },
              { id: "story", label: "Story 9:16" },
              { id: "github", label: "GitHub" },
            ] as { id: Aspect; label: string }[]
          ).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAspect(a.id)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                aspect === a.id ? "bg-tomato text-cream" : "bg-cream hover:bg-tomato-soft"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Slider label="Padding" value={padding} min={0} max={160} step={4} onChange={setPadding} suffix="px" />
        <Slider label="Shadow" value={shadow} min={0} max={100} step={2} onChange={setShadow} suffix="" />
        <Slider label="Radius" value={radius} min={0} max={40} step={1} onChange={setRadius} suffix="px" />
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  suffix: string;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-md border-2 border-ink bg-cream-deep p-2 text-xs">
      <span className="flex items-center justify-between font-semibold uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-tomato"
      />
    </label>
  );
}
