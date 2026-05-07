"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

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

export default function LoremPage() {
  const tool = findTool("lorem")!;
  const [flavourId, setFlavourId] = useLocalStorageState<FlavourId>(STORAGE_KEY, "pirate");
  // Validate the saved flavour — if a flavour was renamed/removed in code
  // since the user's last visit, fall back to the first available one.
  const safeFlavourId: FlavourId =
    FLAVOURS.some((f) => f.id === flavourId) ? flavourId : FLAVOURS[0].id;
  const [count, setCount] = useState(3);
  const [output, setOutput] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const flavour = FLAVOURS.find((f) => f.id === safeFlavourId)!;

  const generate = useCallback(() => {
    const paragraphs = Array.from({ length: count }, () => generateParagraph(flavour));
    setOutput(paragraphs);
  }, [count, flavour]);

  // Generate once on first mount so the page isn't empty. Math.random in a
  // lazy useState initialiser would cause an SSR/client hydration mismatch
  // (server picks one paragraph, client picks a different one); the effect
  // runs only after hydration where Math.random is safe.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (output.length === 0) {
      setOutput(
        Array.from({ length: count }, () => generateParagraph(flavour)),
      );
    }
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

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
