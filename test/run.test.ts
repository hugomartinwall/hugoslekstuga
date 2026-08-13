import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  applyDailyClear,
  applyDefeat,
  applyWin,
  dailyRewardFor,
  starMilestoneBonus,
  totalStars,
  BASE_LIVES,
  boostsFor,
  buyAbility,
  buyUpgrade,
  checkpointLevel,
  coresForWin,
  dailySeed,
  dailyUnlocked,
  DAILY_UNLOCK_CLEARED,
  isCheckpoint,
  livesFor,
  migrateSave,
  newSave,
  progressPath,
  TRACKS,
} from "../lib/overrun/app/run";
import { isBossLevel } from "../lib/overrun/sim/level";
import { COACH_STEPS } from "../lib/overrun/app/coach";

const win = (level: number, stars: 1 | 2 | 3 = 1, streak = 1, rivals = 0) => ({
  level,
  stars,
  streak,
  rivalsEliminatedByPlayer: rivals,
});

describe("run/lives progression", () => {
  it("winning advances the run, banks cores, and raises bestLevel", () => {
    let save = newSave();
    save = applyWin(save, win(1, 3));
    expect(save.run.level).toBe(2);
    expect(save.bestLevel).toBe(2);
    expect(save.clearedMax).toBe(1);
    expect(save.cores).toBeGreaterThan(0);
    expect(save.stars["1"]).toBe(3);
  });

  it("first defeat costs a life; the last defeat ends the run", () => {
    let save = { ...newSave(), bestLevel: 7, run: { level: 5, lives: 2, attempt: 0 } };
    const first = applyDefeat(save);
    expect(first.runOver).toBe(false);
    expect(first.save.run).toEqual({ level: 5, lives: 1, attempt: 1 });
    const second = applyDefeat(first.save);
    expect(second.runOver).toBe(true);
    expect(second.reachedLevel).toBe(5);
    // clearedMax is 0 here, so the fallback is level 1 — a genuine move, and the
    // attempt counter resets because this is not another go at level 5.
    expect(second.save.run).toEqual({ level: 1, lives: BASE_LIVES, attempt: 0 });
    expect(second.save.bestLevel).toBe(7);
  });

  it("a lost run resumes from the last checkpoint, not from level 1", () => {
    /**
     * The point of the feature: reaching level 27 and being sent back to the
     * teaching levels is a punishment out of all proportion to the mistake.
     * Before this, every one of these expected 1.
     */
    const save = { ...newSave(), clearedMax: 26, bestLevel: 27, run: { level: 27, lives: 1, attempt: 0 } };
    const over = applyDefeat(save);
    expect(over.runOver).toBe(true);
    expect(over.reachedLevel).toBe(27);
    expect(over.resumeLevel).toBe(25); // cleared 26 ⇒ last checkpoint is 24
    expect(over.save.run.level).toBe(25);
  });

  it("banks a checkpoint every third level, and only on levels actually cleared", () => {
    expect(checkpointLevel(0)).toBe(1); // nothing cleared yet
    expect(checkpointLevel(2)).toBe(1); // L3 not cleared — no checkpoint yet
    expect(checkpointLevel(3)).toBe(4); // cleared L3 ⇒ start at L4
    expect(checkpointLevel(5)).toBe(4);
    expect(checkpointLevel(6)).toBe(7);
    // Never ahead of what has been beaten: you always resume on a level you
    // have either cleared or already faced.
    for (let cleared = 0; cleared <= 60; cleared++) {
      expect(checkpointLevel(cleared), `cleared=${cleared}`).toBeLessThanOrEqual(cleared + 1);
      expect(checkpointLevel(cleared), `cleared=${cleared}`).toBeGreaterThanOrEqual(1);
    }
    expect([3, 6, 9, 12, 21].every(isCheckpoint)).toBe(true);
    expect([1, 2, 4, 14, 22].some(isCheckpoint)).toBe(false);
  });

  it("losing never costs a checkpoint — it is derived from clearedMax", () => {
    // clearedMax only ever rises (applyWin takes a max), so a bad run cannot
    // walk a player's floor backwards. This is the reason the checkpoint is not
    // stored as its own field.
    let save = { ...newSave(), clearedMax: 10, run: { level: 11, lives: 1, attempt: 0 } };
    for (let i = 0; i < 5; i++) save = applyDefeat(save).save;
    expect(save.clearedMax).toBe(10);
    // Cleared 10 ⇒ the floor is the checkpoint at 10; run-overs oscillate the
    // run back to it but never below, and never erode clearedMax itself.
    expect(save.run.level).toBe(10);
  });

  it("Second Wind grants a third life on new runs", () => {
    const save = newSave();
    save.cores = 500;
    expect(buyUpgrade(save, "secondWind")).toBe(true);
    expect(livesFor(save)).toBe(3);
    const over = applyDefeat({ ...save, run: { level: 4, lives: 1, attempt: 0 } });
    expect(over.save.run.lives).toBe(3);
  });
});

