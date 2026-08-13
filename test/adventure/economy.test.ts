import { describe, expect, it } from "vitest";
import { ENEMY_KINDS } from "../../lib/adventure/content/enemies";
import { LAYOUTS } from "../../lib/adventure/content/layouts";
import { UPGRADES, VERB_ORDER } from "../../lib/adventure/content/upgrades";
import { WORLDS } from "../../lib/adventure/content/worlds";

/**
 * The economy is closed by construction: an enemy's room-budget cost IS
 * its coin drop (splitters add their two 1-coin shards). This suite audits
 * solvency — a player who clears rooms always affords the marquee verb —
 * and pressure — nobody can buy out the whole game.
 */

function roomIncome(spawns: Record<string, string> | undefined): number {
  if (!spawns) return 0;
  let total = 0;
  for (const kind of Object.values(spawns)) {
    const def = ENEMY_KINDS[kind];
    total += def.coins + (def.arch === "splitter" ? 2 : 0);
  }
  return total;
}

function potCount(layout: string): number {
  return LAYOUTS[layout].join("").split("*").length - 1;
}

function worldIncome(worldId: number): number {
  const w = WORLDS[worldId - 1];
  let total = w.bossCoins;
  for (const room of w.rooms) {
    total += roomIncome(room.spawns) + potCount(room.layout);
  }
  return total;
}

function worldStock(worldId: number): number {
  return UPGRADES.filter((u) => u.world === worldId).reduce((s, u) => s + u.price, 0);
}

describe("economy solvency", () => {
  it("cumulative income covers the verb path with ≥15% slack, every world", () => {
    let cumIncome = 0;
    let cumVerbs = 0;
    for (const w of WORLDS) {
      cumIncome += worldIncome(w.id);
      const verb = UPGRADES.find((u) => u.world === w.id && u.kind === "verb")!;
      cumVerbs += verb.price;
      expect(
        cumIncome,
        `world ${w.id}: income ${cumIncome} vs verb path ${cumVerbs}`,
      ).toBeGreaterThanOrEqual(cumVerbs * 1.15);
    }
  });

  it("every world's shop stock exceeds its income (choice pressure)", () => {
    for (const w of WORLDS) {
      expect(
        worldStock(w.id),
        `world ${w.id} stock vs income ${worldIncome(w.id)}`,
      ).toBeGreaterThanOrEqual(worldIncome(w.id) * 1.05);
    }
  });

  it("lifetime stock exceeds lifetime income — you cannot buy everything", () => {
    const income = WORLDS.reduce((s, w) => s + worldIncome(w.id), 0);
    const stock = UPGRADES.reduce((s, u) => s + u.price, 0);
    expect(stock).toBeGreaterThan(income);
  });

  it("world incomes rise through world 9", () => {
    for (let i = 2; i <= 9; i++) {
      expect(
        worldIncome(i),
        `world ${i} vs ${i - 1}`,
      ).toBeGreaterThan(worldIncome(i - 1) * 0.95);
    }
  });
});

describe("upgrade catalogue integrity", () => {
  it("every SKU appears in exactly one shop and every id is unique", () => {
    const ids = UPGRADES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of UPGRADES) {
      expect(u.world).toBeGreaterThanOrEqual(1);
      expect(u.world).toBeLessThanOrEqual(10);
      expect(u.price).toBeGreaterThan(0);
    }
  });

  it("exactly one verb per world, in the canonical order", () => {
    for (let w = 1; w <= 10; w++) {
      const verbs = UPGRADES.filter((u) => u.world === w && u.kind === "verb");
      expect(verbs.length, `world ${w}`).toBe(1);
      expect(verbs[0].id).toBe(VERB_ORDER[w - 1]);
    }
  });

  it("stat tiers are sold in order (damage II never before I)", () => {
    const tierWorld = (id: string) => UPGRADES.find((u) => u.id === id)!.world;
    for (const family of [
      ["dmg1", "dmg2", "dmg3", "dmg4"],
      ["speed1", "speed2", "speed3", "speed4"],
      ["magnet1", "magnet2", "magnet3"],
      ["rollcd1", "rollcd2"],
      ["arc1", "arc2"],
      ["flask", "flask2", "flask3"],
      ["heart1", "heart2", "heart3", "heart4", "heart5"],
    ]) {
      for (let i = 1; i < family.length; i++) {
        expect(
          tierWorld(family[i]),
          `${family[i]} before ${family[i - 1]}`,
        ).toBeGreaterThan(tierWorld(family[i - 1]));
      }
    }
  });
});
