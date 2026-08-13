/**
 * Enemy roster — nine shared archetypes, reskinned and retuned per world.
 * Every world twist is a flag on a kind, not a new state machine; the
 * steppers live in sim/ai.ts. HP is in hit points (the sword starts at 2),
 * damage in half-hearts (a standard hit is 2 = one heart), speed in px/s
 * at 60 ticks/s, coins are exactly what the kind drops — the room-budget
 * rule ("an enemy costs what it pays") is what makes the economy testable.
 */

export type Archetype =
  | "chaser"
  | "shooter"
  | "charger"
  | "splitter"
  | "orbiter"
  | "shielded"
  | "spawner"
  | "exploder"
  | "healer";

export type EnemyFlag =
  | "bogfast" // fast in bog, slow on land (w4 leeches)
  | "crampons" // unaffected by ice (w5 imps)
  | "phasedark" // intangible outside the lantern cone (w8 ghosts)
  | "lane" // only charges along current lanes (w3 pike)
  | "burrow" // travels as an unhittable mound, surfaces to act (w7)
  | "puddle" // shots/blasts leave a lingering poison puddle (w4)
  | "bigblast" // exploder with radius 44 instead of 36 (w6 boilers)
  | "burst" // shooter fires a 3-round burst (w6 vents)
  | "hotshield"; // melee into the shield from the front costs ½ heart (w6)

export type EnemyDef = {
  name: string;
  arch: Archetype;
  hp: number;
  speed: number;
  r: number;
  coins: number;
  touchDmg: number; // half-hearts
  flags?: EnemyFlag[];
};

