import {
  HERO_ORDER,
  CAMPAIGN_WAVES,
  MAP_COUNT,
  MAP_ORDER,
  type HeroId,
  type MapId,
} from "./content";
import type { Save } from "./platform";

const MAX_WAVE = 1_000_000;
const isHero = (hero: unknown): hero is HeroId =>
  typeof hero === "string" && (HERO_ORDER as readonly string[]).includes(hero);
const isMap = (map: unknown): map is MapId =>
  typeof map === "number" && Number.isInteger(map) && map >= 1 && map <= MAP_COUNT;
const clears = (save: Save, hero: HeroId) => save.mapClears[hero] ?? 0;

/** One hero starts unlocked; clearing map 1 with a hero unlocks the next. */
export function getUnlockedHeroes(save: Save): HeroId[] {
  const unlocked: HeroId[] = [];
  for (const hero of HERO_ORDER) {
    unlocked.push(hero);
    if (clears(save, hero) < 1) break;
  }
  return unlocked;
}

export const getClearedHeroes = (save: Save): HeroId[] =>
  HERO_ORDER.filter((hero) => clears(save, hero) >= 1);

/** Maps a hero may start: every cleared map plus the next one. */
export function getUnlockedMaps(save: Save, hero: HeroId): MapId[] {
  if (!isHero(hero) || !getUnlockedHeroes(save).includes(hero)) return [];
  return MAP_ORDER.slice(0, Math.min(MAP_COUNT, clears(save, hero) + 1));
}

export function getClearedMaps(save: Save, hero: HeroId): MapId[] {
  return MAP_ORDER.slice(0, Math.min(MAP_COUNT, clears(save, hero)));
}

export function canPlay(
  save: Save,
  hero: HeroId,
  map: number,
  endless = false,
): boolean {
  if (!isHero(hero) || !isMap(map)) return false;
  if (!getUnlockedMaps(save, hero).includes(map)) return false;
  return !endless || map <= clears(save, hero);
}

/** Reaching any wave, including endless waves, changes records without unlocking. */
export function recordProgress(
  save: Save,
  hero: HeroId,
  map: number,
  wave: number,
): void {
  if (!canPlay(save, hero, map) || !Number.isFinite(wave) || wave < 1) return;
  const reached = Math.min(MAX_WAVE, Math.floor(wave));
  const records = (save.mapRecords[hero] ??= []);
  records[map - 1] = Math.max(records[map - 1] ?? 0, reached);
  for (let index = 0; index < records.length; index++) records[index] ??= 0;
  save.heroRecords[hero] = Math.max(save.heroRecords[hero] ?? 0, reached);
  save.bestWave = Math.max(save.bestWave, reached);
}

/**
 * Call on an actual campaign victory. Only the hero's next uncleared map is a
 * new clear; replays and endless runs are idempotent. Returns what it unlocked.
 */
export function recordClear(
  save: Save,
  hero: HeroId,
  map: number,
): { hero: HeroId | null; map: MapId | null } {
  const none = { hero: null, map: null };
  if (!canPlay(save, hero, map) || map !== clears(save, hero) + 1) return none;
  recordProgress(save, hero, map, CAMPAIGN_WAVES);
  save.mapClears[hero] = map;
  // Victories counts distinct campaign clears, not repeated event notifications.
  save.victories = Object.values(save.mapClears).reduce((a, b) => a + b, 0);
  save.totalRuns = Math.max(save.totalRuns, save.victories);
  const index = HERO_ORDER.indexOf(hero);
  return {
    hero: map === 1 ? (HERO_ORDER[index + 1] ?? null) : null,
    map: map < MAP_COUNT ? ((map + 1) as MapId) : null,
  };
}
