"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

type Level = "L" | "M" | "Q" | "H";
type Size = 256 | 512 | 1024;
type Mode = "text" | "url" | "wifi";
type Security = "WPA" | "WEP" | "nopass";

type ModeData =
  | { mode: "text"; text: string }
  | { mode: "url"; url: string }
  | {
      mode: "wifi";
      ssid: string;
      password: string;
      security: Security;
      hidden: boolean;
    };

export default function QrPage() {
  const tool = findTool("qr")!;
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [wifi, setWifi] = useState({
    ssid: "",
    password: "",
    security: "WPA" as Security,
    hidden: false,
  });
  const [level, setLevel] = useState<Level>("M");
  const [size, setSize] = useState<Size>(512);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const data: ModeData = useMemo(() => {
    if (mode === "url") return { mode: "url", url };
    if (mode === "wifi") return { mode: "wifi", ...wifi };
    return { mode: "text", text };
  }, [mode, text, url, wifi]);

  const encoded = useMemo(() => encode(data), [data]);

  useEffect(() => {
    if (!encoded) {
      setPngUrl(null);
      setSvgString(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QR = await import("qrcode");
        const canvas = canvasRef.current;
        if (canvas) {
          await QR.toCanvas(canvas, encoded, {
            errorCorrectionLevel: level,
            width: size,
            margin: 2,
            color: { dark: "#1a1812", light: "#fbf6ee" },
          });
          if (!cancelled) setPngUrl(canvas.toDataURL("image/png"));
        }
        const svg = await QR.toString(encoded, {
          type: "svg",
          errorCorrectionLevel: level,
          margin: 2,
          color: { dark: "#1a1812", light: "#fbf6ee" },
        });
        if (!cancelled) {
          setSvgString(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't make a QR for that input.",
          );
          setPngUrl(null);
          setSvgString(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [encoded, level, size]);

  const downloadPng = () => {
    if (!pngUrl) return;
    triggerDownload(pngUrl, filenameFor(mode, "png"));
  };

  const downloadSvg = () => {
    if (!svgString) return;
    const u = URL.createObjectURL(
      new Blob([svgString], { type: "image/svg+xml" }),
    );
    triggerDownload(u, filenameFor(mode, "svg"));
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <ModeTabs mode={mode} onChange={setMode} />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:gap-10">
          <div className="flex flex-col gap-5">
            {mode === "text" && (
              <TextInput value={text} onChange={setText} />
            )}
            {mode === "url" && <UrlInput value={url} onChange={setUrl} />}
            {mode === "wifi" && (
              <WifiInputs value={wifi} onChange={setWifi} />
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Error correction
              </p>
              <div className="flex flex-wrap gap-2">
                {(["L", "M", "Q", "H"] as Level[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLevel(l)}
                    className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                      level === l
                        ? "bg-tomato text-cream"
                        : "bg-cream hover:bg-tomato-soft"
                    }`}
                  >
                    {labelForLevel(l)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Image size (PNG export)
              </p>
              <div className="flex flex-wrap gap-2">
                {([256, 512, 1024] as Size[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                      size === s
                        ? "bg-tomato text-cream"
                        : "bg-cream hover:bg-tomato-soft"
                    }`}
                  >
                    {s}px
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col items-center gap-4 self-start">
            <div
              className={`card-chunk flex aspect-square w-full max-w-xs items-center justify-center rounded-[var(--radius-card)] bg-cream p-3 ${
                !encoded ? "border-dashed" : ""
              }`}
            >
              {encoded ? (
                <canvas
                  ref={canvasRef}
                  className="h-full w-full"
                  aria-label="Generated QR code"
                />
              ) : (
                <p className="text-center text-sm text-ink-muted">
                  {mode === "wifi"
                    ? "Fill in network details to see the QR."
                    : mode === "url"
                      ? "Type a URL to see the QR."
                      : "Type something to see a QR code."}
                </p>
              )}
            </div>

            {encoded && pngUrl && svgString && (
              <div className="flex w-full max-w-xs flex-col gap-2">
                <button
                  type="button"
                  onClick={downloadPng}
                  className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-4 py-2 font-display text-base font-extrabold text-cream"
                >
                  Download PNG
                </button>
                <button
                  type="button"
                  onClick={downloadSvg}
                  className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-2 font-display text-base font-extrabold"
                >
                  Download SVG
                </button>
              </div>
            )}
          </div>
        </div>

        {encoded && (
          <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-3 text-xs">
            <summary className="cursor-pointer font-bold">Encoded text</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono">
              {encoded}
            </pre>
          </details>
        )}
      </div>
    </ToolFrame>
  );
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { id: Mode; label: string; sub: string }[] = [
    { id: "text", label: "Text", sub: "anything" },
    { id: "url", label: "URL", sub: "a link" },
    { id: "wifi", label: "Wi-Fi", sub: "join a network" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`flex flex-col items-start rounded-[var(--radius-card)] border-2 border-ink px-4 py-2 text-left transition-colors ${
            mode === t.id
              ? "bg-tomato text-cream"
              : "bg-cream hover:bg-tomato-soft"
          }`}
        >
          <span className="font-display text-base font-extrabold leading-tight">
            {t.label}
          </span>
          <span
            className={`text-xs ${
              mode === t.id ? "text-cream/80" : "text-ink-muted"
            }`}
          >
            {t.sub}
          </span>
        </button>
      ))}
    </div>
  );
}

function TextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="qr-text"
        className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
      >
        Text
      </label>
      <textarea
        id="qr-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A note, a phone number, anything…"
        rows={4}
        className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none"
      />
    </div>
  );
}

function UrlInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="qr-url"
        className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
      >
        URL
      </label>
      <input
        id="qr-url"
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://hugoslekstuga.se"
        className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none"
      />
      <p className="text-xs text-ink-muted">
        We&rsquo;ll add <span className="font-mono">https://</span> if you
        forget it.
      </p>
    </div>
  );
}

