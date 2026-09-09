export type HeroId =
  | "ember"
  | "volt"
  | "bastion"
  | "cinder"
  | "frost"
  | "thorn"
  | "wisp"
  | "flux"
  | "reaper"
  | "prism";
export const HERO_ORDER: HeroId[] = [
  "ember",
  "volt",
  "bastion",
  "cinder",
  "frost",
  "thorn",
  "wisp",
  "flux",
  "reaper",
  "prism",
];
export const CAMPAIGN_WAVES = 30;
/** A boss closes every chapter; the campaign length is a multiple of this. */
export const BOSS_INTERVAL = 3;
export type FamilyId =
  "kinetic" | "thermal" | "storm" | "frost" | "toxic" | "drone";
export const FAMILY_ORDER: FamilyId[] = [
  "kinetic",
  "thermal",
  "storm",
  "frost",
  "toxic",
  "drone",
];
/** Weapons occupy hands; passives, mods and drones live in the bag. */
export type EquipmentCategory = "weapon" | "passive" | "mod" | "drone";
export type WeaponId =
  | "pistol"
  | "shotgun"
  | "arc"
  | "blade"
  | "rocket"
  | "flame"
  | "frostgun"
  | "needle"
  | "railgun"
  | "boomerang"
  | "beam"
  | "pinball"
  | "thumper"
  | "mortar"
  | "flare"
  | "skyfall"
  | "tesla_orb"
  | "halo"
  | "gravity"
  | "spore_mine"
  | "hive"
  | "sentry"
  | "shatter"
  | "eclipse";
export type ItemId =
  | "power"
  | "haste"
  | "vitality"
  | "plating"
  | "stride"
  | "magnet"
  | "mending"
  | "focus"
  | "kinetic_core"
  | "thermal_core"
  | "storm_core"
  | "frost_core"
  | "toxic_core"
  | "drone_core"
  | "orbit_drone"
  | "gun_drone"
  | "shock_drone"
  | "repair_drone"
  | "magnet_drone"
  | "ricochet"
  | "split_shot"
  | "splash"
  | "homing"
  | "lifesteal"
  | "double_shot"
  | "pierce"
  | "crit_damage"
  | "crit_chance"
  | "attack_range"
  | "shield"
  | "knockback"
  | "status_damage"
  | "slow_power"
  | "momentum"
  | "thorns"
  | "interest"
  | "discount"
  | "free_reroll"
  | "luck"
  | "second_chance"
  | "torch_drone"
  | "frost_drone"
  | "mortar_drone"
  | "aegis_drone"
  | "venom_drone";
export type EnemyKind =
  | "grunt"
  | "runner"
  | "brute"
  | "shooter"
  | "charger"
  | "splitter"
  | "shielder"
  | "bomber"
  | "medic"
  | "sniper"
  | "boss";
export interface HeroDefinition {
  id: HeroId;
  name: string;
  role: string;
  tagline: string;
  description: string;
  color: string;
  weapon: WeaponId;
  weaponSlots: number;
  maxHp: number;
  speed: number;
  dashCooldown: number;
  ability: string;
  abilityDescription: string;
  passive: string;
  passiveDescription: string;
  /** The build-shaping bonus and its cost, Brotato-style. */
  signature: string;
  signatureDescription: string;
  downside: string;
  downsideDescription: string;
  /** Set families the hero counts toward on its own. */
  setPiece: FamilyId[];
}
export const HEROES: Record<HeroId, HeroDefinition> = {
  ember: {
    id: "ember",
    name: "Rook",
    role: "Gunner",
    tagline: "Keep it moving.",
    description: "Fast shots. Easy to learn.",
    color: "#ffb653",
    weapon: "pistol",
    weaponSlots: 2,
    maxHp: 110,
    speed: 6.4,
    dashCooldown: 3.8,
    ability: "Crossfire",
    abilityDescription: "Dash fires 7 shots.",
    passive: "Steady hands",
    passiveDescription: "+10% damage.",
    signature: "Marksman",
    signatureDescription: "Bullets gain +2% damage per unit travelled, up to +40%.",
    downside: "Point blank",
    downsideDescription: "−10% damage to enemies within 3 units.",
    setPiece: [],
  },
  volt: {
    id: "volt",
    name: "Volt",
    role: "Lightning",
    tagline: "Connect the dots.",
    description: "Lightning jumps between enemies.",
    color: "#75e2ed",
    weapon: "arc",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.2,
    dashCooldown: 4.1,
    ability: "Short circuit",
    abilityDescription: "Dash shocks nearby enemies.",
    passive: "Live wire",
    passiveDescription: "15% chance to hit another enemy with lightning.",
    signature: "Conductor",
    signatureDescription: "Counts as 1 Lightning piece. Chain lightning jumps once more. Every 5th kill fires a shock nova.",
    downside: "Glass frame",
    downsideDescription: "−20% max health.",
    setPiece: ["storm"],
  },
  bastion: {
    id: "bastion",
    name: "Bastion",
    role: "Tank",
    tagline: "Make room.",
    description: "More health. Dash through crowds.",
    color: "#b7ec82",
    weapon: "shotgun",
    weaponSlots: 2,
    maxHp: 150,
    speed: 5.8,
    dashCooldown: 4.4,
    ability: "Bulldoze",
    abilityDescription: "Dash damages enemies you run through.",
    passive: "Heavy frame",
    passiveDescription: "+8 armor. +40% knockback.",
    signature: "Fortress",
    signatureDescription: "+1% damage per point of armor.",
    downside: "Heavy arms",
    downsideDescription: "−15% attack speed.",
    setPiece: [],
  },
  cinder: {
    id: "cinder",
    name: "Cinder",
    role: "Fire",
    tagline: "Leave a mark.",
    description: "Burn enemies up close.",
    color: "#ff6a45",
    weapon: "flame",
    weaponSlots: 2,
    maxHp: 115,
    speed: 6.1,
    dashCooldown: 4,
    ability: "Flashover",
    abilityDescription: "Dash burns nearby enemies.",
    passive: "Kindling",
    passiveDescription: "Hits burn for 5 damage/sec.",
    signature: "Wildfire",
    signatureDescription: "Counts as 1 Fire piece. Burning enemies take +25% damage. Burn spreads to a neighbour on death.",
    downside: "Short reach",
    downsideDescription: "−20% weapon range.",
    setPiece: ["thermal"],
  },
  frost: {
    id: "frost",
    name: "Frost",
    role: "Ice",
    tagline: "Take your time.",
    description: "Slow enemies and keep your distance.",
    color: "#9bdeff",
    weapon: "frostgun",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.25,
    dashCooldown: 4.1,
    ability: "Cold snap",
    abilityDescription: "Dash slows nearby enemies by 60%.",
    passive: "Permafrost",
    passiveDescription: "Hits slow enemies by 20%.",
    signature: "Shatter",
    signatureDescription: "Counts as 1 Ice piece. Slowed enemies take +25% damage. Slows are 50% stronger. Cold snap freezes for 1s.",
    downside: "Cold hands",
    downsideDescription: "−15% attack speed.",
    setPiece: ["frost"],
  },
  thorn: {
    id: "thorn",
    name: "Thorn",
    role: "Poison",
    tagline: "Let it sink in.",
    description: "Poison keeps hurting enemies after each hit.",
    color: "#b9db55",
    weapon: "needle",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.35,
    dashCooldown: 3.9,
    ability: "Spore burst",
    abilityDescription: "Dash fires 12 poison needles around you.",
    passive: "Venom",
    passiveDescription: "Hits add poison: 4 damage/sec. Stacks up to 3 times.",
    signature: "Contagion",
    signatureDescription: "Counts as 1 Poison piece. Poison stacks to 5. Poison kills spread stacks nearby.",
    downside: "Weak hits",
    downsideDescription: "−20% direct-hit damage.",
    setPiece: ["toxic"],
  },
  wisp: {
    id: "wisp",
    name: "Wisp",
    role: "Drones",
    tagline: "Never alone.",
    description: "One weapon. Stronger drones.",
    color: "#c9b4ff",
    weapon: "pistol",
    weaponSlots: 1,
    maxHp: 100,
    speed: 6.6,
    dashCooldown: 4.4,
    ability: "Swarm",
    abilityDescription: "Dash: drones attack and heal 3× faster for 4s.",
    passive: "Wingmates",
    passiveDescription: "Starts with a Gunner drone. +40% drone damage.",
    signature: "Swarm",
    signatureDescription: "Counts as 1 Drone piece. Drones fire 50% faster. Drone items cost 25% less.",
    downside: "One hand",
    downsideDescription: "−25% weapon damage.",
    setPiece: ["drone"],
  },
  flux: {
    id: "flux",
    name: "Flux",
    role: "Collector",
    tagline: "Nothing goes to waste.",
    description: "Returning blades. Extra emeralds.",
    color: "#ffd879",
    weapon: "boomerang",
    weaponSlots: 2,
    maxHp: 110,
    speed: 6.35,
    dashCooldown: 3.9,
    ability: "Vacuum",
    abilityDescription: "Dash pulls in nearby enemies and pickups.",
    passive: "Prospector",
    passiveDescription: "+25% emeralds. +50% pickup range.",
    signature: "Prospector",
    signatureDescription: "2 extra bag slots. Rerolls cost half.",
    downside: "Scavenger",
    downsideDescription: "−10% damage.",
    setPiece: [],
  },
  reaper: {
    id: "reaper",
    name: "Reaper",
    role: "Swordfighter",
    tagline: "Stay close.",
    description: "Fight up close. Heal as you attack.",
    color: "#ec8ba5",
    weapon: "blade",
    weaponSlots: 2,
    maxHp: 120,
    speed: 6.5,
    dashCooldown: 3.2,
    ability: "Harvest",
    abilityDescription: "Dash hits nearby enemies and heals you.",
    passive: "Blood circuit",
    passiveDescription: "Sword kills restore 2 health.",
    signature: "Bloodlust",
    signatureDescription: "Each kill gives +4% attack speed for 3s, up to +40%. +30% damage within 4 units.",
    downside: "Close quarters",
    downsideDescription: "Weapons with range over 6 deal −30%.",
    setPiece: [],
  },
  prism: {
    id: "prism",
    name: "Prism",
    role: "Four weapons",
    tagline: "Try everything.",
    description: "Carry four weapons. Mix them for more damage.",
    color: "#eab5f7",
    weapon: "beam",
    weaponSlots: 4,
    maxHp: 110,
    speed: 6.3,
    dashCooldown: 4.1,
    ability: "Refraction",
    abilityDescription: "Dash fires 3 beams through enemies.",
    passive: "Spectrum",
    passiveDescription: "+5% damage per different weapon type.",
    signature: "Lattice",
    signatureDescription: "Weapons in your bag still count toward Sets.",
    downside: "Fragile",
    downsideDescription: "−15% max health.",
    setPiece: [],
  },
};
/**
 * How a weapon attacks. The simulation dispatches on `kind`; every number a
 * rank can change comes out of `pattern(level)` so the shop, guide and bots
 * describe exactly what fires.
 */
