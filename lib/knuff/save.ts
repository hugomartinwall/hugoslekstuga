/**
 * What the game keeps on the device: the five keys of the spec (§11), and
 * the only file in the game that touches storage.
 *
 *   hugoslekstuga:knuff:save    localStorage    { v: 1, best, bestClock, bestShot, runs, mornings }
 *   hugoslekstuga:knuff:muted   localStorage    "1" or "0"
 *   hugoslekstuga:knuff:motion  localStorage    "auto", "on" or "off" (reduced motion: system, reduced, full)
 *   hugoslekstuga:knuff:pull    localStorage    "back" or "push"
 *   hugoslekstuga:knuff:run     sessionStorage  { v: 1, tune, state }: a night that was paused or left
 *
 * The two storages are handed in (`createStore(local, session)`), so the
 * save suite can hand in a memory one and one that throws; game.ts hands
 * in the browser's, found by `browserStorages()`. Every read and every
 * write is in a try/catch. Storage that is blocked (a private window, a
 * frame without its own, a full quota) is tolerated in silence: the game
 * plays from memory, and nothing says so.
 *
 * Nothing here runs when the module is loaded.
 */
import { hashState } from "./sim/state";
import type { State, Tune } from "./sim/types";
import type { MotionPref } from "./render/motion";

/** The five keys, all under the site's namespace. */
export const KEY = {
  save: "hugoslekstuga:knuff:save",
  muted: "hugoslekstuga:knuff:muted",
  motion: "hugoslekstuga:knuff:motion",
  pull: "hugoslekstuga:knuff:pull",
  run: "hugoslekstuga:knuff:run",
} as const;

/** What a storage must answer. The browser's does; so do the suite's stand-ins. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The long-lived record of the visitor's nights. */
export type Save = {
  v: 1;
  /** The best score. */
  best: number;
  /** The furthest a night has got: 0 to 10 for the hour he fell in, 11 for the boss, 12 for morning. */
  bestClock: number;
  /** The largest total from one launch. */
  bestShot: number;
  /** Nights begun, counted at the first launch. */
  runs: number;
  /** Nights that reached MORNING. */
  mornings: number;
};

export const NO_SAVE: Save = { v: 1, best: 0, bestClock: 0, bestShot: 0, runs: 0, mornings: 0 };

/** The clock of a night that reached morning (and the top of `bestClock`). */
export const MORNING_CLOCK = 12;

/**
 * The version of a stored run. A run of any other version is thrown away
 * unread. Raise it whenever the State changes its shape, so a night
 * written by an older build is never loaded into a newer one.
 */
export const RUN_V = 1;

/** How a night ended, for the save: its score, how far it got, its best shot, and whether it was a morning. */
export type NightResult = { score: number; clock: number; bestShot: number; morning: boolean };

export type Store = {
  /** The record, never null: an empty one when nothing is stored or it cannot be read. */
  readSave(): Save;
  /** A night has begun (its first launch): one more run, written at once. */
  nightBegan(): Save;
  /**
   * A night has ended: the record raised by it, written at once, and
   * whether its score beat the best stored before it.
   */
  nightEnded(night: NightResult): { save: Save; newBest: boolean };
  readMuted(): boolean;
  writeMuted(muted: boolean): void;
  readMotion(): MotionPref;
  writeMotion(pref: MotionPref): void;
  readPull(): "back" | "push";
  writePull(dir: "back" | "push"): void;
  /**
   * The night kept for this browser session, or null. It is read and left
   * in place. A run of another version, of another tune, or that does not
   * hold a night in progress is thrown away unread and its key deleted.
   */
  readRun(tune: Tune): State | null;
  /** Keep this night for the browser session: a night in progress that was paused or left. */
  writeRun(tune: Tune, state: State): void;
  deleteRun(): void;
};

/**
 * The fingerprint of the rules a night was played under. The pull's
 * direction is left out: it is a setting the pause panel changes, not a
 * rule, and changing it must not cost the night that waits.
 */
export function tuneFingerprint(tune: Tune): string {
  const rules: Record<string, unknown> = { ...tune };
  delete rules.pullDir;
  // hashState walks any plain data; the tune is plain data too.
  return hashState(rules as unknown as State);
}

/** The browser's two storages, or null for one that cannot be reached (reaching it can throw, in a frame or a private window). */
export function browserStorages(): { local: StorageLike | null; session: StorageLike | null } {
  const reach = (pick: () => Storage): StorageLike | null => {
    try {
      return pick() ?? null;
    } catch {
      return null;
    }
  };
  return { local: reach(() => window.localStorage), session: reach(() => window.sessionStorage) };
}

