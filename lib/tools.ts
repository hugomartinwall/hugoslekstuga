export type ToolColor =
  | "tomato"
  | "blue"
  | "yellow"
  | "pink"
  | "green"
  | "purple";

export type Tool = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  color: ToolColor;
  emoji: string;
};

export const tools: Tool[] = [
  {
    slug: "advice",
    title: "Advice",
    tagline: "One good advice, on demand.",
    description:
      "Press a button, get one piece of advice. No feed. No notifications. Just the smallest useful thing in the moment.",
    color: "yellow",
    emoji: "✶",
  },
  {
    slug: "feeling",
    title: "Handle a Feeling",
    tagline: "Pick a feeling, get tips that work.",
    description:
      "Choose what you're feeling and get a few short, science-based things to try — drawn from CBT, behavioral activation, ACT, and modern psychology.",
    color: "pink",
    emoji: "❀",
  },
  {
    slug: "convert",
    title: "Document Converter",
    tagline: "Convert files without uploading them.",
    description:
      "Drop in a file, pick a target format, get the converted file back. Everything happens in your browser — your files never leave your device.",
    color: "blue",
    emoji: "⇄",
  },
  {
    slug: "focus",
    title: "Focus",
    tagline: "Set an intention. Start the timer.",
    description:
      "Name what you're working on, pick a length, and let the page hold space for it. A small, calm timer with a soft chime when time's up.",
    color: "green",
    emoji: "◴",
  },
  {
    slug: "qr",
    title: "QR Code",
    tagline: "Make a QR for anything.",
    description:
      "Type a URL or a few lines of text and a QR code appears. Download as PNG or SVG. No tracking pixels, no sign-up.",
    color: "tomato",
    emoji: "▦",
  },
  {
    slug: "read",
    title: "Read",
    tagline: "What's in your text?",
    description:
      "Paste anything you've written and see word count, reading time, readability, and the words you lean on most. Useful for writers and editors.",
    color: "purple",
    emoji: "¶",
  },
];

export function findTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}

export const colorClasses: Record<
  ToolColor,
  { bg: string; bgSoft: string; text: string; ring: string }
> = {
  tomato: {
    bg: "bg-tomato",
    bgSoft: "bg-tomato-soft",
    text: "text-tomato",
    ring: "ring-tomato",
  },
  blue: {
    bg: "bg-blue",
    bgSoft: "bg-blue-soft",
    text: "text-blue",
    ring: "ring-blue",
  },
  yellow: {
    bg: "bg-yellow",
    bgSoft: "bg-yellow-soft",
    text: "text-yellow",
    ring: "ring-yellow",
  },
  pink: {
    bg: "bg-pink",
    bgSoft: "bg-pink-soft",
    text: "text-pink",
    ring: "ring-pink",
  },
  green: {
    bg: "bg-green",
    bgSoft: "bg-green-soft",
    text: "text-green",
    ring: "ring-green",
  },
  purple: {
    bg: "bg-purple",
    bgSoft: "bg-purple-soft",
    text: "text-purple",
    ring: "ring-purple",
  },
};