export interface BulletChildren {
  count: number;
  /** Fraction of the parent's damage. */
  damage: number;
  speed: number;
  life: number;
  pierce: number;
  homing?: number;
  /** Spread the children evenly around the burst point instead of forward. */
  radial?: boolean;
}
export interface BulletSpec {
  kind: "bullet";
  count: number;
  /** Angle between neighbouring projectiles, radians. */
  spread: number;
  speed: number;
  life: number;
  pierce: number;
  radius?: number;
  knock?: number;
  /** Explosion radius applied on every hit. */
  splash?: number;
  returning?: boolean;
  /** Turn rate toward the nearest enemy, radians per second. */
  homing?: number;
  bounces?: number;
  /** Seconds before the projectile stops (pull/emit) or bursts (children). */
  fuse?: number;
  /** Spawns at the player and never moves. */
  stationary?: boolean;
  /** Radius growth per second for expanding rings. */
  grow?: number;
  /** Oldest projectile from this weapon expires beyond this many. */
  maxActive?: number;
  children?: BulletChildren;
  trail?: { every: number; radius: number; duration: number; damage: number };
  pull?: { radius: number; force: number; duration: number };
  emit?: {
    every: number;
    kind: "zap" | "shot" | "crush";
    reach: number;
    /** Fraction of the projectile's damage per emission. */
    damage: number;
  };
  /** Circles the player instead of flying. */
  orbit?: { radius: number; angular: number; rearm: number };
  /** Passes through enemies without contact damage; only its effects hurt. */
  noContact?: boolean;
  /** Aim at the enemy with the most neighbours instead of the nearest. */
  aimCluster?: boolean;
  /** Storm bolts fired at everything in reach when a pull collapses. */
  bolts?: { reach: number; damage: number };
}
export interface LineSpec {
  kind: "line";
  reach: number;
  knock: number;
}
export interface ConeSpec {
  kind: "cone";
  reach: number;
  /** Minimum cosine between the aim and an enemy for a hit. */
  arc: number;
  knock: number;
}
export interface ChainSpec {
  kind: "chain";
  jumps: number;
  falloff: number;
  reach: number;
  knock: number;
}
export interface MeleeSpec {
  kind: "melee";
  reach: number;
  /** Enemies with a cosine below this are behind the swing and are skipped. */
  arc?: number;
  knock: number;
}
export interface OrbitSpec {
  kind: "orbit";
  count: number;
  radius: number;
  angular: number;
  life: number;
  rearm: number;
}
export interface StrikeSpec {
  kind: "strike";
  delay: number;
  radius: number;
  knock: number;
  shells: number;
}
export interface BoltsSpec {
  kind: "bolts";
  targets: number;
  splash: number;
  knock: number;
}
export interface SingularitySpec {
  kind: "singularity";
  speed: number;
  fuse: number;
  pull: { radius: number; force: number; duration: number };
  crush: { every: number; reach: number; damage: number };
  collapse: { radius: number; damage: number; knock: number };
  bolts: { reach: number; damage: number };
}
export type PatternSpec =
  | BulletSpec
  | LineSpec
  | ConeSpec
  | ChainSpec
  | MeleeSpec
  | OrbitSpec
  | StrikeSpec
  | BoltsSpec
  | SingularitySpec;
