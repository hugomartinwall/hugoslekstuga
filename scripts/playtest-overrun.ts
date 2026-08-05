/**
 * Headless test harness for Overrun (the sim lives in lib/overrun/).
 *
 *   npx tsx scripts/playtest-overrun.ts
 *
 * Author-time only — never imported by app code, never shipped. Ported from
 * the upstream game's vitest suites so the shipped copies stay covered
 * without adding a test runner to the site. Four sections:
 *
 *   A. DETERMINISM — same seed + same commands ⇒ identical state hash;
 *      the guarantee every other behaviour rests on.
 *   B. COMBAT — capture/attrition/redirect/win-loss edge rules.
 *   C. RUN/SAVE — lives progression + save migration (the one area the
 *      port touched adjacent code).
 *   D. BALANCE — scripted bots encode the difficulty funnel: level 1
 *      is winnable by a greedy beginner, high levels actually threaten.
 *
 * Exits non-zero if any assertion fails.
 */

import type { GameState, Node, Owner } from "../lib/overrun/sim/state";
import { hashState, rngNext } from "../lib/overrun/sim/state";
import { tick, TICK_HZ, dist } from "../lib/overrun/sim/tick";
import { createLevel } from "../lib/overrun/sim/level";
import type { Command } from "../lib/overrun/sim/commands";
import {
  applyDefeat,
  applyWin,
  LIVES_PER_RUN,
  migrateSave,
  newSave,
} from "../lib/overrun/app/run";

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};
const check = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else fail(msg);
};

/* ── A. DETERMINISM ─────────────────────────────────────────────── */

function scriptedRun(level: number, ticks: number): number {
  const state = createLevel(level);
  const nodeCount = state.nodes.length;
  for (let i = 0; i < ticks; i++) {
    const commands: Command[] = [];
    if (i % 47 === 0) commands.push({ type: "selectNode", nodeId: i % nodeCount });
    if (i % 90 === 30) commands.push({ type: "sendUnits", from: 0, to: ((i / 7) % nodeCount) | 0 });
    if (i % 113 === 0) commands.push({ type: "deselect" });
    if (i % 31 === 0) rngNext(state.rng); // interleaved draws must not desync anything
    tick(state, commands);
  }
  return hashState(state);
}

console.log("A. DETERMINISM");
check(
  scriptedRun(7, 10_000) === scriptedRun(7, 10_000),
  "same level + same commands ⇒ identical state after 10k ticks",
);
check(scriptedRun(7, 1_000) !== scriptedRun(8, 1_000), "different level ⇒ different hash");
{
  const state = createLevel(1);
  const before = state.nodes.find((n) => n.owner === "player")!.units;
  for (let i = 0; i < 300; i++) tick(state, []);
  check(
    state.nodes.find((n) => n.owner === "player")!.units > before,
    "production accrues over time",
  );
}

/* ── B. COMBAT ──────────────────────────────────────────────────── */

function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units">>,
  sentinel = false,
  aiFirstMoveTick = 1_000_000,
): GameState {
  if (sentinel) nodes = [...nodes, { x: 146, y: 76, owner: "enemy", units: 1 }];
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 1,
      aiFirstMoveTick,
      aiIntervalTicks: 60,
      aiMinUnits: 5,
      aiOverkillMargin: 2,
      aiTier: 1,
      aiKillCertainty: 99, // behavior-neutral: kill layer effectively off
      aiSendFraction: 0.65,
      aiNeutralBonus: 25,
    },
    nodes: nodes.map((n, id) => ({ id, size: 1 as const, selected: false, ...n })),
    flows: [],
    packets: [],
    nextAiTick: aiFirstMoveTick,
    firstSendDone: false,
  };
}

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) tick(state, []);
};
const count = (state: GameState, owner: Owner) =>
  state.nodes.filter((n) => n.owner === owner).length;

