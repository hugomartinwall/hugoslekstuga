import { describe, expect, it } from "vitest";
import { BOSS_DEFS } from "../../lib/adventure/content/bosses";
import {
  expectedDps,
  heroStats,
  DPS_MODEL,
  UPGRADES,
} from "../../lib/adventure/content/upgrades";
import { WORLDS } from "../../lib/adventure/content/worlds";

/**
 * Time-to-kill bounds — computed from the shared DPS-model table, not
 * magic numbers. Every boss must fall inside the fun window at on-pace
 * gear, and stay finishable (if grim) for a stubborn no-stats run.
 */

function verbsOnlyDps(world: number): number {
  const verbs = UPGRADES.filter((u) => u.kind === "verb" && u.world <= world).map((u) => u.id);
  const stats = heroStats(verbs);
  let dps = stats.dmg * DPS_MODEL.swingsPerSec * DPS_MODEL.uptime;
  if (stats.has("dagger")) dps += DPS_MODEL.daggerBonus;
  if (stats.has("parry")) dps += DPS_MODEL.parryBonus;
  if (stats.has("beam")) dps += DPS_MODEL.beamBonus;
  return dps;
}

describe("boss time-to-kill", () => {
  for (const w of WORLDS) {
    const def = BOSS_DEFS[w.boss];
    it(`${w.bossName} (world ${w.id}) dies in 45–120s at expected gear`, () => {
      const ttk = def.hp / expectedDps(w.id);
      expect(ttk, `ttk ${ttk.toFixed(0)}s`).toBeGreaterThanOrEqual(45);
      expect(ttk, `ttk ${ttk.toFixed(0)}s`).toBeLessThanOrEqual(120);
    });
    it(`${w.bossName} stays finishable on a verbs-only run`, () => {
      const ttk = def.hp / verbsOnlyDps(w.id);
      expect(ttk).toBeLessThanOrEqual(w.id === 10 ? 240 : 180);
    });
  }

  it("boss hp rises monotonically", () => {
    for (let i = 1; i < WORLDS.length; i++) {
      expect(BOSS_DEFS[WORLDS[i].boss].hp).toBeGreaterThan(BOSS_DEFS[WORLDS[i - 1].boss].hp);
    }
  });

  it("only the finale has three phases", () => {
    for (const w of WORLDS) {
      expect(BOSS_DEFS[w.boss].phases).toBe(w.id === 10 ? 3 : 2);
    }
  });
});
