"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import Slider from "@/components/Slider";
import ToolFrame from "@/components/ToolFrame";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
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

const subscribeToNothing = () => () => {};

/**
 * False while the server's HTML is being hydrated, true from the next
 * render on, and true at once on a visit that arrives from another
 * page. Values saved on the device arrive on that same render.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
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
  const flavourLabelId = useId();
  const lengthLabelId = useId();
  const hydrated = useHydrated();

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

  // The first text, made once the saved settings are in. Math.random in
  // a lazy useState initialiser would cause SSR/client mismatch; running
  // it from an effect keeps the server HTML deterministic.
  //
  // On a full page load the first render has to match the server's
  // HTML, so it runs on the defaults, and the saved flavour, length and
  // heading arrive one render later. The first text used to be made
  // from that first render: "Words" selected over three pirate
  // paragraphs, the slider reading 3. It waits for the second render
  // now, and the count starts at the saved length's own default, as it
  // always has on a visit that arrives from another page.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!hydrated || output) return;
    const def = modeConfig(mode).default;
    setCount(def);
    generateOutput({ count: def });
  }, [hydrated]);
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

  // About the odd sizes below (min-w-13, -26, -27, -33 and the 10px gap):
  // a chip or key sized by its label is a fraction of a pixel wide (the
  // mono face is 8.4px a letter at this size), and everything after it in
  // the row then sits off the pixel grid, which smears its 1px ring on a
  // 1x screen. The minimums round each one up to whole pixels, and the
  // 10px gap lets three flavour cards divide the column evenly.
  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="flex flex-col gap-3">
          <p id={flavourLabelId} className="label-pixel">
            Pick a flavour
          </p>
          <div
            role="group"
            aria-labelledby={flavourLabelId}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5"
          >
            {FLAVOURS.map((f) => {
              const selected = safeFlavourId === f.id;
              return (
                <Panel
                  key={f.id}
                  as="button"
                  type="button"
                  tone={selected ? "soft" : "page"}
                  aria-pressed={selected}
                  onClick={() => handleFlavour(f.id)}
                  className="flex flex-col items-start gap-1.5 p-3 text-left sm:p-4"
                >
                  <span className="font-display text-xl leading-none">
                    {f.label}
                  </span>
                  <span className="text-xs text-pretty text-ink-soft">
                    {f.description}
                  </span>
                </Panel>
              );
            })}
          </div>
        </div>

        {/* Everything in this panel regenerates the text the moment it is
            pressed. Below `md` one row cannot hold all five chips, so the
            label and the Heading toggle share the top line and the four
            lengths sit under them (two by two on a phone). */}
        <Panel className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          <span id={lengthLabelId} className="label-pixel md:min-w-13">
            Length
          </span>
          <ChipGroup
            labelledBy={lengthLabelId}
            options={MODE_OPTIONS}
            value={mode}
            onChange={handleMode}
            className="order-last w-full max-sm:grid max-sm:grid-cols-2 md:order-none md:w-auto"
            chipClassName="sm:min-w-26"
          />
          {/* The tick is a wider glyph than the plus: the minimum width
              keeps the chip the same size in both states. */}
          <Chip
            pressed={includeHeading}
            onClick={handleToggleHeading}
            className="ml-auto min-w-28"
          >
            {includeHeading ? "✓ Heading" : "+ Heading"}
          </Chip>
        </Panel>

        {/* The slider is the one control that waits for Generate, so it
            sits with that key and not in the panel above. */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Slider
            label={cfg.unitLabel}
            min={cfg.min}
            max={cfg.max}
            step={cfg.step}
            value={count}
            onChange={setCount}
            className="w-full sm:w-auto sm:flex-1"
          />
          <div className="flex w-full gap-2 sm:w-auto">
            <Keycap
              tone="accent"
              onClick={() => generateOutput()}
              className="max-sm:flex-1 sm:min-w-33"
            >
              Generate ↻
            </Keycap>
            {/* Wide enough for the longer of its two labels, so the row
                does not twitch when it says "Copied!". */}
            <Keycap onClick={copy} disabled={!output} className="min-w-27">
              {copied ? "Copied!" : "Copy all"}
            </Keycap>
          </div>
        </div>

        <Panel as="article" className="flex flex-col gap-4 p-5 sm:p-6">
          {!output ? (
            <p className="text-sm text-ink-muted">
              Hit generate to fill the page.
            </p>
          ) : (
            <>
              {output.heading && (
                <h2 className="fade-rise font-display text-2xl leading-tight text-ink">
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
        </Panel>
      </div>
    </ToolFrame>
  );
}