/** A whole number, 0 or more; anything else is 0. */
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** A stored record, read field by field: what cannot be read is 0. A record of another version is none. */
function parseSave(raw: string | null): Save {
  if (raw === null) return { ...NO_SAVE };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ...NO_SAVE };
  }
  if (o === null || typeof o !== "object" || (o as { v?: unknown }).v !== 1) return { ...NO_SAVE };
  const r = o as Record<string, unknown>;
  return {
    v: 1,
    best: count(r.best),
    bestClock: Math.min(MORNING_CLOCK, count(r.bestClock)),
    bestShot: count(r.bestShot),
    runs: count(r.runs),
    mornings: count(r.mornings),
  };
}

/** Every field is a best or a count, so two records meet in the larger of each. */
function larger(a: Save, b: Save): Save {
  return {
    v: 1,
    best: Math.max(a.best, b.best),
    bestClock: Math.max(a.bestClock, b.bestClock),
    bestShot: Math.max(a.bestShot, b.bestShot),
    runs: Math.max(a.runs, b.runs),
    mornings: Math.max(a.mornings, b.mornings),
  };
}

/** Is this, read back from a stored run, a night in progress that can be played on? */
function nightInProgress(s: unknown): s is State {
  if (s === null || typeof s !== "object") return false;
  const st = s as Partial<State>;
  return (
    st.v === 1 &&
    (st.phase === "night" || st.phase === "boss") &&
    typeof st.tick === "number" &&
    Array.isArray(st.things) &&
    Array.isArray(st.plates) &&
    st.him !== null &&
    typeof st.him === "object" &&
    st.night !== null &&
    typeof st.night === "object"
  );
}

export function createStore(local: StorageLike | null, session: StorageLike | null): Store {
  // What has been written, kept here as well: where storage is blocked
  // the game plays from these, and says nothing about it.
  let mem: Save = { ...NO_SAVE };
  let memMuted: boolean | null = null;
  let memMotion: MotionPref | null = null;
  let memPull: "back" | "push" | null = null;

  const get = (store: StorageLike | null, key: string): string | null => {
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  };
  const set = (store: StorageLike | null, key: string, value: string): void => {
    if (!store) return;
    try {
      store.setItem(key, value);
    } catch {
      /* blocked, or full: the game plays on from memory */
    }
  };
  const remove = (store: StorageLike | null, key: string): void => {
    if (!store) return;
    try {
      store.removeItem(key);
    } catch {
      /* blocked: there is nothing it could have kept */
    }
  };

  const readSave = (): Save => {
    // Another tab may have played since this one read it: take the larger of each.
    mem = larger(mem, parseSave(get(local, KEY.save)));
    return { ...mem };
  };
  const writeSave = (next: Save): Save => {
    mem = { ...next };
    set(local, KEY.save, JSON.stringify(mem));
    return { ...mem };
  };

  return {
    readSave,
    nightBegan() {
      const s = readSave();
      return writeSave({ ...s, runs: s.runs + 1 });
    },
    nightEnded(night) {
      const s = readSave();
      const score = count(night.score);
      const newBest = score > s.best;
      const save = writeSave({
        v: 1,
        best: Math.max(s.best, score),
        bestClock: Math.max(s.bestClock, Math.min(MORNING_CLOCK, count(night.clock))),
        bestShot: Math.max(s.bestShot, count(night.bestShot)),
        runs: s.runs,
        mornings: s.mornings + (night.morning ? 1 : 0),
      });
      return { save, newBest };
    },

    readMuted() {
      const raw = get(local, KEY.muted);
      if (raw === "1" || raw === "0") return raw === "1";
      return memMuted ?? false;
    },
    writeMuted(muted) {
      memMuted = muted;
      set(local, KEY.muted, muted ? "1" : "0");
    },
    readMotion() {
      const raw = get(local, KEY.motion);
      if (raw === "auto" || raw === "on" || raw === "off") return raw;
      return memMotion ?? "auto";
    },
    writeMotion(pref) {
      memMotion = pref;
      set(local, KEY.motion, pref);
    },
    readPull() {
      const raw = get(local, KEY.pull);
      if (raw === "back" || raw === "push") return raw;
      return memPull ?? "back";
    },
    writePull(dir) {
      memPull = dir;
      set(local, KEY.pull, dir);
    },

    readRun(tune) {
      const raw = get(session, KEY.run);
      if (raw === null) return null;
      let o: unknown;
      try {
        o = JSON.parse(raw);
      } catch {
        remove(session, KEY.run);
        return null;
      }
      const run = o as { v?: unknown; tune?: unknown; state?: unknown } | null;
      // Another version, or another tune: thrown away unread.
      if (run === null || typeof run !== "object" || run.v !== RUN_V || run.tune !== tuneFingerprint(tune) || !nightInProgress(run.state)) {
        remove(session, KEY.run);
        return null;
      }
      return run.state;
    },
    writeRun(tune, state) {
      let json: string;
      try {
        json = JSON.stringify({ v: RUN_V, tune: tuneFingerprint(tune), state });
      } catch {
        return;
      }
      set(session, KEY.run, json);
    },
    deleteRun() {
      remove(session, KEY.run);
    },
  };
}
