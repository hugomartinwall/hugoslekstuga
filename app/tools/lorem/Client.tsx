"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const FLAVOUR_KEY = "hugoslekstuga:lorem:flavour";
const SETTINGS_KEY = "hugoslekstuga:lorem:settings";

type FlavourId = "pirate" | "recipe" | "fairytale" | "cyberpunk" | "corporate" | "latin";
type Mode = "paragraphs" | "words" | "sentences" | "bullets";

type Settings = { mode: Mode; includeHeading: boolean };
const DEFAULT_SETTINGS: Settings = { mode: "paragraphs", includeHeading: false };

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
      // Nouns
      "ahoy", "matey", "scallywag", "doubloon", "cutlass", "parrot", "anchor",
      "plunder", "scurvy", "treasure", "crew", "sail", "port", "starboard",
      "mizzenmast", "kraken", "rum", "cannonball", "shanty", "voyage", "harbour",
      "cove", "captain", "deck", "brig", "tankard", "compass", "rigging",
      "buccaneer", "galleon", "tide", "skull", "lookout", "cargo", "horizon",
      "spyglass", "barnacle", "sloop", "frigate", "flag", "wharf", "lagoon",
      "shore", "storm", "gale", "albatross", "barrel", "hold", "doubloons",
      "chest", "powder", "musket", "longboat", "sextant", "knot", "bilge",
      // Verbs
      "hoist", "swab", "marooned", "plundered", "raided", "boarded", "mutinied",
      "anchored", "drifted", "sighted", "weighed", "splice",
      // Adjectives
      "salty", "sunken", "treacherous", "blackhearted", "cursed", "weathered",
      "drunken", "bold", "fearsome", "ragged",
    ],
    glue: ["the", "and", "of", "with", "a", "ye", "yon", "thy", "fer", "be"],
  },
  {
    id: "recipe",
    label: "Recipe",
    description: "Simmer, fold, drizzle, devour.",
    pool: [
      // Verbs
      "simmer", "fold", "dice", "roast", "saute", "blend", "garnish", "season",
      "marinate", "drizzle", "pinch", "knead", "fold", "whisk", "fry", "toast",
      "braise", "char", "rest", "deglaze", "flambé", "reduce", "purée",
      "grate", "zest", "stir", "warm", "scatter", "ladle", "swirl",
      // Adjectives
      "glossy", "tender", "fragrant", "golden", "caramelised", "smoky", "herbed",
      "savoury", "peppered", "braised", "infused", "charred", "buttery", "crisp",
      "warm", "earthy", "tangy", "rich", "silky", "crackling", "blistered",
      "blackened", "molten", "bubbling", "feathery",
      // Nouns
      "broth", "thyme", "rosemary", "ginger", "saffron", "honey", "vinegar",
      "stock", "rind", "marrow", "tablespoon", "skillet", "bay-leaf", "harissa",
      "miso", "tahini", "shallot", "preserve", "crème", "glaze", "crust",
      "embers", "char", "drippings", "roe",
    ],
    glue: ["the", "and", "with", "until", "for", "a", "of", "into", "over", "in"],
  },
  {
    id: "fairytale",
    label: "Fairytale",
    description: "Towers, foxes, midnight bargains.",
    pool: [
      // Nouns
      "forest", "tower", "witch", "rose", "lantern", "midnight", "secret",
      "kingdom", "dragon", "princess", "glass", "swan", "raven", "bramble",
      "bridge", "brook", "fawn", "hollow", "crown", "lullaby", "well", "owl",
      "ember", "thicket", "spindle", "river", "winter", "child", "fox", "wolf",
      "bargain", "promise", "lantern", "candle", "hearth", "hare", "bell",
      "cloak", "stranger", "stepmother", "mirror", "key", "door", "garden",
      "throne", "shadow", "wish", "song", "spell",
      // Adjectives / participles
      "woven", "golden", "silver", "moonlit", "wandered", "wishing", "promised",
      "ancient", "feathered", "silvered", "crooked", "marble", "humming",
      "frostbitten", "lost", "forgotten", "stolen", "crowned", "veiled",
      // Verbs
      "wandered", "whispered", "spun", "stitched", "called", "promised",
      "vanished", "sang", "knocked", "watched", "waited",
    ],
    glue: ["the", "and", "of", "in", "where", "once", "a", "when", "with", "by"],
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    description: "Neon, glitch, vapour, signal.",
    pool: [
      // Nouns
      "chrome", "neon", "glitch", "pulse", "signal", "wire", "neural", "data",
      "augment", "drift", "megacity", "downtown", "vapour", "holographic",
      "encrypted", "override", "mainframe", "decoded", "synthetic", "dystopian",
      "grid", "hacker", "lattice", "static", "overdrive", "satellite", "rain",
      "implant", "skyline", "alley", "console", "rooftop", "smog", "subroutine",
      "rooftop", "freeway", "blackmarket", "alleyway", "uplink", "kernel",
      "firewall", "deadzone", "noise-floor", "broadcast", "rig", "spire",
      "biofeed", "drone", "circuit", "transit", "monolith", "shard", "patch",
      // Verbs
      "uploaded", "ghosted", "ran", "jacked", "scanned", "looped", "rerouted",
      "hijacked", "fizzed", "burned", "decompiled", "echoed",
      // Adjectives
      "rusted", "translucent", "crackling", "low-orbit", "off-grid", "radioactive",
      "fragmented", "synthetic", "raw", "modular", "burned-out", "wireless",
    ],
    glue: ["the", "and", "of", "in", "across", "beneath", "a", "no", "past"],
  },
  {
    id: "corporate",
    label: "Corporate",
    description: "Synergy, leverage, north stars.",
    pool: [
      // The classic buzzword set
      "leverage", "ideate", "synergy", "paradigm", "ecosystem", "deliverable",
      "holistic", "alignment", "scalable", "agile", "stakeholders", "runway",
      "north-star", "pivot", "optimise", "value-add", "frictionless", "cadence",
      "OKRs", "verticals", "roadmap", "blueprint", "rightsize", "circle-back",
      "ladder-up", "downstream", "low-hanging", "bandwidth", "win-win",
      "asynchronous", "doubling-down", "high-impact", "mission-critical",
      // More
      "moonshot", "ten-x", "quarterly", "evergreen", "core-competency",
      "headwinds", "tailwinds", "actionable", "value-prop", "white-space",
      "dogfooding", "ship-it", "blue-sky", "north-of-the-line", "above-the-fold",
      "off-line", "loop-in", "double-click", "table-stakes", "lead-time",
      "minimum-viable", "best-in-class", "rightsizing", "outcome-driven",
      "data-driven", "stakeholder-aligned", "business-critical", "high-cadence",
      "value-engineering", "customer-obsessed", "execution-focused",
      "non-trivial", "frame-it-up", "drill-down", "level-set", "swag-it",
      "pre-mortem", "post-mortem", "kpi-aligned", "roi-positive", "go-to-market",
      "lean-in", "buy-in", "cycle-time", "net-net", "north-of-zero",
    ],
    glue: ["the", "and", "of", "to", "for", "with", "a", "our", "key", "by"],
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
      "fugiat", "nulla", "pariatur", "excepteur", "sint", "occaecat", "cupidatat",
      "non", "proident", "sunt", "culpa", "qui", "officia", "deserunt", "mollit",
      "anim", "id", "est", "laborum", "totam", "rem", "aperiam", "eaque",
      "ipsa", "quae", "ab", "illo", "inventore", "veritatis", "quasi", "architecto",
      "beatae", "vitae", "explicabo", "nemo", "voluptatem", "accusantium",
    ],
    glue: ["et", "ut", "in", "ad", "a", "ac"],
  },
];