export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  description: string;
  color: string;
  cost: number;
  damage: number;
  cooldown: number;
  range: number;
  families: FamilyId[];
  stats: string[];
  pattern: (level: number) => PatternSpec;
  /** Shop weight; 0 keeps a weapon out of the normal pool. Default 1. */
  weight?: number;
  /** First wave the shop may offer it. Default 1. */
  minWave?: number;
  /** One per run, no rank scaling, no merging. */
  unique?: boolean;
  /** Overrides the generated rank stat lines. */
  statLines?: (level: number, scale: number) => string[];
  rankDescription?: (level: number) => string;
}
export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Sidearm",
    description: "Pistol. Fires two shots at once.",
    color: "#ffb56d",
    cost: 14,
    damage: 14,
    cooldown: 0.36,
    range: 13,
    families: ["kinetic"],
    stats: ["14 × 2 damage", "0.36s per attack"],
    pattern: (level) => ({
      kind: "bullet",
      count: 2,
      spread: 0.09,
      speed: 24,
      life: 0.68,
      pierce: level >= 3 ? 2 : 1,
    }),
  },
  shotgun: {
    id: "shotgun",
    name: "Scattergun",
    description: "Shotgun. Pellets in a wide spread.",
    color: "#bfdc8a",
    cost: 17,
    damage: 13,
    cooldown: 0.84,
    range: 9,
    families: ["kinetic"],
    stats: ["13 × 5 damage", "Wide spread"],
    pattern: (level) => ({
      kind: "bullet",
      count: level >= 3 ? 7 : 5,
      spread: 0.12,
      speed: 21,
      life: 0.44,
      pierce: 1,
      knock: 2.2,
    }),
    rankDescription: (level) =>
      level >= 3
        ? "Shotgun. Seven pellets in a wide spread."
        : "Shotgun. Pellets in a wide spread.",
  },
  arc: {
    id: "arc",
    name: "Arc coil",
    description: "Lightning that jumps between enemies.",
    color: "#7ae8ff",
    cost: 18,
    damage: 25,
    cooldown: 0.82,
    range: 11,
    families: ["storm"],
    stats: ["25 damage", "4 targets"],
    pattern: (level) => ({
      kind: "chain",
      jumps: 3 + level,
      falloff: 0.86,
      reach: 4.2 + level * 0.35,
      knock: 0.35,
    }),
  },
  blade: {
    id: "blade",
    name: "Scrapblade",
    description: "Sword. Wide swings push enemies back.",
    color: "#ffba65",
    cost: 15,
    damage: 44,
    cooldown: 0.65,
    range: 3.8,
    families: ["kinetic", "toxic"],
    stats: ["44 damage", "Close range"],
    pattern: (level) => ({
      kind: "melee",
      reach: 3.8 + (level - 1) * 0.35,
      arc: -0.3,
      knock: 3,
    }),
  },
  rocket: {
    id: "rocket",
    name: "Firework",
    description: "Rocket launcher. Explodes on impact.",
    color: "#f6a1db",
    cost: 22,
    damage: 64,
    cooldown: 1.15,
    range: 15,
    families: ["thermal"],
    stats: ["64 damage", "Blast radius 2.85"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 12,
      life: 1.7,
      pierce: 1,
      radius: 0.3,
      splash: 2.5 + level * 0.35,
      knock: 6,
    }),
  },
  flame: {
    id: "flame",
    name: "Torch",
    description: "Flamethrower. Burns nearby enemies.",
    color: "#ff794d",
    cost: 17,
    damage: 10,
    cooldown: 0.19,
    range: 6.5,
    families: ["thermal"],
    stats: ["10 damage", "6 burn damage/sec"],
    pattern: (level) => ({
      kind: "cone",
      reach: 6.5 + (level - 1) * 0.35,
      arc: 0.78,
      knock: 0.4,
    }),
  },
  frostgun: {
    id: "frostgun",
    name: "Coldfront",
    description: "Ice gun. Three shards slow enemies.",
    color: "#a4dfff",
    cost: 17,
    damage: 16,
    cooldown: 0.5,
    range: 12,
    families: ["frost"],
    stats: ["16 × 3 damage", "30% slow"],
    pattern: () => ({
      kind: "bullet",
      count: 3,
      spread: 0.1,
      speed: 22,
      life: 0.62,
      pierce: 1,
    }),
  },
  needle: {
    id: "needle",
    name: "Stinger",
    description: "Needle gun. Pierces and poisons.",
    color: "#b4d863",
    cost: 16,
    damage: 12,
    cooldown: 0.22,
    range: 13,
    families: ["toxic"],
    stats: ["12 damage", "4 poison damage/sec"],
    pattern: () => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 27,
      life: 0.58,
      pierce: 2,
    }),
  },
  railgun: {
    id: "railgun",
    name: "Longshot",
    description: "Rifle. Fires through enemies in a line.",
    color: "#aaceea",
    cost: 23,
    damage: 92,
    cooldown: 1.35,
    range: 19,
    families: ["kinetic", "storm"],
    stats: ["92 damage", "Hits enemies in a line"],
    pattern: (level) => ({
      kind: "line",
      reach: 19 + (level - 1) * 0.7,
      knock: 3,
    }),
  },
  boomerang: {
    id: "boomerang",
    name: "Returner",
    description: "Boomerang. Hits on the way out and back.",
    color: "#f0d17f",
    cost: 18,
    damage: 28,
    cooldown: 0.85,
    range: 13,
    families: ["kinetic", "drone"],
    stats: ["28 damage", "Hits on return"],
    pattern: () => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 16,
      life: 1.7,
      pierce: 20,
      returning: true,
    }),
  },
  beam: {
    id: "beam",
    name: "Splitter",
    description: "Laser. Fires through enemies in a line.",
    color: "#d6b8fb",
    cost: 22,
    damage: 25,
    cooldown: 0.32,
    range: 12,
    families: ["thermal", "storm"],
    stats: ["25 damage", "Hits enemies in a line"],
    pattern: (level) => ({
      kind: "line",
      reach: 12 + (level - 1) * 0.7,
      knock: 0.5,
    }),
  },
  pinball: {
    id: "pinball",
    name: "Ricochet ball",
    description: "Ball launcher. The ball bounces between enemies.",
    color: "#e2c48f",
    cost: 19,
    damage: 34,
    cooldown: 0.7,
    range: 12,
    families: ["kinetic"],
    stats: ["34 damage", "Bounces"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 20,
      life: 1.6,
      pierce: 1,
      radius: 0.2,
      knock: 1.2,
      bounces: 2 + Math.ceil(level / 2),
    }),
    rankDescription: (level) =>
      `Ball launcher. The ball bounces to ${2 + Math.ceil(level / 2)} more enemies.`,
  },
  thumper: {
    id: "thumper",
    name: "Thumper",
    description: "Piston hammer. A shockwave knocks everything around you back.",
    color: "#d8b083",
    cost: 18,
    damage: 46,
    cooldown: 1.1,
    range: 6,
    families: ["kinetic"],
    stats: ["46 damage", "Shockwave"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 0,
      life: 0.4,
      pierce: 99,
      radius: 0.3,
      stationary: true,
      grow: (6 + 0.4 * (level - 1)) / 0.4,
      knock: level >= 4 ? 9 : 7,
    }),
  },
  mortar: {
    id: "mortar",
    name: "Lobber",
    description: "Mortar. Shells land where the enemy stands.",
    color: "#f0a36a",
    cost: 22,
    damage: 70,
    cooldown: 1.4,
    range: 16,
    families: ["thermal", "kinetic"],
    stats: ["70 damage", "Splash damage"],
    pattern: (level) => ({
      kind: "strike",
      delay: 0.7,
      radius: 2.2 + 0.2 * (level - 1),
      knock: 5,
      shells: level >= 4 ? 2 : 1,
    }),
  },
  flare: {
    id: "flare",
    name: "Flare launcher",
    description: "Flare gun. Leaves a burning trail on the floor.",
    color: "#ff8f5a",
    cost: 20,
    damage: 9,
    cooldown: 1,
    range: 11,
    families: ["thermal"],
    stats: ["9 damage / tick", "Fire trail"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 9,
      life: 1.3,
      pierce: 3,
      radius: 0.18,
      trail: {
        every: 0.14,
        radius: 1.1,
        duration: 2.5 + 0.3 * (level - 1),
        damage: 1,
      },
    }),
    statLines: (level, scale) => [
      `${Math.round(9 * scale)} damage, 4 times a second`,
      "1s per attack",
      `Flare gun. The trail burns for ${(2.5 + 0.3 * (level - 1)).toFixed(1)}s.`,
    ],
  },
  skyfall: {
    id: "skyfall",
    name: "Skyfall",
    description: "Calls lightning down on several enemies at once.",
    color: "#9ee6ff",
    cost: 21,
    damage: 30,
    cooldown: 0.95,
    range: 13,
    families: ["storm"],
    stats: ["30 damage", "Several targets"],
    pattern: (level) => ({
      kind: "bolts",
      targets: 2 + Math.floor(level / 2),
      splash: 1.2,
      knock: 1,
    }),
  },
  tesla_orb: {
    id: "tesla_orb",
    name: "Tesla orb",
    description: "A slow orb that zaps everything it drifts past.",
    color: "#8ad4f5",
    cost: 22,
    damage: 12,
    cooldown: 1.6,
    range: 12,
    families: ["storm", "drone"],
    stats: ["12 damage per zap", "Drifting orb"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 6,
      life: 2.2 + 0.15 * (level - 1),
      pierce: 99,
      radius: 0.35,
      noContact: true,
      emit: {
        every: 0.18,
        kind: "zap",
        reach: 3.5 + 0.3 * (level - 1),
        damage: 1,
      },
    }),
    statLines: (level, scale) => [
      `${Math.round(12 * scale)} damage per zap`,
      "1.6s per attack",
      `Orb zaps every 0.18s within ${(3.5 + 0.3 * (level - 1)).toFixed(1)} for ${(2.2 + 0.15 * (level - 1)).toFixed(1)}s.`,
    ],
  },
  halo: {
    id: "halo",
    name: "Ice halo",
    description: "Ice crystals circle you and cut anything that comes close.",
    color: "#bde8ff",
    cost: 19,
    damage: 14,
    cooldown: 3.2,
    range: 8,
    families: ["frost"],
    stats: ["14 damage", "Orbiting crystals"],
    pattern: (level) => ({
      kind: "orbit",
      count: 3 + Math.floor(level / 2),
      radius: 2.6 + 0.15 * (level - 1),
      angular: 2.4,
      life: 3,
      rearm: 0.45,
    }),
    rankDescription: (level) =>
      `${3 + Math.floor(level / 2)} ice crystals circle you for 3s, hitting every 0.45s.`,
  },
  gravity: {
    id: "gravity",
    name: "Gravity well",
    description: "Pulls enemies together, then blows them apart.",
    color: "#b9c8ff",
    cost: 23,
    damage: 55,
    cooldown: 2.2,
    range: 13,
    families: ["frost", "storm"],
    stats: ["55 damage", "Pull, then splash"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 7,
      life: 6,
      pierce: 99,
      radius: 0.3,
      noContact: true,
      fuse: 0.5,
      pull: { radius: 4 + 0.3 * (level - 1), force: 9, duration: 1.2 },
      splash: 2.4,
      knock: 4,
    }),
  },
  spore_mine: {
    id: "spore_mine",
    name: "Spore mine",
    description: "Drops mines at your feet. They burst when stepped on.",
    color: "#c5e07a",
    cost: 19,
    damage: 60,
    cooldown: 1.3,
    range: 9,
    families: ["toxic"],
    stats: ["60 damage", "Splash damage"],
    pattern: (level) => ({
      kind: "bullet",
      count: level >= 4 ? 2 : 1,
      spread: 2.4,
      speed: 0,
      life: 12,
      pierce: 1,
      radius: 0.55,
      stationary: true,
      splash: 2 + 0.2 * (level - 1),
      knock: 3,
      maxActive: 8,
    }),
  },
  hive: {
    id: "hive",
    name: "Hive launcher",
    description: "A pod that bursts into homing wasps.",
    color: "#d5d86a",
    cost: 21,
    damage: 20,
    cooldown: 1.25,
    range: 12,
    families: ["toxic", "drone"],
    stats: ["20 damage", "Homing wasps"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 14,
      life: 1.2,
      pierce: 1,
      radius: 0.2,
      fuse: 0.45,
      children: {
        count: 4 + level,
        damage: 0.45,
        speed: 12,
        life: 1.6,
        pierce: 1,
        homing: 10,
      },
    }),
    statLines: (level, scale) => [
      `${Math.round(20 * scale)} + ${4 + level} × ${Math.round(20 * scale * 0.45)} damage`,
      "1.25s per attack",
      `Pod bursts into ${4 + level} homing wasps.`,
    ],
  },
  sentry: {
    id: "sentry",
    name: "Sentry pod",
    description: "Drops a turret that shoots on its own for a while.",
    color: "#d9c39a",
    cost: 22,
    damage: 11,
    cooldown: 3.5,
    range: 14,
    families: ["drone", "kinetic"],
    stats: ["11 damage per shot", "Turret"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 0,
      life: 6 + 0.5 * (level - 1),
      pierce: 999,
      radius: 0.4,
      stationary: true,
      noContact: true,
      maxActive: 2,
      emit: {
        every: Math.max(0.18, 0.3 - 0.02 * (level - 1)),
        kind: "shot",
        reach: 11,
        damage: 1,
      },
    }),
    statLines: (level, scale) => [
      `${Math.round(11 * scale)} damage per shot`,
      "3.5s per attack",
      `Turret lasts ${(6 + 0.5 * (level - 1)).toFixed(1)}s and fires every ${Math.max(0.18, 0.3 - 0.02 * (level - 1)).toFixed(2)}s. Two at a time.`,
    ],
  },
  shatter: {
    id: "shatter",
    name: "Shatter cannon",
    description: "A crystal shell that shatters into fragments on impact.",
    color: "#c9dcf2",
    cost: 20,
    damage: 30,
    cooldown: 0.9,
    range: 12,
    families: ["drone", "frost"],
    stats: ["30 damage", "Fragments"],
    pattern: (level) => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 22,
      life: 0.7,
      pierce: 1,
      radius: 0.16,
      children: {
        count: 6 + (level - 1),
        damage: 0.33,
        speed: 18,
        life: 0.5,
        pierce: 1,
        radial: true,
      },
    }),
    statLines: (level, scale) => [
      `${Math.round(30 * scale)} + ${6 + (level - 1)} × ${Math.round(30 * scale * 0.33)} damage`,
      "0.9s per attack",
      `Shell shatters into ${6 + (level - 1)} fragments.`,
    ],
  },
  eclipse: {
    id: "eclipse",
    name: "Eclipse",
    description:
      "A black hole. Drags in every enemy nearby, crushes them, then collapses with a storm.",
    color: "#ff3df0",
    cost: 45,
    damage: 420,
    cooldown: 7,
    range: 15,
    families: ["kinetic", "thermal", "storm", "frost", "toxic", "drone"],
    stats: ["420 damage", "Counts as every set"],
    unique: true,
    weight: 0,
    minWave: 20,
    pattern: () => ({
      kind: "bullet",
      count: 1,
      spread: 0,
      speed: 5,
      life: 8,
      pierce: 999,
      radius: 0.5,
      noContact: true,
      aimCluster: true,
      fuse: 0.6,
      pull: { radius: 7, force: 14, duration: 3 },
      emit: { every: 0.25, kind: "crush", reach: 2.2, damage: 30 / 420 },
      splash: 5,
      knock: 12,
      bolts: { reach: 9, damage: 150 / 420 },
    }),
    statLines: () => [
      "420 collapse damage",
      "7s per attack",
      "Pulls enemies in for 3s, crushing them for 120 damage/s. Collapses for 420 in a radius of 5, then bolts everything within 9 for 150. Counts as one piece of every Set. Cannot be merged.",
    ],
  },
};
/** Projectiles or targets per attack, for stat lines and bot scoring. */
export const patternCount = (spec: PatternSpec): number =>
  spec.kind === "bullet"
    ? spec.count
    : spec.kind === "orbit"
      ? spec.count
      : spec.kind === "bolts"
        ? spec.targets
        : spec.kind === "strike"
          ? spec.shells
          : 1;
