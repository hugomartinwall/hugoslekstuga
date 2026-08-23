/**
 * The ad economy: `CLAUDE.md` §8's six rewarded slots, and the rules that get a
 * build rejected if they are broken.
 *
 * **Ads are OFF during Basic Launch.** `ADS_ENABLED` is false and every offer
 * reports itself unavailable, so nothing renders. The seams are built anyway
 * because retrofitting them is painful and because the *caps* — which are the
 * part that is easy to get wrong — want to be exercised by tests long before
 * they are exercised by money.
 *
 * ## What is enforced here rather than remembered
 *
 * - **Diminishing returns per session: 100% / 50% / 25%.** Their guidance, and
 *   it is what stops a player farming one placement for a whole session.
 * - **Revive: once per stage, once per session**, and there is always a non-ad
 *   path to the same goal (restart the stage). §8 requires the non-ad path to
 *   exist; the UI requires the decline to be equally prominent.
 * - **The camp crate is capped at 5/day** — their explicit number — and the
 *   count lives in the save, because a cap that resets on reload is not a cap.
 * - **The grimoire hint scales with how full the grimoire already is**, never a
 *   flat number. Also their explicit advice, and the slot that fits this game
 *   best: the grimoire *is* the progression.
 * - **Never chain two ads for one reward**, and never stack a midgame with a
 *   rewarded between the same two states. One `pending` latch covers both.
 * - **Midgame only at chapter ends and camp returns**, never on a stage
 *   boundary — those come every 2–4 minutes and a forced ad there would be the
 *   most interrupting thing in the game. The first is gated behind chapter 1 or
 *   five minutes.
 * - **No cooldown of our own.** The SDK enforces one midgame per three minutes
 *   and returns `adCooldown`, which is a normal outcome, not an error.
 * - **Adblock users play normally.** `hidden` is what the UI reads; it never
 *   leaves a button that does nothing.
 */

import { getPlatform } from "../platform/local";
import { discoveredCount, type CampaignSave } from "./save";
import { MIX_COUNT } from "../content";

/**
 * The dormant flag. Basic Launch runs with ads OFF and exactly one SDK call
 * (`gameplayStart`); this is the single line that wakes the economy for Full
 * Launch.
 */
export const ADS_ENABLED = false;

export type RewardedSlot =
  /** Stage clear → double the spores. Their top-converting placement. */
  | "stageDouble"
  /** Defeat → revive. Second highest value, and the reason defeat exists. */
  | "revive"
  /** Loot drop → reroll the affixes on it. */
  | "lootReroll"
  /** Camp → the daily supply crate. Capped at 5/day. */
  | "campCrate"
  /** Grimoire → reveal an undiscovered mix, scaled to how full it is. */
  | "grimoireHint"
  /** Chapter boss down → an extra affix pick. */
  | "bossAffix";

export const REWARDED_SLOTS: readonly RewardedSlot[] = [
  "stageDouble",
  "revive",
  "lootReroll",
  "campCrate",
  "grimoireHint",
  "bossAffix",
];

/** What the UI needs to draw an offer, or to draw nothing. */
export interface Offer {
  slot: RewardedSlot;
  /** False → render no button at all. Never render one that cannot pay. */
  available: boolean;
  /** 1, 0.5 or 0.25 — the session's diminishing return on this slot. */
  multiplier: number;
  /** Why it is unavailable. For the debug handle and for tests. */
  reason: "ok" | "disabled" | "adblock" | "capped" | "pending" | "not-here";
}

/** Ticks of the session clock. Wall time, app-side — never read by the sim. */
const FIRST_MIDGAME_MS = 5 * 60 * 1000;

/** Their published diminishing-returns curve. */
const DIMINISHING = [1, 0.5, 0.25];

/** §8's explicit cap on the daily crate. */
const CRATE_PER_DAY = 5;

export interface EconomyDeps {
  /** Injected so tests need no clock and no globals. */
  now: () => number;
  /** Resolved once at boot; adblock must never leave a dead button. */
  adblock: boolean;
}

export class Economy {
  private taken: Partial<Record<RewardedSlot, number>> = {};
  /** One in flight. Covers "never chain two ads" and "never stack" at once. */
  private pending = false;
  private reviveThisSession = 0;
  private reviveStage = -1;
  private startedAt: number;
  private lastMidgameChapter = -1;
  private deps: EconomyDeps;

