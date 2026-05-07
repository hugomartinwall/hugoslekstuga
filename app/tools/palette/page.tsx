"use client";

import { useCallback, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import {
  contrast,
  harmonies,
  isHex,
  normalizeHex,
  preferredText,
  randomBaseHex,
  wcagBadge,
  type Harmony,
} from "@/lib/palette";

const STORAGE_KEY = "hugoslekstuga:palette:base";
const FALLBACK = "#0d9488"; // teal — same as tool color

export default function PalettePage() {
  const tool = findTool("palette")!;
  const [base, setBase] = useLocalStorageState<string>(STORAGE_KEY, FALLBACK);
  // Keep the controlled hex input in sync with the saved base on mount.
  const [hexInput, setHexInput] = useState<string>(base);

  const setBoth = useCallback((next: string) => {
    setBase(next);
    setHexInput(next);
  }, []);

  const onHexChange = (raw: string) => {
    setHexInput(raw);
    if (isHex(raw)) {
      const normalized = normalizeHex(raw);
      if (normalized) setBase(normalized);
    }
  };

  const onPickerChange = (color: string) => setBoth(color);

  const onRandom = () => setBoth(randomBaseHex());

  const harmonyList = useMemo(() => harmonies(base), [base]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-7">
        <BaseColor
          base={base}
          hexInput={hexInput}
          onHexChange={onHexChange}
          onPickerChange={onPickerChange}
          onRandom={onRandom}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {harmonyList.map((h) => (
            <HarmonyCard key={h.name} base={base} harmony={h} />
          ))}
        </div>
      </div>
    </ToolFrame>
  );
}

function BaseColor({
  base,
  hexInput,
  onHexChange,
  onPickerChange,
  onRandom,
}: {
  base: string;
  hexInput: string;
  onHexChange: (s: string) => void;
  onPickerChange: (s: string) => void;
  onRandom: () => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-cream p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Base color
      </p>
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
        <ColorChip hex={base} large label="base" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={base}
              onChange={(e) => onPickerChange(e.target.value)}
              className="h-12 w-12 cursor-pointer rounded-[12px] border-2 border-ink bg-cream p-1"
              aria-label="Pick a base color"
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => onHexChange(e.target.value)}
              spellCheck={false}
              className="card-chunk flex-1 rounded-[var(--radius-card)] bg-cream px-3 py-2 font-mono text-base uppercase focus:outline-none"
              placeholder="#0d9488"
            />
            <button
              type="button"
              onClick={onRandom}
              className="btn-chunk rounded-[var(--radius-button)] bg-teal px-4 py-2 font-display text-sm font-extrabold text-cream"
            >
              ↻ Random
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            Pick anything you like — your saved color sticks around in this
            browser.
          </p>
        </div>
      </div>
    </div>
  );
}

function HarmonyCard({ base, harmony }: { base: string; harmony: Harmony }) {
  return (
    <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg font-extrabold tracking-tight">
          {harmony.name}
        </p>
        <p className="text-xs text-ink-soft">{harmony.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ColorChip hex={base} dim label="base" />
        {harmony.hexes.map((h) => (
          <ColorChip key={h} hex={h} label="harmony" />
        ))}
      </div>
    </div>
  );
}

function ColorChip({
  hex,
  large = false,
  dim = false,
  label,
}: {
  hex: string;
  large?: boolean;
  dim?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = preferredText(hex);
  const ratioWhite = contrast(hex, "#fbf6ee");
  const ratioBlack = contrast(hex, "#1a1812");
  const bestRatio = Math.max(ratioWhite, ratioBlack);
  const badge = wcagBadge(bestRatio);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [hex]);

  return (
    <button
      type="button"
      onClick={copy}
      className={`group relative flex flex-col justify-between gap-1 overflow-hidden rounded-[14px] border-2 border-ink p-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-[0_4px_0_0_var(--color-ink)] ${
        large ? "aspect-square sm:aspect-[4/3]" : "aspect-square"
      } ${dim ? "opacity-90" : ""}`}
      style={{ background: hex, color: text }}
      aria-label={`Copy ${hex}`}
    >
      <div className="flex items-start justify-between gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        <span>{label ?? ""}</span>
        <span
          className="rounded-full border px-1.5 py-0.5"
          style={{ borderColor: text, opacity: 0.85 }}
        >
          {badge.tier}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <p
          className={`font-mono uppercase ${large ? "text-2xl font-bold" : "text-sm font-bold"}`}
        >
          {hex}
        </p>
        <p className="text-[11px] opacity-80 tabular-nums">
          {bestRatio.toFixed(1)}:1 contrast
        </p>
      </div>
      <span
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-3 py-1 text-center text-[11px] font-bold transition-opacity ${
          copied ? "opacity-100" : "opacity-0"
        }`}
        style={{ background: text, color: hex }}
      >
        {copied ? "Copied!" : ""}
      </span>
    </button>
  );
}
