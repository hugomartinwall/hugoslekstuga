import type { AdventureSave } from "./app/run";

/**
 * Persistence for Adventure — plain namespaced localStorage, synchronous.
 * Deliberately shape-blind: whatever is on disk goes straight to
 * migrateSave() in app/run.ts, which owns the schema.
 */

const SAVE_KEY = "hugoslekstuga:adventure:save";

/** Raw parsed save blob, shape-unchecked — feed it to migrateSave(). */
export function loadRaw(): unknown {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null; // private mode / corrupt JSON — start fresh
  }
}

export function persistSave(save: AdventureSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* private mode — the adventure just won't survive a reload */
  }
}
