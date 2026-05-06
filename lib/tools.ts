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
  {
    slug: "sleep",
    title: "Sleep",
    tagline: "When to go to bed.",
    description:
      "Tell it when you'd like to wake up (or when you're going to bed). It returns the times that fall on a 90-minute sleep cycle so you wake between cycles, not in the middle of one.",
    color: "blue",
    emoji: "☾",
  },
  {
    slug: "idea",
    title: "Idea",
    tagline: "A spark for the blank page.",
    description:
      "A creative-writing prompt generator. Press the button and get an unlikely combination of character, twist, and setting. Use them, ignore them, mash them up.",
    color: "pink",
    emoji: "✦",
  },
  {
    slug: "markdown",
    title: "Markdown",
    tagline: "Type Markdown, see it rendered.",
    description:
      "A two-pane Markdown editor with live preview. Headings, lists, code, links, tables. Copy the HTML when you're happy. Saves locally so a refresh doesn't lose your work.",
    color: "tomato",
    emoji: "⌘",
  },
  {
    slug: "diff",
    title: "Diff",
    tagline: "What changed between two texts?",
    description:
      "Paste an old version and a new version, see what was added, removed, or kept. Toggle word- or line-level. Useful for tracking edits, contracts, code snippets.",
    color: "orange",
    emoji: "⇆",
  },
  {
    slug: "stretch",
    title: "Stretch",
    tagline: "Three minutes away from your screen.",
    description:
      "A guided desk-stretch routine — neck rolls, shoulders, wrists, hips, eyes. Hit start, follow along, come back loose. Great in a long Focus session.",
    color: "green",
    emoji: "❄",
  },
  {
    slug: "emoji",
    title: "Emoji",
    tagline: "Find the right emoji, fast.",
    description:
      "A searchable emoji picker. Type a feeling or thing, get matching emojis, click any to copy. No keyboard menus, no doom-scrolling.",
    color: "yellow",
    emoji: "☻",
  },
  {
    slug: "memory",
    title: "Memory",
    tagline: "Match the pairs.",
    description:
      "The classic match-pairs card game, in our brand colors. A small break for the brain. Track your best time and fewest moves.",
    color: "purple",
    emoji: "◈",
  },
  {
    slug: "sketch",
    title: "Sketch",
    tagline: "Draw something, download it.",
    description:
      "A quick drawing canvas with a pen, eraser, color picker, and undo. Sketch a wireframe, sign your name, doodle. Save as a PNG when you're done.",
    color: "teal",
    emoji: "✎",
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
