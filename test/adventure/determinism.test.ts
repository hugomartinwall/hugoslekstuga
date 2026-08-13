import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enterWorld,
  emptyIntent,
  hashState,
  type GameState,
} from "../../lib/adventure/sim/state";
import { tick } from "../../lib/adventure/sim/tick";
import { WORLDS } from "../../lib/adventure/content/worlds";

/** A scripted, deterministic intent stream — no Math.random in tests either. */
function scriptedIntent(t: number) {
  const intent = emptyIntent();
  intent.mx = Math.sin(t / 40);
  intent.my = Math.cos(t / 55);
  intent.attack = t % 30 === 0;
  intent.attackHeld = t % 30 < 8;
  intent.dodge = t % 90 === 0;
  intent.dagger = t % 45 === 0;
  return intent;
}

function run(seed: number, world: number, ticks: number): GameState {
  const cp = {
    maxHp: 8,
    hp: 8,
    coins: 100,
    gear: ["roll", "dagger", "heart1"],
    flasks: 0,
  };
  const state = enterWorld(cp, world, seed);
  for (let t = 0; t < ticks; t++) {
    tick(state, scriptedIntent(t));
    if (state.playerDied) break;
  }
  return state;
}

describe("determinism", () => {
  it("same seed + same intents ⇒ identical hash at 600 and 3600 ticks", () => {
    for (const ticks of [600, 3600]) {
      const a = run(1234, 1, ticks);
      const b = run(1234, 1, ticks);
      expect(hashState(a)).toBe(hashState(b));
      expect(a.tick).toBe(b.tick);
      expect(a.player.coins).toBe(b.player.coins);
    }
  });

  it("different seeds diverge", () => {
    const a = run(1, 2, 600);
    const b = run(2, 2, 600);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("every world simulates 1200 ticks without crashing", () => {
    for (const w of WORLDS) {
      const state = run(99, w.id, 1200);
      expect(state.tick).toBeGreaterThan(0);
    }
  });

  it("sim and content modules never touch Math.random or the DOM", () => {
    const roots = ["lib/adventure/sim", "lib/adventure/content"];
    for (const root of roots) {
      for (const file of readdirSync(root)) {
        const src = readFileSync(join(root, file), "utf8");
        expect(src, `${root}/${file} uses Math.random`).not.toMatch(/Math\.random/);
        expect(src, `${root}/${file} touches window`).not.toMatch(/\bwindow\./);
        expect(src, `${root}/${file} touches document`).not.toMatch(/\bdocument\./);
        expect(src, `${root}/${file} touches localStorage`).not.toMatch(/localStorage/);
      }
    }
  });
});
