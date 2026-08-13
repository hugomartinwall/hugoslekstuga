import { heroStats, UPGRADES, upgradeById } from "../content/upgrades";
import { FINAL_WORLD } from "../content/worlds";
import type { CheckpointData } from "../sim/state";

/**
 * The save schema and everything that mutates it — pure, node-testable.
 * Persistence itself is save.ts's two dumb functions; ALL shape knowledge
 * lives here.
 *
 * Checkpoint semantics: the checkpoint is the world-entry snapshot.
 * Death restores it wholesale — hp, coins, gear all revert, so mid-world
 * purchases and farmed coins are lost with the attempt. Persist points
 * are world entry, boss clear, and the win; the run inside a world is
 * deliberately ephemeral (a reload = a world restart, same as death).
 */

export type AdventureSave = {
  v: 1;
  world: number; // current world, 1..10
  worldsCleared: number; // highest cleared, 0..10
  won: boolean;
  seed: number; // run seed — a retry is an identical-odds attempt
  checkpoint: CheckpointData;
  deaths: number;
  deathsThisWorld: number;
  bestTicks: (number | null)[]; // per-world clear times
  purchases: string[]; // lifetime receipt (the credits scroll)
};

export function newSave(seed: number): AdventureSave {
  return {
    v: 1,
    world: 1,
    worldsCleared: 0,
    won: false,
    seed: seed >>> 0,
    checkpoint: { maxHp: 6, hp: 6, coins: 0, gear: [], flasks: 0 },
    deaths: 0,
    deathsThisWorld: 0,
    bestTicks: Array.from({ length: FINAL_WORLD }, () => null),
    purchases: [],
  };
}

const KNOWN_GEAR = new Set(UPGRADES.map((u) => u.id));

/** Normalize whatever was on disk into a valid v1 save. */
export function migrateSave(raw: unknown, fallbackSeed = 1): AdventureSave {
  const fresh = newSave(fallbackSeed);
  if (!raw || typeof raw !== "object") return fresh;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return fresh;

  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const gearIn = Array.isArray(r.checkpoint && (r.checkpoint as Record<string, unknown>).gear)
    ? ((r.checkpoint as Record<string, unknown>).gear as unknown[])
    : [];
  const gear = gearIn.filter((g): g is string => typeof g === "string" && KNOWN_GEAR.has(g));
  const stats = heroStats(gear);
  const cpIn = (r.checkpoint ?? {}) as Record<string, unknown>;

  const save: AdventureSave = {
    v: 1,
    world: Math.max(1, Math.min(FINAL_WORLD, Math.round(num(r.world, 1)))),
    worldsCleared: Math.max(0, Math.min(FINAL_WORLD, Math.round(num(r.worldsCleared, 0)))),
    won: r.won === true,
    seed: num(r.seed, fallbackSeed) >>> 0,
    checkpoint: {
      maxHp: stats.maxHp,
      hp: Math.max(1, Math.min(stats.maxHp, Math.round(num(cpIn.hp, stats.maxHp)))),
      coins: Math.max(0, Math.round(num(cpIn.coins, 0))),
      gear,
      flasks: Math.max(0, Math.min(stats.flaskMax, Math.round(num(cpIn.flasks, 0)))),
    },
    deaths: Math.max(0, Math.round(num(r.deaths, 0))),
    deathsThisWorld: Math.max(0, Math.round(num(r.deathsThisWorld, 0))),
    bestTicks: Array.from({ length: FINAL_WORLD }, (_, i) => {
      const arr = Array.isArray(r.bestTicks) ? r.bestTicks : [];
      const v = arr[i];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    }),
    purchases: Array.isArray(r.purchases)
      ? r.purchases.filter((p): p is string => typeof p === "string" && KNOWN_GEAR.has(p))
      : [],
  };
  return save;
}

/** Boss down: bank the post-clear snapshot as world N+1's checkpoint. */
export function applyWorldClear(
  save: AdventureSave,
  cp: CheckpointData,
  clearTicks: number,
): AdventureSave {
  const idx = save.world - 1;
  const best = save.bestTicks[idx];
  save.bestTicks[idx] = best === null ? clearTicks : Math.min(best, clearTicks);
  save.worldsCleared = Math.max(save.worldsCleared, save.world);
  if (save.world >= FINAL_WORLD) {
    save.won = true;
  } else {
    save.world += 1;
    // Enter the next world with full hearts — the checkpoint is a fresh start.
    save.checkpoint = { ...cp, gear: [...cp.gear], hp: cp.maxHp };
  }
  save.deathsThisWorld = 0;
  return save;
}

export function applyDeath(save: AdventureSave): AdventureSave {
  save.deaths += 1;
  save.deathsThisWorld += 1;
  return save;
}

/** The pity valve: two deaths in a world → 10% off that world's shop. */
export function shopDiscount(save: AdventureSave): number {
  return save.deathsThisWorld >= 2 ? 0.9 : 1;
}

export function priceOf(id: string, save: AdventureSave): number {
  const u = upgradeById(id);
  if (!u) return Infinity;
  return Math.max(1, Math.round(u.price * shopDiscount(save)));
}

/** What this world's shop has left to sell (each SKU sold once). */
export function shopInventory(world: number, gear: readonly string[]): string[] {
  const owned = new Set(gear);
  return UPGRADES.filter((u) => u.world === world && !owned.has(u.id)).map((u) => u.id);
}

export type BuyResult = { ok: boolean; reason?: "owned" | "coins" | "unknown" };

/**
 * Buy into a live checkpoint-shaped bag (the game applies this to the
 * running player, then mirrors coins/gear back into the sim).
 */
export function buyUpgrade(
  bag: { coins: number; gear: string[] },
  id: string,
  save: AdventureSave,
): BuyResult {
  const u = upgradeById(id);
  if (!u) return { ok: false, reason: "unknown" };
  if (bag.gear.includes(id)) return { ok: false, reason: "owned" };
  const price = priceOf(id, save);
  if (bag.coins < price) return { ok: false, reason: "coins" };
  bag.coins -= price;
  bag.gear.push(id);
  if (!save.purchases.includes(id)) save.purchases.push(id);
  return { ok: true };
}