const MODE_OPTIONS: {
  value: Mode;
  label: string;
  unitLabel: string;
  min: number;
  max: number;
  step: number;
  default: number;
}[] = [
  { value: "paragraphs", label: "Paragraphs", unitLabel: "Paragraphs", min: 1, max: 10, step: 1, default: 3 },
  { value: "words", label: "Words", unitLabel: "Words", min: 25, max: 500, step: 25, default: 150 },
  { value: "sentences", label: "Sentences", unitLabel: "Sentences", min: 1, max: 30, step: 1, default: 8 },
  { value: "bullets", label: "Bullets", unitLabel: "Bullets", min: 3, max: 15, step: 1, default: 5 },
];

function modeConfig(mode: Mode) {
  return MODE_OPTIONS.find((o) => o.value === mode) ?? MODE_OPTIONS[0];
}

type Output =
  | { kind: "paragraphs"; heading?: string; paragraphs: string[] }
  | { kind: "single"; heading?: string; text: string }
  | { kind: "bullets"; heading?: string; items: string[] };

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
  // Mid-sentence comma sometimes; rarely an em-dash inset.
  if (Math.random() < 0.45 && out.length > 6) {
    const at = 2 + Math.floor(Math.random() * (out.length - 4));
    out[at] = out[at] + ",";
  }
  if (Math.random() < 0.12 && out.length > 7) {
    const at = 3 + Math.floor(Math.random() * (out.length - 5));
    out[at] = out[at] + " —";
  }
  let sentence = out.join(" ");
  sentence = sentence[0].toUpperCase() + sentence.slice(1);
  // Mostly periods, occasional question or exclamation for variety.
  const r = Math.random();
  const ending = r < 0.08 ? "?" : r < 0.13 ? "!" : ".";
  return sentence + ending;
}

