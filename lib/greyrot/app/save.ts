/**
 * The save. Two keys, versioned from v1, decisions only.
 *
 * `CLAUDE.md` §7 in full:
 *
 * - **Store decisions and seeds, never derived state.** Progress is the chapter
 *   index, a bitset of cleared stages and the grimoire's discovered flags.
 *   Nothing here can be recomputed from something else here.
 * - **Two keys**, so a corrupt campaign cannot destroy settings. They are
 *   written independently and read independently, and a failure of either
 *   returns defaults rather than throwing.
 * - **Versioned from v1** with `migrateSave()`, and the migration test is
 *   written *before* the second schema change rather than after.
 * - **Autosave at seams only** — never mid-fight. Mid-fight state is large,
 *   changes thirty times a second, and is fully reconstructable from the last
 *   seam, which is the entire argument for not storing it.
 * - Target **< 32 KB stringified** on a maxed save, against a 1 MB cap, so the
 *   cap never has to be thought about again. A test asserts it.
 *
 * The pivot made this SMALLER. A party of three with classes, resources,
 * talent trees and four gear slots each was what pushed the old schema toward
 * the cap; one hero and an 83-bit grimoire is not close to it.
 *
 * ## Why the SDK's data module and not localStorage
 *
 * §12 bans localStorage as the only save path: the `data` module ties progress
 * to the player's CrazyGames account so it follows them across devices, and it
 * costs us no backend (§12 bans one of those too). `getPlatform().save/load` already
 * falls back to localStorage when the SDK is absent, which is what makes dev
 * standalone.
 */

import { MIX_COUNT, foundBitsThroughStage, mixIndex, type Element } from "../content";
import { getPlatform } from "../platform/local";

/**
 * Bump when a field changes meaning. Adding an optional field does not.
 *
 * v2: the queue cap dropped to 2 (owner decision), so the grimoire's mix
 * enumeration changed from 83 slots to 27 — old bit positions mean different
 * mixes now, so a v1 grimoire is unreadable and migration ZEROES it (there
 * are no real players yet; rediscovery is the honest outcome). Everything
 * else carries over field-by-field.
 *
 * v3: finds became TAKEABLE (third playtest), so held power stopped being
 * derivable from the stages walked — a player can clear stages while
 * deliberately leaving a find standing. `found` records the decision; the
 * migration derives it for v≤2 saves, whose builds collected by contact.
 */
export const SAVE_VERSION = 3;

const KEY_META = "hugoslekstuga:greyrot:meta";
const KEY_CAMPAIGN = "hugoslekstuga:greyrot:save";

/** 28-bit words: comfortably inside the range that stays an SMI, and JSON-safe. */
const WORD_BITS = 28;
const GRIMOIRE_WORDS = Math.ceil(MIX_COUNT / WORD_BITS);

/**
 * Settings and lifetime totals. Survives everything, including a campaign
 * reset — losing your audio preference because a playthrough broke would be a
 * strictly worse bug than losing the playthrough.
 */
export interface MetaSave {
  v: number;
  /** Manual quality override, or "auto" to let the probe decide (§5). */
  quality: "auto" | "low" | "medium" | "high";
  /** The player's own mute toggle. The PLATFORM's mute is not ours to store. */
  muted: boolean;
  lifetime: { runs: number; kills: number; spores: number; defeats: number };
}

export interface CampaignSave {
  v: number;
  /** Chapter reached. Derived from `stage` today; authored separately because
   *  a future chapter select needs it and recomputing it would be derived
   *  state pretending to be a decision. */
  chapter: number;
  /** The stage the player is on. */
  stage: number;
  /** Bitset of cleared stage indices. One number is 28 stages; Act 1 is ~25. */
  cleared: number;
  /**
   * The finds in hand: bit i is CASTABLES[i], bit 6 THE WEAVE (`encodeFound`
   * in content/spells.ts). A DECISION, not derived state — finds are taken
   * with a press and can be deliberately left standing.
   */
  found: number;
  /** Discovered mixes, one bit each, packed into 28-bit words (27 slots). */
  grimoire: number[];
  spores: number;
  /**
   * The rewarded-crate cap (§8 caps it at 5/day), and the day it belongs to.
   *
   * A cap that lived only in memory would reset on every reload, which is the
   * difference between a cap and a suggestion. Stored as a day number rather
   * than a timestamp so it carries no clock precision we would have to defend.
   */
  crateDay: number;
  crateCount: number;
}

export function defaultMeta(): MetaSave {
  return {
    v: SAVE_VERSION,
    quality: "auto",
    muted: false,
    lifetime: { runs: 0, kills: 0, spores: 0, defeats: 0 },
  };
}

export function defaultCampaign(): CampaignSave {
  return {
    v: SAVE_VERSION,
    chapter: 0,
    stage: 0,
    cleared: 0,
    found: 0,
    grimoire: new Array<number>(GRIMOIRE_WORDS).fill(0),
    spores: 0,
    crateDay: 0,
    crateCount: 0,
  };
}

/* ------------------------------------------------------------- grimoire */

/** Mark a mix discovered. Returns true if it was new — the seam worth a flash. */
export function discover(save: CampaignSave, elements: readonly Element[]): boolean {
  const i = mixIndex(elements);
  if (i < 0) return false;
  const w = (i / WORD_BITS) | 0;
  const bit = 1 << i % WORD_BITS;
  const word = save.grimoire[w] ?? 0;
  if ((word & bit) !== 0) return false;
  save.grimoire[w] = word | bit;
  return true;
}

