/**
 * Boss stat blocks. The pattern state machines live in sim/boss.ts;
 * these are the numbers the balance suite audits (TTK bounds compute
 * from hp here and the DPS model in upgrades.ts).
 */

export type BossDef = {
  kind: string;
  hp: number;
  r: number;
  contactDmg: number; // half-hearts
  phases: number; // 2, or 3 for the finale
};

export const BOSS_DEFS: Record<string, BossDef> = {
  cartking: { kind: "cartking", hp: 70, r: 14, contactDmg: 2, phases: 2 },
  stump: { kind: "stump", hp: 110, r: 16, contactDmg: 2, phases: 2 },
  heron: { kind: "heron", hp: 140, r: 12, contactDmg: 2, phases: 2 },
  toad: { kind: "toad", hp: 160, r: 15, contactDmg: 2, phases: 2 },
  zamboni: { kind: "zamboni", hp: 210, r: 16, contactDmg: 2, phases: 2 },
  foreman: { kind: "foreman", hp: 240, r: 16, contactDmg: 2, phases: 2 },
  antlion: { kind: "antlion", hp: 260, r: 15, contactDmg: 2, phases: 2 },
  archivist: { kind: "archivist", hp: 300, r: 13, contactDmg: 2, phases: 2 },
  playtester: { kind: "playtester", hp: 330, r: 9, contactDmg: 2, phases: 2 },
  proprietor: { kind: "proprietor", hp: 430, r: 26, contactDmg: 2, phases: 3 },
};