export type DroneId =
  | "orbit_drone"
  | "gun_drone"
  | "shock_drone"
  | "repair_drone"
  | "magnet_drone"
  | "torch_drone"
  | "frost_drone"
  | "mortar_drone"
  | "aegis_drone"
  | "venom_drone";
export type DroneAttack =
  | "orbit"
  | "gun"
  | "shock"
  | "repair"
  | "magnet"
  | "flame"
  | "pulse"
  | "strike"
  | "guard"
  | "spray";
/** Drone attacks that count as being armed. */
export const OFFENSIVE_DRONES: DroneAttack[] = [
  "gun",
  "orbit",
  "shock",
  "flame",
  "pulse",
  "strike",
  "spray",
];
export type PassiveStat =
  | "damage"
  | "attackSpeed"
  | "maxHp"
  | "armor"
  | "speed"
  | "magnet"
  | "healing"
  | "dashRecovery"
  | "salvage"
  | "burnDamage"
  | "poisonDamage"
  | "critChance"
  | "critDamage"
  | "range"
  | "barrierRate"
  | "knockback"
  | "dotPower"
  | "slowPower"
  | "momentum"
  | "thorns"
  | "ricochet"
  | "split"
  | "splash"
  | "homing"
  | "lifesteal"
  | "echo"
  | "pierce"
  | "interest"
  | "discount"
  | "freeRerolls"
  | "luck"
  | "emergency";
