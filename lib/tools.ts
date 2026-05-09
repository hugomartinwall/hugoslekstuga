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
    title: "Spin the Wheel",
    tagline: "Can't decide? Let it decide.",
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
    slug: "sketch",
    title: "Sketch",
    tagline: "Draw something, download it.",
    description:
      "A quick drawing canvas with a pen, eraser, color picker, and undo. Sketch a wireframe, sign your name, doodle. Save as a PNG when you're done.",
    color: "teal",
    emoji: "✎",
  },
  {
    slug: "zones",
    title: "Zones",
    tagline: "What time is it for them, right now?",
    description:
      "Pick the cities your collaborators are in and see them all at a glance. Drag a slider to find a meeting time that doesn't ruin anyone's evening.",
    color: "blue",
    emoji: "⊙",
  },
  {
    slug: "squeeze",
    title: "Squeeze",
    tagline: "Make any image lighter.",
    description:
      "Drop a photo, choose a target size or quality, get a smaller version. Perfect for emails, slide decks, and Slack uploads. The file never leaves your browser.",
    color: "orange",
    emoji: "◌",
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
    slug: "talk",
    title: "Talk",
    tagline: "Pace your presentation.",
    description:
      "A timer for talks, demos, and standups. Set the length, get visual milestones at 25 / 50 / 75 / 90% and a gentle chime when time's up. Stays out of your way.",
    color: "pink",
    emoji: "▷",
  },
  {
    slug: "slug",
    title: "Slug",
    tagline: "Clean text for URLs, filenames, identifiers.",
    description:
      "Type anything and get a URL-safe slug, plus kebab-case, snake_case, camelCase, PascalCase, CONSTANT_CASE, and Title Case. Click any to copy.",
    color: "tomato",
    emoji: "—",
  },

  // ---------- Round 2: 25 more tools to reach 50 ----------

  // Files
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
    slug: "trace",
    title: "Trace",
    tagline: "Bitmap in, vector out.",
    description:
      "Drop a PNG or JPG and get back crisp SVG paths you can scale forever. Tweak the threshold, copy the markup, save the file.",
    color: "orange",
    emoji: "◇",
  },
  {
    slug: "ascii",
    title: "ASCII",
    tagline: "Turn any image into text.",
    description:
      "Drop a photo, drag the density slider, watch it become characters. Copy the result as text or save it as an image.",
    color: "green",
    emoji: "▥",
  },
  {
    slug: "base64",
    title: "Base64",
    tagline: "Encode an image, decode a data URL.",
    description:
      "Two-way base64 for images. Drop a file and copy the data URL, or paste a data URL and see the picture. Useful for embedding in CSS or JSON.",
    color: "blue",
    emoji: "◰",
  },
  {
    slug: "favicon",
    title: "Favicon",
    tagline: "One PNG, every favicon size.",
    description:
      "Drop in a square image and get all the favicon sizes a modern browser asks for, plus a manifest snippet. Built for new project setup.",
    color: "yellow",
    emoji: "◧",
  },

  // Writing
  {
    slug: "case",
    title: "Case",
    tagline: "The wonky case-converter.",
    description:
      "Mocking, reverse, inverted, l33t, clap-case, spaced, redacted, ROT13. For when you've got something to say and want it to look weird. The serious cases live in Slug.",
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
  // Wellness
  {
    slug: "tally",
    title: "Tally",
    tagline: "A clicker for counting things.",
    description:
      "Tap to add. Long-press to reset. Soft sound, satisfying click. For birds, reps, the people coming through the door — anything you'd otherwise count on paper.",
    color: "orange",
    emoji: "⫶",
  },
  {
    slug: "noise",
    title: "Noise",
    tagline: "Build a soundscape for focus.",
    description:
      "Mix white, pink, and brown noise with a slow drone using chunky sliders. Generated live in your browser — no audio files, no internet needed.",
    color: "blue",
    emoji: "≋",
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

  // Creative
  {
    slug: "mash",
    title: "Mash",
    tagline: "Smash two word lists together.",
    description:
      "Two pools of words bounce until one combination wins. Brainstorm names, projects, bands, pets — useful when nothing in your head fits.",
    color: "pink",
    emoji: "⋈",
  },

  // Code (new cluster)
  {
    slug: "gradient",
    title: "Gradient",
    tagline: "Build a CSS gradient, copy the snippet.",
    description:
      "Drag stops on a chunky bar, pick colours, switch between linear, radial, and conic. The CSS updates live and is yours to copy.",
    color: "pink",
    emoji: "◓",
  },
  {
    slug: "contrast",
    title: "Contrast",
    tagline: "Will anyone be able to read this?",
    description:
      "Type two hex codes and we tell you the WCAG contrast ratio — plus the words actually fighting to be read.",
    color: "orange",
    emoji: "◑",
  },
  {
    slug: "shadow",
    title: "Shadow",
    tagline: "Stack box-shadows like a pro.",
    description:
      "Layer multiple shadows for depth, neumorphism, or paper-cutout effects. Drag offset, blur, and spread, then copy the CSS.",
    color: "teal",
    emoji: "◖",
  },
  {
    slug: "easing",
    title: "Easing",
    tagline: "Design a cubic-bezier curve by feel.",
    description:
      "Drag the handles, watch the easing on a real moving element. When it feels right, copy the values.",
    color: "teal",
    emoji: "⌇",
  },
  {
    slug: "regex",
    title: "Regex",
    tagline: "Test a pattern, see what matches.",
    description:
      "A live regex tester with highlighted matches and a small cheatsheet on the side. Paste your regex, paste your text, fix until it sticks.",
    color: "teal",
    emoji: "⫽",
  },

  // ---------- Round 3: complex tools ----------

  {
    slug: "sum",
    title: "Sum",
    tagline: "Math you can read.",
    description:
      "A notepad calculator. Type one line at a time and see each answer pinned to the right — variables, line references, percentages, units, currency. Multiple sessions, all stored on your device.",
    color: "yellow",
    emoji: "∑",
  },
  {
    slug: "sift",
    title: "Sift",
    tagline: "Drop a CSV. See what's in it.",
    description:
      "An explorer for tabular data. Drop a CSV, TSV, or JSON array and you get a sortable, filterable table with auto-detected column types and a per-column summary — count, range, top values, sparkline. Files never leave your browser.",
    color: "purple",
    emoji: "⌗",
  },
  {
    slug: "shot",
    title: "Shot",
    tagline: "Make a screenshot worth posting.",
    description:
      "Drop a screenshot or paste some code, then dress it up — gradient backgrounds, window chrome, padding, shadow, syntax highlighting in any of a dozen themes. Export at 1×, 2×, or 3× as PNG, or copy straight to your clipboard.",
    color: "tomato",
    emoji: "▣",
  },

  // ---------- Round 4: games ----------

  {
    slug: "munch",
    title: "Munch",
    tagline: "The bigger the better.",
    description:
      "Real-time multiplayer on a single shared map. Eat the dots, eat the smaller players, dodge the bigger ones. Press space to fire half of yourself forward as a weapon. No accounts, no chat, just one shared room.",
    color: "purple",
    emoji: "◉",
  },
];

export function findTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}
