/**
 * The platform seam, as it exists on hugoslekstuga.
 *
 * game2 shipped a 443-line CrazyGames SDK wrapper with a stub fallback for
 * offline dev. On the site there is no SDK to fall back FROM, so the wrapper
 * is gone and this is all that remains: the same `Platform` interface, backed
 * by localStorage and a handful of honest no-ops.
 *
 * Why keep the interface at all rather than tearing the calls out of
 * `main.ts`? Because the seam is what kept SDK knowledge out of 60 other
 * files, and `test/greyrot/architecture.test.ts` still guards it — it now
 * asserts that NOTHING mentions the SDK, which is the stronger claim. Deleting
 * the interface would mean touching every call site to prove a point.
 *
 * Ads do not exist here. `ADS_ENABLED` in `app/economy.ts` is false, so
 * `requestAd` is unreachable — it returns a refusal rather than pretending,
 * because §8's rule is that an offer which cannot pay must never be on screen.
 */

export type AdType = "midgame" | "rewarded";

export type AdErrorCode = "adsDisabledBasicLaunch" | "unfilled" | "adblock" | "adCooldown" | "other";

export interface AdResult {
  completed: boolean;
  code?: AdErrorCode | string;
}

export interface Platform {
  readonly available: boolean;
  init(): Promise<void>;
  gameplayStart(): void;
  gameplayStop(): void;
  loadingStart(): void;
  loadingStop(): void;
  happytime(): void;
  reportCompleted(percent: number): void;
  setContext(ctx: { zone?: string }): void;
  isMuted(): boolean;
  onMuteChange(fn: (muted: boolean) => void): () => void;
  requestAd(type: AdType): Promise<AdResult>;
  hasAdblock(): Promise<boolean>;
  save(key: string, value: unknown): Promise<void>;
  load<T>(key: string): Promise<T | null>;
}

/**
 * Ads used to pause and mute the game, so main.ts wired these in. Nothing
 * calls them now, but the setter stays: it costs four lines and removing it
 * would mean editing main.ts to prove ads are gone twice.
 */
export interface GameHooks {
  pause: () => void;
  resume: () => void;
  mute: () => void;
  unmute: () => void;
}

export function setGameHooks(_h: GameHooks): void {
  /* no ad can interrupt play, so nothing needs to pause for one */
}

class LocalPlatform implements Platform {
  readonly available = false;

  async init(): Promise<void> {
    /* nothing to hand-shake with */
  }

  gameplayStart(): void {}
  gameplayStop(): void {}
  loadingStart(): void {}
  loadingStop(): void {}
  happytime(): void {}
  reportCompleted(_percent: number): void {}
  setContext(_ctx: { zone?: string }): void {}

  /** The player's mute lives in `audio/audio.ts`; nothing else may override it. */
  isMuted(): boolean {
    return false;
  }
  onMuteChange(_fn: (muted: boolean) => void): () => void {
    return () => {};
  }

  async requestAd(_type: AdType): Promise<AdResult> {
    return { completed: false, code: "adsDisabledBasicLaunch" };
  }

  async hasAdblock(): Promise<boolean> {
    return false;
  }

  async save(key: string, value: unknown): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode — the run just won't survive a reload */
    }
  }

  async load<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null; // private mode / corrupt JSON — start fresh
    }
  }
}

/**
 * Lazy, not `export const platform = new LocalPlatform()`.
 *
 * The old module built its singleton at import time, which on a Next route
 * means during SSR of the client component. Nothing in here would actually
 * throw there, but a module-scope side effect in a file the server touches is
 * the kind of thing that only stays harmless until someone adds a line to it.
 */
let instance: Platform | null = null;

export function getPlatform(): Platform {
  instance ??= new LocalPlatform();
  return instance;
}
