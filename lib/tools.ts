export type ToolColor =
  | "tomato"
  | "blue"
  | "yellow"
  | "pink"
  | "green"
  | "purple"
  | "orange"
  | "teal";

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
  {
    slug: "roll",
    title: "Roll",
    tagline: "Can't decide? Let the wheel decide.",
    description:
      "Type a list of options, hit spin, and a colorful wheel picks one for you. For dinner choices, task order, friendly arguments — anything.",
    color: "orange",
    emoji: "◐",
  },
  {
    slug: "palette",
    title: "Palette",
    tagline: "Find a palette that fits.",
    description:
      "Start from any color and get matching harmonies — complementary, analogous, triadic, split-complement — with contrast scores and one-click hex copy.",
    color: "teal",
    emoji: "◍",
  },
  {
    slug: "three",
    title: "Three Good Things",
    tagline: "What went right today?",
    description:
      "End your day by jotting down three good things and (if you want) why each happened. A research-backed gratitude habit. Stays on your device, builds a streak.",
    color: "green",
    emoji: "✿",
  },
  {
    slug: "breathe",
    title: "Breathe",
    tagline: "A guided breath, in your browser.",
    description:
      "Pick a pattern — box, 4-7-8, calm — and let a slow, full-screen circle pace your breath. A minute or two is often enough.",
    color: "blue",
    emoji: "⊚",
  },
  {
    slug: "tip",
    title: "Tip",
    tagline: "Sort the bill, fast.",
    description:
      "Type the total, pick a tip, and split it among however many of you. Round up if you feel generous. No accounts, no math in your head.",
    color: "yellow",
    emoji: "⊕",
  },
  {
    slug: "until",
    title: "Time Until",
    tagline: "Count down to the things you're waiting for.",
    description:
      "Add the dates that matter — birthdays, deadlines, trips, the long weekend. Watch them tick down. Stays on your device.",
    color: "purple",
    emoji: "◷",
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
  orange: {
    bg: "bg-orange",
    bgSoft: "bg-orange-soft",
    text: "text-orange",
    ring: "ring-orange",
  },
  teal: {
    bg: "bg-teal",
    bgSoft: "bg-teal-soft",
    text: "text-teal",
    ring: "ring-teal",
  },
};
