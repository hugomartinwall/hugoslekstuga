import { ENEMY_KINDS, MINION_KINDS, type EnemyDef } from "../content/enemies";
import { LAYOUTS } from "../content/layouts";
import { heroStats } from "../content/upgrades";
import { worldDef, type Mechanic, type RoomRecipe, type WorldDef } from "../content/worlds";
import { Rng, rngSeed } from "./rng";
import { parseRoom, T, type ParsedRoom } from "./rooms";

/**
 * The whole simulation state — pure data, mutated in place by tick(),
 * cloned by the loop for interpolated rendering, hashed by the
 * determinism suite. Positions are float px on the 320×192 playfield;
 * hp is half-hearts; every timer is a tick count.
 */

export type Intent = {
  mx: number; // analog move, -1..1
  my: number;
  attack: boolean; // edge-triggered: pressed since last tick
  attackHeld: boolean;
  dodge: boolean;
  dagger: boolean;
  parry: boolean;
  dash: boolean;
  whirl: boolean;
  bomb: boolean;
  flash: boolean;
  overclock: boolean;
  flask: boolean;
  interact: boolean;
};

export function emptyIntent(): Intent {
  return {
    mx: 0, my: 0,
    attack: false, attackHeld: false, dodge: false,
    dagger: false, parry: false, dash: false, whirl: false,
    bomb: false, flash: false, overclock: false, flask: false,
    interact: false,
  };
}

export type AttackPhase =
  | "idle"
  | "windup"
  | "swing"
  | "recover"
  | "charging"
  | "chargeSwing"
  | "whirl"
  | "dashing"
  | "stagger";

export type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  faceAng: number;
  hp: number;
  maxHp: number;
  coins: number;
  gear: string[];
  flasks: number;
  attack: { phase: AttackPhase; t: number; ang: number; id: number; whirlHits: number };
  chargeT: number;
  dodgeT: number; // ticks remaining in the roll
  dodgeAng: number;
  dodgeReadyAt: number;
  dodgeCharges: number;
  parryT: number;
  iframesUntil: number;
  kbx: number;
  kby: number;
  hitStop: number;
  cool: Record<string, number>; // verb id → tick it comes off cooldown
  overclockUntil: number;
  bogT: number;
  bufAttack: number; // input buffer expiry ticks
  bufDodge: number;
  flashUntil: number; // the flash verb's world-lighting window
};

export type Entity = {
  id: number;
  kind: string; // enemy kind id
  arch: EnemyDef["arch"];
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  speed: number;
  coins: number;
  touchDmg: number;
  faceAng: number;
  mode: string;
  t: number;
  mem: number[];
  lastHitSwing: number;
  iframesUntil: number;
  kbx: number;
  kby: number;
  shieldHp: number;
  spawnGrace: number;
  hitFlash: number;
  flags: number; // bit flags, see F below
};

/** Entity flag bits (from EnemyFlag strings, resolved at spawn). */
export const F = {
  BOGFAST: 1,
  CRAMPONS: 2,
  PHASEDARK: 4,
  LANE: 8,
  BURROW: 16,
  PUDDLE: 32,
  BIGBLAST: 64,
  BURST: 128,
  HOTSHIELD: 256,
} as const;

export type Projectile = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  hostile: boolean; // true → hurts the player
  kind: string; // "dagger" | "beam" | "bomb" | "shot" | "shard" | "wisp" | "fakecoin" | ...
  t: number;
  ttl: number;
  pierce: number;
  homing: number; // steering strength per tick (0 = ballistic)
};

export type Zone = {
  kind: string;
  shape: "circle" | "line" | "rect" | "ring";
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  w: number;
  a1: number; // ring safe-notch angle 1
  a2: number; // ring safe-notch angle 2
  fireAt: number;
  activeFor: number;
  dmg: number;
  harmless: boolean;
};

export type CoinDrop = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  t: number;
};

export type BossState = {
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  phase: number;
  mode: string;
  t: number;
  mem: number[];
  faceAng: number;
  lastHitSwing: number;
  hitFlash: number;
  vulnerable: boolean;
  /** True in stun/vent/preen-style punish windows: the boss's body stops
   *  hurting on touch, so the reward for reading the fight is actually
   *  collectable at sword range. */
  contactHarmless: boolean;
  contactDmg: number;
  announcedPhase: number;
  dead: boolean;
};

