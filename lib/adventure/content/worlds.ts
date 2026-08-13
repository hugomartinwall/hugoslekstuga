import type { ToolColor } from "@/lib/tools";

/**
 * The ten adventures. Each world is a room sequence (combat rooms, one
 * shop after the third fight, the boss arena), an accent, a mechanic, and
 * tuning numbers. Spawn recipes map a layout's numbered markers to enemy
 * kinds — the room's coin income IS the sum of those kinds' drops, which
 * is what the economy suite audits.
 *
 * World 9 (THE STATIC) remixes: each room overrides mechanic + accent to
 * replay an earlier world's hazard, harder.
 */

export type Mechanic =
  | "none"
  | "grass"
  | "current"
  | "bog"
  | "ice"
  | "lava"
  | "sand"
  | "dark"
  | "arcade";

export type RoomRecipe = {
  layout: string;
  kind: "combat" | "shop" | "boss";
  spawns?: Record<string, string>; // marker digit → enemy kind id
  mechanic?: Mechanic; // per-room override (world 9)
  accent?: ToolColor; // per-room override (world 9)
};

export type WorldDef = {
  id: number;
  name: string;
  accent: ToolColor;
  mechanic: Mechanic;
  hpMult: number;
  /** Minimum enemy/boss windup, in ticks — the fairness floor. */
  telegraphFloor: number;
  boss: string;
  bossName: string;
  bossCoins: number;
  rooms: RoomRecipe[];
};

const shop = { layout: "shop", kind: "shop" as const };

