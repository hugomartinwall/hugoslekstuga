/**
 * Every line of copy in the game, in one place. The voice is the site's:
 * terse, wry, lowercase-comfortable. The script suite checks that no
 * world has a hole and no line runs long — walls of text are a bug.
 */

export const OPENING_CARD = [
  "the arcade is quiet. the EXIT sign hums.",
  "hugo has a sword now. (it was in lost & found.)",
] as const;

export type WorldScript = {
  intro: string; // under "ADVENTURE N: THE NAME"
  bossLine: string; // under the boss's name on the intro card
  shopLine: string; // VÄXEL's greeting in this world's shop
  clearLine: string; // stinger under "ADVENTURE N CLEAR"
};

export const WORLD_SCRIPT: Record<number, WorldScript> = {
  1: {
    intro: "the door locks behind you.",
    bossLine: "the carts unionized.",
    shopLine: "coins. you have some. i want them. the classic arrangement.",
    clearLine: "the lot is quiet. hugo is not going back inside. yet.",
  },
  2: {
    intro: "the trees remember you.",
    bossLine: "she planted this forest. she can unplant you.",
    shopLine: "i followed you. machines get lonely. buy something.",
    clearLine: "the forest lets you pass. it keeps the receipt.",
  },
  3: {
    intro: "the water is going somewhere. so are you.",
    bossLine: "your papers are not in order.",
    shopLine: "everything here is waterproof. warranty isn't.",
    clearLine: "papers: in order.",
  },
  4: {
    intro: "bring boots. you didn't.",
    bossLine: "rent is due. rent was always due.",
    shopLine: "the bog takes boots. i sell everything but boots. yes, on purpose.",
    clearLine: "rent: negotiated.",
  },
  5: {
    intro: "everything keeps. nothing leaves.",
    bossLine: "it resurfaces more than ice.",
    shopLine: "cold storage. i'm the only warm machine for miles. browse slowly.",
    clearLine: "nothing keeps forever.",
  },
  6: {
    intro: "someone left the everything on.",
    bossLine: "safety briefing cancelled.",
    shopLine: "i used to make change. now i make progress.",
    clearLine: "clocked out.",
  },
  7: {
    intro: "the sand was here first. (the streetlights send their regards.)",
    bossLine: "retired. not tired.",
    shopLine: "sand in my slot. don't ask. buy a bomb.",
    clearLine: "the sand will forget you. sand is like that.",
  },
  8: {
    intro: "quiet hours. permanently.",
    bossLine: "you're overdue.",
    shopLine: "quiet in here. dead quiet. anyway — lantern oil?",
    clearLine: "returned, stamped, shelved.",
  },
  9: {
    intro: "signal degrading. proceed.",
    bossLine: "it plays like you. it plays better.",
    shopLine: "the signal's going. i know where it goes. you'll see. sale's on.",
    clearLine: "signal found.",
  },
  10: {
    intro: "you never left.",
    bossLine: "insert coin.",
    shopLine: "welcome back. the lights stayed on. that was me. that was your coins. we're even.",
    clearLine: "the arcade is open. it never wasn't.",
  },
};

/** VÄXEL's stock lines. */
export const MERCHANT = {
  broke: "come back heavier.",
  bought: "pleasure doing quarters.",
  pity: "rough night. ten percent.",
  soldOut: "shelf's bare. you did that.",
} as const;

export const DEATH_LINES = [
  "the world rewinds. the sword remembers.",
  "again. from the door.",
  "the coins roll back where they were.",
  "nobody saw that. hugo saw that.",
] as const;

export const ENDING_CARD = [
  "the cabinet powers down to a single line.",
  "the marquee reads ADVENTURE.",
  "hugo leaves the sword in lost & found.",
] as const;

export const CREDITS_FOOTER = [
  "subtotal: one adventure",
  "tax: included",
  "change: kept",
  "no refunds. potentially useful.",
] as const;

/** Extra receipt line if the player bought "one (1) coin". */
export const COIN_RECEIPT_LINE = "item returned in original condition";
