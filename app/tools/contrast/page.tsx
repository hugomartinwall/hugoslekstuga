"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:contrast:state";

type State = { fg: string; bg: string };

const DEFAULT: State = { fg: "#1a1812", bg: "#fbf6ee" };

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function relLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: string, bg: string): number | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return null;
  const la = relLuminance(a.r, a.g, a.b);
  const lb = relLuminance(b.r, b.g, b.b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function tier(r: number) {
  return {
    aaSmall: r >= 4.5,
    aaLarge: r >= 3,
    aaaSmall: r >= 7,
    aaaLarge: r >= 4.5,
  };
}

function commentary(r: number): { headline: string; mood: "good" | "ok" | "bad" } {
  if (r >= 7) return { headline: "Crystal clear.", mood: "good" };
  if (r >= 4.5) return { headline: "Reads well.", mood: "good" };
  if (r >= 3) return { headline: "OK for big text only.", mood: "ok" };
  if (r >= 2) return { headline: "Hard to read…", mood: "bad" };
  return { headline: "I can't read this!", mood: "bad" };
}

export default function ContrastPage() {
  const tool = findTool("contrast")!;
  const [state, setState] = useState<State>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (parsed.fg && parsed.bg) setState(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const r = useMemo(() => ratio(state.fg, state.bg), [state]);
  const t = r ? tier(r) : null;
  const c = r ? commentary(r) : null;

  const swap = () => setState((s) => ({ fg: s.bg, bg: s.fg }));

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <ColorInput
            label="Text"
            value={state.fg}
            onChange={(v) => setState((s) => ({ ...s, fg: v }))}
          />
          <ColorInput
            label="Background"
            value={state.bg}
            onChange={(v) => setState((s) => ({ ...s, bg: v }))}
          />
        </div>

        <button
          type="button"
          onClick={swap}
          className="self-start text-xs font-semibold text-orange underline-offset-2 hover:underline"
        >
          ⇄ swap colours
        </button>

        <div
          className="card-chunk flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] p-8 text-center sm:p-12"
          style={{ background: state.bg, color: state.fg }}
        >
          <p className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            The quick brown fox
          </p>
          <p className="text-base sm:text-lg">
            jumps over the lazy dog at twilight.
          </p>
        </div>

        {r && c && t ? (
          <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`font-display text-3xl font-extrabold sm:text-4xl ${c.mood === "good" ? "text-green" : c.mood === "ok" ? "text-orange" : "text-tomato"}`}
              >
                {r.toFixed(2)} : 1
              </span>
              <span className="font-display text-base font-extrabold sm:text-lg">
                {c.headline}
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
              <Tier label="WCAG AA · normal text" pass={t.aaSmall} />
              <Tier label="WCAG AA · large text" pass={t.aaLarge} />
              <Tier label="WCAG AAA · normal text" pass={t.aaaSmall} />
              <Tier label="WCAG AAA · large text" pass={t.aaaLarge} />
            </ul>
          </div>
        ) : (
          <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-4 text-center text-sm text-ink-muted">
            Both colours need to be valid hex codes (e.g. #1a1812).
          </p>
        )}

        <p className="text-xs text-ink-muted">
          Large text means 18pt regular or 14pt bold.{" "}
          AA is the standard most teams aim for; AAA is the bar for
          high-contrast designs.
        </p>
      </div>
    </ToolFrame>
  );
}

function Tier({ label, pass }: { label: string; pass: boolean }) {
  return (
    <li
      className={`flex items-center justify-between rounded-md px-3 py-2 ${pass ? "bg-green-soft" : "bg-tomato-soft"}`}
    >
      <span>{label}</span>
      <span className="font-mono text-xs font-bold">{pass ? "pass" : "fail"}</span>
    </li>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="card-chunk flex items-center gap-2 rounded-[var(--radius-card)] bg-cream p-2">
        <input
          type="color"
          value={parseHex(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-md border-2 border-ink"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-sm focus:outline-none"
          spellCheck={false}
        />
      </span>
    </label>
  );
}