function WifiInputs({
  value,
  onChange,
}: {
  value: {
    ssid: string;
    password: string;
    security: Security;
    hidden: boolean;
  };
  onChange: (v: typeof value) => void;
}) {
  const set = <K extends keyof typeof value>(
    k: K,
    v: (typeof value)[K],
  ) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="qr-ssid"
          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          Network name (SSID)
        </label>
        <input
          id="qr-ssid"
          type="text"
          value={value.ssid}
          onChange={(e) => set("ssid", e.target.value)}
          placeholder="MyHomeWiFi"
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="qr-pw"
          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          Password
        </label>
        <input
          id="qr-pw"
          type="text"
          value={value.password}
          onChange={(e) => set("password", e.target.value)}
          placeholder={
            value.security === "nopass" ? "(no password)" : "your-password"
          }
          disabled={value.security === "nopass"}
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm focus:outline-none disabled:opacity-50"
        />
        <p className="text-xs text-ink-muted">
          The password is encoded into the QR code itself; nothing is sent
          anywhere.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Security
        </p>
        <div className="flex flex-wrap gap-2">
          {(["WPA", "WEP", "nopass"] as Security[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("security", s)}
              className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                value.security === s
                  ? "bg-tomato text-cream"
                  : "bg-cream hover:bg-tomato-soft"
              }`}
            >
              {s === "nopass" ? "No password" : s}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.hidden}
          onChange={(e) => set("hidden", e.target.checked)}
          className="h-4 w-4 accent-tomato"
        />
        Hidden network
      </label>
    </div>
  );
}

function encode(data: ModeData): string {
  if (data.mode === "text") return data.text.trim();
  if (data.mode === "url") {
    const u = data.url.trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u) || /^[a-z]+:\/\//i.test(u)) return u;
    return `https://${u}`;
  }
  // wifi
  const { ssid, password, security, hidden } = data;
  if (!ssid.trim()) return "";
  const parts = [
    `T:${security}`,
    `S:${escapeWifi(ssid)}`,
  ];
  if (security !== "nopass") parts.push(`P:${escapeWifi(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

function escapeWifi(s: string): string {
  return s.replace(/[\\;,:"]/g, "\\$&");
}

function labelForLevel(l: Level): string {
  switch (l) {
    case "L":
      return "L · 7%";
    case "M":
      return "M · 15%";
    case "Q":
      return "Q · 25%";
    case "H":
      return "H · 30%";
  }
}

function filenameFor(mode: Mode, ext: string): string {
  return `${mode === "text" ? "qr-code" : `qr-${mode}`}.${ext}`;
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
