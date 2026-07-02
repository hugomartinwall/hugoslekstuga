import { adviceEntries, type AdviceEntry, type AdviceTone } from "./advice";
import type { HugoMood } from "./hugo-state";

/**
 * The draw logic behind the Advice page — Hugo's flagship. The page
 * asks this module for "the next line Hugo hands over"; everything
 * that makes the draw feel considered lives here:
 *
 *   - a recency window so lines don't echo
 *   - a deterministic "one for today" first draw per calendar day
 *   - tone bias from Hugo's live mood (grumpy leans blunt, sleepy warm)
 *   - the rare pool, unlocked by the relationship (streaks, visit
 *     counts, his "birthday" — the firstSeen anniversary)
 *   - told-you-this-before memory across visits
 *
 * All persistence is one localStorage key owned by this module.
 * Hugo's own memory (streak, visits, firstSeen) is read-only input.
 */

const MEMORY_KEY = "hugoslekstuga:advice:memory";
const RECENT_WINDOW = 12;
const GIVEN_RING = 80;
/** A draw counts as "told you before" if it last happened over ~20h ago. */
const REPEAT_HORIZON_MS = 20 * 60 * 60 * 1000;
/** Chance a draw surfaces an unseen rare, once the pool is unlocked. */
const RARE_CHANCE = 0.14;

export type AdviceMemory = {
  given: { id: string; at: number }[];
  keptIds: string[];
  lastDailyKey: string | null;
  draws: number;
  rareSeenIds: string[];
};

const EMPTY_MEMORY: AdviceMemory = {
  given: [],
  keptIds: [],
  lastDailyKey: null,
  draws: 0,
  rareSeenIds: [],
};

export function loadAdviceMemory(): AdviceMemory {
  if (typeof window === "undefined") return { ...EMPTY_MEMORY };
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (!raw) return { ...EMPTY_MEMORY };
    const parsed = JSON.parse(raw) as Partial<AdviceMemory>;
    return {
      ...EMPTY_MEMORY,
      ...parsed,
      given: Array.isArray(parsed.given) ? parsed.given : [],
      keptIds: Array.isArray(parsed.keptIds) ? parsed.keptIds : [],
      rareSeenIds: Array.isArray(parsed.rareSeenIds) ? parsed.rareSeenIds : [],
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export function saveAdviceMemory(memory: AdviceMemory) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage full or blocked — the page still works, just forgets.
  }
}

/** Deterministic PRNG for the daily draw — same seed, same line, every client. */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromKey(dateKey: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    h = Math.imul(h ^ dateKey.charCodeAt(i), 16777619);
  }
  return h | 0;
}

/** How strongly each mood pulls toward each tone. 1 = neutral. */
const TONE_WEIGHT: Record<HugoMood, Record<AdviceTone, number>> = {
  calm: { warm: 1, blunt: 1, wry: 1 },
  curious: { warm: 1, blunt: 1, wry: 1.6 },
  excited: { warm: 1.2, blunt: 1, wry: 1.4 },
  sleepy: { warm: 1.8, blunt: 0.7, wry: 1 },
  grumpy: { warm: 0.5, blunt: 2.4, wry: 1.2 },
};

export type DrawContext = {
  memory: AdviceMemory;
  mood: HugoMood;
  streakDays: number;
  visitCount: number;
  /** Hugo's firstSeen (epoch ms) — his birthday is its anniversary. */
  firstSeen: number;
  /** Local YYYY-MM-DD for today. */
  dateKey: string;
};

export type DrawResult = {
  entry: AdviceEntry;
  /** First draw of this calendar day — deterministic, shared by everyone. */
  isDaily: boolean;
  /** He has told you this on an earlier visit. */
  isRepeat: boolean;
  isRare: boolean;
  /** Updated memory — caller persists it. */
  memory: AdviceMemory;
};

function isBirthday(firstSeen: number, dateKey: string): boolean {
  if (!firstSeen) return false;
  const seen = new Date(firstSeen);
  const [, m, d] = dateKey.split("-").map(Number);
  // Same month + day, but not the very first day itself.
  return (
    seen.getMonth() + 1 === m &&
    seen.getDate() === d &&
    localKeyOf(seen) !== dateKey
  );
}

function localKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rarePoolUnlocked(ctx: {
  streakDays: number;
  visitCount: number;
  firstSeen: number;
  dateKey: string;
}): boolean {
  return (
    ctx.streakDays >= 7 ||
    ctx.visitCount >= 25 ||
    isBirthday(ctx.firstSeen, ctx.dateKey)
  );
}

function weightedPick(
  pool: AdviceEntry[],
  mood: HugoMood,
  rand: () => number,
): AdviceEntry {
  const weights = pool.map((e) => TONE_WEIGHT[mood][e.tone]);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function drawAdvice(ctx: DrawContext): DrawResult {
  const { memory, mood, dateKey } = ctx;
  const commons = adviceEntries.filter((e) => e.rarity === "common");
  const rares = adviceEntries.filter((e) => e.rarity === "rare");

  const recentIds = new Set(
    memory.given.slice(0, RECENT_WINDOW).map((g) => g.id),
  );

  let entry: AdviceEntry | null = null;
  let isDaily = false;
  let isRare = false;

  // 1) First draw of a new day: deterministic over the common pool.
  //    Everyone on the same date gets the same line — "one for today".
  if (memory.lastDailyKey !== dateKey) {
    const rand = mulberry32(seedFromKey(dateKey));
    entry = commons[Math.floor(rand() * commons.length)];
    isDaily = true;
  }

  // 2) Rare pool, when the relationship has earned it and something
  //    unseen remains.
  if (!entry && rarePoolUnlocked(ctx)) {
    const unseen = rares.filter((e) => !memory.rareSeenIds.includes(e.id));
    if (unseen.length > 0 && Math.random() < RARE_CHANCE) {
      entry = unseen[Math.floor(Math.random() * unseen.length)];
      isRare = true;
    }
  }

  // 3) The everyday draw: mood-weighted over commons, avoiding echoes.
  if (!entry) {
    const fresh = commons.filter((e) => !recentIds.has(e.id));
    const pool = fresh.length > 0 ? fresh : commons;
    entry = weightedPick(pool, mood, Math.random);
  }

  const lastGiven = memory.given.find((g) => g.id === entry.id);
  const isRepeat =
    !isDaily && !!lastGiven && Date.now() - lastGiven.at > REPEAT_HORIZON_MS;

  const nextMemory: AdviceMemory = {
    ...memory,
    given: [
      { id: entry.id, at: Date.now() },
      ...memory.given.filter((g) => g.id !== entry.id),
    ].slice(0, GIVEN_RING),
    lastDailyKey: isDaily ? dateKey : memory.lastDailyKey,
    draws: memory.draws + 1,
    rareSeenIds: isRare
      ? [...memory.rareSeenIds, entry.id]
      : memory.rareSeenIds,
  };

  return { entry, isDaily, isRepeat, isRare, memory: nextMemory };
}

export function toggleKept(memory: AdviceMemory, id: string): AdviceMemory {
  const kept = memory.keptIds.includes(id)
    ? memory.keptIds.filter((k) => k !== id)
    : [...memory.keptIds, id];
  return { ...memory, keptIds: kept };
}

export function keptEntries(memory: AdviceMemory): AdviceEntry[] {
  return memory.keptIds
    .map((id) => adviceEntries.find((e) => e.id === id))
    .filter((e): e is AdviceEntry => Boolean(e));
}