export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  cost: number;
  color: string;
  category: Exclude<EquipmentCategory, "weapon">;
  families: FamilyId[];
  family?: FamilyId;
  stats: string[];
  passiveStats: Partial<Record<PassiveStat, number>>;
  drone?: {
    attack: DroneAttack;
    damage: number;
    cooldown: number;
    range: number;
  };
  /** Shop weight (default 1) and the first wave it can appear. */
  weight?: number;
  minWave?: number;
}
const item = (
  id: ItemId,
  name: string,
  description: string,
  cost: number,
  color: string,
  passiveStats: ItemDefinition["passiveStats"],
  families: FamilyId[] = [],
): ItemDefinition => ({
  id,
  name,
  description,
  cost,
  color,
  category: "passive",
  families,
  family: families[0],
  stats: [description],
  passiveStats,
});
/** Mods change how every bullet you fire behaves. They live in the bag. */
const mod = (
  id: ItemId,
  name: string,
  description: string,
  cost: number,
  color: string,
  passiveStats: ItemDefinition["passiveStats"],
  families: FamilyId[],
): ItemDefinition => ({
  ...item(id, name, description, cost, color, passiveStats, families),
  category: "mod",
  weight: 0.8,
  minWave: 4,
});
const drone = (
  id: ItemId,
  name: string,
  description: string,
  cost: number,
  color: string,
  families: FamilyId[],
  spec: NonNullable<ItemDefinition["drone"]>,
  passiveStats: ItemDefinition["passiveStats"] = {},
): ItemDefinition => ({
  ...item(id, name, description, cost, color, passiveStats, families),
  category: "drone",
  drone: spec,
  weight: 0.9,
});
export const ITEMS: Record<ItemId, ItemDefinition> = {
  power: item(
    "power",
    "Hot core",
    "+14% damage",
    12,
    "#ff9468",
    { damage: 0.14 },
    ["thermal"],
  ),
  haste: item(
    "haste",
    "Quickdraw",
    "+10% attack speed",
    13,
    "#efd378",
    { attackSpeed: 0.1 },
    ["kinetic"],
  ),
  vitality: item(
    "vitality",
    "Second heart",
    "+22 max health",
    13,
    "#ef8c9d",
    { maxHp: 22 },
    ["toxic"],
  ),
  plating: item(
    "plating",
    "Ceramic plate",
    "+7 armor",
    12,
    "#a9c895",
    { armor: 7 },
    ["kinetic"],
  ),
  stride: item(
    "stride",
    "Servo boost",
    "+7% movement speed",
    11,
    "#a8e4d5",
    { speed: 0.07 },
    ["frost"],
  ),
  magnet: item(
    "magnet",
    "Lucky pull",
    "+35% pickup range. +8% emeralds.",
    10,
    "#dbcc84",
    { magnet: 0.35, salvage: 0.08 },
    ["drone"],
  ),
  mending: item(
    "mending",
    "Repair cell",
    "Heal 1 health every 3 seconds.",
    14,
    "#9bdf9e",
    { healing: 1 / 3 },
    ["toxic"],
  ),
  focus: item(
    "focus",
    "Second wind",
    "Dash recharges 14% faster.",
    12,
    "#b7c4fa",
    { dashRecovery: 0.14 },
    ["storm"],
  ),
  kinetic_core: item(
    "kinetic_core",
    "Physical module",
    "+6% damage. +3 armor.",
    15,
    "#edc280",
    { damage: 0.06, armor: 3 },
    ["kinetic"],
  ),
  thermal_core: item(
    "thermal_core",
    "Fire module",
    "+6% damage. Your hits burn for 3 / second.",
    15,
    "#ff8658",
    { damage: 0.06, burnDamage: 3 },
    ["thermal"],
  ),
  storm_core: item(
    "storm_core",
    "Lightning module",
    "+5% attack speed. Dash recharges 6% faster.",
    15,
    "#8ce5f2",
    { attackSpeed: 0.05, dashRecovery: 0.06 },
    ["storm"],
  ),
  frost_core: item(
    "frost_core",
    "Ice module",
    "+8 max health. +3% movement speed.",
    15,
    "#a6dfff",
    { maxHp: 8, speed: 0.03 },
    ["frost"],
  ),
  toxic_core: item(
    "toxic_core",
    "Poison module",
    "Heal 0.5 health every 3 seconds. Your hits poison for 2 / second.",
    15,
    "#badb72",
    { healing: 1 / 6, poisonDamage: 2 },
    ["toxic"],
  ),
  drone_core: item(
    "drone_core",
    "Drone module",
    "+5% attack speed. +10% pickup range.",
    15,
    "#d1b5ff",
    { attackSpeed: 0.05, magnet: 0.1 },
    ["drone"],
  ),
  orbit_drone: {
    ...item(
      "orbit_drone",
      "Orbit drone",
      "Circles you and hits nearby enemies.",
      20,
      "#ccb8ff",
      {},
      ["drone"],
    ),
    category: "drone",
    drone: { attack: "orbit", damage: 28, cooldown: 0.45, range: 1.8 },
  },
  gun_drone: {
    ...item(
      "gun_drone",
      "Gunner drone",
      "Follows you and shoots enemies.",
      20,
      "#f2bc7e",
      {},
      ["drone", "kinetic"],
    ),
    category: "drone",
    drone: { attack: "gun", damage: 23, cooldown: 0.55, range: 14 },
  },
  shock_drone: {
    ...item(
      "shock_drone",
      "Arc drone",
      "Lightning hits up to 3 enemies.",
      23,
      "#91e1e9",
      {},
      ["drone", "storm"],
    ),
    category: "drone",
    drone: { attack: "shock", damage: 22, cooldown: 0.9, range: 10 },
  },
  repair_drone: {
    ...item(
      "repair_drone",
      "Medic drone",
      "Restores health every 4 seconds.",
      22,
      "#b1e7a7",
      {},
      ["drone", "toxic"],
    ),
    category: "drone",
    drone: { attack: "repair", damage: 2, cooldown: 4, range: 0 },
  },
  magnet_drone: {
    ...item(
      "magnet_drone",
      "Collector drone",
      "+30% pickup range. +10% emeralds. Pulls in nearby emeralds.",
      18,
      "#f0d78e",
      { magnet: 0.3, salvage: 0.1 },
      ["drone"],
    ),
    category: "drone",
    drone: { attack: "magnet", damage: 0, cooldown: 1, range: 0 },
  },
  ricochet: mod(
    "ricochet",
    "Ricochet",
    "Bullets bounce to another enemy.",
    17,
    "#e6c27a",
    { ricochet: 1 },
    ["kinetic"],
  ),
  split_shot: mod(
    "split_shot",
    "Split shot",
    "Bullets split into fragments on their first hit.",
    17,
    "#ffa068",
    { split: 1 },
    ["thermal"],
  ),
  splash: mod(
    "splash",
    "Splash damage",
    "Every hit also damages enemies next to the target.",
    17,
    "#ff8a5c",
    { splash: 0.3 },
    ["thermal"],
  ),
  homing: mod(
    "homing",
    "Homing",
    "Bullets steer toward the nearest enemy.",
    16,
    "#cfbcff",
    { homing: 3 },
    ["drone"],
  ),
  lifesteal: mod(
    "lifesteal",
    "Lifesteal",
    "Hits heal you for a share of the damage dealt.",
    18,
    "#c8e07a",
    { lifesteal: 0.004 },
    ["toxic"],
  ),
  double_shot: mod(
    "double_shot",
    "Double shot",
    "Chance to fire every attack twice.",
    18,
    "#9ee8f2",
    { echo: 0.12 },
    ["storm"],
  ),
  pierce: mod(
    "pierce",
    "Pierce",
    "Bullets pass through more enemies.",
    16,
    "#b6e0ff",
    { pierce: 1 },
    ["frost"],
  ),
  crit_damage: mod(
    "crit_damage",
    "Crit damage",
    "Critical hits deal more damage.",
    17,
    "#f2d07e",
    { critDamage: 0.3 },
    ["kinetic"],
  ),
  crit_chance: item(
    "crit_chance",
    "Crit chance",
    "+8% critical chance",
    13,
    "#efd48a",
    { critChance: 0.08 },
    ["kinetic"],
  ),
  attack_range: item(
    "attack_range",
    "Attack range",
    "+12% attack range",
    13,
    "#8fe1ea",
    { range: 0.12 },
    ["storm"],
  ),
  shield: item(
    "shield",
    "Shield",
    "Gain a shield charge every 12 seconds. A charge absorbs one hit.",
    15,
    "#a9dfff",
    { barrierRate: 1 / 12 },
    ["frost"],
  ),
  knockback: item(
    "knockback",
    "Knockback",
    "+40% knockback",
    11,
    "#d6c3ff",
    { knockback: 0.4 },
    ["drone"],
  ),
  status_damage: item(
    "status_damage",
    "Status damage",
    "+25% burn and poison damage",
    14,
    "#ff9d6a",
    { dotPower: 0.25 },
    ["thermal"],
  ),
  slow_power: item(
    "slow_power",
    "Slow power",
    "Your slows are 15% stronger.",
    14,
    "#b8e6ff",
    { slowPower: 0.15 },
    ["frost"],
  ),
  momentum: item(
    "momentum",
    "Momentum",
    "+12% damage while moving",
    14,
    "#a5e3ec",
    { momentum: 0.12 },
    ["storm"],
  ),
  thorns: item(
    "thorns",
    "Thorns",
    "Enemies that touch you get poisoned.",
    13,
    "#b9dd6c",
    { thorns: 1 },
    ["toxic"],
  ),
  interest: item(
    "interest",
    "Interest",
    "Earn 5% of your unspent emeralds after every wave.",
    14,
    "#e8d78c",
    { interest: 0.05 },
    ["drone"],
  ),
  discount: item(
    "discount",
    "Discount",
    "Shop prices −6%",
    16,
    "#e3c98a",
    { discount: 0.06 },
    ["kinetic"],
  ),
  free_reroll: item(
    "free_reroll",
    "Free reroll",
    "The first reroll in every shop is free.",
    15,
    "#ffb17a",
    { freeRerolls: 1 },
    ["thermal"],
  ),
  luck: item(
    "luck",
    "Luck",
    "+6% chance of higher-rank offers.",
    15,
    "#a3ecf0",
    { luck: 0.06 },
    ["storm"],
  ),
  second_chance: item(
    "second_chance",
    "Second chance",
    "Once per wave, dropping below 25% health heals 30%.",
    16,
    "#c4e58c",
    { emergency: 0.3 },
    ["toxic"],
  ),
  torch_drone: drone(
    "torch_drone",
    "Torch drone",
    "Follows you and burns nearby enemies.",
    22,
    "#ff9a66",
    ["drone", "thermal"],
    { attack: "flame", damage: 9, cooldown: 0.25, range: 3.5 },
  ),
  frost_drone: drone(
    "frost_drone",
    "Frost drone",
    "Pulses cold that slows everything around it.",
    22,
    "#b3e4ff",
    ["drone", "frost"],
    { attack: "pulse", damage: 14, cooldown: 1.2, range: 3.8 },
  ),
  mortar_drone: drone(
    "mortar_drone",
    "Mortar drone",
    "Lobs shells at the farthest enemy it can see.",
    24,
    "#e8bf8c",
    ["drone", "kinetic"],
    { attack: "strike", damage: 40, cooldown: 2, range: 14 },
  ),
  aegis_drone: drone(
    "aegis_drone",
    "Aegis drone",
    "Gives you a shield charge every 9 seconds.",
    23,
    "#c7d9f7",
    ["drone", "kinetic"],
    { attack: "guard", damage: 0, cooldown: 9, range: 0 },
  ),
  venom_drone: drone(
    "venom_drone",
    "Venom drone",
    "Sprays a poison pool under the nearest enemy.",
    23,
    "#bfe07a",
    ["drone", "toxic"],
    { attack: "spray", damage: 8, cooldown: 2.5, range: 10 },
  ),
};
export const RANKS = [
  { level: 1, name: "Scrap", color: "#a9b0b5" },
  { level: 2, name: "Forged", color: "#8ed49c" },
  { level: 3, name: "Rare", color: "#76baff" },
  { level: 4, name: "Epic", color: "#c6a1ff" },
  { level: 5, name: "Mythic", color: "#f47c7c" },
  { level: 6, name: "Legendary", color: "#ffe293" },
] as const;
export const rankScale = (level: number): number =>
  [1, 1.5, 2.25, 3.4, 5.1, 7.7][
    Math.max(0, Math.min(5, Math.floor(level) - 1))
  ];
/** How each passive stat prints: percent of a base, a flat amount, or per second. */
export const PASSIVE_FORMAT: Record<
  PassiveStat,
  { label: string; unit: "percent" | "flat" | "healing" | "count" }
