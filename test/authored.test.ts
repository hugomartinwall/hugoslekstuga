import { describe, expect, it } from "vitest";
import { AUTHORED_BOARDS, createAuthoredLevel, type AuthoredBoard } from "../lib/overrun/sim/authored";
import { hashState, NEUTRAL, PLAYER } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { buildSendCommand, type Command } from "../lib/overrun/sim/commands";

/**
 * Recorded-solution verification: stronger than screening. Each authored
 * board ships with its intended command list; the deterministic sim replays
 * it exactly, so "the budget is sufficient" and "the obvious line fails" are
 * proofs, not probabilities.
 */

const MAX_TICKS = 30 * 240; // 4 minutes — far beyond any intended solve

function replay(board: AuthoredBoard, steps: ReadonlyArray<{ atTick: number; from: number; to: number; fraction?: number }>) {
  const s = createAuthoredLevel(board);
  const byTick = new Map<number, Command[]>();
  for (const step of steps) {
    const cmds = byTick.get(step.atTick) ?? [];
    cmds.push(buildSendCommand(step.from, step.to, step.fraction ?? 1));
    byTick.set(step.atTick, cmds);
  }
  for (let t = 0; t < MAX_TICKS && s.status === "playing"; t++) {
    tick(s, byTick.get(s.tick) ?? []);
  }
  return s;
}

describe.each(AUTHORED_BOARDS.map((b) => [`L${b.level} ${b.intro}`, b] as const))(
  "%s",
  (_name, board) => {
    it("the recorded solution wins inside the send budget", () => {
      const s = replay(board, board.solution);
      expect(s.status).toBe("won");
      expect(s.sendsUsed).toBeLessThanOrEqual(board.sendBudget);
    });

    it("the obvious line — charge the target with everything — fails", () => {
      // The greedy line: repeatedly hurl the whole home garrison at the
      // nearest not-yet-owned ball as soon as anything is available. If THIS
      // wins inside the budget, the board is a fight, not a puzzle.
      const s = createAuthoredLevel(board);
      let lastSend = -60;
      for (let t = 0; t < MAX_TICKS && s.status === "playing"; t++) {
        const cmds: Command[] = [];
        if (s.tick - lastSend >= 60 && s.sendsUsed < board.sendBudget) {
          const sources = s.nodes.filter(
            (n) => n.owner === PLAYER && n.units >= 3 && !s.flows.some((f) => f.from === n.id),
          );
          const src = sources.reduce((a, b) => (b && b.units > (a?.units ?? -1) ? b : a), sources[0]);
          if (src) {
            let best = null as { id: number; d: number } | null;
            for (const n of s.nodes) {
              if (n.owner === PLAYER) continue;
              const d = Math.hypot(n.x - src.x, n.y - src.y);
              if (!best || d < best.d) best = { id: n.id, d };
            }
            if (best) {
              cmds.push(buildSendCommand(src.id, best.id, 1));
              lastSend = s.tick;
            }
          }
        }
        tick(s, cmds);
      }
      expect(s.status).toBe("lost");
    });

    it("is deterministic and its board is sane", () => {
      expect(hashState(createAuthoredLevel(board))).toBe(hashState(createAuthoredLevel(board)));
      const s = createAuthoredLevel(board);
      expect(s.nodes.filter((n) => n.owner === PLAYER).length).toBeGreaterThanOrEqual(1);
      expect(s.nodes.filter((n) => n.owner === NEUTRAL).length).toBeGreaterThanOrEqual(2);
      // No live rival, and yet not an instant win: the gauntlet rules hold.
      tick(s, []);
      expect(s.status).toBe("playing");
      if (board.targetIndex !== undefined) {
        expect(s.nodes[board.targetIndex]).toBeDefined();
      }
    });
  },
);
