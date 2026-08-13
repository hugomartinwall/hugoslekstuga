import { describe, expect, it } from "vitest";
import { ARCH_INTRO_WORLD, ENEMY_KINDS } from "../../lib/adventure/content/enemies";
import { UPGRADES } from "../../lib/adventure/content/upgrades";
import { WORLDS } from "../../lib/adventure/content/worlds";
import {
  DODGE_IFRAME_END,
  DODGE_IFRAME_START,
  HURT_IFRAMES,
  SWING_ACTIVE,
  SWING_RECOVER,
  SWING_WINDUP,
} from "../../lib/adventure/sim/tick";

/**
 * The fairness grammar as invariants: telegraph floors, i-frame windows,
 * and the intro schedule (nothing appears before its teaching world;
 * nothing shielded appears before a shield-breaker is purchasable).
 */

describe("telegraph floors", () => {
  it("floors ease from 28 down to 18 ticks and never below 300ms-equivalent", () => {
    let prev = Infinity;
    for (const w of WORLDS) {
      expect(w.telegraphFloor).toBeGreaterThanOrEqual(18); // 300ms at 60Hz
      expect(w.telegraphFloor).toBeLessThanOrEqual(prev);
      prev = w.telegraphFloor;
    }
    expect(WORLDS[0].telegraphFloor).toBe(28);
  });

  it("hero frame data holds its contract", () => {
    expect(HURT_IFRAMES).toBeGreaterThanOrEqual(45);
    expect(DODGE_IFRAME_END - DODGE_IFRAME_START + 1).toBe(10); // 10 i-frame ticks
    expect(SWING_WINDUP + SWING_ACTIVE + SWING_RECOVER).toBeLessThanOrEqual(16); // swing ≤ 267ms
  });
});

describe("intro schedule", () => {
  it("no archetype appears in a world before its intro world", () => {
    for (const w of WORLDS) {
      for (const room of w.rooms) {
        if (!room.spawns) continue;
        for (const kind of Object.values(room.spawns)) {
          const arch = ENEMY_KINDS[kind].arch;
          expect(
            w.id,
            `${kind} (${arch}) appears in world ${w.id}, intro is ${ARCH_INTRO_WORLD[arch]}`,
          ).toBeGreaterThanOrEqual(ARCH_INTRO_WORLD[arch]);
        }
      }
    }
  });

  it("shielded enemies never appear before a shield-breaker is purchasable", () => {
    const breakerWorld = Math.min(
      ...UPGRADES.filter((u) => ["charge", "bomb"].includes(u.id)).map((u) => u.world),
    );
    for (const w of WORLDS) {
      for (const room of w.rooms) {
        if (!room.spawns) continue;
        for (const kind of Object.values(room.spawns)) {
          if (ENEMY_KINDS[kind].arch === "shielded") {
            expect(w.id, `${kind} in world ${w.id}`).toBeGreaterThan(breakerWorld);
          }
        }
      }
    }
  });

  it("dark-phasing enemies only appear where the lantern mechanic exists", () => {
    for (const w of WORLDS) {
      for (const room of w.rooms) {
        if (!room.spawns) continue;
        for (const kind of Object.values(room.spawns)) {
          if (ENEMY_KINDS[kind].flags?.includes("phasedark")) {
            const mech = room.mechanic ?? w.mechanic;
            expect(mech, `${kind} in world ${w.id} room ${w.rooms.indexOf(room)}`).toBe("dark");
          }
        }
      }
    }
  });
});
