import { HERO_ORDER, type HeroId } from "./content";

/**
 * Progress lives in this browser only. The CrazyGames SDK wrapper the game
 * shipped with is gone: the site runs no third-party scripts and needs no
 * cloud save, so the platform seam collapses to localStorage behind the same
 * method names the game loop already calls.
 */
export type Save = {
  version: 2;
  muted: boolean;
  music: boolean;
  reducedMotion: boolean;
  bestWave: number;
  totalRuns: number;
  victories: number;
  clearedHeroes: HeroId[];
  heroRecords: Partial<Record<HeroId, number>>;
};

export const SAVE_KEY = "hugoslekstuga:survival-maxx:save";
export const MAX_RECORDED_WAVE = 1_000_000;
export const freshSave = (): Save => ({
  version: 2,
  muted: false,
  music: true,
  reducedMotion: false,
  bestWave: 0,
  totalRuns: 0,
  victories: 0,
  clearedHeroes: [],
  heroRecords: {},
});

function counter(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(Math.max(0, Math.min(maximum, value)))
    : 0;
}

export function parseSave(raw: string | null): Save {
  const save = freshSave();
  if (!raw) return save;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return save;
    const data = value as Record<string, unknown>;
    if (data.version !== 2) return save;
    save.muted = data.muted === true;
    save.music = data.music !== false;
    save.reducedMotion = data.reducedMotion === true;
    save.bestWave = counter(data.bestWave, MAX_RECORDED_WAVE);
    save.totalRuns = counter(data.totalRuns, 1_000_000);
    // Only a contiguous chain of known campaign clears can unlock characters.
    const clears = Array.isArray(data.clearedHeroes) ? data.clearedHeroes : [];
    for (const id of HERO_ORDER) {
      if (!clears.includes(id)) break;
      save.clearedHeroes.push(id);
    }
    if (
      data.heroRecords &&
      typeof data.heroRecords === "object" &&
      !Array.isArray(data.heroRecords)
    ) {
      const records = data.heroRecords as Record<string, unknown>;
      for (const id of HERO_ORDER) {
        const wave = counter(records[id], MAX_RECORDED_WAVE);
        if (wave) save.heroRecords[id] = wave;
      }
    }
    // A cleared character has reached the campaign's last wave by definition.
    for (const id of save.clearedHeroes)
      save.heroRecords[id] = Math.max(30, save.heroRecords[id] ?? 0);
    save.bestWave = Math.max(save.bestWave, ...Object.values(save.heroRecords));
    save.victories = save.clearedHeroes.length;
    save.totalRuns = Math.max(save.totalRuns, save.victories);
  } catch {
    // A damaged or older save must never prevent a new run.
  }
  return save;
}

type StorageAdapter = Pick<Storage, "getItem" | "setItem">;

export class Platform {
  save = freshSave();
  warning = "";
  onMute: (muted: boolean) => void = () => {};
  private storage: StorageAdapter | null = null;
  private initialization: Promise<void> | null = null;

  constructor(storage?: StorageAdapter) {
    if (storage) this.storage = storage;
  }

  init(): Promise<void> {
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<void> {
    try {
      if (!this.storage) {
        if (typeof window === "undefined") return;
        this.storage = window.localStorage;
      }
      this.save = parseSave(this.storage.getItem(SAVE_KEY));
    } catch {
      // Private mode or blocked storage: the whole game still plays in memory.
      this.storage = null;
      this.warning = "Progress won't be saved.";
    }
  }

  persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.save));
      this.warning = "";
    } catch {
      this.warning = "Progress not saved.";
    }
  }

  // The remaining calls were platform telemetry. They stay as no-ops so the
  // game loop reads the same as it always did.
  gameplay(active: boolean): void {
    void active;
  }

  celebrate(): void {}

  context(wave: number): void {
    void wave;
  }

  clearContext(): void {}

  dispose(): void {
    this.onMute = () => {};
  }
}