export type RoomState = {
  idx: number;
  kind: RoomRecipe["kind"];
  layout: string;
  mechanic: Mechanic;
  tiles: Uint8Array;
  /** GRASS tiles hiding something: 0 none, 1 coin, 2 ambusher. Indexed like tiles. */
  hidden: Uint8Array;
  entities: Entity[];
  projectiles: Projectile[];
  coins: CoinDrop[];
  zones: Zone[];
  cleared: boolean;
  merchant: { x: number; y: number } | null;
  doorTiles: number[];
  enteredAt: number;
};

export type GameState = {
  tick: number;
  rng: number; // u32 generator state
  seed: number; // the run seed (stable across a world attempt)
  world: number;
  roomIdx: number;
  player: Player;
  room: RoomState;
  boss: BossState | null;
  nextId: number;
  hazardT: number; // world-mechanic clock (lava tides)
  hazardPhase: number; // which lava third floods next / current direction
  deathsThisWorld: number; // pity-discount counter
  pendingDoor: boolean; // player touched the open exit door
  playerDied: boolean;
  bossDownAt: number; // tick the boss died (0 = alive)
};

// -----------------------------------------------------------------------

let parsedCache: Map<string, ParsedRoom> | null = null;
function parsedLayout(id: string): ParsedRoom {
  if (!parsedCache) parsedCache = new Map();
  let p = parsedCache.get(id);
  if (!p) {
    const rows = LAYOUTS[id];
    if (!rows) throw new Error(`unknown layout "${id}"`);
    p = parseRoom(rows);
    parsedCache.set(id, p);
  }
  return p;
}

export function enemyDefFor(kind: string): EnemyDef {
  const def = ENEMY_KINDS[kind] ?? MINION_KINDS[kind];
  if (!def) throw new Error(`unknown enemy kind "${kind}"`);
  return def;
}

function flagBits(def: EnemyDef): number {
  let bits = 0;
  for (const f of def.flags ?? []) {
    if (f === "bogfast") bits |= F.BOGFAST;
    else if (f === "crampons") bits |= F.CRAMPONS;
    else if (f === "phasedark") bits |= F.PHASEDARK;
    else if (f === "lane") bits |= F.LANE;
    else if (f === "burrow") bits |= F.BURROW;
    else if (f === "puddle") bits |= F.PUDDLE;
    else if (f === "bigblast") bits |= F.BIGBLAST;
    else if (f === "burst") bits |= F.BURST;
    else if (f === "hotshield") bits |= F.HOTSHIELD;
  }
  return bits;
}

export function spawnEnemy(
  state: GameState,
  kind: string,
  x: number,
  y: number,
  hpMult = 1,
  grace = 0,
): Entity {
  const def = enemyDefFor(kind);
  const e: Entity = {
    id: state.nextId++,
    kind,
    arch: def.arch,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: Math.round(def.hp * hpMult),
    maxHp: Math.round(def.hp * hpMult),
    r: def.r,
    speed: def.speed,
    coins: def.coins,
    touchDmg: def.touchDmg,
    faceAng: 0,
    mode: "idle",
    t: 0,
    mem: [0, 0, 0, 0],
    lastHitSwing: -1,
    iframesUntil: 0,
    kbx: 0,
    kby: 0,
    shieldHp: def.arch === "shielded" ? 4 : 0,
    spawnGrace: grace,
    hitFlash: 0,
    flags: flagBits(def),
  };
  if (e.flags & F.BURROW) e.mode = "burrow";
  state.room.entities.push(e);
  return e;
}

function buildRoom(state: GameState | null, world: WorldDef, roomIdx: number, rng: Rng, tick: number): RoomState {
  const recipe = world.rooms[roomIdx];
  const parsed = parsedLayout(recipe.layout);
  const tiles = new Uint8Array(parsed.tiles); // copy — grass gets cut, pots break
  const hidden = new Uint8Array(tiles.length);
  const mechanic = recipe.mechanic ?? world.mechanic;

  // Decide what the grass hides — seeded, so a world retry is identical.
  if (mechanic === "grass") {
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === T.GRASS) {
        const roll = rng.next();
        hidden[i] = roll < 0.3 ? 1 : roll < 0.45 ? 2 : 0;
      }
    }
  }

  const room: RoomState = {
    idx: roomIdx,
    kind: recipe.kind,
    layout: recipe.layout,
    mechanic,
    tiles,
    hidden,
    entities: [],
    projectiles: [],
    coins: [],
    zones: [],
    cleared: recipe.kind === "shop",
    merchant: parsed.merchant,
    doorTiles: parsed.doorTiles,
    enteredAt: tick,
  };
  return room;
}

