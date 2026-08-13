/**
 * Commands are the ONLY way the outside world influences the simulation.
 * Input handlers translate pointer/keyboard events into commands; the loop
 * feeds the queued commands into tick(). Keeps the sim deterministic and
 * makes replays trivial (a replay is just a command log).
 *
 * The AI does NOT use commands — it is deterministic-given-state and lives
 * inside the sim (src/sim/ai.ts), so a replayed command log stays in sync.
 */

export interface SelectNodeCommand {
  type: "selectNode";
  nodeId: number;
}

export interface DeselectCommand {
  type: "deselect";
}

/** Send units from an owned node. `to === from` cancels the flow. */
export interface SendUnitsCommand {
  type: "sendUnits";
  from: number;
  to: number;
  /**
   * Portion of the units present NOW to commit, in (0, 1]. Absent means 1
   * (send everything) — which is also why input omits the field at 100%:
   * the command log stays byte-identical to every log recorded before the
   * field existed, so old replays (the marketing demo) hold.
   */
  fraction?: number;
}

/**
 * Build a sendUnits command, OMITTING the fraction field at 100% rather than
 * writing `fraction: 1`. The omission is the input half of the replay
 * guarantee: command logs recorded before the field existed stay
 * byte-identical (the sim half — absent ≡ 1 — is pinned in combat.test.ts).
 * Every input path routes sends through this; cancels never do (a cancel is
 * whole, and carries no fraction by construction).
 */
export function buildSendCommand(from: number, to: number, fraction: number): SendUnitsCommand {
  return fraction < 1 ? { type: "sendUnits", from, to, fraction } : { type: "sendUnits", from, to };
}

/** Spend units to grow a node one size tier (takes UPGRADE_TICKS to finish). */
export interface UpgradeNodeCommand {
  type: "upgradeNode";
  nodeId: number;
}

/**
 * Fire a player ability. Validated ENTIRELY in applyCommands — charge
 * available, target legality — and a charge is consumed on success only, so
 * corrupt or mistimed input degrades to a no-op, never a lost charge. The AI
 * never issues commands, so abilities are structurally player-only. Zero RNG.
 *
 * `nodeId` is required by overcharge (an OWN ball) and stasis (any non-owned
 * ball); recall takes no target.
 */
export interface UseAbilityCommand {
  type: "useAbility";
  ability: "overcharge" | "stasis" | "recall";
  nodeId?: number;
}

export type Command =
  | SelectNodeCommand
  | DeselectCommand
  | SendUnitsCommand
  | UpgradeNodeCommand
  | UseAbilityCommand;
