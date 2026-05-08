// Shot's static configuration — backgrounds, themes, languages, aspect
// ratios. Kept here so the page module stays focused on UI.

export type Aspect = "free" | "tweet" | "square" | "story" | "github";

export const ASPECT_DIMENSIONS: Record<Aspect, { w: number; h: number } | null> = {
  free: null,
  tweet: { w: 1200, h: 675 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  github: { w: 1280, h: 640 },
};

export type BgPreset = {
  id: string;
  label: string;
  kind: "gradient" | "solid" | "transparent";
  /** CSS background value. Empty for transparent (we render a checker). */
  css: string;
};

// Curated, opinionated. The point is "you'll find one you like" — not 200 options.
export const BG_PRESETS: BgPreset[] = [
  {
    id: "playhouse",
    label: "Playhouse",
    kind: "gradient",
    css: "linear-gradient(135deg, #ff7ab2 0%, #ff5a3c 60%, #ffc233 100%)",
  },
  {
    id: "ember",
    label: "Ember",
    kind: "gradient",
    css: "linear-gradient(140deg, #ff5a3c 0%, #f97316 50%, #ffc233 100%)",
  },
  {
    id: "deep",
    label: "Deep",
    kind: "gradient",
    css: "linear-gradient(160deg, #1a1812 0%, #0d9488 100%)",
  },
  {
    id: "mint",
    label: "Mint",
    kind: "gradient",
    css: "linear-gradient(160deg, #3fa66e 0%, #4f66f2 100%)",
  },
  {
    id: "violet",
    label: "Violet",
    kind: "gradient",
    css: "linear-gradient(135deg, #9333ea 0%, #ff7ab2 100%)",
  },
  {
    id: "paper",
    label: "Paper",
    kind: "solid",
    css: "#FBF8F1",
  },
  {
    id: "ink",
    label: "Ink",
    kind: "solid",
    css: "#1a1812",
  },
  {
    id: "ocean",
    label: "Ocean",
    kind: "gradient",
    css: "linear-gradient(160deg, #4f66f2 0%, #3fa66e 100%)",
  },
  {
    id: "transparent",
    label: "Transparent",
    kind: "transparent",
    css: "",
  },
];

export type Frame = "none" | "border" | "macos" | "browser" | "iphone";

export const FRAMES: Array<{ id: Frame; label: string }> = [
  { id: "none", label: "None" },
  { id: "border", label: "Border" },
  { id: "macos", label: "macOS" },
  { id: "browser", label: "Browser" },
  { id: "iphone", label: "iPhone" },
];

// Languages we want highlighting for. Lazy-loaded via Shiki on demand.
export const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: "typescript", label: "TypeScript" },
  { id: "tsx", label: "TSX" },
  { id: "javascript", label: "JavaScript" },
  { id: "jsx", label: "JSX" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "swift", label: "Swift" },
  { id: "ruby", label: "Ruby" },
  { id: "php", label: "PHP" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "bash", label: "Shell" },
  { id: "sql", label: "SQL" },
  { id: "markdown", label: "Markdown" },
];

export const THEMES: Array<{ id: string; label: string }> = [
  { id: "github-dark", label: "GitHub Dark" },
  { id: "github-light", label: "GitHub Light" },
  { id: "vitesse-dark", label: "Vitesse Dark" },
  { id: "vitesse-light", label: "Vitesse Light" },
  { id: "rose-pine", label: "Rosé Pine" },
  { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "monokai", label: "Monokai" },
  { id: "dracula", label: "Dracula" },
  { id: "nord", label: "Nord" },
];

export const STARTER_CODE = `// shot — make a screenshot worth posting.
import { useState } from "react";

export function Counter() {
  const [n, setN] = useState(0);
  return (
    <button onClick={() => setN(n + 1)}>
      Count: {n}
    </button>
  );
}
`;
