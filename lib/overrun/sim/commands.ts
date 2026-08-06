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

/** Send all current units from an owned node. `to === from` cancels the flow. */
export interface SendUnitsCommand {
  type: "sendUnits";
  from: number;
  to: number;
}

/** Spend units to grow a node one size tier (takes UPGRADE_TICKS to finish). */
export interface UpgradeNodeCommand {
  type: "upgradeNode";
  nodeId: number;
}

export type Command =
  | SelectNodeCommand
  | DeselectCommand
  | SendUnitsCommand
  | UpgradeNodeCommand;