> = {
  damage: { label: "damage", unit: "percent" },
  attackSpeed: { label: "attack speed", unit: "percent" },
  maxHp: { label: "max health", unit: "flat" },
  armor: { label: "armor", unit: "flat" },
  speed: { label: "movement speed", unit: "percent" },
  magnet: { label: "pickup range", unit: "percent" },
  healing: { label: "health / second", unit: "healing" },
  dashRecovery: { label: "dash recharge", unit: "percent" },
  salvage: { label: "emeralds", unit: "percent" },
  burnDamage: { label: "burn / second", unit: "flat" },
  poisonDamage: { label: "poison / second", unit: "flat" },
  critChance: { label: "crit chance", unit: "percent" },
  critDamage: { label: "crit damage", unit: "percent" },
  range: { label: "attack range", unit: "percent" },
  barrierRate: { label: "shield charges / 12s", unit: "count" },
  knockback: { label: "knockback", unit: "percent" },
  dotPower: { label: "burn and poison damage", unit: "percent" },
  slowPower: { label: "slow strength", unit: "percent" },
  momentum: { label: "damage while moving", unit: "percent" },
  thorns: { label: "poison stacks to attackers", unit: "count" },
  ricochet: { label: "ricochet bounces", unit: "count" },
  split: { label: "split fragments", unit: "count" },
  splash: { label: "splash damage", unit: "percent" },
  homing: { label: "homing turn rate", unit: "flat" },
  lifesteal: { label: "lifesteal", unit: "percent" },
  echo: { label: "double shot chance", unit: "percent" },
  pierce: { label: "pierce", unit: "count" },
  interest: { label: "interest on unspent emeralds", unit: "percent" },
  discount: { label: "shop discount", unit: "percent" },
  freeRerolls: { label: "free rerolls per shop", unit: "count" },
  luck: { label: "luck", unit: "percent" },
  emergency: { label: "emergency heal", unit: "percent" },
};
export function passiveStatLine(key: PassiveStat, amount: number): string {
  const format = PASSIVE_FORMAT[key];
  return format.unit === "healing"
    ? `+${Math.round(amount * 3 * 10) / 10} health / 3s`
    : format.unit === "count"
      ? `+${Math.max(1, Math.floor(amount))} ${format.label}`
      : format.unit === "flat"
      ? `+${Math.round(amount * 10) / 10} ${format.label}`
      : `+${Math.round(amount * 100)}% ${format.label}`;
}
export function rankStatLines(
  kind: WeaponId | ItemId,
  level: number,
): string[] {
  if (kind in WEAPONS) {
    const weapon = WEAPONS[kind as WeaponId],
      scale = weapon.unique ? 1 : rankScale(level);
    if (weapon.statLines) return weapon.statLines(level, scale);
    const pellets = patternCount(weapon.pattern(level));
    return [
      `${Math.round(weapon.damage * scale)}${pellets > 1 ? ` × ${pellets}` : ""} damage`,
      `${weapon.cooldown}s per attack`,
      weapon.rankDescription?.(level) ?? weapon.description,
    ];
  }
  const scale = rankScale(level),
    item = ITEMS[kind as ItemId],
    lines: string[] = [];
  for (const [key, value] of Object.entries(item.passiveStats) as [
    PassiveStat,
    number,
  ][])
    lines.push(passiveStatLine(key, value * scale));
  if (item.drone) {
    const d = item.drone;
    if (d.attack === "repair")
      lines.push(
        `${Math.round(d.damage * scale * 10) / 10} health / ${d.cooldown}s`,
      );
    else if (d.damage)
      lines.push(`${Math.round(d.damage * scale)} damage / ${d.cooldown}s`);
  }
  return [...lines, ...(item.category === "drone" ? [item.description] : [])];
}
/** Set bonuses switch on at these piece counts. */
export const SET_TIERS = [2, 4, 6] as const;
export type SetTierSize = (typeof SET_TIERS)[number];
export interface FamilyDefinition {
  id: FamilyId;
  name: string;
  color: string;
  thresholds: Record<SetTierSize, string>;
}
export const FAMILIES: Record<FamilyId, FamilyDefinition> = {
  kinetic: {
    id: "kinetic",
    name: "Physical",
    color: "#edc280",
    thresholds: {
      2: "10% critical chance. Critical hits deal 60% more damage.",
      4: "20% critical chance. Shots pass through 1 extra enemy.",
      6: "30% critical chance. Critical hits deal 100% more damage. Shots pass through 2 extra enemies.",
    },
  },
  thermal: {
    id: "thermal",
    name: "Fire",
    color: "#ff8658",
    thresholds: {
      2: "Hits burn enemies for 6 damage/sec.",
      4: "Hits burn enemies for 12 damage/sec.",
      6: "Hits burn enemies for 20 damage/sec. Burning enemies explode on death for 30% of their max health.",
    },
  },
  storm: {
    id: "storm",
    name: "Lightning",
    color: "#8ce5f2",
    thresholds: {
      2: "10% chance to hit another enemy for 45% damage.",
      4: "22% chance to hit another enemy for 45% damage.",
      6: "35% chance to hit another enemy for 60% damage, and that hit can jump again.",
    },
  },
  frost: {
    id: "frost",
    name: "Ice",
    color: "#a6dfff",
    thresholds: {
      2: "Hits slow enemies by 20%.",
      4: "Hits slow enemies by 35%.",
      6: "Hits slow enemies by 50%. Slowed enemies take 20% more damage.",
    },
  },
  toxic: {
    id: "toxic",
    name: "Poison",
    color: "#badb72",
    thresholds: {
      2: "Poison: 4 damage/sec per stack. Up to 3 stacks.",
      4: "Poison: 8 damage/sec per stack. Poison kills heal 2.",
      6: "Poison: 12 damage/sec per stack. Up to 5 stacks. Poison kills heal 4 and spread poison nearby.",
    },
  },
  drone: {
    id: "drone",
    name: "Drones",
    color: "#d1b5ff",
    thresholds: {
      2: "+10% attack speed. +5% movement speed.",
      4: "+22% attack speed. +10% movement speed.",
      6: "+35% attack speed. +15% movement speed. Drones attack twice as often and deal 50% more damage.",
    },
  },
};
export type SetTier = 0 | 1 | 2 | 3;
export interface Synergy {
  id: FamilyId;
  name: string;
  color: string;
  count: number;
  tier: SetTier;
  next: SetTierSize | null;
  description: string;
}
export const setTier = (count: number): SetTier =>
  SET_TIERS.filter((size) => count >= size).length as SetTier;
export const nextSetTier = (count: number): SetTierSize | null =>
  SET_TIERS.find((size) => count < size) ?? null;
export function getSynergies(
  weapons: ReadonlyArray<{ kind: WeaponId }>,
  items:
    | Partial<Record<ItemId, number>>
    | ReadonlyArray<{ kind: WeaponId | ItemId; category: string }>,
  /** Families a hero counts toward on its own. */
  heroFamilies: ReadonlyArray<FamilyId> = [],
): Synergy[] {
  return Object.values(FAMILIES).map((family) => {
    const active = Array.isArray(items)
      ? items
          .filter((e) => e.category !== "weapon")
          .map((e) => ITEMS[e.kind as ItemId])
      : Object.values(ITEMS).filter(
          (item) =>
            ((items as Partial<Record<ItemId, number>>)[item.id] ?? 0) > 0,
        );
    const count =
      weapons.filter((weapon) =>
        WEAPONS[weapon.kind].families.includes(family.id),
      ).length +
      active.filter((item) => item.families.includes(family.id)).length +
      (heroFamilies.includes(family.id) ? 1 : 0);
    const tier = setTier(count),
      next = nextSetTier(count);
    return {
      ...family,
      count,
      tier,
      next,
      description:
        family.thresholds[tier === 0 ? 2 : SET_TIERS[tier - 1]],
    };
  });
}
export const THREATS: {
  wave: number;
  kind: EnemyKind;
  name: string;
  description: string;
}[] = [
  {
    wave: 4,
    kind: "runner",
    name: "Runners",
    description: "Fast enemies. Keep moving.",
  },
  {
    wave: 7,
    kind: "brute",
    name: "Brutes",
    description: "Slow, tough, and hits hard.",
  },
  {
    wave: 10,
    kind: "shooter",
    name: "Shooters",
    description: "Fires from a distance. Dodge the shots.",
  },
  {
    wave: 13,
    kind: "charger",
    name: "Chargers",
    description: "Rushes straight at you. Move to the side.",
  },
  {
    wave: 16,
    kind: "splitter",
    name: "Splitters",
    description: "Splits into 3 Runners when defeated.",
  },
  {
    wave: 19,
    kind: "shielder",
    name: "Shielders",
    description: "Protects nearby enemies. Break its shield.",
  },
  {
    wave: 22,
    kind: "bomber",
    name: "Bombers",
    description: "Explodes nearby. Leave the marked circle.",
  },
  {
    wave: 25,
    kind: "medic",
    name: "Medics",
    description: "Heals nearby enemies. Defeat it first.",
  },
  {
    wave: 28,
    kind: "sniper",
    name: "Snipers",
    description: "Aims, then fires fast. Dodge the aim line.",
  },
];
export const BOSS_NAMES = [
  "Gatekeeper",
  "Breaker",
  "Furnace",
  "Stormheart",
  "Broodmother",
  "Iron Choir",
  "Venom Regent",
  "Citadel",
  "Lifebinder",
  "The Crucible",
];
export const waveDuration = (wave: number, interval = BOSS_INTERVAL) =>
  wave % interval === 0
    ? 45
    : Math.min(
        45,
        30 + ((wave - 1) % BOSS_INTERVAL) * 3 + Math.floor((wave - 1) / 10) * 2,
      );
/* ---------------------------------------------------------------------------
 * Maps. Every map is a full campaign against the same enemy roster; each one
 * multiplies the base curve and adds one rule. Map 1 is the base curve itself.
 * ------------------------------------------------------------------------- */
export type MapId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const MAP_COUNT = 10;
export const MAP_ORDER: MapId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export type MapRuleId =
  | "none"
  | "stampede"
  | "earlyThreats"
  | "wardedBosses"
  | "elites"
  | "scorched"
  | "volatile"
  | "fog"
  | "gauntlet"
  | "twinFinale";
