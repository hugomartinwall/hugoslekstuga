export const characters = [
  "a retired spy",
  "a paranoid astronaut",
  "an aging boxer",
  "a small-town locksmith",
  "a midnight pastry chef",
  "a tax accountant who used to be a saint",
  "an off-grid weather scientist",
  "a child diplomat",
  "a stand-up comedian losing their voice",
  "a stage magician's assistant",
  "a librarian with a photographic memory",
  "a former cult member, now a florist",
  "an unsuccessful mountain climber",
  "a substitute teacher with a grudge",
  "a deep-sea welder",
  "a wedding officiant for hire",
  "an apartment-building superintendent",
  "an early-shift baker",
  "a private investigator who always loses tails",
  "a competitive eater between jobs",
  "a lighthouse keeper's daughter",
  "a translator of dead languages",
  "a portrait photographer in a dying town",
  "a former child star, now a vet tech",
  "a pawn-shop owner with a wall of secrets",
];

export const settings = [
  "during a city-wide blackout",
  "on the last night of summer camp",
  "at a wedding nobody wanted to attend",
  "in a hotel that's been booked solid for forty years",
  "on a sleeper train crossing two borders",
  "in a town where everyone is named after a flower",
  "at the only diner open after 2 a.m.",
  "in a small theater between rehearsals",
  "during the slowest Sunday at a museum",
  "on the bench outside a vet clinic",
  "in a parking lot full of unsold ice-cream trucks",
  "at a community-college commencement",
  "in an empty cathedral at noon",
  "on a roof in a neighborhood that's about to be demolished",
  "in a self-storage unit they didn't rent",
  "at the back booth of a 24-hour bowling alley",
  "in a half-restored vintage shop",
  "in a sleep clinic's reception area",
  "during the first snow of the year",
  "in a public laundromat at 4 a.m.",
];

export const twists = [
  "discovers an old photograph of themselves they don't remember taking",
  "is mistaken for someone famous, repeatedly",
  "finds a list of their own decisions, written in someone else's handwriting",
  "receives a phone call meant for someone with the same name",
  "is offered an enormous amount of money for something they no longer have",
  "starts replying to letters delivered to the wrong address",
  "sees the exact same stranger for the third time this week",
  "is invited to a reunion of a club they don't recall joining",
  "wakes up speaking a language they don't know",
  "is accused of a small but specific crime they didn't commit",
  "agrees to a favor they don't fully understand",
  "learns their childhood imaginary friend was real",
  "finds a single key that fits no lock they own",
  "inherits a piece of furniture with a hidden compartment",
  "is recognized by someone they've never met",
  "loses a small heirloom and starts seeing it everywhere",
  "is asked to deliver a message to themselves from ten years ago",
];

export const tones = [
  "told entirely through what's left out",
  "in five short scenes, each shorter than the last",
  "written like a friendly local news segment",
  "in the form of a single uninterrupted phone call",
  "narrated by an object in the room",
  "with the ending revealed in the first line",
  "as a series of overheard conversations",
  "in the second person, present tense",
];

export type PromptKey = "character" | "setting" | "twist" | "tone";

export type Prompt = Record<PromptKey, string>;

export type Locks = Record<PromptKey, boolean>;

export const EMPTY_LOCKS: Locks = {
  character: false,
  setting: false,
  twist: false,
  tone: false,
};

const POOLS: Record<PromptKey, string[]> = {
  character: characters,
  setting: settings,
  twist: twists,
  tone: tones,
};

function pick<T>(arr: T[], avoid?: T): T {
  if (arr.length === 0) throw new Error("empty list");
  if (arr.length === 1 || avoid === undefined) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  let v = arr[Math.floor(Math.random() * arr.length)];
  let attempts = 0;
  while (v === avoid && attempts < 8) {
    v = arr[Math.floor(Math.random() * arr.length)];
    attempts++;
  }
  return v;
}

/**
 * Generate a new prompt. For any locked key, keep the previous value.
 */
export function generatePrompt(prev?: Prompt, locks: Locks = EMPTY_LOCKS): Prompt {
  const out: Prompt = { character: "", setting: "", twist: "", tone: "" };
  (Object.keys(POOLS) as PromptKey[]).forEach((k) => {
    if (locks[k] && prev) {
      out[k] = prev[k];
    } else {
      out[k] = pick(POOLS[k], prev?.[k]);
    }
  });
  return out;
}

/**
 * Re-roll a single key only.
 */
export function rerollPart(prev: Prompt, key: PromptKey): Prompt {
  return { ...prev, [key]: pick(POOLS[key], prev[key]) };
}
