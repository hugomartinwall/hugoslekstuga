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
    slug: "focus",
    title: "Focus",
    tagline: "Set an intention. Start the timer.",
    description:
      "Name what you're working on, pick a length, and let the page hold space for it. A small, calm timer with a soft chime when time's up.",
    color: "green",
    emoji: "◴",
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
    slug: "strip",
    title: "Strip",
    tagline: "Drop a photo, lose the metadata.",
    description:
      "Drag in any image and watch the GPS, camera, and timestamp data fly off and disappear. Download a clean copy. Nothing is uploaded — privacy by way of physics.",
    color: "tomato",
    emoji: "⊘",
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
    slug: "sudoku",
    title: "Sudoku",
    tagline: "Nine by nine. No noise.",
    description:
      "Generate a fresh Sudoku at the difficulty you want, then sit with it. Notes mode for pencil marks, gentle conflict highlighting, a quiet timer, and your puzzle resumes where you left it. No ads, no streaks chasing you for tomorrow.",
    color: "pink",
    emoji: "#",
  },
  {
    slug: "sjokort",
    title: "Sjökort",
    tagline: "See where you are on the water.",
    description:
      "A live sea chart of Stockholm and the archipelago. Pan the sjökort, switch on GPS, and a boat marker tracks your position. The one tool here that loads map tiles from the open web — your location never leaves your device.",
    color: "teal",
    emoji: "◎",
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
