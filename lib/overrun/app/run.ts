/**
 * Run/lives progression logic — pure and DOM-free so it's unit-testable.
 * A run = a climb from level 1 with LIVES_PER_RUN lives. Losing a level costs
 * a life; losing the last life ends the run (recorded against bestLevel) and
 * the next run starts fresh at level 1.
 */

export const LIVES_PER_RUN = 2;

export interface RunState {
  level: number;
  lives: number;
}

/** Save schema v2. v1 was `{ highestLevel: number }`. */
export interface SaveV2 {
  v: 2;
  bestLevel: number;
  run: RunState;
}

export function newRun(): RunState {
  return { level: 1, lives: LIVES_PER_RUN };
}

export function newSave(): SaveV2 {
  return { v: 2, bestLevel: 1, run: newRun() };
}

export interface DefeatResult {
  save: SaveV2;
  /** true = run over (start fresh); false = retry the same level. */
  runOver: boolean;
  /** Level reached by the ended run (only when runOver). */
  reachedLevel: number;
}

/** Winning level N advances the run to N+1 and may raise bestLevel. */
export function applyWin(save: SaveV2): SaveV2 {
  const level = save.run.level + 1;
  return {
    v: 2,
    bestLevel: Math.max(save.bestLevel, level),
    run: { level, lives: save.run.lives },
  };
}

/** A defeat costs a life; the last life ends the run. */
export function applyDefeat(save: SaveV2): DefeatResult {
  const lives = save.run.lives - 1;
  if (lives <= 0) {
    return {
      save: { v: 2, bestLevel: save.bestLevel, run: newRun() },
      runOver: true,
      reachedLevel: save.run.level,
    };
  }
  return {
    save: { v: 2, bestLevel: save.bestLevel, run: { level: save.run.level, lives } },
    runOver: false,
    reachedLevel: save.run.level,
  };
}

/**
 * Accept whatever came out of storage: v2 passes through (validated),
 * v1 `{ highestLevel }` grandfathers the player's best but starts a fresh
 * run, anything else becomes a new save.
 */
export function migrateSave(raw: unknown): SaveV2 {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (
      o.v === 2 &&
      typeof o.bestLevel === "number" &&
      o.bestLevel >= 1 &&
      o.run &&
      typeof o.run === "object" &&
      typeof (o.run as RunState).level === "number" &&
      (o.run as RunState).level >= 1 &&
      typeof (o.run as RunState).lives === "number" &&
      (o.run as RunState).lives >= 1
    ) {
      const run = o.run as RunState;
      return {
        v: 2,
        bestLevel: Math.max(o.bestLevel as number, run.level),
        run: { level: run.level, lives: Math.min(run.lives, LIVES_PER_RUN) },
      };
    }
    if (typeof o.highestLevel === "number" && o.highestLevel >= 1) {
      return { v: 2, bestLevel: Math.floor(o.highestLevel), run: newRun() };
    }
  }
  return newSave();
}
