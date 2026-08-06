import type { SaveV3 } from "./app/run";

/**
 * Persistence for Overrun — plain namespaced localStorage, synchronous.
 * (The game was born on a platform with a cloud-save SDK; here the whole
 * "platform" is these two functions.)
 *
 * The schema is v3; older v1/v2 blobs written before the engine re-sync are
 * upgraded by migrateSave() in app/run.ts, so never validate the shape here
 * — hand whatever's on disk straight to it.
 */

const SAVE_KEY = "hugoslekstuga:overrun:save";

/** Raw parsed save blob, shape-unchecked — feed it to migrateSave(). */
export function loadRaw(): unknown {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null; // private mode / corrupt JSON — start fresh
  }
}

export function persistSave(save: SaveV3): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* private mode — the run just won't survive a reload */
  }
}