export type MapDecoration = "pylons" | "barricades" | "vents" | "spires" | "ruins";
export interface MapPalette {
  background: number;
  fog: number;
  fogDensity: number;
  ground: string;
  groundTile: string;
  groundLine: string;
  slab: number;
  edge: number;
  trim: number;
  accent: number;
  lamp: number;
  sky: number;
  groundLight: number;
  dust: number;
}
export interface MapTuning {
  /** Non-boss enemy health multiplier. */
  hp: number;
  /** Enemy contact, bullet and hazard damage multiplier. */
  damage: number;
  /** Added to the per-wave enemy speed bonus and to its cap. */
  speedBonus: number;
  /** Extra enemies per spawn group and per horde. */
  spawnGroup: number;
  /** Multiplier on the number of enemies each wave spawns. */
  budget: number;
  bossHp: number;
  salvage: number;
  prices: number;
  /** Waves added to every new enemy type's arrival; negative is earlier. */
  threatShift: number;
}
export interface MapDefinition {
  id: MapId;
  key: string;
  name: string;
  tagline: string;
  rule: { id: MapRuleId; title: string; description: string };
  palette: MapPalette;
  decoration: MapDecoration;
  tuning: MapTuning;
}
/** Map modifiers reach full strength on this wave; the opening ramps toward it. */
export const MAP_RAMP = { start: 0.375, fullWave: 6 } as const;
export const mapRamp = (wave: number) =>
  Math.max(MAP_RAMP.start, Math.min(1, (wave + 2) / (MAP_RAMP.fullWave + 2)));
const palette = (
  background: number,
  fog: number,
  fogDensity: number,
  ground: string,
  groundTile: string,
  groundLine: string,
  slab: number,
  edge: number,
  trim: number,
  accent: number,
  lamp: number,
  sky: number,
  groundLight: number,
  dust: number,
): MapPalette => ({
  background,
  fog,
  fogDensity,
  ground,
  groundTile,
  groundLine,
  slab,
  edge,
  trim,
  accent,
  lamp,
  sky,
  groundLight,
  dust,
});
const tuning = (
  hp: number,
  damage: number,
  speedBonus: number,
  spawnGroup: number,
  budget: number,
  bossHp: number,
  salvage: number,
  prices: number,
  threatShift: number,
): MapTuning => ({
  hp,
  damage,
  speedBonus,
  spawnGroup,
  budget,
  bossHp,
  salvage,
  prices,
  threatShift,
});
export const MAPS: MapDefinition[] = [
  {
    id: 1,
    key: "foundry",
    name: "Foundry Yard",
    tagline: "Where every run starts.",
    rule: {
      id: "none",
      title: "Proving Ground",
      description: "No special rule. Learn the enemies and the shop.",
    },
    palette: palette(
      0x161c23, 0x161c23, 0.014, "#26343e", "#30404a", "#8399a3",
      0x111b23, 0xe27c43, 0xbaa67b, 0xebad63, 0xff7b40, 0xcbdcea, 0x30353b,
      0xe5bb89,
    ),
    decoration: "pylons",
    tuning: tuning(1, 1, 0, 0, 1, 1, 1, 1, 0),
  },
  {
    id: 2,
    key: "flats",
    name: "Salt Flats",
    tagline: "Nowhere to hide.",
    rule: {
      id: "stampede",
      title: "Stampede",
      description: "Runners join every wave from wave 1.",
    },
    palette: palette(
      0x1f2426, 0x2a2f30, 0.011, "#3a3f3b", "#4a4e46", "#b8b09a",
      0x1a1d1c, 0xd8c67a, 0xd9d2b8, 0xf1e3a0, 0xffd27a, 0xe8e6da, 0x4a4a42,
      0xf0e3b8,
    ),
    decoration: "barricades",
    tuning: tuning(1.08, 1.06, 0.03, 0, 1.04, 1.08, 1.05, 1.03, 0),
  },
  {
    id: 3,
    key: "quarry",
    name: "Rust Quarry",
    tagline: "They come early.",
    rule: {
      id: "earlyThreats",
      title: "Early Threats",
      description: "New enemy types arrive 3 waves sooner.",
    },
    palette: palette(
      0x1b1410, 0x23170f, 0.015, "#3b2a1f", "#4a3427", "#a77b52",
      0x1b120c, 0xd4692e, 0xa77b52, 0xe9a25a, 0xff8a3a, 0xd9b89a, 0x3d2b21,
      0xd9a274,
    ),
    decoration: "vents",
    tuning: tuning(1.16, 1.12, 0.05, 0, 1.08, 1.16, 1.1, 1.06, -3),
  },
  {
    id: 4,
    key: "dock",
    name: "Bulwark Dock",
    tagline: "Break the wards.",
    rule: {
      id: "wardedBosses",
      title: "Warded Bosses",
      description: "Every boss spawns with a 30% shield that regrows.",
    },
    palette: palette(
      0x0f1a24, 0x0f1c28, 0.016, "#1f3542", "#274250", "#8fb6c4",
      0x0b1620, 0x4fb3d9, 0x8fb6c4, 0x9ee2ff, 0x5fc4ff, 0xbfe1f2, 0x203540,
      0xa8d8ea,
    ),
    decoration: "spires",
    tuning: tuning(1.25, 1.18, 0.07, 1, 1.12, 1.25, 1.15, 1.1, -1),
  },
  {
    id: 5,
    key: "vault",
    name: "Ember Vault",
    tagline: "Big targets, big payouts.",
    rule: {
      id: "elites",
      title: "Elites",
      description:
        "Elite enemies are twice as common, at least 1 in 5. Elites have double health and drop 3× emeralds.",
    },
    palette: palette(
      0x1c1512, 0x201612, 0.014, "#352622", "#42302a", "#c9a45c",
      0x1a1210, 0xf0b23a, 0xc9a45c, 0xffd36b, 0xffc040, 0xe6d2b0, 0x3a2b24,
      0xf2cf86,
    ),
    decoration: "pylons",
    tuning: tuning(1.4, 1.3, 0.09, 1, 1.18, 1.4, 1.2, 1.14, -1),
  },
  {
    id: 6,
    key: "furnace",
    name: "Cinder Furnace",
    tagline: "Keep moving or burn.",
    rule: {
      id: "scorched",
      title: "Scorched Floor",
      description:
        "Standing still for 1 second burns you for 4% of max health per second.",
    },
    palette: palette(
      0x1a0c0a, 0x2a0f0a, 0.018, "#3a1c16", "#47231b", "#ff5a2a",
      0x1c0b08, 0xff5a2a, 0x8a4a3a, 0xff9a52, 0xff4a1c, 0xffb08a, 0x3b1a14,
      0xff8a55,
    ),
    decoration: "vents",
    tuning: tuning(1.65, 1.55, 0.11, 1, 1.26, 1.7, 1.26, 1.18, -2),
  },
  {
    id: 7,
    key: "nest",
    name: "Brood Nest",
    tagline: "Nothing dies quietly.",
    rule: {
      id: "volatile",
      title: "Volatile",
      description: "Grunts and Runners burst shortly after they die. Step away.",
    },
    palette: palette(
      0x10161a, 0x142018, 0.016, "#1f2e26", "#28382e", "#6f8a5a",
      0x0e1712, 0x86d64a, 0x6f8a5a, 0xb6ff6a, 0x8cff5a, 0xc6e6c0, 0x233229,
      0xa9e27a,
    ),
    decoration: "ruins",
    tuning: tuning(1.9, 1.75, 0.13, 1, 1.35, 2, 1.32, 1.22, -2),
  },
  {
    id: 8,
    key: "mist",
    name: "Mist Reach",
    tagline: "Short sight, short range.",
    rule: {
      id: "fog",
      title: "Fog",
      description: "Weapon and drone reach is reduced by 25%.",
    },
    palette: palette(
      0x2a3238, 0x38434a, 0.03, "#2c3a40", "#35444b", "#a8b6bd",
      0x1e262b, 0x9fd0e0, 0xa8b6bd, 0xd4f0ff, 0xbfe8ff, 0xe0eef5, 0x3a464c,
      0xdbe8ee,
    ),
    decoration: "spires",
    tuning: tuning(2.2, 2, 0.18, 2, 1.42, 2.35, 1.38, 1.26, -2),
  },
  {
    id: 9,
    key: "gauntlet",
    name: "Iron Gauntlet",
    tagline: "Fifteen bosses.",
    rule: {
      id: "gauntlet",
      title: "Boss Gauntlet",
      description: "A boss arrives every 2 waves instead of every 3.",
    },
    palette: palette(
      0x121216, 0x16161c, 0.014, "#2a2a30", "#343440", "#8c8c98",
      0x0e0e12, 0xd94a5a, 0x8c8c98, 0xff6b7a, 0xff4d6a, 0xd6d6e6, 0x2d2d36,
      0xd0d0e0,
    ),
    decoration: "barricades",
    tuning: tuning(2.55, 2.3, 0.21, 2, 1.5, 2.75, 1.44, 1.3, -3),
  },
  {
    id: 10,
    key: "crucible",
    name: "The Crucible",
    tagline: "Two guardians. One finale.",
    rule: {
      id: "twinFinale",
      title: "Twin Finale",
      description: "Wave 30 is held by two bosses at once.",
    },
    palette: palette(
      0x0c0a12, 0x160c1c, 0.017, "#2a1c33", "#35243f", "#7a5a99",
      0x0f0a16, 0xb455ff, 0x7a5a99, 0xe08cff, 0xa64dff, 0xd8c2ee, 0x2d2238,
      0xcf9cff,
    ),
    decoration: "ruins",
    tuning: tuning(3, 2.7, 0.25, 2, 1.6, 3.3, 1.5, 1.35, -3),
  },
];
export const mapById = (id: number): MapDefinition =>
  MAPS[
    Math.min(MAP_COUNT, Math.max(1, Number.isFinite(id) ? Math.floor(id) : 1)) -
      1
  ];