console.log("B. COMBAT");
{
  const s = makeState(
    [
      { x: 40, y: 45, owner: "player", units: 10 },
      { x: 60, y: 45, owner: "neutral", units: 5 },
    ],
    true,
  );
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 300);
  check(
    s.nodes[1]!.owner === "player" && s.nodes[1]!.units >= 5,
    "captures a weaker neutral with the remainder surviving",
  );
}
{
  const s = makeState(
    [
      { x: 40, y: 45, owner: "player", units: 5 },
      { x: 60, y: 45, owner: "neutral", units: 20 },
    ],
    true,
  );
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 300);
  check(
    s.nodes[1]!.owner === "neutral" && s.nodes[1]!.units === 15,
    "attack fails against a stronger defender, shaving its units",
  );
}
{
  const s = makeState([
    { x: 20, y: 45, owner: "player", units: 30 },
    { x: 120, y: 45, owner: "player", units: 1 },
    { x: 130, y: 45, owner: "enemy", units: 10 },
  ]);
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  s.flows.push({ from: 2, to: 1, remaining: 10 });
  run(s, 1000);
  check(s.nodes[1]!.owner === "player", "friendly stream toward a mid-flight flip becomes an attack");
}
{
  const play = () => {
    const s = makeState([
      { x: 30, y: 45, owner: "player", units: 12 },
      { x: 80, y: 45, owner: "neutral", units: 0 },
      { x: 130, y: 45, owner: "enemy", units: 12 },
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    s.flows.push({ from: 2, to: 1, remaining: 12 });
    run(s, 400);
    return s;
  };
  const a = play();
  const b = play();
  check(
    a.nodes[1]!.owner === b.nodes[1]!.owner && a.nodes[1]!.units === b.nodes[1]!.units,
    "simultaneous opposing arrivals resolve deterministically",
  );
}
{
  const s = makeState(
    [
      { x: 40, y: 45, owner: "player", units: 60 },
      { x: 60, y: 45, owner: "player", units: 49 }, // medium cap = 50
    ],
    true,
  );
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 600);
  check(s.nodes[1]!.units > 50, "deposits may exceed the production cap");
}
{
  const s = makeState([
    { x: 20, y: 45, owner: "player", units: 3 },
    { x: 140, y: 45, owner: "neutral", units: 50 },
    { x: 30, y: 45, owner: "enemy", units: 40 },
  ]);
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  s.flows.push({ from: 2, to: 0, remaining: 40 });
  run(s, 100);
  check(
    s.nodes[0]!.owner === "enemy" && !s.flows.some((f) => f.from === 0),
    "capturing a node kills its outgoing flow",
  );
}
{
  const s = makeState(
    [
      { x: 40, y: 45, owner: "player", units: 20 },
      { x: 60, y: 45, owner: "neutral", units: 5 },
      { x: 40, y: 70, owner: "neutral", units: 5 },
    ],
    true,
  );
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 4);
  const inFlight = s.packets.length;
  tick(s, [{ type: "sendUnits", from: 0, to: 2 }]); // redirect
  const redirected = s.flows.length === 1 && s.flows[0]!.to === 2;
  run(s, 400);
  check(
    inFlight > 0 && redirected && s.nodes[2]!.owner === "player",
    "redirect replaces the flow without losing unsent units",
  );
}
{
  const s = makeState(
    [
      { x: 40, y: 45, owner: "player", units: 20 },
      { x: 60, y: 45, owner: "neutral", units: 19 },
    ],
    true,
  );
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 2);
  tick(s, [{ type: "sendUnits", from: 0, to: 0 }]);
  check(s.flows.length === 0, "cancel (send to self) stops the stream");
}
{
  const s = makeState([
    { x: 40, y: 45, owner: "player", units: 30 },
    { x: 120, y: 45, owner: "enemy", units: 2 },
  ]);
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  run(s, 60);
  const stillPlaying = s.status === "playing";
  run(s, 1000);
  check(
    stillPlaying && s.status === "won",
    "win only when enemy nodes AND packets are gone",
  );
}
{
  const s = makeState([
    { x: 20, y: 45, owner: "player", units: 30 },
    { x: 140, y: 45, owner: "neutral", units: 1 },
    { x: 25, y: 45, owner: "enemy", units: 60 },
  ]);
  tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
  s.flows.push({ from: 2, to: 0, remaining: 60 });
  let sawHomeless = false;
  for (let i = 0; i < 1000 && s.status === "playing"; i++) {
    tick(s, []);
    if (!s.nodes.some((n) => n.owner === "player") && s.packets.some((p) => p.owner === "player"))
      sawHomeless = true;
  }
  check(
    sawHomeless && count(s, "player") > 0,
    "losing the last node while a stream is mid-air is not a loss",
  );
}