  constructor(deps: EconomyDeps) {
    this.deps = deps;
    this.startedAt = deps.now();
  }

  /** Day number, for the crate cap. Coarse on purpose — no clock precision. */
  private today(): number {
    return Math.floor(this.deps.now() / 86_400_000);
  }

  /**
   * Can this offer be shown, and at what rate?
   *
   * `stageIndex` is only consulted by the revive slot, which is once per stage
   * as well as once per session.
   */
  offer(slot: RewardedSlot, save: CampaignSave, stageIndex = -1): Offer {
    const no = (reason: Offer["reason"]): Offer => ({
      slot,
      available: false,
      multiplier: 0,
      reason,
    });
    if (!ADS_ENABLED) return no("disabled");
    if (this.deps.adblock) return no("adblock");
    if (this.pending) return no("pending");

    if (slot === "revive") {
      if (this.reviveThisSession >= 1) return no("capped");
      if (stageIndex >= 0 && this.reviveStage === stageIndex) return no("capped");
    }
    if (slot === "campCrate") {
      const day = this.today();
      const used = save.crateDay === day ? save.crateCount : 0;
      if (used >= CRATE_PER_DAY) return no("capped");
    }
    if (slot === "grimoireHint" && discoveredCount(save) >= MIX_COUNT) return no("capped");

    const n = this.taken[slot] ?? 0;
    return {
      slot,
      available: true,
      multiplier: DIMINISHING[Math.min(n, DIMINISHING.length - 1)]!,
      reason: "ok",
    };
  }

  /**
   * Run the ad and report whether the reward is earned.
   *
   * Grants on completion ALONE. The caller renders an equally prominent
   * decline and a non-ad path; that is a submission requirement, not a
   * nicety, and it is enforced in the UI because that is where prominence
   * lives.
   */
  async claim(slot: RewardedSlot, save: CampaignSave, stageIndex = -1): Promise<boolean> {
    if (!this.offer(slot, save, stageIndex).available) return false;
    this.pending = true;
    try {
      const r = await getPlatform().requestAd("rewarded");
      if (!r.completed) return false;
      this.taken[slot] = (this.taken[slot] ?? 0) + 1;
      if (slot === "revive") {
        this.reviveThisSession++;
        this.reviveStage = stageIndex;
      }
      if (slot === "campCrate") {
        const day = this.today();
        save.crateCount = save.crateDay === day ? save.crateCount + 1 : 1;
        save.crateDay = day;
      }
      return true;
    } finally {
      this.pending = false;
    }
  }

  /**
   * A midgame ad, if this is a place one is allowed.
   *
   * Chapter ends and camp returns only — never a stage boundary. Returns
   * whether one was requested, which is what the seam-count instrumentation
   * reads; whether it actually *played* is the SDK's business, and
   * `adCooldown` is the expected answer most of the time.
   */
  midgame(where: "chapter-end" | "camp", chapter: number): boolean {
    if (!ADS_ENABLED || this.deps.adblock || this.pending) return false;
    // First one gated behind chapter 1 or five minutes, whichever comes first.
    const elapsed = this.deps.now() - this.startedAt;
    if (chapter < 1 && elapsed < FIRST_MIDGAME_MS) return false;
    // Never twice for the same chapter transition — the chapter end and the
    // camp it leads into are one seam from the player's side, and §8 bans
    // stacking two ads between the same two states.
    if (this.lastMidgameChapter === chapter) return false;
    this.lastMidgameChapter = chapter;
    void getPlatform().requestAd("midgame");
    void where;
    return true;
  }

  /**
   * How many mixes a grimoire hint is worth right now.
   *
   * Scaled to how much is already filled, never flat — §8 is explicit about
   * this one. An early hint is nearly worthless because everything is a
   * discovery anyway; a late one, when four mixes remain unfound, is worth
   * something real.
   */
  hintValue(save: CampaignSave): number {
    const remaining = MIX_COUNT - discoveredCount(save);
    if (remaining <= 0) return 0;
    return Math.max(1, Math.round(remaining * 0.15));
  }

  /** For the debug handle and the seam-count assertion. */
  stats(): { taken: Partial<Record<RewardedSlot, number>>; reviveThisSession: number } {
    return { taken: { ...this.taken }, reviveThisSession: this.reviveThisSession };
  }
}