export const threatWave = (threat: { wave: number }, map: MapDefinition) =>
  Math.min(
    CAMPAIGN_WAVES,
    Math.max(1, threat.wave + map.tuning.threatShift),
  );
export const mapThreatSchedule = (map: MapDefinition) =>
  THREATS.map((threat) => ({ ...threat, wave: threatWave(threat, map) }));
/** Plain lines for the guide and the roster: only the knobs that differ from map 1. */
export function mapStatLines(map: MapDefinition): string[] {
  const t = map.tuning,
    lines: string[] = [],
    pct = (n: number) => `${n >= 1 ? "+" : "−"}${Math.round(Math.abs(n - 1) * 100)}%`;
  if (t.hp !== 1) lines.push(`Enemy health ${pct(t.hp)}`);
  if (t.damage !== 1) lines.push(`Enemy damage ${pct(t.damage)}`);
  if (t.speedBonus) lines.push(`Enemy speed +${Math.round(t.speedBonus * 100)}%`);
  if (t.budget !== 1) lines.push(`Enemies per wave ${pct(t.budget)}`);
  if (t.spawnGroup) lines.push(`+${t.spawnGroup} per spawn group`);
  if (t.bossHp !== 1) lines.push(`Boss health ${pct(t.bossHp)}`);
  if (t.salvage !== 1) lines.push(`Emeralds ${pct(t.salvage)}`);
  if (t.prices !== 1) lines.push(`Shop prices ${pct(t.prices)}`);
  if (t.threatShift)
    lines.push(
      `New enemies ${Math.abs(t.threatShift)} wave${Math.abs(t.threatShift) === 1 ? "" : "s"} ${t.threatShift < 0 ? "earlier" : "later"}`,
    );
  if (!lines.length) lines.push("Base difficulty");
  return lines;
}
export const WAVE_DURATIONS = Array.from(
  { length: CAMPAIGN_WAVES },
  (_, index) => waveDuration(index + 1),
);
export const ARENA_RADIUS = 17;
export const BAG_CAPACITY = 12;
/** Extra bag slots are bought in the shop, a few per run. */
export const BAG_SLOT_COST = 2000;
export const MAX_EXTRA_SLOTS = 4;
export const SHOP_OFFERS = 4;
/** The shop's prices, so the guide and the simulation cannot drift apart. */
export const RANK_PRICE_MULTIPLIERS = [1, 1.35, 1.9, 2.8, 4.1, 6] as const;
export const offerPrice = (base: number, wave: number, level: number) =>
  Math.ceil(
    (base + wave * 1.3) *
      RANK_PRICE_MULTIPLIERS[Math.max(0, Math.min(5, Math.floor(level) - 1))],
  );
export const rerollCost = (wave: number, rolls: number) =>
  4 + wave + rolls * 3;
export const REPAIR_HEAL = 0.45;
export const repairCost = (wave: number) => 8 + wave * 2;
export const SELL_RATE = 0.5;
export const WAVE_CLEAR_BONUS = (wave: number) => 9 + wave * 2;
export const WAVE_END_HEAL = 0.1;
export const WEAVE = { dodges: 3, bonus: 0.25, duration: 3.5 } as const;
export const ENEMY_STATS: Record<
  EnemyKind,
  {
    hp: number;
    speed: number;
    radius: number;
    damage: number;
    salvage: number;
  }
> = {
  grunt: { hp: 50, speed: 2.6, radius: 0.54, damage: 10, salvage: 1 },
  runner: { hp: 20, speed: 3.5, radius: 0.4, damage: 8, salvage: 1 },
  brute: { hp: 125, speed: 1.22, radius: 0.83, damage: 18, salvage: 2 },
  shooter: { hp: 56, speed: 1.55, radius: 0.53, damage: 12, salvage: 2 },
  charger: { hp: 88, speed: 1.8, radius: 0.65, damage: 17, salvage: 2 },
  splitter: { hp: 95, speed: 1.6, radius: 0.64, damage: 12, salvage: 3 },
  shielder: { hp: 130, speed: 1.1, radius: 0.77, damage: 16, salvage: 4 },
  bomber: { hp: 48, speed: 2.35, radius: 0.48, damage: 25, salvage: 2 },
  medic: { hp: 85, speed: 1.3, radius: 0.58, damage: 9, salvage: 4 },
  sniper: { hp: 90, speed: 1.15, radius: 0.58, damage: 22, salvage: 4 },
  boss: { hp: 2400, speed: 1.08, radius: 1.9, damage: 22, salvage: 40 },
};

/* ---------------------------------------------------------------------------
 * Waves. Each wave spawns a fixed number of enemies (its budget) over its
 * timer; the HUD counts them down. The timer still ends the wave.
 * ------------------------------------------------------------------------- */
export const waveBudget = (wave: number) =>
  Math.round(36 + 3.5 * wave + 0.11 * wave * wave);
/** Boss waves spawn adds during their first 45 seconds. */
export const bossAddBudget = (wave: number) => Math.round(waveBudget(wave) * 0.55);
export const spawnGroupSize = (wave: number) => 3 + Math.floor((wave - 1) / 9);
export const hordeCount = (wave: number) => (wave < 3 ? 1 : wave < 15 ? 2 : 3);
export const hordeProgress = (wave: number): number[] =>
  wave < 3 ? [0.55] : wave < 15 ? [0.35, 0.7] : [0.25, 0.55, 0.85];
export const hordeSize = (wave: number) =>
  Math.max(4, Math.min(28, Math.round(waveBudget(wave) * 0.12)));
export const ENEMY_CAP = 60;
export const SPAWN_TELEGRAPH = 0.7;
export const HORDE_TELEGRAPH = 1;
/** Enemies spawn anywhere this far from the player. */
export const SPAWN_DISTANCE = { min: 5, max: 14 } as const;
export const HORDE_RING = { min: 7, max: 9 } as const;
export const eliteChance = (wave: number) =>
  wave < 8 ? 0 : Math.min(0.15, 0.03 + (wave - 10) * 0.006);
export const ELITE = { hp: 2.2, speed: 1.25, radius: 1.35, salvage: 3 } as const;
/** The base enemy curve (map 1). Maps multiply on top of it. */
export const ENEMY_CURVE = {
  hpLinear: 0.3,
  hpQuadratic: 0.02,
  bossBase: 0.72,
  bossPower: 1.6,
  speedPerWave: 0.03,
  speedCap: 0.85,
  damageLinear: 0.045,
  damageQuadratic: 0.0022,
  armorCap: 0.6,
  chargerSpeed: 10,
  chargerSpeedPerWave: 0.3,
  chargerSpeedBonusCap: 4.5,
  shooterBulletSpeed: 7,
  shooterBulletSpeedPerWave: 0.4,
  shooterBulletSpeedBonusCap: 4,
  shooterInterval: 2.6,
  shooterIntervalPerWave: 0.04,
  shooterIntervalFloor: 1.9,
  sniperBulletSpeed: 23,
  sniperBulletSpeedPerWave: 1.5,
  sniperBulletSpeedBonusCap: 5,
} as const;

/* ---------------------------------------------------------------------------
 * Hints: shown once each in play and listed in the guide.
 * ------------------------------------------------------------------------- */
export type HintTrigger =
  | "wave1"
  | "firstShop"
  | "counter"
  | "horde"
  | "firstMod"
  | "firstInsane"
  | "firstSetTier"
  | "firstMapClear"
  | "slot";
export interface HintDefinition {
  id: string;
  trigger: HintTrigger;
  title: string;
  text: string;
  keys?: string;
  touch?: string;
  duration?: number;
}
export const HINTS: HintDefinition[] = [
  {
    id: "move",
    trigger: "wave1",
    title: "Moving",
    text: "Move with WASD or drag. Space dashes. Weapons fire on their own.",
    keys: "WASD or drag to move · SPACE to dash · Weapons fire on their own",
    touch: "Drag to move · Tap Dash to dodge · Weapons fire on their own",
  },
  {
    id: "counter",
    trigger: "counter",
    title: "Enemy counter",
    text: "The counter shows enemies left this wave. Clear them all to end the wave early.",
    duration: 6000,
  },
  {
    id: "shop",
    trigger: "firstShop",
    title: "Shop",
    text: "Buy gear with emeralds. Merge two matching pieces at the same rank to rank up.",
    duration: 7000,
  },
  {
    id: "horde",
    trigger: "horde",
    title: "Hordes",
    text: "A horde is forming around you. Move before the rings close.",
    duration: 4000,
  },
  {
    id: "mods",
    trigger: "firstMod",
    title: "Mods",
    text: "Mods change how all your bullets behave. They work from the bag.",
    duration: 6000,
  },
  {
    id: "insane",
    trigger: "firstInsane",
    title: "Insane weapon",
    text: "An Insane weapon. It only shows up after wave 20. Lock it if you cannot afford it yet.",
    duration: 8000,
  },
  {
    id: "sets",
    trigger: "firstSetTier",
    title: "Sets",
    text: "Two pieces of one set turn on its bonus. Four and six pieces add more.",
    duration: 6000,
  },
  {
    id: "maps",
    trigger: "firstMapClear",
    title: "Maps",
    text: "Clearing a map unlocks the next one for this character.",
    duration: 6000,
  },
  {
    id: "slot",
    trigger: "slot",
    title: "Bag slots",
    text: "You can afford an extra bag slot. Buy it under the bag.",
    duration: 6000,
  },
];