/* ── C. RUN/SAVE ────────────────────────────────────────────────── */

console.log("C. RUN/SAVE");
{
  let save = newSave();
  save = applyWin(save);
  check(
    save.run.level === 2 && save.bestLevel === 2 && save.run.lives === LIVES_PER_RUN,
    "winning advances the run and raises bestLevel",
  );
}
{
  const save = applyWin({ ...newSave(), bestLevel: 9 });
  check(save.bestLevel === 9, "bestLevel never regresses");
}
{
  const r = applyDefeat({ ...newSave(), run: { level: 5, lives: 2 } });
  check(
    !r.runOver && r.save.run.level === 5 && r.save.run.lives === 1,
    "first defeat costs a life and retries the same level",
  );
}
{
  const r = applyDefeat({ ...newSave(), bestLevel: 7, run: { level: 5, lives: 1 } });
  check(
    r.runOver &&
      r.reachedLevel === 5 &&
      r.save.run.level === 1 &&
      r.save.run.lives === LIVES_PER_RUN &&
      r.save.bestLevel === 7,
    "second defeat ends the run, resets to level 1, best survives",
  );
}
{
  const s = migrateSave({ v: 2, bestLevel: 6, run: { level: 4, lives: 1 } });
  check(
    s.v === 2 && s.bestLevel === 6 && s.run.level === 4 && s.run.lives === 1,
    "migration passes valid v2 through",
  );
}
{
  const s = migrateSave({ highestLevel: 8 });
  check(
    s.bestLevel === 8 && s.run.level === 1 && s.run.lives === LIVES_PER_RUN,
    "migration grandfathers v1 highestLevel",
  );
}
{
  const s = migrateSave({ v: 2, bestLevel: 2, run: { level: 5, lives: 99 } });
  check(
    s.bestLevel === 5 && s.run.lives === LIVES_PER_RUN,
    "migration repairs inconsistent v2",
  );
}
{
  const fresh = newSave();
  const allFresh = [null, undefined, 42, "x", {}, { v: 2 }, { run: {} }].every((junk) => {
    const s = migrateSave(junk);
    return (
      s.v === fresh.v && s.bestLevel === fresh.bestLevel && s.run.level === fresh.run.level
    );
  });
  check(allFresh, "migration falls back to a new save on garbage");
}

/* ── D. BALANCE ─────────────────────────────────────────────────── */

function greedyCommands(state: GameState, tickNo: number): Command[] {
  if (tickNo % 60 !== 0) return [];
  let src: Node | null = null;
  for (const n of state.nodes) {
    if (n.owner !== "player") continue;
    if (state.flows.some((f) => f.from === n.id)) continue;
    if (!src || n.units > src.units) src = n;
  }
  if (!src || src.units < 3) return [];
  let target: Node | null = null;
  let best = Infinity;
  for (const n of state.nodes) {
    if (n.owner === "player") continue;
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

console.log("D. BALANCE");
check(playGreedy(1, 90).status === "won", "greedy player wins level 1 within 90 s");
for (const lvl of [2, 3]) {
  check(playGreedy(lvl, 180).status === "won", `greedy player wins level ${lvl} within 3 min`);
}
check(playIdle(1, 60).status === "playing", "do-nothing player survives 60 s on level 1");
check(playIdle(10, 300).status === "lost", "do-nothing player loses level 10 within 5 min");
{
  const easy = playGreedy(5, 300);
  const hard = playGreedy(20, 300);
  const score = (r: { status: string; seconds: number }) =>
    r.status === "won" ? 1000 - r.seconds : r.seconds;
  check(score(hard) <= score(easy), "difficulty roughly monotonic (level 20 ≥ level 5)");
}

/* ── verdict ────────────────────────────────────────────────────── */

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