export function isDiscovered(save: CampaignSave, elements: readonly Element[]): boolean {
  const i = mixIndex(elements);
  if (i < 0) return false;
  return (((save.grimoire[(i / WORD_BITS) | 0] ?? 0) >> i % WORD_BITS) & 1) === 1;
}

/** How many of the 83 mixes have been found. Drives §8's scaled reveal offer. */
export function discoveredCount(save: CampaignSave): number {
  let n = 0;
  for (const word of save.grimoire) {
    let w = word >>> 0;
    while (w) {
      n += w & 1;
      w >>>= 1;
    }
  }
  return n;
}

/* -------------------------------------------------------------- stages */

export function markStageCleared(save: CampaignSave, stageIndex: number): void {
  if (stageIndex >= 0 && stageIndex < 31) save.cleared |= 1 << stageIndex;
}

export function isStageCleared(save: CampaignSave, stageIndex: number): boolean {
  return stageIndex >= 0 && stageIndex < 31 && (save.cleared & (1 << stageIndex)) !== 0;
}

/* ------------------------------------------------------------ migration */

/**
 * Bring any stored shape up to the current version.
 *
 * Written now, with exactly one version in existence, because the alternative
 * is writing it during the migration that needs it — and §7's rule is that the
 * migration test comes before the second schema change, not after. It is
 * deliberately total: an unknown version, a truncated object, a string where a
 * number should be, or `null` all resolve to a usable save rather than to a
 * crash on boot. A player whose save we cannot read should get a new game, not
 * a black screen.
 */
export function migrateSave<T extends MetaSave | CampaignSave>(raw: unknown, fallback: T): T {
  if (raw === null || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  const v = typeof obj.v === "number" ? obj.v : 0;
  // A save from the FUTURE (the player used a newer build on another device)
  // is not migratable downward. Their newer device still has it; giving them a
  // fresh start here beats loading fields we do not understand.
  if (v > SAVE_VERSION) return fallback;

  const out = { ...fallback } as unknown as Record<string, unknown>;
  for (const key of Object.keys(fallback as object)) {
    const got = obj[key];
    const want = (fallback as unknown as Record<string, unknown>)[key];
    if (got === undefined || got === null) continue;
    if (typeof got !== typeof want) continue;
    if (Array.isArray(want) !== Array.isArray(got)) continue;
    out[key] = got;
  }
  // v1's grimoire numbered 83 mixes over a 3-element queue; v2's numbers 27
  // over a 2-element queue, so v1 bits point at the wrong spells. Zero it —
  // half-reading it would fill the grimoire with discoveries that never
  // happened, which is worse than an empty book.
  if (v < 2 && "grimoire" in out) {
    out.grimoire = new Array<number>(GRIMOIRE_WORDS).fill(0);
  }
  // v≤2 builds collected finds by CONTACT, so a save at stage j provably
  // crossed every find of stages < j−1 — derive `found` from that once,
  // here. A v3 save never derives: its `found` is a recorded decision.
  if (v < 3 && "found" in out) {
    const stage = typeof out.stage === "number" ? out.stage : 0;
    out.found = foundBitsThroughStage(stage);
  }

  // Whatever version it claimed, it is this version now.
  out.v = SAVE_VERSION;

  // Structural repair the field-by-field copy cannot do: an array of the wrong
  // length is the one shape that type-checks and still breaks indexing.
  if ("grimoire" in out) {
    const g = out.grimoire as unknown[];
    const fixed = new Array<number>(GRIMOIRE_WORDS).fill(0);
    for (let i = 0; i < Math.min(fixed.length, g.length); i++) {
      const n = g[i];
      // Masked to the bits that are actually mixes. MIX_COUNT is not a multiple
      // of the word size, so the top word has spare bits that `discover` can
      // never set — but a corrupt or hand-edited save can, and the only visible
      // symptom would be a grimoire reading "84 / 83".
      const bitsHere = Math.min(WORD_BITS, MIX_COUNT - i * WORD_BITS);
      const mask = bitsHere >= WORD_BITS ? (1 << WORD_BITS) - 1 : (1 << bitsHere) - 1;
      fixed[i] = typeof n === "number" && Number.isFinite(n) ? (n | 0) & mask : 0;
    }
    out.grimoire = fixed;
  }
  if ("lifetime" in out) {
    const l = out.lifetime as Record<string, unknown>;
    const base = (fallback as MetaSave).lifetime;
    out.lifetime = {
      runs: typeof l.runs === "number" ? l.runs : base.runs,
      kills: typeof l.kills === "number" ? l.kills : base.kills,
      spores: typeof l.spores === "number" ? l.spores : base.spores,
      defeats: typeof l.defeats === "number" ? l.defeats : base.defeats,
    };
  }
  return out as T;
}

/* ---------------------------------------------------------------- i/o */

export async function loadMeta(): Promise<MetaSave> {
  return migrateSave(await getPlatform().load<unknown>(KEY_META), defaultMeta());
}

export async function loadCampaign(): Promise<CampaignSave> {
  return migrateSave(await getPlatform().load<unknown>(KEY_CAMPAIGN), defaultCampaign());
}

export async function saveMeta(m: MetaSave): Promise<void> {
  await getPlatform().save(KEY_META, m);
}

export async function saveCampaign(c: CampaignSave): Promise<void> {
  await getPlatform().save(KEY_CAMPAIGN, c);
}

/** Stringified size, for the size assertion and for the debug handle. */
export function saveBytes(...saves: unknown[]): number {
  return saves.reduce<number>((n, s) => n + JSON.stringify(s).length, 0);
}
