import { HERO_ORDER, CAMPAIGN_WAVES, type HeroId } from "./content";
import type { Save } from "./platform";

const MAX_WAVE = 1_000_000;
const isHero = (hero: unknown): hero is HeroId =>
  typeof hero === "string" && (HERO_ORDER as readonly string[]).includes(hero);

/** One operator starts unlocked; each completed predecessor unlocks the next. */
export function getUnlockedHeroes(save: Save): HeroId[] {
  const unlocked: HeroId[] = [];
  for (const hero of HERO_ORDER) {
    unlocked.push(hero);
    if (!save.clearedHeroes.includes(hero)) break;
  }
  return unlocked;
}

/** Reaching any wave, including endless waves, changes records without unlocking. */
export function recordProgress(save: Save, hero: HeroId, wave: number): void {
  if (
    !isHero(hero) ||
    !getUnlockedHeroes(save).includes(hero) ||
    !Number.isFinite(wave) ||
    wave < 1
  )
    return;
  const reached = Math.min(MAX_WAVE, Math.floor(wave));
  save.heroRecords[hero] = Math.max(save.heroRecords[hero] ?? 0, reached);
  save.bestWave = Math.max(save.bestWave, reached);
}

/** Call on an actual campaign victory. Idempotent, even after entering endless. */
export function recordClear(save: Save, hero: HeroId): HeroId | null {
  if (
    !isHero(hero) ||
    !getUnlockedHeroes(save).includes(hero) ||
    save.clearedHeroes.includes(hero)
  )
    return null;
  const index = HERO_ORDER.indexOf(hero);
  if (index > 0 && !save.clearedHeroes.includes(HERO_ORDER[index - 1]))
    return null;
  recordProgress(save, hero, CAMPAIGN_WAVES);
  save.clearedHeroes.push(hero);
  // Victories counts distinct campaign clears, not repeated event notifications.
  save.victories = save.clearedHeroes.length;
  save.totalRuns = Math.max(save.totalRuns, save.victories);
  return HERO_ORDER[index + 1] ?? null;
}
