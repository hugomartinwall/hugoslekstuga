import { describe, expect, it } from "vitest";
import type { GameState } from "../lib/overrun/sim/state";
import { tick, TICK_HZ, dist } from "../lib/overrun/sim/tick";
import { createLevel } from "../lib/overrun/sim/level";
import type { Command } from "../lib/overrun/sim/commands";

/**
 * Balance bots — the cheap insurance CLAUDE.md §10 asks for. These encode the
 * Basic Launch funnel as assertions: if a tuning tweak makes level 1 hostile
 * to a beginner or the AI toothless at level 10, CI screams before players do.
 */

/** Greedy scripted player: every 2 s, strongest node attacks the weakest capturable target. */
function greedyCommands(state: GameState, tickNo: number): Command[] {
  if (tickNo % 60 !== 0) return [];
  let src = null;
  for (const n of state.nodes) {
    if (n.owner !== 1) continue;
    if (state.flows.some((f) => f.from === n.id)) continue;
    if (!src || n.units > src.units) src = n;
  }
  if (!src || src.units < 3) return [];
  let target = null;
  let best = Infinity;
  for (const n of state.nodes) {
    if (n.owner === 1) continue;
    const cost = n.units + dist(src, n) / 8;
    if (cost < best && src.units > n.units + 2) {
      best = cost;
      target = n;
    }
  }
  return target ? [{ type: "sendUnits", from: src.id, to: target.id }] : [];
}

function playGreedy(level: number, maxSeconds: number): { status: string; seconds: number } {
  const state = createLevel(level);
  const maxTicks = maxSeconds * TICK_HZ;
  let i = 0;
  for (; i < maxTicks && state.status === "playing"; i++) tick(state, greedyCommands(state, i));
  return { status: state.status, seconds: i / TICK_HZ };
}

function playIdle(level: number, maxSeconds: number): { status: string; seconds: number } {
  const state = createLevel(level);
  const maxTicks = maxSeconds * TICK_HZ;
  let i = 0;
  for (; i < maxTicks && state.status === "playing"; i++) tick(state, []);
  return { status: state.status, seconds: i / TICK_HZ };
}

describe("balance: the onboarding funnel as unit tests", () => {
  it("greedy player wins level 1 within 90 s", () => {
    const r = playGreedy(1, 90);
    expect(r.status).toBe("won");
  });

  it("greedy player wins levels 2–3 within 3 min", () => {
    for (const lvl of [2, 3]) {
      const r = playGreedy(lvl, 180);
      expect(r.status, `level ${lvl}`).toBe("won");
    }
  });

  it("do-nothing player survives at least 60 s on level 1 (conversion bar)", () => {
    const r = playIdle(1, 60);
    expect(r.status).toBe("playing");
  });

  it("do-nothing player loses level 10 within 5 min (AI actually threatens)", () => {
    const r = playIdle(10, 300);
    expect(r.status).toBe("lost");
  });

  it("difficulty is roughly monotonic: greedy bot struggles more at 20 than at 5", () => {
    // The greedy bot is crude, so compare survival time when losing / win speed.
    const easy = playGreedy(5, 300);
    const hard = playGreedy(20, 300);
    const score = (r: { status: string; seconds: number }) =>
      r.status === "won" ? 1000 - r.seconds : r.seconds;
    expect(score(hard)).toBeLessThanOrEqual(score(easy));
  });
});
