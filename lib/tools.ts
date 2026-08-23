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
  /** Fresh arrival — the homepage swarm hangs a NEW tag on the orb. Remove after the novelty fades. */
  isNew?: boolean;
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
    slug: "pixla",
    title: "Pixla",
    tagline: "Drop a photo, get a sprite.",
    description:
      "Drag in any image and watch it collapse into chunky pixels. Pick a palette, tune the grid, flip on dithering, download a crisp PNG. Nothing is uploaded — it all happens in your tab.",
    color: "tomato",
    emoji: "▦",
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
    color: "purple",
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
    slug: "overrun",
    title: "Overrun",
    tagline: "Send everything. Take everything.",
    description:
      "A tiny real-time strategy game against the machine. Nodes breed units; drag from yours to pour them somewhere else. Take the neutrals, overrun three rival factions across a thirty-level campaign — checkpoints bank your progress, cores buy doctrine and powers between runs, and the levels don't get kinder. Single player, runs entirely in your tab.",
    color: "pink",
    emoji: "◍",
    isNew: true,
  },
  {
    slug: "adventure",
    title: "Adventure",
    tagline: "One sword. Ten worlds.",
    description:
      "A top-down action adventure. At closing time Hugo takes the lost & found sword and walks out the back door — ten worlds, ten bosses, and a change machine that follows him selling upgrades. You start with only a swing; by the end you have everything. Runs entirely in your tab.",
    color: "pink",
    emoji: "⚔",
    isNew: true,
  },
  {
    slug: "greyrot",
    title: "Greyrot",
    tagline: "The mould takes the colour first.",
    description:
      "A real-time action adventure about the smallest mushroom in the colony. A grey rot is draining the forest of its colour, and you walk into it with one element and no plan — six get found along the road, two can be queued at once, and every cast goes wherever you happen to be facing. Spells leave water, oil, ice and fire on the ground; all of it spreads, reacts, and burns you too. Runs entirely in your tab.",
    color: "pink",
    emoji: "🍄",
    isNew: true,
  },
];

export function findTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}
