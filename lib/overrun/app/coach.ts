import type { GameState } from "../sim/state";
import { NEUTRAL, PLAYER } from "../sim/state";
import { pickUpgradeNudgeNode } from "./nudge";

/**
 * The onboarding, as data.
 *
 * Everything the game taught before this existed: one line on the start card,
 * a dashed arrow on L1–3, and a one-time upgrade spotlight. Real teaching, but
 * scattered — nothing told the player they were being taught, nothing said how
 * much was left, and there was no way to decline it. CLAUDE.md §6 asks for a
 * SKIPPABLE onboarding, and you cannot skip something that never announced
 * itself.
 *
 * Constraints that shape this, all from §6:
 *  - no tutorial level and no modal text walls; every step is taught over live
 *    play, on the level the player was going to play anyway;
 *  - one click before gameplay, which the start card already spends;
 *  - a step is a VERB the player has to perform, and it ends when they perform
 *    it — never on a timer, so nobody is rushed and nobody is held back.
 *
 * Pure predicates over sim state, like nudge.ts. The app layer owns the save
 * flag and the lifecycle; this file is unit-testable and DOM-free.
 */

export interface CoachStep {
  id: string;
  /** Shown verbatim. Kept to roughly five words — this is a banner, not prose. */
  text: string;
  /** Earliest level this step may fire on. Steps are taught in order. */
  fromLevel: number;
  /**
   * Last level this step may fire on. Past it the step retires unlearned.
   *
   * Without this the onboarding can never end for a player who declines a
   * lesson: the upgrade step only shows when a good upgrade is available, so it
   * is not permanently on screen — it is worse than that, it reappears on every
   * level for the rest of the game. A player who has decided not to upgrade
   * nodes has made a legitimate choice and should stop being asked.
   *
   * Guarantees termination: the whole sequence is over by the last untilLevel,
   * whether or not anything was learned.
   */
  untilLevel: number;
  /** Is the lesson available to be taught right now on this board? */
  ready: (state: GameState) => boolean;
  /** Has the player just done the thing? Advances to the next step. */
  satisfied: (state: GameState) => boolean;
  /** Draw the dashed send arrow alongside the banner. */
  arrow?: boolean;
}

const playerNodes = (s: GameState): number =>
  s.nodes.reduce((n, x) => n + (x.owner === PLAYER ? 1 : 0), 0);

const outgoingFlows = (s: GameState): number =>
  s.flows.reduce((n, f) => n + (s.nodes[f.from]!.owner === PLAYER ? 1 : 0), 0);

/**
 * Five verbs, in the order they stop being optional.
 *
 * Deliberately NOT a step for each node kind: those already teach themselves
 * on their own boss level, with a named intro card, and burying them here
 * would make the onboarding feel endless rather than finite.
 */
export const COACH_STEPS: readonly CoachStep[] = [
  {
    id: "send",
    text: "DRAG FROM YOUR BALL TO A GREY ONE",
    fromLevel: 1,
    untilLevel: 4,
    ready: () => true,
    satisfied: (s) => s.firstSendDone,
    arrow: true,
  },
  {
    id: "capture",
    text: "OUTNUMBER A GREY BALL TO TAKE IT",
    fromLevel: 1,
    untilLevel: 4,
    ready: (s) => s.firstSendDone,
    satisfied: (s) => playerNodes(s) >= 2,
  },
  {
    id: "converge",
    text: "DRAG THROUGH YOUR BALLS TO SEND THEM ALL",
    fromLevel: 2,
    untilLevel: 6,
    // Only once there is something to converge WITH, or the instruction is
    // impossible to follow and reads as noise.
    ready: (s) => playerNodes(s) >= 2 && s.nodes.some((n) => n.owner === NEUTRAL),
    satisfied: (s) => outgoingFlows(s) >= 2,
  },
  {
    id: "ratio",
    text: "TAP ALL TO SEND HALF AND KEEP HALF",
    fromLevel: 3,
    untilLevel: 7,
    // Worth teaching once holding ground matters — two balls is when a full
    // send first leaves something undefended. The chip pulses while this step
    // is live (the renderer keys on the id), so "ALL" points at itself.
    ready: (s) => playerNodes(s) >= 2,
    // Set by the sim on the player's first real partial send — the command
    // path, so the F key and the chip satisfy it identically, and the AI
    // (which skips commands) never can.
    satisfied: (s) => s.halfSendDone,
  },
  {
    id: "upgrade",
    text: "TAP A BALL, THEN THE ARROW, TO GROW IT",
    fromLevel: 5,
    untilLevel: 9,
    // Reuses the nudge's own "safe, rich, eligible" predicate rather than a
    // second opinion about the same question.
    ready: (s) => pickUpgradeNudgeNode(s) !== null,
    satisfied: (s) => s.nodes.some((n) => n.owner === PLAYER && (n.upgrading !== 0 || n.size >= 2)),
  },
];

export interface CoachView {
  /** 0-based index into COACH_STEPS. */
  index: number;
  total: number;
  /** The step's stable id — the renderer keys step-specific affordances on it
   * (the ratio step pulses the ALL chip) without caring about ordering. */
  id: string;
  text: string;
  arrow: boolean;
}

/**
 * The step to show right now, or null when the onboarding is finished, skipped,
 * or has nothing to say on this board.
 *
 * `progress` is how many steps the player has completed — one number in the
 * save rather than a flag per step, so "STEP 2 OF 5" falls out for free and
 * adding a step later cannot leave a stale flag behind.
 */
export function coachView(state: GameState, progress: number): CoachView | null {
  if (progress >= COACH_STEPS.length) return null;
  const step = COACH_STEPS[progress]!;
  if (state.cfg.level < step.fromLevel || state.cfg.level > step.untilLevel) return null;
  if (!step.ready(state)) return null;
  return {
    index: progress,
    total: COACH_STEPS.length,
    id: step.id,
    text: step.text,
    arrow: step.arrow === true,
  };
}

/**
 * Advance past the current step if the player has just performed it.
 * Returns the new progress value (unchanged when nothing was learned).
 */
export function coachAdvance(state: GameState, progress: number): number {
  if (progress >= COACH_STEPS.length) return progress;
  const step = COACH_STEPS[progress]!;
  // Past its window the step retires unlearned, so the queue always drains —
  // including for a player who resumed at a checkpoint well past the teaching
  // levels and was never going to be shown the early steps at all.
  if (state.cfg.level > step.untilLevel) return coachAdvance(state, progress + 1);
  if (state.cfg.level < step.fromLevel) return progress;
  return step.satisfied(state) ? progress + 1 : progress;
}
