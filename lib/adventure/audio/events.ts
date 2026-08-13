import type { GameState } from "../sim/state";

/**
 * Pure sim-state diffing — the sim stays ignorant of audio; SFX are
 * derived by comparing consecutive states. The struct is reused (no
 * per-tick allocation). Diffs are skipped across room/world swaps.
 */

export type TickEvents = {
  swing: boolean;
  playerHurt: boolean;
  kills: number;
  coins: number;
  bossHit: boolean;
  parry: boolean;
  purchase: boolean;
  doorOpen: boolean;
  bossPhase: boolean;
  explosion: boolean;
};

export function diffTick(prev: GameState, curr: GameState, out: TickEvents): void {
  out.swing = false;
  out.playerHurt = false;
  out.kills = 0;
  out.coins = 0;
  out.bossHit = false;
  out.parry = false;
  out.purchase = false;
  out.doorOpen = false;
  out.bossPhase = false;
  out.explosion = false;

  // A room/world swap makes entity-count deltas meaningless.
  if (prev.world !== curr.world || prev.roomIdx !== curr.roomIdx) return;

  out.swing = curr.player.attack.id !== prev.player.attack.id;
  out.playerHurt = curr.player.hp < prev.player.hp;
  out.kills = Math.max(0, prev.room.entities.length - curr.room.entities.length);
  out.coins = Math.max(0, curr.player.coins - prev.player.coins);
  out.doorOpen = !prev.room.cleared && curr.room.cleared;
  if (prev.boss && curr.boss) {
    out.bossHit = curr.boss.hp < prev.boss.hp;
    out.bossPhase = curr.boss.phase > prev.boss.phase;
  }
  // A blast zone appearing = something exploded.
  const prevBlasts = countBlasts(prev);
  const currBlasts = countBlasts(curr);
  out.explosion = currBlasts > prevBlasts;
  // A hostile projectile flipping friendly = a parry connected.
  const prevRipostes = countRipostes(prev);
  const currRipostes = countRipostes(curr);
  out.parry = currRipostes > prevRipostes;
}

function countBlasts(s: GameState): number {
  let n = 0;
  for (const z of s.room.zones) if (z.kind === "blast") n++;
  return n;
}

function countRipostes(s: GameState): number {
  let n = 0;
  for (const p of s.room.projectiles) if (p.kind === "riposte") n++;
  return n;
}
