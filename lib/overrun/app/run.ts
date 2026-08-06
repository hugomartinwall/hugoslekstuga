import type { PlayerBoosts } from "../sim/level";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../sim/constants";

/**
 * Run/lives progression + meta progression — pure and DOM-free so it's
 * unit-testable. A run = a climb from level 1 with a save-derived number of
 * lives. Cores earned on wins buy permanent upgrade tracks.
 */

export const BASE_LIVES = 2;

export interface RunState {
  level: number;
  lives: number;
}

export type TrackKey =
  | "garrison"
  | "production"
  | "discount"
  | "buildSpeed"
  | "salvage"
  | "secondWind";

export interface UpgradeTrack {
  key: TrackKey;
  name: string;
  /** Cost of tier 1..maxTier. */
  costs: readonly number[];
  describe: (tier: number) => string;
}

export const TRACKS: readonly UpgradeTrack[] = [
  { key: "garrison", name: "START GARRISON", costs: [60, 180, 420],
    describe: (t) => `+${[0, 2, 4, 6][t]} start units` },
  { key: "production", name: "PRODUCTION DRIVE", costs: [100, 260, 550],
    describe: (t) => `${["+0%", "+7%", "+15%", "+25%"][t]} production` },
  { key: "discount", name: "UPGRADE DISCOUNT", costs: [80, 200, 450],
    describe: (t) => `-${[0, 2, 4, 6][t]} node upgrade cost` },
  { key: "buildSpeed", name: "RAPID DEPLOY", costs: [70, 190, 400],
    describe: (t) => `${[3.0, 2.7, 2.3, 2.0][t]}s node upgrades` },
  { key: "salvage", name: "CORE SALVAGE", costs: [90, 240, 500],
    describe: (t) => `+${t} cores per win` },
  { key: "secondWind", name: "SECOND WIND", costs: [450],
    describe: (t) => (t > 0 ? "3 lives per run" : "+1 life per run") },
];

/** Player-only production interval tables per Production Drive tier. */
const PROD_TIERS: readonly (readonly [number, number, number])[] = [
  PROD_INTERVAL,
  [42, 28, 22],
  [39, 26, 20],
  [36, 24, 18],
];

export interface SaveV3 {
  v: 3;
  bestLevel: number;
  /** Highest level ever WON (for first-clear core bonuses). */
  clearedMax: number;
  run: RunState;
  cores: number;
  upgrades: Record<TrackKey, number>;
  /** Best star rating per level (stringified level keys via JSON). */
  stars: Record<string, number>;
  daily: { lastClearUTC: string; dayStreak: number } | null;
  flags: { upgradeNudgeShown: boolean };
}

export function livesFor(save: SaveV3): number {
  return BASE_LIVES + (save.upgrades.secondWind > 0 ? 1 : 0);
}

export function newRun(save?: SaveV3): RunState {
  return { level: 1, lives: save ? livesFor(save) : BASE_LIVES };
}

export function newSave(): SaveV3 {
  const save: SaveV3 = {
    v: 3,
    bestLevel: 1,
    clearedMax: 0,
    run: { level: 1, lives: BASE_LIVES },
    cores: 0,
    upgrades: { garrison: 0, production: 0, discount: 0, buildSpeed: 0, salvage: 0, secondWind: 0 },
    stars: {},
    daily: null,
    flags: { upgradeNudgeShown: false },
  };
  return save;
}

/** Fold permanent upgrades into the sim-facing boost object. */
export function boostsFor(save: SaveV3): PlayerBoosts {
  const u = save.upgrades;
  return {
    startUnits: [0, 2, 4, 6][u.garrison]!,
    prodInterval: PROD_TIERS[u.production]!,
    upgradeCost: [
      Math.max(9, UPGRADE_COST[0] - 2 * u.discount),
      Math.max(19, UPGRADE_COST[1] - 2 * u.discount),
    ] as const,
    upgradeTicks: UPGRADE_TICKS - 10 * u.buildSpeed,
  };
}

/* ------------------------------------------------------------------ cores */

export interface WinContext {
  level: number;
  stars: 1 | 2 | 3;
  streak: number;
  rivalsEliminatedByPlayer: number;
}

/** Cores earned for a level win (losses pay 0). */
export function coresForWin(save: SaveV3, w: WinContext): number {
  const starMult = [0, 1, 1.5, 2][w.stars]!;
  const base = Math.floor(w.level * starMult);
  const first = w.level > save.clearedMax ? 5 : 0;
  const fire = w.streak >= 3 ? 3 : 0;
  const bounty = 3 * w.rivalsEliminatedByPlayer;
  const salvage = save.upgrades.salvage;
  return Math.min(base + first + fire + bounty + salvage, 2 * w.level + 10);
}

