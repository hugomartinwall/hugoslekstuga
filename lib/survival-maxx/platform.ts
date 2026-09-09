import {
  HERO_ORDER,
  CAMPAIGN_WAVES,
  MAP_COUNT,
  type HeroId,
} from "./content";

/**
 * Progress lives in this browser only. The CrazyGames SDK wrapper the game
 * shipped with is gone: the site runs no third-party scripts and needs no
 * cloud save, so the platform seam collapses to localStorage behind the same
 * method names the game loop already calls.
 */
export type Save = {
  version: 3;
  muted: boolean;
  music: boolean;
  reducedMotion: boolean;
  bestWave: number;
  totalRuns: number;
  victories: number;
  /** Best wave on any map, derived from `mapRecords`. */
  heroRecords: Partial<Record<HeroId, number>>;
  /** Maps cleared per hero, always contiguous from map 1. */
  mapClears: Partial<Record<HeroId, number>>;
  /** Best wave per map per hero; index = map id − 1. */
  mapRecords: Partial<Record<HeroId, number[]>>;
  /** One-time hints already shown. */
  hints: string[];
};

export const SAVE_KEY = "hugoslekstuga:survival-maxx:save";
export const MAX_RECORDED_WAVE = 1_000_000;
export const MAX_HINTS = 64;
export const freshSave = (): Save => ({
  version: 3,
  muted: false,
  music: true,
  reducedMotion: false,
  bestWave: 0,
  totalRuns: 0,
  victories: 0,
  heroRecords: {},
  mapClears: {},
  mapRecords: {},
  hints: [],
});

function counter(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(Math.max(0, Math.min(maximum, value)))
    : 0;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function parseSave(raw: string | null): Save {
  const save = freshSave();
  if (!raw) return save;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return save;
    const data = value;
    if (data.version !== 2 && data.version !== 3) return save;
    save.muted = data.muted === true;
    save.music = data.music !== false;
    save.reducedMotion = data.reducedMotion === true;
    save.bestWave = counter(data.bestWave, MAX_RECORDED_WAVE);
    save.totalRuns = counter(data.totalRuns, 1_000_000);
    // Clears per hero. v2 stored a list of heroes that beat the single campaign;
    // that is exactly "map 1 cleared". Only a contiguous hero chain counts.
    const claimed: Partial<Record<HeroId, number>> = {};
    if (data.version === 2) {
      const list = Array.isArray(data.clearedHeroes) ? data.clearedHeroes : [];
      for (const id of HERO_ORDER) {
        if (!list.includes(id)) break;
        claimed[id] = 1;
      }
    } else if (isRecord(data.mapClears))
      for (const id of HERO_ORDER)
        claimed[id] = counter(data.mapClears[id], MAP_COUNT);
    let chain = true;
    for (const id of HERO_ORDER) {
      const cleared = chain ? (claimed[id] ?? 0) : 0;
      if (cleared > 0) save.mapClears[id] = cleared;
      if (cleared < 1) chain = false;
    }
    // Records exist only for unlocked heroes and unlocked maps; a cleared map
    // implies at least a full campaign on it.
    const v2Records = isRecord(data.heroRecords) ? data.heroRecords : {},
      v3Records = isRecord(data.mapRecords) ? data.mapRecords : {};
    let previous: HeroId | null = null;
    for (const id of HERO_ORDER) {
      const unlocked = !previous || (save.mapClears[previous] ?? 0) >= 1;
      previous = id;
      if (!unlocked) continue;
      const cleared = save.mapClears[id] ?? 0;
      let list: number[] = [];
      if (data.version === 2) {
        const wave = counter(v2Records[id], MAX_RECORDED_WAVE);
        if (wave) list = [wave];
      } else if (Array.isArray(v3Records[id]))
        list = (v3Records[id] as unknown[])
          .slice(0, MAP_COUNT)
          .map((entry) => counter(entry, MAX_RECORDED_WAVE));
      list = list.slice(0, cleared + 1);
      for (let index = 0; index < cleared; index++)
        list[index] = Math.max(CAMPAIGN_WAVES, list[index] ?? 0);
      while (list.length && !list[list.length - 1]) list.pop();
      if (list.length) {
        save.mapRecords[id] = list;
        save.heroRecords[id] = Math.max(...list);
      }
    }
    if (Array.isArray(data.hints))
      save.hints = [
        ...new Set(
          data.hints.filter(
            (hint): hint is string =>
              typeof hint === "string" && hint.length <= 40,
          ),
        ),
      ].slice(0, MAX_HINTS);
    save.bestWave = Math.max(save.bestWave, ...Object.values(save.heroRecords));
    save.victories = Object.values(save.mapClears).reduce((a, b) => a + b, 0);
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
      // Version 2 saves (the 0.8 port) migrate in parseSave; anything newer
      // is preserved untouched and writes stay off for the session.
      const raw = this.storage.getItem(SAVE_KEY);
      if (raw !== null) {
        const decoded: unknown = JSON.parse(raw);
        if (
          !decoded ||
          typeof decoded !== "object" ||
          ![2, 3].includes((decoded as { version?: unknown }).version as number)
        )
          throw new Error("Unsupported save");
      }
      this.save = parseSave(raw);
    } catch {
      // Private mode, blocked storage or a save from the future: the whole
      // game still plays in memory.
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

  context(wave: number, map = 1): void {
    void wave;
    void map;
  }

  clearContext(): void {}

  dispose(): void {
    this.onMute = () => {};
  }
}