export const WORLDS: WorldDef[] = [
  {
    id: 1,
    name: "THE PARKING LOT",
    accent: "orange",
    mechanic: "none",
    hpMult: 1,
    telegraphFloor: 28,
    boss: "cartking",
    bossName: "THE CART KING",
    bossCoins: 25,
    rooms: [
      { layout: "open", kind: "combat", spawns: { "1": "rat", "2": "rat", "3": "rat" } },
      { layout: "pillars", kind: "combat", spawns: { "1": "rat", "2": "rat", "3": "rat", "4": "rat" } },
      { layout: "cross", kind: "combat", spawns: { "1": "rat", "2": "rat", "3": "pigeon", "4": "rat" } },
      shop,
      { layout: "halls", kind: "combat", spawns: { "1": "rat", "2": "rat", "3": "pigeon", "4": "rat", "5": "pigeon" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 2,
    name: "THE DARK FOREST",
    accent: "green",
    mechanic: "grass",
    hpMult: 1,
    telegraphFloor: 28,
    boss: "stump",
    bossName: "MOTHER STUMP",
    bossCoins: 30,
    rooms: [
      { layout: "meadow", kind: "combat", spawns: { "1": "sapling", "2": "sapling", "3": "spitter", "5": "sapling" } },
      { layout: "thicket", kind: "combat", spawns: { "1": "boar", "2": "sapling", "3": "spitter", "4": "sapling" } },
      { layout: "meadow", kind: "combat", spawns: { "1": "puffball", "2": "sapling", "3": "boar", "4": "spitter", "6": "sapling" } },
      shop,
      { layout: "pillars", kind: "combat", spawns: { "1": "boar", "2": "puffball", "3": "puffball", "4": "sapling", "5": "spitter" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 3,
    name: "THE CANALS",
    accent: "blue",
    mechanic: "current",
    hpMult: 1.25,
    telegraphFloor: 24,
    boss: "heron",
    bossName: "THE HARBORMASTER",
    bossCoins: 40,
    rooms: [
      { layout: "lanes", kind: "combat", spawns: { "1": "crab", "2": "crab", "3": "angler", "4": "crab", "5": "angler" } },
      { layout: "crosscur", kind: "combat", spawns: { "1": "pike", "2": "crab", "3": "angler", "4": "gull", "5": "crab" } },
      { layout: "lanes", kind: "combat", spawns: { "1": "pike", "2": "gull", "3": "angler", "4": "crab", "5": "angler" } },
      shop,
      { layout: "cross", kind: "combat", spawns: { "1": "gull", "2": "pike", "3": "angler", "4": "crab", "5": "gull" } },
      { layout: "crosscur", kind: "combat", spawns: { "1": "pike", "2": "pike", "3": "gull", "4": "angler", "5": "crab" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 4,
    name: "THE BOG",
    accent: "yellow",
    mechanic: "bog",
    hpMult: 1.25,
    telegraphFloor: 24,
    boss: "toad",
    bossName: "THE LANDLORD",
    bossCoins: 45,
    rooms: [
      { layout: "bog", kind: "combat", spawns: { "1": "leech", "2": "leech", "3": "bogspit", "4": "leech", "5": "gasbag" } },
      { layout: "fen", kind: "combat", spawns: { "1": "slime", "2": "leech", "3": "bogspit", "4": "leech", "5": "gasbag" } },
      { layout: "bog", kind: "combat", spawns: { "1": "gasbag", "2": "slime", "3": "leech", "4": "bogspit", "5": "leech" } },
      shop,
      { layout: "fen", kind: "combat", spawns: { "1": "slime", "2": "gasbag", "3": "bogspit", "4": "leech", "5": "slime" } },
      { layout: "cross", kind: "combat", spawns: { "1": "gasbag", "2": "slime", "3": "bogspit", "4": "leech", "5": "gasbag" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 5,
    name: "THE COLD STORAGE",
    accent: "teal",
    mechanic: "ice",
    hpMult: 1.5,
    telegraphFloor: 24,
    boss: "zamboni",
    bossName: "THE ZAMBONI",
    bossCoins: 55,
    rooms: [
      { layout: "open", kind: "combat", spawns: { "1": "imp", "2": "imp", "3": "icicle", "4": "imp", "5": "knight" } },
      { layout: "pillars", kind: "combat", spawns: { "1": "crate", "2": "imp", "3": "icicle", "4": "knight", "5": "imp" } },
      { layout: "halls", kind: "combat", spawns: { "1": "knight", "2": "imp", "3": "icicle", "4": "crate", "5": "imp" } },
      shop,
      { layout: "cross", kind: "combat", spawns: { "1": "crate", "2": "knight", "3": "icicle", "4": "imp", "5": "knight" } },
      { layout: "open", kind: "combat", spawns: { "1": "knight", "2": "crate", "3": "icicle", "4": "imp", "5": "imp", "6": "icicle" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 6,
    name: "THE FURNACE",
    accent: "tomato",
    mechanic: "lava",
    hpMult: 1.5,
    telegraphFloor: 21,
    boss: "foreman",
    bossName: "THE FOREMAN",
    bossCoins: 65,
    rooms: [
      { layout: "tides", kind: "combat", spawns: { "1": "slagpup", "2": "slagpup", "3": "vent", "4": "boiler", "5": "slagpup", "6": "vent" } },
      { layout: "bands", kind: "combat", spawns: { "1": "ovendoor", "2": "slagpup", "3": "vent", "4": "boiler", "5": "slagpup", "6": "drone" } },
      { layout: "tides", kind: "combat", spawns: { "1": "boiler", "2": "ovendoor", "3": "vent", "4": "slagpup", "5": "drone", "6": "slagpup" } },
      shop,
      { layout: "bands", kind: "combat", spawns: { "1": "ovendoor", "2": "boiler", "3": "vent", "4": "drone", "5": "slagpup", "6": "vent" } },
      { layout: "pillars", kind: "combat", spawns: { "1": "ovendoor", "2": "drone", "3": "vent", "4": "boiler", "5": "slagpup" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 7,
    name: "THE DUNES",
    accent: "orange",
    mechanic: "sand",
    hpMult: 2,
    telegraphFloor: 21,
    boss: "antlion",
    bossName: "THE ANTLION EMERITUS",
    bossCoins: 75,
    rooms: [
      { layout: "open", kind: "combat", spawns: { "1": "scarab", "2": "scarab", "3": "devil", "4": "burrower", "5": "scarab", "6": "mine" } },
      { layout: "pillars", kind: "combat", spawns: { "1": "nest", "2": "scarab", "3": "devil", "4": "mine", "5": "burrower" } },
      { layout: "cross", kind: "combat", spawns: { "1": "burrower", "2": "devil", "3": "mine", "4": "scarab", "5": "nest" } },
      shop,
      { layout: "halls", kind: "combat", spawns: { "1": "burrower", "2": "nest", "3": "devil", "4": "scarab", "5": "mine" } },
      { layout: "open", kind: "combat", spawns: { "1": "nest", "2": "burrower", "3": "mine", "4": "devil", "5": "scarab", "6": "scarab" } },
      { layout: "cross", kind: "combat", spawns: { "1": "burrower", "2": "mine", "3": "devil", "4": "nest", "5": "scarab" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 8,
    name: "THE CRYPT",
    accent: "purple",
    mechanic: "dark",
    hpMult: 2,
    telegraphFloor: 18,
    boss: "archivist",
    bossName: "THE ARCHIVIST",
    bossCoins: 85,
    rooms: [
      { layout: "crypt", kind: "combat", spawns: { "1": "ghoul", "2": "pallbearer", "3": "candle", "4": "pallbearer" } },
      { layout: "stacks", kind: "combat", spawns: { "1": "ghost", "2": "pallbearer", "3": "candle", "4": "moth", "5": "ghost" } },
      { layout: "crypt", kind: "combat", spawns: { "1": "pallbearer", "2": "ghost", "3": "chandler", "4": "moth" } },
      shop,
      { layout: "stacks", kind: "combat", spawns: { "1": "chandler", "2": "ghost", "3": "pallbearer", "4": "pallbearer", "5": "moth" } },
      { layout: "crypt", kind: "combat", spawns: { "1": "pallbearer", "2": "pallbearer", "3": "chandler", "4": "ghost" } },
      { layout: "stacks", kind: "combat", spawns: { "1": "pallbearer", "2": "ghost", "3": "candle", "4": "chandler", "5": "chandler" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 9,
    name: "THE STATIC",
    accent: "pink",
    mechanic: "arcade",
    hpMult: 2.5,
    telegraphFloor: 18,
    boss: "playtester",
    bossName: "THE PLAYTESTER",
    bossCoins: 95,
    rooms: [
      { layout: "thicket", kind: "combat", mechanic: "grass", accent: "green", spawns: { "1": "cabinet", "2": "glitch", "3": "beamcell", "4": "glitch" } },
      { layout: "lanes", kind: "combat", mechanic: "current", accent: "blue", spawns: { "1": "cabinet", "2": "glitch", "3": "beamcell", "4": "holo", "5": "glitch" } },
      { layout: "fen", kind: "combat", mechanic: "bog", accent: "yellow", spawns: { "1": "fuse", "2": "glitch", "3": "beamcell", "4": "glitch", "5": "cabinet" } },
      shop,
      { layout: "open", kind: "combat", mechanic: "ice", accent: "teal", spawns: { "1": "cabinet", "2": "holo", "3": "beamcell", "4": "glitch", "5": "fuse", "6": "glitch" } },
      { layout: "bands", kind: "combat", mechanic: "lava", accent: "tomato", spawns: { "1": "staticRift", "2": "glitch", "3": "beamcell", "4": "holo", "5": "glitch", "6": "fuse" } },
      { layout: "crypt", kind: "combat", mechanic: "dark", accent: "purple", spawns: { "1": "staticRift", "2": "holo", "3": "beamcell", "4": "glitch" } },
      { layout: "arena", kind: "boss" },
    ],
  },
  {
    id: 10,
    name: "THE ARCADE",
    accent: "pink",
    mechanic: "arcade",
    hpMult: 2.5,
    telegraphFloor: 18,
    boss: "proprietor",
    bossName: "THE PROPRIETOR",
    bossCoins: 0,
    rooms: [
      { layout: "pillars", kind: "combat", spawns: { "1": "glitch", "2": "glitch", "3": "beamcell", "4": "holo", "5": "cabinet" } },
      { layout: "cross", kind: "combat", spawns: { "1": "fuse", "2": "cabinet", "3": "beamcell", "4": "glitch", "5": "holo" } },
      { layout: "halls", kind: "combat", spawns: { "1": "staticRift", "2": "glitch", "3": "holo", "4": "cabinet", "5": "beamcell" } },
      shop,
      { layout: "stacks", kind: "combat", spawns: { "1": "cabinet", "2": "holo", "3": "beamcell", "4": "fuse", "5": "glitch" } },
      { layout: "open", kind: "combat", spawns: { "1": "staticRift", "2": "cabinet", "3": "beamcell", "4": "holo", "5": "glitch", "6": "fuse" } },
      { layout: "arena", kind: "boss" },
    ],
  },
];

export function worldDef(world: number): WorldDef {
  return WORLDS[Math.max(1, Math.min(WORLDS.length, world)) - 1];
}

export const FINAL_WORLD = WORLDS.length;
