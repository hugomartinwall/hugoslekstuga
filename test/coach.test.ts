import { describe, expect, it } from "vitest";
import type { Faction } from "../lib/overrun/sim/state";
import { NEUTRAL, PLAYER } from "../lib/overrun/sim/state";
import { COACH_STEPS, coachAdvance, coachView } from "../lib/overrun/app/coach";
import { makeState, run } from "./sim-harness";
import { applyUpgrade, startFlow, tick } from "../lib/overrun/sim/tick";

/**
 * The onboarding. Pure predicates over sim state, so all of this is unit
 * testable — which matters, because the failure mode of a tutorial is that it
 * shows the wrong step, or shows one forever, and neither is visible from a
 * screenshot of the right step.
 */

/** A two-node board with one takeable neutral, at a given level. */
const board = (level: number) => {
  const s = makeState([
    { x: 30, y: 45, owner: PLAYER, units: 20 },
    { x: 70, y: 45, owner: NEUTRAL, units: 3 },
    { x: 100, y: 45, owner: NEUTRAL, units: 3 },
    { x: 140, y: 45, owner: 2 as Faction, units: 12 },
  ]);
  s.cfg.level = level;
  s.firstSendDone = false;
  return s;
};

describe("onboarding steps", () => {
  it("opens on the send step, with the arrow", () => {
    const v = coachView(board(1), 0);
    expect(v).not.toBeNull();
    expect(v!.index).toBe(0);
    expect(v!.total).toBe(COACH_STEPS.length);
    expect(v!.arrow).toBe(true);
    expect(v!.text.length).toBeGreaterThan(0);
  });

  it("advances only when the player actually performs the step", () => {
    const s = board(1);
    expect(coachAdvance(s, 0)).toBe(0); // nothing done yet
    startFlow(s, 0, 1, 1);
    s.firstSendDone = true;
    expect(coachAdvance(s, 0)).toBe(1);
  });

  it("never runs out of order, and never before its level", () => {
    // The upgrade step is last and gated to L5 — it must not appear on L1 even
    // if the board happens to satisfy it.
    const s = board(1);
    s.nodes[0]!.units = 999;
    expect(coachView(s, COACH_STEPS.length - 1)).toBeNull();
  });

  it("holds a step whose lesson is not yet possible rather than showing noise", () => {
    // "Send from several nodes at once" with one node is an instruction the
    // player cannot follow.
    const s = board(2);
    s.firstSendDone = true;
    const convergeIdx = COACH_STEPS.findIndex((x) => x.id === "converge");
    expect(coachView(s, convergeIdx)).toBeNull();
    s.nodes[1]!.owner = PLAYER; // now there are two
    expect(coachView(s, convergeIdx)).not.toBeNull();
  });

  it("finishes, and stays finished", () => {
    expect(coachView(board(1), COACH_STEPS.length)).toBeNull();
    expect(coachAdvance(board(1), COACH_STEPS.length)).toBe(COACH_STEPS.length);
    // Skipping is exactly "jump to the end", so this is the skip path too.
    expect(coachView(board(9), COACH_STEPS.length)).toBeNull();
  });

  it("cannot get stuck: a player who performs every verb drains the queue", () => {
    /**
     * The real risk with an ordered tutorial is a step whose `satisfied` never
     * fires, which parks the banner on screen for the rest of the game. Drive
     * an actual board and assert the queue drains.
     */
    const s = board(1);
    // By id, not by raw index — the previous script hardcoded `progress === 2`
    // and `=== 3`, and inserting the ratio step would have silently made it
    // drive the WRONG steps while still compiling.
    const idx = (id: string) => COACH_STEPS.findIndex((x) => x.id === id);
    let progress = 0;
    startFlow(s, 0, 1, 1);
    s.firstSendDone = true;
    for (let i = 0; i < 400 && progress < COACH_STEPS.length; i++) {
      run(s, 1);
      if (progress === idx("converge") && s.nodes[1]!.owner === PLAYER && s.flows.length === 0) {
        s.cfg.level = 2; // converge is gated to L2+
        startFlow(s, 0, 3, 0.4);
        startFlow(s, 1, 3, 0.4);
      }
      if (progress === idx("ratio")) {
        s.cfg.level = 3; // the ratio step's window opens at L3
        // Through the COMMAND path on purpose: startFlow alone must not
        // satisfy this lesson (see the AI test below), so the script performs
        // the step exactly the way a player's input does.
        tick(s, [{ type: "sendUnits", from: 0, to: 2, fraction: 0.5 }]);
      }
      if (progress === idx("upgrade")) {
        s.cfg.level = 5;
        s.nodes[0]!.units = 99;
        applyUpgrade(s, 0, PLAYER);
      }
      progress = coachAdvance(s, progress);
    }
    expect(progress, "the onboarding must reach its end from play alone").toBe(COACH_STEPS.length);
    expect(coachView(s, progress)).toBeNull();
  });

  it("only a player command satisfies the ratio lesson — never the AI, never a full send", () => {
    const s = board(3);
    s.nodes[1]!.owner = PLAYER; // ratio.ready wants two player balls
    // The AI's route: startFlow directly, fraction < 1. Must not count.
    startFlow(s, 0, 2, 0.4);
    run(s, 3);
    expect(s.halfSendDone, "AI partial sends are not the lesson").toBe(false);
    // A full-send command must not count either...
    tick(s, [{ type: "sendUnits", from: 0, to: 2 }]);
    expect(s.halfSendDone, "full sends are not the lesson").toBe(false);
    // ...nor a fractional CANCEL (self-send)...
    tick(s, [{ type: "sendUnits", from: 0, to: 0, fraction: 0.5 }]);
    expect(s.halfSendDone, "cancels are not the lesson").toBe(false);
    // ...only the real thing: a player command with a fraction and a target.
    tick(s, [{ type: "sendUnits", from: 1, to: 3, fraction: 0.5 }]);
    expect(s.halfSendDone).toBe(true);
    const ratioIdx = COACH_STEPS.findIndex((x) => x.id === "ratio");
    expect(coachAdvance(s, ratioIdx)).toBe(ratioIdx + 1);
  });

  it("cannot get stuck: a player who ignores every lesson still finishes", () => {
    /**
     * The failure this guards is the one that nearly shipped. The upgrade step
     * only surfaces when a good upgrade exists, so declining it forever did not
     * pin a banner to the screen — it re-offered the same lesson on every level
     * for the rest of the game, which is worse. Steps now retire unlearned.
     */
    const last = COACH_STEPS[COACH_STEPS.length - 1]!;
    const s = board(last.untilLevel + 1);
    let progress = 0;
    for (let i = 0; i < COACH_STEPS.length + 1; i++) progress = coachAdvance(s, progress);
    expect(progress).toBe(COACH_STEPS.length);
    expect(coachView(s, 0)).toBeNull();
  });

  it("every step's window is non-empty and the sequence is monotonic", () => {
    // A fromLevel above its own untilLevel would make a step unreachable, and
    // windows that run backwards would let a later step expire before an
    // earlier one — silently reordering the lessons.
    let prevUntil = 0;
    for (const step of COACH_STEPS) {
      expect(step.fromLevel, step.id).toBeLessThanOrEqual(step.untilLevel);
      expect(step.untilLevel, step.id).toBeGreaterThanOrEqual(prevUntil);
      prevUntil = step.untilLevel;
    }
  });
});
