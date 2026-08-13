import { describe, expect, it } from "vitest";
import { hashState, rngNext } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { createLevel } from "../lib/overrun/sim/level";
import type { Command } from "../lib/overrun/sim/commands";

/**
 * Full-system determinism: level 7 has AI, flows, packets, and combat all
 * active; a scripted player keeps commands flowing. Same seed + same commands
 * ⇒ identical hash — the guarantee the 144 Hz requirement and future replay
 * feature both rest on.
 */
function run(level: number, ticks: number): number {
  const state = createLevel(level);
  const nodeCount = state.nodes.length;
  for (let i = 0; i < ticks; i++) {
    const commands: Command[] = [];
    if (i % 47 === 0) commands.push({ type: "selectNode", nodeId: i % nodeCount });
    if (i % 90 === 30) commands.push({ type: "sendUnits", from: 0, to: (i / 7) % nodeCount | 0 });
    if (i % 113 === 0) commands.push({ type: "deselect" });
    if (i % 31 === 0) rngNext(state.rng); // interleaved draws must not desync anything
    tick(state, commands);
  }
  return hashState(state);
}

describe("simulation determinism", () => {
  it("same level + same commands ⇒ identical state after 10k ticks", () => {
    expect(run(7, 10_000)).toBe(run(7, 10_000));
  });

  it("different level ⇒ different state (hash discriminates)", () => {
    expect(run(7, 1_000)).not.toBe(run(8, 1_000));
  });

  it("boss levels are deterministic too — every kind, every new tier", () => {
    /**
     * L7 alone is tier 2, three factions, and only the three original kinds.
     * Phase 3A.3 added a pass to the tick pipeline (siphonDrain), a mutation
     * inside the arrivals loop (the volatile blast), a neutral that grows
     * (nursery), and tiers 5–7 with new branches — none of which L7 exercises.
     *
     * One case per boss level, so each debuting kind is actually stepped.
     * L50 and L56 matter most of the eight: the corrupter is the only thing in
     * the game that MUTATES a packet after spawn, and hashState covers packet
     * owners, so a non-deterministic steal would surface here and nowhere else.
     */
    for (const level of [14, 20, 26, 32, 38, 44, 50, 56]) {
      expect(run(level, 4_000), `L${level}`).toBe(run(level, 4_000));
    }
  });

  it("a volatile blast never drives a node below zero units", () => {
    // The blast subtracts from every node in radius; unlike combat it is not
    // gated on units > 0. A negative unit count would not crash — it would
    // quietly corrupt production, the AI's cost model and the hash.
    for (const level of [20, 26, 44]) {
      const state = createLevel(level);
      for (let i = 0; i < 6_000; i++) {
        tick(state, i % 90 === 30 ? [{ type: "sendUnits", from: 0, to: i % state.nodes.length }] : []);
        for (const n of state.nodes) {
          if (n.units < 0) throw new Error(`L${level} node ${n.id} went negative at tick ${i}`);
        }
      }
      expect(state.nodes.every((n) => n.units >= 0)).toBe(true);
    }
  });

  it("production accrues over time (sim actually advances)", () => {
    const state = createLevel(1);
    const before = state.nodes.find((n) => n.owner === 1)!.units;
    for (let i = 0; i < 300; i++) tick(state, []);
    expect(state.nodes.find((n) => n.owner === 1)!.units).toBeGreaterThan(before);
  });
});
