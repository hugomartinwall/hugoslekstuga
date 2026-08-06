import { describe, expect, it } from "vitest";
import {
  applyDefeat,
  applyWin,
  BASE_LIVES,
  buyUpgrade,
  CHECKPOINT_EVERY,
  checkpointLevel,
  migrateSave,
  newSave,
  runFrom,
} from "../lib/overrun/app/run";

/**
 * SITE-LOCAL SUITE — not from the upstream Overrun repo.
 *
 * Checkpoints every third level are a hugoslekstuga addition, so they get their
 * own file: a re-sync overwrites the upstream suites and leaves this one alone.
 */

const save = (clearedMax: number, over: Partial<ReturnType<typeof newSave>> = {}) => ({
  ...newSave(),
  clearedMax,
  ...over,
});

describe("checkpoints", () => {
  it("banks one every third cleared level, at the level after it", () => {
    expect(CHECKPOINT_EVERY).toBe(3);
    expect(checkpointLevel(save(0))).toBe(1);
    expect(checkpointLevel(save(1))).toBe(1);
    expect(checkpointLevel(save(2))).toBe(1);
    expect(checkpointLevel(save(3))).toBe(4);
    expect(checkpointLevel(save(5))).toBe(4);
    expect(checkpointLevel(save(6))).toBe(7);
    expect(checkpointLevel(save(20))).toBe(19);
  });

  it("is monotonic and never regresses as a run climbs", () => {
    let s = newSave();
    let last = checkpointLevel(s);
    for (let level = 1; level <= 12; level++) {
      s = applyWin(s, { level, stars: 1, streak: 1, rivalsEliminatedByPlayer: 0 });
      const cp = checkpointLevel(s);
      expect(cp).toBeGreaterThanOrEqual(last);
      expect(cp).toBeLessThanOrEqual(level + 1);
      last = cp;
    }
    expect(last).toBe(13); // cleared 12 ⇒ banked at 13
  });

  it("run over lands on the checkpoint with a full set of lives", () => {
    const over = applyDefeat(save(8, { bestLevel: 9, run: { level: 9, lives: 1 } }));
    expect(over.runOver).toBe(true);
    expect(over.reachedLevel).toBe(9);
    expect(over.save.run).toEqual({ level: 7, lives: BASE_LIVES });
  });

  it("still lands on level 1 before anything is banked", () => {
    const over = applyDefeat(save(2, { run: { level: 3, lives: 1 } }));
    expect(over.save.run).toEqual({ level: 1, lives: BASE_LIVES });
  });

  it("losing a life mid-run leaves the level alone", () => {
    const hit = applyDefeat(save(8, { run: { level: 9, lives: 2 } }));
    expect(hit.runOver).toBe(false);
    expect(hit.save.run).toEqual({ level: 9, lives: 1 });
  });

  it("runFrom clamps to a real level and honours Second Wind", () => {
    const s = newSave();
    expect(runFrom(s, 0)).toEqual({ level: 1, lives: BASE_LIVES });
    expect(runFrom(s, 7.9)).toEqual({ level: 7, lives: BASE_LIVES });
    s.cores = 500;
    expect(buyUpgrade(s, "secondWind")).toBe(true);
    expect(runFrom(s, 7).lives).toBe(3);
  });

  it("adds no save state — the checkpoint is derived from clearedMax", () => {
    expect(newSave()).not.toHaveProperty("checkpoint");
    const s = { ...newSave(), clearedMax: 8 };
    expect(migrateSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
