"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:shadow:layers";

type Layer = {
  id: number;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
};

let nextId = 1;

const DEFAULT: Layer[] = [
  { id: nextId++, x: 0, y: 6, blur: 14, spread: 0, color: "#1a181230", inset: false },
];

const PRESETS: { name: string; layers: Omit<Layer, "id">[] }[] = [
  {
    name: "soft",
    layers: [
      { x: 0, y: 4, blur: 12, spread: 0, color: "#1a181222", inset: false },
    ],
  },
  {
    name: "chunky",
    layers: [
      { x: 0, y: 6, blur: 0, spread: 0, color: "#1a1812", inset: false },
    ],
  },
  {
    name: "neumorph",
    layers: [
      { x: 8, y: 8, blur: 16, spread: 0, color: "#bdb6a8", inset: false },
      { x: -8, y: -8, blur: 16, spread: 0, color: "#ffffff", inset: false },
    ],
  },
  {
    name: "layered",
    layers: [
      { x: 0, y: 1, blur: 1, spread: 0, color: "#1a181214", inset: false },
      { x: 0, y: 2, blur: 4, spread: 0, color: "#1a181214", inset: false },
      { x: 0, y: 8, blur: 16, spread: 0, color: "#1a181222", inset: false },
    ],
  },
  {
    name: "inset",
    layers: [
      { x: 0, y: 4, blur: 12, spread: 0, color: "#1a181233", inset: true },
    ],
  },
];

function buildCss(layers: Layer[]): string {
  return layers
    .map((l) => {
      const inset = l.inset ? "inset " : "";
      return `${inset}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${l.color}`;
    })
    .join(", ");
}

export default function ShadowPage() {
  const tool = findTool("shadow")!;
  const [layers, setLayers] = useState<Layer[]>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Layer[];
        if (parsed.length > 0) {
          setLayers(parsed);
          nextId = Math.max(...parsed.map((l) => l.id)) + 1;
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layers));
    } catch {}
  }, [layers, hydrated]);

  const css = useMemo(() => buildCss(layers), [layers]);

  const update = useCallback(
    (id: number, patch: Partial<Omit<Layer, "id">>) => {
      setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    [],
  );

  const add = () => {
    setLayers((ls) => [
      ...ls,
      { id: nextId++, x: 0, y: 4, blur: 12, spread: 0, color: "#1a181222", inset: false },
    ]);
  };

  const remove = (id: number) => {
    setLayers((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.id !== id)));
  };

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setLayers(preset.layers.map((l) => ({ ...l, id: nextId++ })));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`box-shadow: ${css};`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="card-chunk flex h-72 w-full items-center justify-center rounded-[var(--radius-card)] bg-cream-deep">
          <div
            className="rounded-2xl bg-cream"
            style={{
              width: 220,
              height: 140,
              boxShadow: css,
              border: "2px solid #1a1812",
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Presets
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-teal-soft"
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Layers
            </p>
            <button
              type="button"
              onClick={add}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-teal-soft"
            >
              + add
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {layers.map((l, i) => (
              <li
                key={l.id}
                className="flex flex-col gap-2 rounded-md border-2 border-ink bg-cream-deep p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Layer {i + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={l.inset}
                        onChange={(e) => update(l.id, { inset: e.target.checked })}
                      />
                      inset
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(l.id)}
                      disabled={layers.length <= 1}
                      className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-tomato hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Remove layer"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Slider
                    label="x"
                    value={l.x}
                    min={-50}
                    max={50}
                    onChange={(v) => update(l.id, { x: v })}
                  />
                  <Slider
                    label="y"
                    value={l.y}
                    min={-50}
                    max={50}
                    onChange={(v) => update(l.id, { y: v })}
                  />
                  <Slider
                    label="blur"
                    value={l.blur}
                    min={0}
                    max={80}
                    onChange={(v) => update(l.id, { blur: v })}
                  />
                  <Slider
                    label="spread"
                    value={l.spread}
                    min={-30}
                    max={30}
                    onChange={(v) => update(l.id, { spread: v })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={l.color.slice(0, 7)}
                    onChange={(e) =>
                      update(l.id, {
                        color: e.target.value + (l.color.length > 7 ? l.color.slice(7) : ""),
                      })
                    }
                    className="h-9 w-12 cursor-pointer rounded-md border-2 border-ink"
                  />
                  <input
                    type="text"
                    value={l.color}
                    onChange={(e) => update(l.id, { color: e.target.value })}
                    className="flex-1 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-xs"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            CSS
          </p>
          <div className="flex items-start gap-2">
            <pre className="card-chunk flex-1 overflow-x-auto rounded-[var(--radius-card)] bg-cream-deep p-3 font-mono text-xs">
{`box-shadow: ${css};`}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="btn-chunk shrink-0 rounded-[var(--radius-button)] bg-teal px-4 py-2 font-display text-sm font-extrabold text-cream"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </ToolFrame>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-teal"
      />
    </label>
  );
}
