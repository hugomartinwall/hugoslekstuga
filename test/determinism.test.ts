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

  it("production accrues over time (sim actually advances)", () => {
    const state = createLevel(1);
    const before = state.nodes.find((n) => n.owner === 1)!.units;
    for (let i = 0; i < 300; i++) tick(state, []);
    expect(state.nodes.find((n) => n.owner === 1)!.units).toBeGreaterThan(before);
  });
});