/** Spawn the recipe's enemies into a freshly built room. */
function populateRoom(state: GameState, world: WorldDef): void {
  const recipe = world.rooms[state.roomIdx];
  if (!recipe.spawns) return;
  const parsed = parsedLayout(recipe.layout);
  for (const [marker, kind] of Object.entries(recipe.spawns)) {
    const pos = parsed.spawns.get(marker);
    if (!pos) throw new Error(`layout ${recipe.layout} has no marker ${marker}`);
    spawnEnemy(state, kind, pos.x, pos.y, world.hpMult, 30);
  }
}

export type CheckpointData = {
  maxHp: number;
  hp: number;
  coins: number;
  gear: string[];
  flasks: number;
};

function makePlayer(cp: CheckpointData, entry: { x: number; y: number }): Player {
  const stats = heroStats(cp.gear);
  return {
    x: entry.x,
    y: entry.y,
    vx: 0,
    vy: 0,
    faceAng: 0,
    hp: Math.min(cp.hp, stats.maxHp),
    maxHp: stats.maxHp,
    coins: cp.coins,
    gear: [...cp.gear],
    flasks: Math.min(cp.flasks, stats.flaskMax),
    attack: { phase: "idle", t: 0, ang: 0, id: 0, whirlHits: 0 },
    chargeT: 0,
    dodgeT: 0,
    dodgeAng: 0,
    dodgeReadyAt: 0,
    dodgeCharges: stats.rollCharges,
    parryT: 0,
    iframesUntil: 0,
    kbx: 0,
    kby: 0,
    hitStop: 0,
    cool: {},
    overclockUntil: 0,
    bogT: 0,
    bufAttack: 0,
    bufDodge: 0,
    flashUntil: 0,
  };
}

/**
 * A fresh GameState at the entry of `world`, from a checkpoint snapshot.
 * The same (seed, world, deaths) always builds the identical state —
 * a retry is a fair, identical-odds attempt.
 */
export function enterWorld(
  cp: CheckpointData,
  world: number,
  seed: number,
  deathsThisWorld = 0,
): GameState {
  const def = worldDef(world);
  const rng = new Rng(rngSeed(seed, world * 101));
  const state: GameState = {
    tick: 0,
    rng: 0,
    seed,
    world,
    roomIdx: 0,
    player: makePlayer(cp, { x: 0, y: 0 }),
    room: null as unknown as RoomState, // set below
    boss: null,
    nextId: 1,
    hazardT: 0,
    hazardPhase: 0,
    deathsThisWorld,
    pendingDoor: false,
    playerDied: false,
    bossDownAt: 0,
  };
  state.room = buildRoom(state, def, 0, rng, 0);
  state.rng = rng.state;
  const entry = parsedLayout(def.rooms[0].layout).entry;
  state.player.x = entry.x;
  state.player.y = entry.y;
  populateRoom(state, def);
  return state;
}

/** Advance to the next room in the world's sequence. */
export function enterRoom(state: GameState, roomIdx: number): void {
  const def = worldDef(state.world);
  const rng = new Rng(state.rng);
  state.roomIdx = roomIdx;
  state.room = buildRoom(state, def, roomIdx, rng, state.tick);
  state.rng = rng.state;
  state.pendingDoor = false;
  state.hazardT = 0;
  state.hazardPhase = 0;
  const entry = parsedLayout(def.rooms[roomIdx].layout).entry;
  state.player.x = entry.x;
  state.player.y = entry.y;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.kbx = 0;
  state.player.kby = 0;
  state.boss = null;
  state.bossDownAt = 0;
  populateRoom(state, def);
}

export function checkpointOf(state: GameState): CheckpointData {
  return {
    maxHp: state.player.maxHp,
    hp: state.player.hp,
    coins: state.player.coins,
    gear: [...state.player.gear],
    flasks: state.player.flasks,
  };
}

// -----------------------------------------------------------------------
// State hash — FNV-1a over quantized fields, for the determinism suite.
// -----------------------------------------------------------------------

export function hashState(state: GameState): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 0x01000193);
    h >>>= 0;
  };
  const q = (n: number) => Math.round(n * 16);
  mix(state.tick);
  mix(state.rng);
  mix(state.world * 31 + state.roomIdx);
  const p = state.player;
  mix(q(p.x));
  mix(q(p.y));
  mix(p.hp * 65537 + p.coins);
  mix(p.gear.length);
  for (const e of state.room.entities) {
    mix(e.id);
    mix(q(e.x));
    mix(q(e.y));
    mix(e.hp);
  }
  for (const pr of state.room.projectiles) {
    mix(q(pr.x));
    mix(q(pr.y));
  }
  mix(state.room.coins.length);
  if (state.boss) {
    mix(q(state.boss.x));
    mix(q(state.boss.y));
    mix(state.boss.hp * 7 + state.boss.phase);
  }
  return h;
}