describe("the attempt counter — never stuck on one board", () => {
  /**
   * `run.attempt` feeds `seedSequence(level, attempt)`, and that is the whole
   * unstick mechanism: attempt 0 draws the level's historic board, every later
   * attempt draws a different verified-winnable one. If the counter is wrong,
   * the player is handed the same wall twice and the feature does nothing.
   */

  it("counts up on every loss of the same level", () => {
    let save = { ...newSave(), clearedMax: 20, run: { level: 21, lives: 3, attempt: 0 } };
    for (const expected of [1, 2]) {
      save = applyDefeat(save).save;
      expect(save.run.attempt).toBe(expected);
    }
  });

  it("SURVIVES a run-over that resumes on the same level — the level 4 loop", () => {
    /**
     * The exact trap players reported, as an assertion.
     *
     * Clearing L3 makes `checkpointLevel(3) === 4`, so a run that dies on L4
     * resumes on L4. If the counter reset there — which is what `newRun` does on
     * its own — every run would draw attempt 0, i.e. the identical board, for
     * ever. Two lives means this fires on the player's SECOND loss, not some
     * distant edge case. (This was the level 6 loop under the 5-cadence; the
     * trap follows the first checkpoint wherever the cadence puts it.)
     */
    let save = { ...newSave(), clearedMax: 3, bestLevel: 4, run: { level: 4, lives: 2, attempt: 0 } };

    const first = applyDefeat(save);
    expect(first.runOver).toBe(false);
    expect(first.save.run.attempt).toBe(1);

    const second = applyDefeat(first.save);
    expect(second.runOver).toBe(true);
    expect(second.resumeLevel, "the checkpoint sends them back to L4").toBe(4);
    expect(second.save.run.attempt, "so the board must move on even though the level did not").toBe(
      2,
    );

    // And it keeps climbing across further run-overs, so the boards keep changing.
    save = second.save;
    for (const expected of [3, 4]) {
      save = applyDefeat(save).save;
      expect(save.run.attempt).toBe(expected);
    }
  });

  it("resets when the fallback actually moves the player to another level", () => {
    // Not another go at the same board — a different level, which has its own
    // historic board and deserves attempt 0.
    const save = { ...newSave(), clearedMax: 26, bestLevel: 27, run: { level: 27, lives: 1, attempt: 4 } };
    const over = applyDefeat(save);
    expect(over.runOver).toBe(true);
    expect(over.resumeLevel).toBe(25);
    expect(over.save.run.attempt).toBe(0);
  });

  it("resets on a win, so a cleared level is never revisited mid-sequence", () => {
    // Checkpoints can return a player to a level they have already beaten;
    // arriving there mid-sequence would skip its historic board for no reason.
    const save = { ...newSave(), run: { level: 9, lives: 2, attempt: 6 } };
    expect(applyWin(save, win(9)).run.attempt).toBe(0);
  });

  it("clamps a corrupt counter on load rather than feeding it to the generator", () => {
    const s = migrateSave({ ...newSave(), run: { level: 4, lives: 2, attempt: 1e12 } });
    expect(Number.isFinite(s.run.attempt)).toBe(true);
    expect(s.run.attempt).toBeLessThanOrEqual(9999);
    const neg = migrateSave({ ...newSave(), run: { level: 4, lives: 2, attempt: -7 } });
    expect(neg.run.attempt).toBe(0);
    const junk = migrateSave({ ...newSave(), run: { level: 4, lives: 2, attempt: "boom" } });
    expect(junk.run.attempt).toBe(0);
  });
});

