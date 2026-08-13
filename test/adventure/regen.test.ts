import { describe, expect, it } from "vitest";
import { emptyIntent, enterWorld, type GameState } from "../../lib/adventure/sim/state";
import { REGEN_EVERY, REGEN_GRACE, tick } from "../../lib/adventure/sim/tick";
import { T, TILE, ROOM_W } from "../../lib/adventure/sim/rooms";

/**
 * Out-of-combat regen: hearts trickle back after the grace window, the
 * clock resets on any hp loss, and the bog never regens anybody.
 */

const cp = { maxHp: 6, hp: 6, coins: 0, gear: [], flasks: 0 };

/** A quiet state: world 1 room 0 with every enemy removed. */
function quietState(): GameState {
  const state = enterWorld(cp, 1, 42);
  state.room.entities.length = 0;
  state.room.cleared = true;
  return state;
}

function hurt(state: GameState, dmg: number): void {
  state.player.hp -= dmg;
  state.player.lastHurtAt = state.tick;
}

function idle(state: GameState, ticks: number): void {
  const intent = emptyIntent();
  for (let i = 0; i < ticks; i++) tick(state, intent);
}

describe("regen", () => {
  it("restores half a heart per interval after the grace window", () => {
    const state = quietState();
    idle(state, 10);
    hurt(state, 4); // 6 → 2
    idle(state, REGEN_GRACE - 1);
    expect(state.player.hp).toBe(2); // still in grace
    idle(state, 2);
    expect(state.player.hp).toBe(3); // first beat lands at the grace edge
    idle(state, REGEN_EVERY * 3);
    expect(state.player.hp).toBe(6); // full again
    idle(state, REGEN_EVERY * 2);
    expect(state.player.hp).toBe(6); // never over max
  });

  it("a fresh hit resets the clock", () => {
    const state = quietState();
    idle(state, 10);
    hurt(state, 2);
    idle(state, REGEN_GRACE - 10); // almost healed the grace off
    hurt(state, 2);
    idle(state, REGEN_GRACE - 10);
    expect(state.player.hp).toBe(2); // no beat has landed since the re-hit
  });

  it("the bog blocks regen", () => {
    const state = quietState();
    // Turn the tile under the player into bog and park there.
    const p = state.player;
    const idx = Math.floor(p.y / TILE) * ROOM_W + Math.floor(p.x / TILE);
    state.room.tiles[idx] = T.BOG;
    hurt(state, 1);
    const before = state.player.hp;
    idle(state, REGEN_GRACE + REGEN_EVERY * 4);
    // The bog drains rather than heals — hp must not have gone UP.
    expect(state.player.hp).toBeLessThanOrEqual(before);
  });
});
