import { describe, expect, it } from "vitest";
import {
  applyDeath,
  applyWorldClear,
  buyUpgrade,
  migrateSave,
  newSave,
  priceOf,
  shopDiscount,
  shopInventory,
} from "../../lib/adventure/app/run";

describe("save migration", () => {
  it("garbage in, fresh save out", () => {
    for (const raw of [null, undefined, 42, "junk", [], { v: 99 }, { v: 1, world: "x" }]) {
      const save = migrateSave(raw, 7);
      expect(save.v).toBe(1);
      expect(save.world).toBeGreaterThanOrEqual(1);
      expect(save.checkpoint.maxHp).toBe(6);
    }
  });

  it("valid saves round-trip; unknown gear is dropped; world clamps", () => {
    const save = newSave(5);
    save.world = 99 as number;
    save.checkpoint.gear = ["roll", "hax", "dmg1"];
    const migrated = migrateSave(JSON.parse(JSON.stringify(save)), 5);
    expect(migrated.world).toBe(10);
    expect(migrated.checkpoint.gear).toEqual(["roll", "dmg1"]);
  });

  it("hp clamps to derived maxHp", () => {
    const save = newSave(1);
    save.checkpoint.hp = 999;
    const migrated = migrateSave(JSON.parse(JSON.stringify(save)), 1);
    expect(migrated.checkpoint.hp).toBe(migrated.checkpoint.maxHp);
  });
});

describe("checkpoint flow", () => {
  it("world clear banks a full-hearts checkpoint and advances", () => {
    const save = newSave(1);
    applyWorldClear(save, { maxHp: 8, hp: 3, coins: 55, gear: ["roll"], flasks: 0 }, 1234);
    expect(save.world).toBe(2);
    expect(save.worldsCleared).toBe(1);
    expect(save.checkpoint.hp).toBe(8); // full hearts at the door
    expect(save.checkpoint.coins).toBe(55);
    expect(save.bestTicks[0]).toBe(1234);
    expect(save.deathsThisWorld).toBe(0);
  });

  it("clearing world 10 wins instead of advancing", () => {
    const save = newSave(1);
    save.world = 10;
    applyWorldClear(save, save.checkpoint, 1);
    expect(save.won).toBe(true);
    expect(save.world).toBe(10);
  });

  it("the pity valve opens at two deaths and resets on clear", () => {
    const save = newSave(1);
    expect(shopDiscount(save)).toBe(1);
    applyDeath(save);
    expect(shopDiscount(save)).toBe(1);
    applyDeath(save);
    expect(shopDiscount(save)).toBe(0.9);
    expect(priceOf("roll", save)).toBe(36);
    applyWorldClear(save, save.checkpoint, 1);
    expect(shopDiscount(save)).toBe(1);
  });
});

describe("shop", () => {
  it("inventory excludes owned SKUs and each buys exactly once", () => {
    const save = newSave(1);
    expect(shopInventory(1, [])).toContain("roll");
    const bag = { coins: 100, gear: [] as string[] };
    expect(buyUpgrade(bag, "roll", save).ok).toBe(true);
    expect(bag.coins).toBe(60);
    expect(buyUpgrade(bag, "roll", save)).toEqual({ ok: false, reason: "owned" });
    expect(shopInventory(1, bag.gear)).not.toContain("roll");
  });

  it("refuses politely when broke", () => {
    const save = newSave(1);
    const bag = { coins: 3, gear: [] as string[] };
    expect(buyUpgrade(bag, "roll", save)).toEqual({ ok: false, reason: "coins" });
    expect(bag.coins).toBe(3);
  });
});
