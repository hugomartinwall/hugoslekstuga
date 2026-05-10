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
    title: "Spin the Wheel",
    tagline: "Can't decide? Let it decide.",
    description:
      "Type a list of options, hit spin, and a colorful wheel picks one for you. For dinner choices, task order, friendly arguments — anything.",
    color: "orange",
    emoji: "◐",
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
    slug: "pdf",
    title: "PDF",
    tagline: "Merge, split, and extract — without uploading.",
    description:
      "Combine multiple PDFs into one, split one into pages, or pull out just the pages you need. Everything happens locally — no third-party server sees your file.",
    color: "teal",
    emoji: "▤",
  },
  {
    slug: "strip",
    title: "Strip",
    tagline: "Drop a photo, lose the metadata.",
    description:
      "Drag in any image and watch the GPS, camera, and timestamp data fly off and disappear. Download a clean copy. Nothing is uploaded — privacy by way of physics.",
    color: "tomato",
    emoji: "⊘",
  },
  {
    slug: "case",
    title: "Case",
    tagline: "The wonky case-converter.",
    description:
      "Mocking, reverse, inverted, l33t, clap-case, spaced, redacted, ROT13. For when you've got something to say and want it to look weird.",
    color: "purple",
    emoji: "⌷",
  },
  {
    slug: "cleantext",
    title: "Cleantext",
    tagline: "Strip invisible junk from your text.",
    description:
      "Smart quotes, em-dashes, BOM markers, zero-width characters, weird whitespace — paste in messy text and watch them peel away. The clean version is yours to copy.",
    color: "tomato",
    emoji: "⌫",
  },
  {
    slug: "lorem",
    title: "Lorem",
    tagline: "Placeholder text, with personality.",
    description:
      "Pick a flavour — pirate, recipe, fairytale, cyberpunk, corporate-speak — and generate the paragraphs you need. Beats Latin every time.",
    color: "yellow",
    emoji: "§",
  },
  {
    slug: "typing",
    title: "Typing",
    tagline: "How fast do you really type?",
    description:
      "A one-minute typing test on real prose, with live accuracy and a streak. Stays out of your way, then shows you a result you can keep.",
    color: "green",
    emoji: "⌑",
  },

  // ---------- games ----------

  {
    slug: "munch",
    title: "Munch",
    tagline: "The bigger the better.",
    description:
      "Real-time multiplayer on a single shared map. Eat the dots, eat the smaller players, dodge the bigger ones. Press space to fire half of yourself forward as a weapon. No accounts, no chat, just one shared room.",
    color: "purple",
    emoji: "◉",
  },
  {
    slug: "noodle",
    title: "Noodle",
    tagline: "Eat dots. Don't get bumped.",
    description:
      "Real-time multiplayer snake. You move forward at all times — aim with the mouse or your finger, eat dots to grow, hit another snake's body and you die. Hold space to boost (costs length). One shared room, pasta-named bots fill it when you're alone.",
    color: "green",
    emoji: "~",
  },
];

export function findTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}