export const ENEMY_KINDS: Record<string, EnemyDef> = {
  // ---- world 1: the parking lot -------------------------------------
  rat: { name: "lot rat", arch: "chaser", hp: 4, speed: 55, r: 7, coins: 2, touchDmg: 2 },
  pigeon: { name: "gutter pigeon", arch: "shooter", hp: 3, speed: 40, r: 7, coins: 3, touchDmg: 2 },

  // ---- world 2: the dark forest -------------------------------------
  sapling: { name: "sapling", arch: "chaser", hp: 4, speed: 58, r: 7, coins: 2, touchDmg: 2 },
  spitter: { name: "seed-spitter", arch: "shooter", hp: 3, speed: 0, r: 7, coins: 3, touchDmg: 2 },
  boar: { name: "boar", arch: "charger", hp: 6, speed: 30, r: 8, coins: 4, touchDmg: 2 },
  puffball: { name: "puffball", arch: "splitter", hp: 6, speed: 40, r: 8, coins: 3, touchDmg: 2 },

  // ---- world 3: the canals ------------------------------------------
  crab: { name: "crab", arch: "chaser", hp: 5, speed: 60, r: 7, coins: 2, touchDmg: 2 },
  angler: { name: "angler", arch: "shooter", hp: 4, speed: 35, r: 7, coins: 3, touchDmg: 2 },
  pike: { name: "pike", arch: "charger", hp: 7, speed: 30, r: 8, coins: 4, touchDmg: 2, flags: ["lane"] },
  gull: { name: "gull", arch: "orbiter", hp: 4, speed: 70, r: 6, coins: 3, touchDmg: 2 },

  // ---- world 4: the bog ---------------------------------------------
  leech: { name: "leech", arch: "chaser", hp: 5, speed: 45, r: 7, coins: 2, touchDmg: 2, flags: ["bogfast"] },
  bogspit: { name: "bog spitter", arch: "shooter", hp: 4, speed: 30, r: 7, coins: 3, touchDmg: 2, flags: ["puddle"] },
  slime: { name: "slime", arch: "splitter", hp: 7, speed: 40, r: 8, coins: 3, touchDmg: 2, flags: ["bogfast"] },
  gasbag: { name: "gasbag", arch: "exploder", hp: 2, speed: 32, r: 7, coins: 4, touchDmg: 2, flags: ["puddle"] },

  // ---- world 5: the cold storage ------------------------------------
  imp: { name: "freezer imp", arch: "chaser", hp: 6, speed: 62, r: 7, coins: 2, touchDmg: 2, flags: ["crampons"] },
  icicle: { name: "icicle turret", arch: "shooter", hp: 4, speed: 0, r: 7, coins: 3, touchDmg: 2 },
  crate: { name: "crate golem", arch: "charger", hp: 8, speed: 28, r: 9, coins: 4, touchDmg: 2 },
  knight: { name: "frost knight", arch: "shielded", hp: 5, speed: 35, r: 8, coins: 5, touchDmg: 2 },

  // ---- world 6: the furnace -----------------------------------------
  slagpup: { name: "slag pup", arch: "chaser", hp: 6, speed: 64, r: 7, coins: 2, touchDmg: 2 },
  vent: { name: "vent crawler", arch: "shooter", hp: 5, speed: 34, r: 7, coins: 3, touchDmg: 2, flags: ["burst"] },
  boiler: { name: "boiler", arch: "exploder", hp: 3, speed: 30, r: 8, coins: 4, touchDmg: 2, flags: ["bigblast"] },
  ovendoor: { name: "furnace door", arch: "shielded", hp: 6, speed: 32, r: 9, coins: 5, touchDmg: 2, flags: ["hotshield"] },
  drone: { name: "repair drone", arch: "healer", hp: 3, speed: 70, r: 6, coins: 5, touchDmg: 0 },

  // ---- world 7: the dunes -------------------------------------------
  scarab: { name: "scarab", arch: "chaser", hp: 6, speed: 66, r: 7, coins: 2, touchDmg: 2 },
  burrower: { name: "burrow-charger", arch: "charger", hp: 8, speed: 32, r: 8, coins: 4, touchDmg: 2, flags: ["burrow"] },
  devil: { name: "dust devil", arch: "orbiter", hp: 5, speed: 74, r: 6, coins: 3, touchDmg: 2 },
  mine: { name: "tumblemine", arch: "exploder", hp: 3, speed: 34, r: 7, coins: 4, touchDmg: 2 },
  nest: { name: "antlion nest", arch: "spawner", hp: 8, speed: 0, r: 10, coins: 6, touchDmg: 2 },

  // ---- world 8: the crypt -------------------------------------------
  ghoul: { name: "ghoul", arch: "chaser", hp: 7, speed: 60, r: 7, coins: 2, touchDmg: 2 },
  ghost: { name: "ghost", arch: "chaser", hp: 6, speed: 55, r: 7, coins: 3, touchDmg: 2, flags: ["phasedark"] },
  candle: { name: "candle head", arch: "shooter", hp: 5, speed: 32, r: 7, coins: 3, touchDmg: 2 },
  moth: { name: "moth", arch: "orbiter", hp: 5, speed: 76, r: 6, coins: 3, touchDmg: 2, flags: ["phasedark"] },
  pallbearer: { name: "pallbearer", arch: "shielded", hp: 6, speed: 34, r: 9, coins: 5, touchDmg: 2 },
  chandler: { name: "bone chandler", arch: "healer", hp: 4, speed: 68, r: 6, coins: 5, touchDmg: 0 },

  // ---- worlds 9-10: elite remixes (spawned via world hp multipliers) --
  staticRift: { name: "static rift", arch: "spawner", hp: 10, speed: 0, r: 10, coins: 6, touchDmg: 2 },
  glitch: { name: "glitch", arch: "chaser", hp: 8, speed: 68, r: 7, coins: 3, touchDmg: 2 },
  beamcell: { name: "beam cell", arch: "shooter", hp: 6, speed: 36, r: 7, coins: 4, touchDmg: 2, flags: ["burst"] },
  holo: { name: "hologram", arch: "orbiter", hp: 6, speed: 78, r: 6, coins: 4, touchDmg: 2 },
  cabinet: { name: "loose cabinet", arch: "charger", hp: 10, speed: 30, r: 9, coins: 5, touchDmg: 2 },
  fuse: { name: "blown fuse", arch: "exploder", hp: 3, speed: 36, r: 7, coins: 4, touchDmg: 2, flags: ["bigblast"] },
};

export type EnemyKindId = keyof typeof ENEMY_KINDS;

/** Minion kinds are engine-spawned (splitter shards, spawner litters, boss adds). */
export const MINION_KINDS: Record<string, EnemyDef> = {
  shard: { name: "shard", arch: "chaser", hp: 2, speed: 80, r: 5, coins: 1, touchDmg: 2 },
  litter: { name: "litter", arch: "chaser", hp: 2, speed: 70, r: 5, coins: 1, touchDmg: 2 },
  cartling: { name: "cartling", arch: "chaser", hp: 4, speed: 60, r: 6, coins: 1, touchDmg: 2 },
  addSapling: { name: "sapling", arch: "chaser", hp: 3, speed: 58, r: 6, coins: 1, touchDmg: 2 },
};

/** The world's first appearance of each archetype — the intro schedule. */
export const ARCH_INTRO_WORLD: Record<Archetype, number> = {
  chaser: 1,
  shooter: 1,
  charger: 2,
  splitter: 2,
  orbiter: 3,
  exploder: 4,
  shielded: 5,
  healer: 6,
  spawner: 7,
};
