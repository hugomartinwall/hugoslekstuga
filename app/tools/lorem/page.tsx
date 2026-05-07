"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:lorem:flavour";

type FlavourId = "pirate" | "recipe" | "fairytale" | "cyberpunk" | "corporate" | "latin";

type Flavour = {
  id: FlavourId;
  label: string;
  description: string;
  pool: string[];
  glue: string[];
};

const FLAVOURS: Flavour[] = [
  {
    id: "pirate",
    label: "Pirate",
    description: "Doubloons, scallywags, salty seas.",
    pool: [
      "ahoy", "matey", "scallywag", "doubloon", "cutlass", "parrot", "anchor",
      "plunder", "scurvy", "treasure", "crew", "hoist", "sail", "port", "starboard",
      "mizzenmast", "kraken", "rum", "cannonball", "shanty", "voyage", "harbour",
      "cove", "captain", "swab", "deck", "brig", "marooned", "tankard", "compass",
      "buccaneer", "galleon", "tide", "skull", "lookout", "cargo", "horizon",
    ],
    glue: ["the", "and", "of", "with", "a", "ye", "yon", "thy"],
  },
  {
    id: "recipe",
    label: "Recipe",
    description: "Simmer, fold, drizzle, devour.",
    pool: [
      "simmer", "fold", "dice", "roast", "saute", "blend", "garnish", "season",
      "marinade", "drizzle", "pinch", "tablespoon", "glossy", "tender", "fragrant",
      "golden", "caramelised", "smoky", "herbed", "savoury", "citrus", "peppered",
      "braised", "infused", "charred", "buttery", "crisp", "warm", "broth",
      "zest", "thyme", "rosemary", "ginger", "saffron", "honey", "vinegar",
    ],
    glue: ["the", "and", "with", "until", "for", "a", "of", "into"],
  },
  {
    id: "fairytale",
    label: "Fairytale",
    description: "Towers, foxes, midnight bargains.",
    pool: [
      "forest", "tower", "witch", "rose", "lantern", "midnight", "secret",
      "kingdom", "dragon", "princess", "glass", "woven", "golden", "silver",
      "swan", "raven", "bramble", "bridge", "brook", "fawn", "hollow", "crown",
      "lullaby", "well", "owl", "moonlit", "ember", "thicket", "spindle",
      "wandered", "wishing", "river", "winter", "promised", "ancient", "child",
    ],
    glue: ["the", "and", "of", "in", "where", "once", "a", "when", "with"],
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    description: "Neon, glitch, vapour, signal.",
    pool: [
      "chrome", "neon", "glitch", "pulse", "signal", "wire", "neural", "data",
      "augment", "drift", "megacity", "downtown", "vapour", "holographic",
      "encrypted", "override", "mainframe", "decoded", "synthetic", "dystopian",
      "grid", "hacker", "lattice", "static", "overdrive", "satellite", "rain",
      "implant", "skyline", "alley", "console", "rooftop", "smog", "subroutine",
    ],
    glue: ["the", "and", "of", "in", "across", "beneath", "a", "no"],
  },
  {
    id: "corporate",
    label: "Corporate",
    description: "Synergy, leverage, north stars.",
    pool: [
      "leverage", "ideate", "synergy", "paradigm", "ecosystem", "deliverable",
      "holistic", "alignment", "scalable", "agile", "stakeholders", "runway",
      "north-star", "pivot", "optimise", "value-add", "frictionless", "cadence",
      "OKRs", "verticals", "roadmap", "blueprint", "rightsize", "circle-back",
      "ladder-up", "downstream", "low-hanging", "bandwidth", "win-win",
      "asynchronous", "doubling-down", "high-impact", "mission-critical",
    ],
    glue: ["the", "and", "of", "to", "for", "with", "a", "our", "key"],
  },
  {
    id: "latin",
    label: "Lorem",
    description: "The classic. Latin-ish placeholder.",
    pool: [
      "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
      "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et",
      "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis",
      "nostrud", "exercitation", "ullamco", "laboris", "nisi", "ex", "ea", "commodo",
      "consequat", "duis", "aute", "irure", "voluptate", "velit", "esse", "cillum",
    ],
    glue: ["the", "et", "ut", "in", "ad", "a"],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSentence(f: Flavour): string {
  const len = 6 + Math.floor(Math.random() * 10); // 6-15
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const useGlue = Math.random() < 0.32 && i > 0 && i < len - 1;
    out.push(useGlue ? pick(f.glue) : pick(f.pool));
  }
  // Light punctuation
  if (Math.random() < 0.5 && out.length > 6) {
    const at = 2 + Math.floor(Math.random() * (out.length - 4));
    out[at] = out[at] + ",";
  }
  let sentence = out.join(" ");
  sentence = sentence[0].toUpperCase() + sentence.slice(1);
  return sentence + ".";
}

function generateParagraph(f: Flavour): string {
  const sentences = 3 + Math.floor(Math.random() * 3);
  return Array.from({ length: sentences }, () => generateSentence(f)).join(" ");
}

export default function LoremPage() {
  const tool = findTool("lorem")!;
  const [flavourId, setFlavourId] = useState<FlavourId>("pirate");
  const [count, setCount] = useState(3);
  const [output, setOutput] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && FLAVOURS.some((f) => f.id === saved)) {
        setFlavourId(saved as FlavourId);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, flavourId);
    } catch {}
  }, [flavourId, hydrated]);

  const flavour = FLAVOURS.find((f) => f.id === flavourId)!;

  const generate = useCallback(() => {
    const paragraphs = Array.from({ length: count }, () => generateParagraph(flavour));
    setOutput(paragraphs);
  }, [count, flavour]);

  // Generate once on first mount so the page isn't empty
  useEffect(() => {
    if (hydrated && output.length === 0) {
      setOutput(
        Array.from({ length: count }, () => generateParagraph(flavour)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const copy = useCallback(async () => {
    if (!output.length) return;
    try {
      await navigator.clipboard.writeText(output.join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [output]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Pick a flavour
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FLAVOURS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFlavourId(f.id)}
                className={`card-chunk flex flex-col items-start gap-0.5 rounded-[var(--radius-card)] p-3 text-left transition-colors ${
                  flavourId === f.id
                    ? "bg-yellow-soft"
                    : "bg-cream hover:bg-yellow-soft"
                }`}
              >
                <span className="font-display text-base font-extrabold tracking-tight">
                  {f.label}
                </span>
                <span className="text-[11px] text-ink-soft">{f.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Paragraphs</span>
            <input
              type="range"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="accent-yellow"
            />
            <span className="w-6 font-mono text-sm font-bold">{count}</span>
          </label>
          <button
            type="button"
            onClick={generate}
            className="btn-chunk rounded-[var(--radius-button)] bg-yellow px-5 py-2 font-display text-base font-extrabold"
          >
            Generate ↻
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={output.length === 0}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-base font-extrabold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copied ? "Copied!" : "Copy all"}
          </button>
        </div>

        <article className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-cream p-5 sm:p-6">
          {output.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Hit generate to fill the page.
            </p>
          ) : (
            output.map((p, i) => (
              <p
                key={i}
                className="fade-rise text-base leading-relaxed text-ink"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {p}
              </p>
            ))
          )}
        </article>
      </div>
    </ToolFrame>
  );
}