function generateParagraph(f: Flavour): string {
  const sentences = 3 + Math.floor(Math.random() * 3);
  return Array.from({ length: sentences }, () => generateSentence(f)).join(" ");
}

function generateBullet(f: Flavour): string {
  // Bullets are tighter — 4-9 words, no comma, em-dash, or terminal punctuation.
  const len = 4 + Math.floor(Math.random() * 6);
  const words: string[] = [];
  for (let i = 0; i < len; i++) {
    const useGlue = Math.random() < 0.25 && i > 0 && i < len - 1;
    words.push(useGlue ? pick(f.glue) : pick(f.pool));
  }
  let s = words.join(" ");
  s = s[0].toUpperCase() + s.slice(1);
  return s;
}

function generateHeading(f: Flavour): string {
  const len = 3 + Math.floor(Math.random() * 5); // 3-7 words
  const words: string[] = [];
  for (let i = 0; i < len; i++) {
    // Less glue in headings — punchier titles.
    const useGlue = Math.random() < 0.18 && i > 0 && i < len - 1;
    words.push(useGlue ? pick(f.glue) : pick(f.pool));
  }
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).length;
}

function generate(
  mode: Mode,
  count: number,
  includeHeading: boolean,
  f: Flavour,
): Output {
  const heading = includeHeading ? generateHeading(f) : undefined;
  if (mode === "paragraphs") {
    const paragraphs = Array.from({ length: count }, () => generateParagraph(f));
    return { kind: "paragraphs", heading, paragraphs };
  }
  if (mode === "sentences") {
    const sentences = Array.from({ length: count }, () => generateSentence(f));
    return { kind: "single", heading, text: sentences.join(" ") };
  }
  if (mode === "words") {
    // Build paragraphs of 3-5 sentences each until we hit the word target.
    // Reading 500 words as one block is tiring; paragraph breaks help.
    const paragraphs: string[] = [];
    let total = 0;
    while (total < count) {
      const sentences: string[] = [];
      const targetSentences = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < targetSentences && total < count; i++) {
        const s = generateSentence(f);
        sentences.push(s);
        total += wordCount(s);
      }
      paragraphs.push(sentences.join(" "));
    }
    return { kind: "paragraphs", heading, paragraphs };
  }
  // bullets
  const items = Array.from({ length: count }, () => generateBullet(f));
  return { kind: "bullets", heading, items };
}

function toPlainText(out: Output): string {
  const blocks: string[] = [];
  if (out.heading) blocks.push(out.heading);
  if (out.kind === "paragraphs") {
    blocks.push(...out.paragraphs);
  } else if (out.kind === "single") {
    blocks.push(out.text);
  } else {
    // Bullets share one block — single newlines between, blank line above.
    blocks.push(out.items.map((i) => `- ${i}`).join("\n"));
  }
  return blocks.join("\n\n");
}