describe("progressPath — the map's data", () => {
  it("anchors at level 1 early, centres once the journey is long enough", () => {
    const fresh = newSave();
    const early = progressPath(fresh, 1, 7);
    expect(early.map((e) => e.level)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const deep = progressPath({ ...fresh, clearedMax: 19 }, 20, 7);
    expect(deep.map((e) => e.level)).toEqual([17, 18, 19, 20, 21, 22, 23]);
  });

  it("has exactly one current level, and it is the one asked for", () => {
    const save = { ...newSave(), clearedMax: 9 };
    for (const current of [1, 2, 10]) {
      const path = progressPath(save, current, 7);
      const marked = path.filter((e) => e.current);
      expect(marked.length, `current=${current}`).toBe(1);
      expect(marked[0]!.level).toBe(current);
    }
  });

  it("reads stars, cleared and locked straight from the save", () => {
    const save = { ...newSave(), clearedMax: 4, stars: { "1": 3, "2": 1, "4": 2 } };
    const path = progressPath(save, 5, 7); // levels 2..8
    const byLevel = new Map(path.map((e) => [e.level, e]));
    expect(byLevel.get(2)!.stars).toBe(1);
    // Cleared with no stars entry = 0, not a crash: v2-migrated saves have
    // clearedMax without per-level stars (the grandfathering path).
    expect(byLevel.get(3)!.stars).toBe(0);
    expect(byLevel.get(3)!.cleared).toBe(true);
    expect(byLevel.get(4)!.stars).toBe(2);
    expect(byLevel.get(4)!.cleared).toBe(true);
    expect(byLevel.get(5)!.cleared).toBe(false);
    expect(byLevel.get(5)!.locked, "the frontier level is playable").toBe(false);
    expect(byLevel.get(6)!.locked).toBe(true);
    expect(byLevel.get(8)!.locked).toBe(true);
  });

  it("flags checkpoints and bosses from the same schedule the game runs", () => {
    const path = progressPath({ ...newSave(), clearedMax: 20 }, 14, 9); // 10..18
    for (const e of path) {
      expect(e.checkpoint, `L${e.level}`).toBe(e.level % 3 === 0);
      expect(e.boss, `L${e.level}`).toBe(isBossLevel(e.level));
    }
    // L14 is the first boss; the window straddles it on purpose.
    expect(path.find((e) => e.level === 14)!.boss).toBe(true);
  });
});

describe("cores economy", () => {
  it("star multiplier, first-clear, streak fire, bounty — capped at 2L+10", () => {
    const save = newSave();
    // L4 first clear, 3 stars, streak 3, 1 rival downed: 8 + 5 + 3 + 3 = 19 > cap 18.
    expect(coresForWin(save, win(4, 3, 3, 1))).toBe(18);
    // Replay (not first clear), 1 star, no streak: just floor(4×1) = 4.
    save.clearedMax = 10;
    expect(coresForWin(save, win(4, 1, 1, 0))).toBe(4);
  });

  it("salvage track adds flat cores per win", () => {
    const save = newSave();
    save.upgrades.salvage = 2;
    save.clearedMax = 10;
    expect(coresForWin(save, win(3, 1, 1, 0))).toBe(3 + 2);
  });

  it("buyUpgrade validates tiers and funds", () => {
    const save = newSave();
    expect(buyUpgrade(save, "garrison")).toBe(false); // broke
    save.cores = 40;
    expect(buyUpgrade(save, "garrison")).toBe(true);
    expect(save.cores).toBe(0);
    expect(save.upgrades.garrison).toBe(1);
    expect(boostsFor(save).startUnits).toBe(2);
  });

  it("keeps the first purchase inside the conversion window", () => {
    /**
     * CLAUDE.md §5 wants a want-moment every ~75s; at the old 60-core entry
     * price the FIRST purchase landed at level 5, four-plus minutes in, with
     * the shop showing five rows the player could not have. Cheapest entry is
     * 40; the 3-star path pays 7/9/14/16 through L4 (cumulative 46), so the
     * first purchase lands during level 4, ~3 minutes in.
     */
    const cheapest = Math.min(...TRACKS.map((t) => t.costs[0]!));
    expect(cheapest).toBe(40);
    // Walk the REAL payout path (an earlier version re-derived the payout
    // with an inline copy of the formula, which could not notice coresForWin
    // changing). 3-star clears through L4 must afford the cheapest track by
    // the L4 victory screen — that is the "first purchase ~3 minutes in"
    // claim, stated executable.
    let save = newSave();
    for (const l of [1, 2, 3, 4]) save = applyWin(save, win(l, 3));
    expect(save.cores).toBeGreaterThanOrEqual(cheapest);
    // And not by an economy-breaking margin: still under the second tier.
    expect(save.cores).toBeLessThan(cheapest * 2.5);
  });

  it("keeps the total sink deep enough for a run, shallow enough to finish", () => {
    /**
     * A PROPERTY, deliberately not the old magic total (4,115): the exact sum
     * is a knob, not a contract, and pinning it meant every deliberate price
     * change edited a test that explained nothing. What actually matters:
     * the sink must outlast a casual career (>= 4,000 cores — roughly 30-40
     * levels of earnings, or the retention curve has no tail) yet stay
     * completable (< 9,000, or maxing out becomes a fantasy nobody chases).
     * With the POWERS tab the sink now includes abilities; lands ~6.1k.
     */
    const total =
      TRACKS.reduce((a, t) => a + t.costs.reduce((x, y) => x + y, 0), 0) +
      ABILITIES.reduce((a, d) => a + d.costs.reduce((x, y) => x + y, 0), 0);
    expect(total).toBeGreaterThanOrEqual(4000);
    expect(total).toBeLessThanOrEqual(9000);
    // Every ladder is ascending — a cheaper later tier is a typo, not a sale.
    for (const t of [...TRACKS, ...ABILITIES]) {
      for (let i = 1; i < t.costs.length; i++) {
        expect(t.costs[i]!, `${t.key} tier ${i + 1}`).toBeGreaterThan(t.costs[i - 1]!);
      }
    }
  });

  it("buyAbility validates tiers and funds, and tiers grant charges 1:1", () => {
    const save = newSave();
    expect(buyAbility(save, "overcharge")).toBe(false); // broke
    save.cores = 120;
    expect(buyAbility(save, "overcharge")).toBe(true);
    expect(save.cores).toBe(0);
    expect(save.abilities.overcharge).toBe(1);
    // boostsFor maps tier -> charges per level, and only when something is owned.
    expect(boostsFor(save).abilities).toEqual({ overcharge: 1, stasis: 0, recall: 0 });
    expect(boostsFor(newSave()).abilities, "nothing owned = ABSENT, not zeros").toBeUndefined();
    // Maxed tier refuses even with funds.
    save.abilities.overcharge = 3;
    save.cores = 10_000;
    expect(buyAbility(save, "overcharge")).toBe(false);
  });

  it("star milestones pay once, on crossing, and replays that improve count", () => {
    // Monotone totals are the whole idempotency argument: a milestone can only
    // be crossed once because totalStars never goes down.
    expect(starMilestoneBonus(14, 15)).toBe(30);
    expect(starMilestoneBonus(15, 16)).toBe(0); // already crossed
    expect(starMilestoneBonus(0, 40)).toBe(90); // two at once
    expect(starMilestoneBonus(14, 14)).toBe(0);

    // Through applyWin: a save sitting one star below the first milestone.
    let save = newSave();
    for (let l = 1; l <= 5; l++) save.stars[String(l)] = l <= 4 ? 3 : 2; // 14 stars
    expect(totalStars(save)).toBe(14);
    save = { ...save, run: { level: 6, lives: 2, attempt: 0 }, cores: 0 };
    // Captured BEFORE applyWin: coresForWin reads clearedMax for the
    // first-clear bonus, and applyWin advances it.
    const winPay = coresForWin(save, win(6, 1));
    save = applyWin(save, win(6, 1)); // 15th star crosses the 15 milestone
    expect(totalStars(save)).toBe(15);
    expect(save.cores).toBe(winPay + 30);

    // An improvement replay (1★ -> 3★) adds two stars and can cross too.
    let s2 = newSave();
    for (let l = 1; l <= 7; l++) s2.stars[String(l)] = 2; // 14
    s2 = { ...s2, clearedMax: 7, run: { level: 3, lives: 2, attempt: 0 }, cores: 0 };
    s2.stars["3"] = 1;
    // 13 stars; winning L3 with 3★ -> 15 total, crossing.
    const c2 = s2.cores;
    s2 = applyWin(s2, win(3, 3));
    expect(totalStars(s2)).toBe(15);
    expect(s2.cores - c2).toBeGreaterThanOrEqual(30);
  });

  it("dailyRewardFor matches what applyDailyClear actually pays", () => {
    // The overlay promises "TOMORROW PAYS N" using dailyRewardFor; if the two
    // drift, the game makes a promise applyDailyClear breaks.
    // Literal numbers on the applyDailyClear side, deliberately: it calls
    // dailyRewardFor internally, so `toBe(dailyRewardFor(n))` was a tautology
    // that could never catch the promise drifting from the payout.
    const save = newSave();
    expect(applyDailyClear(save, "2026-08-05")).toBe(30); // day 1
    expect(dailyRewardFor(1)).toBe(30);
    expect(applyDailyClear(save, "2026-08-06")).toBe(35); // streak advanced
    expect(dailyRewardFor(2)).toBe(35);
    expect(dailyRewardFor(7)).toBe(55); // capped
    expect(dailyRewardFor(99)).toBe(55);
  });

  it("production boosts respect the interval floor and only touch the player", () => {
    const save = newSave();
    save.upgrades.production = 3;
    const b = boostsFor(save);
    expect(b.prodInterval[2]).toBeGreaterThanOrEqual(12);
    expect(b.prodInterval[0]).toBeLessThan(45);
  });
});

describe("daily challenge", () => {
  it("unlocks exactly at the first checkpoint — cleared 3, not before", () => {
    // Hugo's call: the daily (an L12-grade board) opens with the first
    // checkpoint under the every-3rd cadence. The alignment is the point,
    // so pin both the boundary and the equality with the cadence itself.
    expect(dailyUnlocked({ ...newSave(), clearedMax: DAILY_UNLOCK_CLEARED - 1 })).toBe(false);
    expect(dailyUnlocked({ ...newSave(), clearedMax: DAILY_UNLOCK_CLEARED })).toBe(true);
    expect(DAILY_UNLOCK_CLEARED).toBe(3);
    expect(isCheckpoint(DAILY_UNLOCK_CLEARED)).toBe(true);
  });

  it("same date ⇒ same seed; different date ⇒ different seed", () => {
    expect(dailySeed("2026-08-05")).toBe(dailySeed("2026-08-05"));
    expect(dailySeed("2026-08-05")).not.toBe(dailySeed("2026-08-06"));
  });

  it("pays once per day, streaks on consecutive days, caps the bonus", () => {
    const save = newSave();
    expect(applyDailyClear(save, "2026-08-05")).toBe(30);
    expect(applyDailyClear(save, "2026-08-05")).toBe(0); // already claimed
    expect(applyDailyClear(save, "2026-08-06")).toBe(35); // streak 2
    expect(applyDailyClear(save, "2026-08-08")).toBe(30); // gap resets
    save.daily = { lastClearUTC: "2026-08-08", dayStreak: 99 };
    expect(applyDailyClear(save, "2026-08-09")).toBe(30 + 25); // capped
  });
});

describe("save migration", () => {
  /** A well-formed v3 save with the OLD six-track upgrade record. */
  const v3Save = (upgrades: Partial<Record<string, number>> = {}, cores = 0) => ({
    v: 3,
    bestLevel: 9,
    clearedMax: 8,
    run: { level: 9, lives: 2, attempt: 0 },
    cores,
    upgrades: {
      garrison: 0,
      production: 0,
      discount: 0,
      buildSpeed: 0,
      salvage: 0,
      secondWind: 0,
      ...upgrades,
    },
    stars: {},
    daily: null,
    flags: { upgradeNudgeShown: false, coachProgress: 5, panHintShown: false },
  });

  it("passes valid v4 through, repairing ranges", () => {
    const s = migrateSave({ ...newSave(), cores: 12.7, run: { level: 4, lives: 9 } });
    expect(s.v).toBe(4);
    expect(s.cores).toBe(12);
    expect(s.run.lives).toBeLessThanOrEqual(3);
  });

  it("clamps corrupt ability tiers on load — a bad tier is infinite charges", () => {
    const s = migrateSave({
      ...newSave(),
      abilities: { overcharge: 99, stasis: -3, recall: "boom" as unknown as number },
    });
    expect(s.abilities).toEqual({ overcharge: 3, stasis: 0, recall: 0 });
  });

  it("v3 -> v4 carries engineering as max(discount, buildSpeed)", () => {
    const s = migrateSave(v3Save({ discount: 2, buildSpeed: 1, garrison: 3, salvage: 1 }));
    expect(s.v).toBe(4);
    expect(s.upgrades.engineering).toBe(2);
    expect(s.upgrades.garrison).toBe(3);
    expect(s.upgrades.salvage).toBe(1);
    expect(s.abilities).toEqual({ overcharge: 0, stasis: 0, recall: 0 });
    // The rest of the identity survives.
    expect(s.bestLevel).toBe(9);
    expect(s.clearedMax).toBe(8);
    expect(s.run).toEqual({ level: 9, lives: 2, attempt: 0 });
  });

  it("v3 -> v4 refunds the cores spent on tiers that do not carry", () => {
    /**
     * discount 2 + buildSpeed 1 cost 55+200 + 50 = 305 under v3 pricing.
     * The carried engineering tier is max(2,1) = 2, worth 55+210 = 265 at
     * engineering prices. The 40-core difference goes back to the player —
     * they paid for three tiers of effect and keep two.
     */
    const s = migrateSave(v3Save({ discount: 2, buildSpeed: 1 }, 100));
    expect(s.cores).toBe(100 + (55 + 200 + 50) - (55 + 210));
    // Maxed both: paid 705 + 640 = 1345, carried tier 3 costs 725 -> +620.
    const maxed = migrateSave(v3Save({ discount: 3, buildSpeed: 3 }, 0));
    expect(maxed.upgrades.engineering).toBe(3);
    expect(maxed.cores).toBe(1345 - 725);
    // Nothing bought on either track: nothing refunded.
    expect(migrateSave(v3Save({}, 7)).cores).toBe(7);
  });

  it("v3 -> v4 never CHARGES for the merge — player-positive means floored at 0", () => {
    // buildSpeed tier 1 cost 50; engineering tier 1 costs 55. The player owns
    // strictly more than they bought (both effects), so the answer is a zero
    // refund, never a 5-core debit.
    const s = migrateSave(v3Save({ buildSpeed: 1 }, 20));
    expect(s.upgrades.engineering).toBe(1);
    expect(s.cores).toBe(20);
  });

  it("v2 grandfathers best + run and gifts welcome cores", () => {
    const s = migrateSave({ v: 2, bestLevel: 8, run: { level: 5, lives: 1 } });
    expect(s.v).toBe(4);
    expect(s.bestLevel).toBe(8);
    expect(s.clearedMax).toBe(7);
    expect(s.run).toEqual({ level: 5, lives: 1, attempt: 0 });
    expect(s.cores).toBe(40);
    expect(s.abilities).toEqual({ overcharge: 0, stasis: 0, recall: 0 });
  });

  it("v1 chains through with a fresh run", () => {
    const s = migrateSave({ highestLevel: 6 });
    expect(s.bestLevel).toBe(6);
    expect(s.run).toEqual({ level: 1, lives: BASE_LIVES, attempt: 0 });
    expect(s.cores).toBe(30);
  });

  it("falls back to a new save on garbage", () => {
    for (const junk of [null, undefined, 42, "x", {}, { v: 9 }]) {
      expect(migrateSave(junk)).toEqual(newSave());
    }
  });

  it("preserves a fired upgrade nudge flag; defaults it when absent", () => {
    const fired = migrateSave({ ...newSave(), flags: { upgradeNudgeShown: true } });
    expect(fired.flags.upgradeNudgeShown).toBe(true);

    const legacy = { ...newSave() } as Record<string, unknown>;
    delete legacy.flags;
    expect(migrateSave(legacy).flags).toEqual({
      upgradeNudgeShown: false,
      coachProgress: 0,
      panHintShown: false,
    });
  });

  it("does not re-teach the onboarding to a save that predates it", () => {
    // A v3 save from before app/coach.ts existed has no coachProgress, so it
    // defaults to 0 — which would put "DRAG FROM YOUR NODE" in front of someone
    // on level 40. Anyone past the teaching band has demonstrably been taught.
    const veteran = { ...newSave(), bestLevel: 41, clearedMax: 40 } as Record<string, unknown>;
    delete (veteran.flags as Record<string, unknown>).coachProgress;
    expect(migrateSave(veteran).flags.coachProgress).toBe(COACH_STEPS.length);

    // A genuine newcomer mid-teaching-arc keeps their place in the queue.
    const rookie = { ...newSave(), bestLevel: 2, clearedMax: 1 } as Record<string, unknown>;
    delete (rookie.flags as Record<string, unknown>).coachProgress;
    expect(migrateSave(rookie).flags.coachProgress).toBe(0);

    // And older schema versions are veterans of an entirely different build.
    expect(migrateSave({ v: 2, bestLevel: 8, run: { level: 5, lives: 1 } }).flags.coachProgress)
      .toBe(COACH_STEPS.length);
    expect(migrateSave({ highestLevel: 6 }).flags.coachProgress).toBe(COACH_STEPS.length);
  });
});

describe("upgrade descriptions", () => {
  // Tracks AND abilities: the POWERS rows render through the exact same shop
  // row (ShopView.desc), so they answer to the same rules.
  const DESCRIBED = [...TRACKS, ...ABILITIES];

  it("are total and non-degenerate over every reachable tier", () => {
    // describe() is called with tier+1 while a row is buyable and tier once
    // it is maxed, so 0..costs.length is the whole reachable domain.
    for (const t of DESCRIBED) {
      for (let tier = 0; tier <= t.costs.length; tier++) {
        const s = t.describe(tier);
        expect(s.length, `${t.key}@${tier}`).toBeGreaterThan(0);
        expect(s, `${t.key}@${tier}`).not.toContain("undefined");
        expect(s, `${t.key}@${tier}`).not.toContain("NaN");
      }
    }
  });

  it("never states a percentage", () => {
    // A row is supposed to say what the upgrade DOES, in units the player can
    // picture. "+7% production" was also not arithmetically true.
    for (const t of DESCRIBED) {
      for (let tier = 0; tier <= t.costs.length; tier++) {
        expect(t.describe(tier), `${t.key}@${tier}`).not.toContain("%");
      }
    }
  });

  it("agrees with itself on plurals", () => {
    const salvage = TRACKS.find((t) => t.key === "salvage")!;
    expect(salvage.describe(1)).toContain("+1 core banked");
    expect(salvage.describe(2)).toContain("+2 cores banked");
    // The ability rows carry the charge count in the same grammar.
    for (const a of ABILITIES) {
      expect(a.describe(1), a.key).toContain("1 charge per level");
      expect(a.describe(2), a.key).toContain("2 charges per level");
    }
  });

  it("prints one decimal place on every timing tier", () => {
    // [3.0, 2.7, 2.3, 2.0][3] is the number 2, so the last tier used to render
    // "2s" beside "2.7s" and "2.3s". ENGINEERING inherited the timings — and
    // the trap — from the retired RAPID DEPLOY track.
    const eng = TRACKS.find((t) => t.key === "engineering")!;
    expect(eng.describe(3)).toContain("2.0s");
    expect(eng.describe(1)).toContain("2.7s");
  });

  it("states each ability's CONDITION in game units", () => {
    // The sim's own numbers, verbatim: 10s of OVERCHARGE_TICKS at 30 Hz, 5s
    // of STASIS_TICKS. A desc that drifts from the constants sells a lie.
    const byKey = Object.fromEntries(ABILITIES.map((a) => [a.key, a]));
    expect(byKey.overcharge!.describe(1)).toContain("10s");
    expect(byKey.overcharge!.describe(1)).toContain("4x");
    expect(byKey.stasis!.describe(1)).toContain("5s");
    expect(byKey.recall!.describe(1).toLowerCase()).toContain("in flight");
  });

  it("states resulting life counts, not a delta, on the single-tier track", () => {
    // The old copy read "+1 life per run" at tier 0 and "3 lives per run" at
    // tier 1 — inconsistent registers, and the tier-0 branch was unreachable
    // anyway. Asserting the two strings merely DIFFER passes on that old code,
    // so it would have been a vacuous test. What matters is that both state a
    // resulting count that agrees with livesFor(), and neither reads as a delta.
    const sw = TRACKS.find((t) => t.key === "secondWind")!;
    expect(sw.costs.length).toBe(1);

    const owned = { ...newSave(), upgrades: { ...newSave().upgrades, secondWind: 1 } };
    expect(livesFor(newSave())).toBe(BASE_LIVES);
    expect(livesFor(owned)).toBe(BASE_LIVES + 1);

    for (const tier of [0, 1]) {
      expect(sw.describe(tier), `tier ${tier}`).not.toMatch(/^[+-]/);
    }
    expect(sw.describe(0).toLowerCase()).toContain("two");
    expect(sw.describe(1).toLowerCase()).toContain("third");
  });
});