export function buyUpgrade(save: SaveV3, key: TrackKey): boolean {
  const track = TRACKS.find((t) => t.key === key)!;
  const tier = save.upgrades[key];
  if (tier >= track.costs.length) return false;
  const cost = track.costs[tier]!;
  if (save.cores < cost) return false;
  save.cores -= cost;
  save.upgrades[key] = tier + 1;
  return true;
}

/* -------------------------------------------------------------- transitions */

export interface DefeatResult {
  save: SaveV3;
  runOver: boolean;
  reachedLevel: number;
}

/** Winning level N advances the run; caller applies cores separately. */
export function applyWin(save: SaveV3, w: WinContext): SaveV3 {
  const level = save.run.level + 1;
  const stars = { ...save.stars };
  const prev = stars[String(w.level)] ?? 0;
  if (w.stars > prev) stars[String(w.level)] = w.stars;
  return {
    ...save,
    bestLevel: Math.max(save.bestLevel, level),
    clearedMax: Math.max(save.clearedMax, w.level),
    cores: save.cores + coresForWin(save, w),
    stars,
    run: { level, lives: save.run.lives },
  };
}

export function applyDefeat(save: SaveV3): DefeatResult {
  const lives = save.run.lives - 1;
  if (lives <= 0) {
    return {
      save: { ...save, run: newRun(save) },
      runOver: true,
      reachedLevel: save.run.level,
    };
  }
  return {
    save: { ...save, run: { level: save.run.level, lives } },
    runOver: false,
    reachedLevel: save.run.level,
  };
}

/* -------------------------------------------------------------------- daily */

/** UTC date string → deterministic seed (FNV-1a). Same board worldwide. */
export function dailySeed(dateUTC: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateUTC.length; i++) {
    h ^= dateUTC.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export function todayUTC(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Cores for a daily clear; pays once per UTC day. Returns 0 if already paid. */
export function applyDailyClear(save: SaveV3, dateUTC: string): number {
  if (save.daily?.lastClearUTC === dateUTC) return 0;
  const yesterday = new Date(new Date(dateUTC).getTime() - 86_400_000).toISOString().slice(0, 10);
  const dayStreak = save.daily?.lastClearUTC === yesterday ? save.daily.dayStreak + 1 : 1;
  const reward = 30 + Math.min(25, 5 * (dayStreak - 1));
  save.daily = { lastClearUTC: dateUTC, dayStreak };
  save.cores += reward;
  return reward;
}

/* ---------------------------------------------------------------- migration */

export function migrateSave(raw: unknown): SaveV3 {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.v === 3 && typeof o.bestLevel === "number" && o.run && typeof o.run === "object") {
      const base = newSave();
      const run = o.run as RunState;
      const merged: SaveV3 = {
        ...base,
        ...(o as unknown as SaveV3),
        run: {
          level: Math.max(1, Math.floor(run.level ?? 1)),
          lives: Math.max(1, Math.min(3, Math.floor(run.lives ?? BASE_LIVES))),
        },
        upgrades: { ...base.upgrades, ...(o.upgrades as SaveV3["upgrades"] | undefined) },
        flags: { ...base.flags, ...(o.flags as SaveV3["flags"] | undefined) },
      };
      merged.bestLevel = Math.max(merged.bestLevel, merged.run.level);
      merged.cores = Math.max(0, Math.floor(merged.cores));
      return merged;
    }
    // v2: keep best + run, welcome-back core gift so veterans buy something.
    if (o.v === 2 && typeof o.bestLevel === "number" && o.bestLevel >= 1) {
      const save = newSave();
      const run = (o.run ?? {}) as Partial<RunState>;
      save.bestLevel = Math.floor(o.bestLevel as number);
      save.clearedMax = Math.max(0, save.bestLevel - 1);
      save.run = {
        level: Math.max(1, Math.floor(run.level ?? 1)),
        lives: Math.max(1, Math.min(BASE_LIVES, Math.floor(run.lives ?? BASE_LIVES))),
      };
      save.cores = 5 * save.bestLevel;
      return save;
    }
    // v1
    if (typeof o.highestLevel === "number" && o.highestLevel >= 1) {
      const save = newSave();
      save.bestLevel = Math.floor(o.highestLevel);
      save.clearedMax = Math.max(0, save.bestLevel - 1);
      save.cores = 5 * save.bestLevel;
      return save;
    }
  }
  return newSave();
}
