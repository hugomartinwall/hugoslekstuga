import { describe, expect, it } from "vitest";
import {
  applyDailyClear,
  applyDefeat,
  applyWin,
  BASE_LIVES,
  boostsFor,
  buyUpgrade,
  coresForWin,
  dailySeed,
  livesFor,
  migrateSave,
  newSave,
  TRACKS,
  type SaveV3,
} from "../lib/overrun/app/run";

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
    let save = { ...newSave(), bestLevel: 7, run: { level: 5, lives: 2 } };
    const first = applyDefeat(save);
    expect(first.runOver).toBe(false);
    expect(first.save.run).toEqual({ level: 5, lives: 1 });
    const second = applyDefeat(first.save);
    expect(second.runOver).toBe(true);
    expect(second.reachedLevel).toBe(5);
    expect(second.save.run).toEqual({ level: 1, lives: BASE_LIVES });
    expect(second.save.bestLevel).toBe(7);
  });

  it("Second Wind grants a third life on new runs", () => {
    const save = newSave();
    save.cores = 500;
    expect(buyUpgrade(save, "secondWind")).toBe(true);
    expect(livesFor(save)).toBe(3);
    const over = applyDefeat({ ...save, run: { level: 4, lives: 1 } });
    expect(over.save.run.lives).toBe(3);
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
    save.cores = 60;
    expect(buyUpgrade(save, "garrison")).toBe(true);
    expect(save.cores).toBe(0);
    expect(save.upgrades.garrison).toBe(1);
    expect(boostsFor(save).startUnits).toBe(2);
  });

  it("total track cost matches the designed 4,240 grind", () => {
    const total = TRACKS.reduce((a, t) => a + t.costs.reduce((x, y) => x + y, 0), 0);
    expect(total).toBe(4240);
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
  it("passes valid v3 through, repairing ranges", () => {
    const s = migrateSave({ ...newSave(), cores: 12.7, run: { level: 4, lives: 9 } });
    expect(s.v).toBe(3);
    expect(s.cores).toBe(12);
    expect(s.run.lives).toBeLessThanOrEqual(3);
  });

  it("v2 grandfathers best + run and gifts welcome cores", () => {
    const s = migrateSave({ v: 2, bestLevel: 8, run: { level: 5, lives: 1 } });
    expect(s.v).toBe(3);
    expect(s.bestLevel).toBe(8);
    expect(s.clearedMax).toBe(7);
    expect(s.run).toEqual({ level: 5, lives: 1 });
    expect(s.cores).toBe(40);
  });

  it("v1 chains through with a fresh run", () => {
    const s = migrateSave({ highestLevel: 6 });
    expect(s.bestLevel).toBe(6);
    expect(s.run).toEqual({ level: 1, lives: BASE_LIVES });
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
    expect(migrateSave(legacy).flags).toEqual({ upgradeNudgeShown: false });
  });
});