export default function LoremPage() {
  const tool = findTool("lorem")!;
  const [flavourId, setFlavourId] = useLocalStorageState<FlavourId>(FLAVOUR_KEY, "pirate");
  const [settings, setSettings] = useLocalStorageState<Settings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );

  // Defensive reads — older persisted shapes might be missing fields.
  const mode: Mode = settings.mode ?? "paragraphs";
  const includeHeading = settings.includeHeading ?? false;

  // Validate the saved flavour — if a flavour was renamed/removed in code
  // since the user's last visit, fall back to the first available one.
  const safeFlavourId: FlavourId = FLAVOURS.some((f) => f.id === flavourId)
    ? flavourId
    : FLAVOURS[0].id;

  const [count, setCount] = useState(modeConfig(mode).default);
  const [output, setOutput] = useState<Output | null>(null);
  const [copied, setCopied] = useState(false);

  const cfg = modeConfig(mode);

  const generateOutput = useCallback(
    (over: {
      flavourId?: FlavourId;
      mode?: Mode;
      count?: number;
      includeHeading?: boolean;
    } = {}) => {
      const fId = over.flavourId ?? safeFlavourId;
      const f = FLAVOURS.find((x) => x.id === fId) ?? FLAVOURS[0];
      const m = over.mode ?? mode;
      const c = over.count ?? count;
      const h = over.includeHeading ?? includeHeading;
      setOutput(generate(m, c, h, f));
    },
    [safeFlavourId, mode, count, includeHeading],
  );

  // Initial generation on mount, after hydration. Math.random in a lazy
  // useState initialiser would cause SSR/client mismatch; running it from
  // an effect keeps the server HTML deterministic.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!output) generateOutput();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const handleFlavour = (id: FlavourId) => {
    setFlavourId(id);
    generateOutput({ flavourId: id });
  };

  const handleMode = (m: Mode) => {
    const def = modeConfig(m).default;
    setSettings((s) => ({ ...s, mode: m }));
    setCount(def);
    generateOutput({ mode: m, count: def });
  };

  const handleToggleHeading = () => {
    const next = !includeHeading;
    setSettings((s) => ({ ...s, includeHeading: next }));
    generateOutput({ includeHeading: next });
  };

  const copy = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(toPlainText(output));
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
                onClick={() => handleFlavour(f.id)}
                className={`card-chunk flex flex-col items-start gap-0.5 rounded-[var(--radius-card)] p-3 text-left transition-colors ${
                  safeFlavourId === f.id
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

        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Length
            </span>
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleMode(opt.value)}
                  className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    active ? "bg-ink text-cream" : "bg-cream hover:bg-yellow-soft"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleToggleHeading}
              className={`ml-auto rounded-full border-2 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                includeHeading
                  ? "bg-ink text-cream"
                  : "bg-cream hover:bg-yellow-soft"
              }`}
            >
              {includeHeading ? "✓ Heading" : "+ Heading"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{cfg.unitLabel}</span>
            <input
              type="range"
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="accent-yellow"
            />
            <span className="w-10 font-mono text-sm font-bold tabular-nums">
              {count}
            </span>
          </label>
          <button
            type="button"
            onClick={() => generateOutput()}
            className="btn-chunk rounded-[var(--radius-button)] bg-yellow px-5 py-2 font-display text-base font-extrabold"
          >
            Generate ↻
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!output}
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-base font-extrabold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copied ? "Copied!" : "Copy all"}
          </button>
        </div>

        <article className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-cream p-5 sm:p-6">
          {!output ? (
            <p className="text-sm text-ink-muted">
              Hit generate to fill the page.
            </p>
          ) : (
            <>
              {output.heading && (
                <h2 className="fade-rise font-display text-xl font-extrabold tracking-tight text-ink">
                  {output.heading}
                </h2>
              )}
              {output.kind === "paragraphs" &&
                output.paragraphs.map((p, i) => (
                  <p
                    key={i}
                    className="fade-rise text-base leading-relaxed text-ink"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {p}
                  </p>
                ))}
              {output.kind === "single" && (
                <p className="fade-rise text-base leading-relaxed text-ink">
                  {output.text}
                </p>
              )}
              {output.kind === "bullets" && (
                <ul className="flex flex-col gap-1.5 text-base leading-relaxed text-ink">
                  {output.items.map((it, i) => (
                    <li
                      key={i}
                      className="fade-rise flex gap-2"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span aria-hidden className="select-none text-ink-soft">
                        —
                      </span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>
      </div>
    </ToolFrame>
  );
}
